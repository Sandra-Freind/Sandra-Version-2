import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectRegion,
  outOfScopeReply,
  urgentHealthReply,
  unsupportedRegionReply,
  unsupportedSearchLanguageReply,
  type SandraRegion,
} from './sandraKnowledge';
import { matchSandraMasterDomains } from './sandraMasterTaxonomy';

export type SandraTimeContext =
  | 'now'
  | 'soon'
  | 'today'
  | 'tonight'
  | 'tomorrow'
  | 'tomorrow_morning'
  | 'weekend'
  | 'breakfast'
  | 'lunch'
  | 'dinner'
  | 'unspecified';

export type SandraPreference =
  | 'nearby'
  | 'cheap'
  | 'quiet'
  | 'beachfront'
  | 'dog_friendly'
  | 'no_walking_street';

export type ConversationPhase =
  | 'IDLE'
  | 'UNDERSTANDING'
  | 'WAITING_FOR_LOCATION'
  | 'WAITING_FOR_CLARIFICATION'
  | 'SEARCHING_LOCAL'
  | 'SEARCHING_EXTERNAL'
  | 'VALIDATING_RESULTS'
  | 'SHOWING_RESULTS'
  | 'WAITING_FOR_SELECTION'
  | 'RESULT_SELECTED'
  | 'WAITING_FOR_MORE_DECISION'
  | 'HEALTH_TRIAGE'
  | 'EMERGENCY'
  | 'TRANSLATION_MODE'
  | 'BLOCKED';

export type SandraIntentKind =
  | 'local_search'
  | 'conversation'
  | 'emergency'
  | 'blocked'
  | 'unsupported_language'
  | 'unsupported_region';

export type SandraIntent = {
  kind: SandraIntentKind;
  category?: string;
  raw: string;
  confidence: 'high' | 'medium' | 'low';
};

export type LocationState = {
  region: SandraRegion;
  timestamp: number;
  confidence: 'high' | 'medium' | 'low';
  source: 'explicit_user_statement' | 'session_context';
};

export type ConversationState = {
  currentTopic?: string;
  currentIntent?: SandraIntent;
  pendingIntent?: SandraIntent;
  waitingFor?: 'location' | 'clarification';
  currentLocation?: LocationState;
  futureLocations: Partial<Record<SandraTimeContext, LocationState>>;
  timeContext: SandraTimeContext;
  activePreferences: SandraPreference[];
  previousTopic?: string;
  conversationPhase: ConversationPhase;
  lastMessageAt: number;
};

const states = new Map<string, ConversationState>();
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const CURRENT_LOCATION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_STATE_DIR = process.env.SANDRA_SESSION_STATE_DIR?.trim() || join(process.cwd(), '.sandra-session-state');

function persistedStatePath(session: string): string {
  return join(SESSION_STATE_DIR, `${session.replace(/[^0-9a-z-]/giu, '_')}.json`);
}

function isStructurallyValidState(value: unknown): value is ConversationState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ConversationState>;
  return (
    typeof state.lastMessageAt === 'number' &&
    typeof state.conversationPhase === 'string' &&
    typeof state.timeContext === 'string' &&
    !!state.futureLocations &&
    typeof state.futureLocations === 'object' &&
    Array.isArray(state.activePreferences)
  );
}

function loadPersistedState(session: string, now: number): ConversationState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(persistedStatePath(session), 'utf8'));
    if (!isStructurallyValidState(parsed) || now - parsed.lastMessageAt > STATE_TTL_MS) {
      try { unlinkSync(persistedStatePath(session)); } catch {}
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function persistConversationState(session: string, state: ConversationState): void {
  try {
    mkdirSync(SESSION_STATE_DIR, { recursive: true });
    const target = persistedStatePath(session);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, target);
  } catch {
    // Persistence is a resilience layer. A single request may continue in memory,
    // but the next request will again prefer the newest valid persisted snapshot.
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ß/gu, 'ss');
}

function freshState(now: number): ConversationState {
  return {
    futureLocations: {},
    timeContext: 'unspecified',
    activePreferences: [],
    conversationPhase: 'IDLE',
    lastMessageAt: now,
  };
}

export function getConversationState(session: string): ConversationState {
  const now = Date.now();
  const current = states.get(session);
  const currentIsFresh = !!current && now - current.lastMessageAt <= STATE_TTL_MS;
  const restored = loadPersistedState(session, now);

  // Hostinger may route consecutive requests to different Node processes. Always
  // compare the local snapshot with the persisted one and use whichever is newer.
  // This prevents a stale process-local Map from overwriting a newer location,
  // intent or preference written by another worker.
  if (restored && (!currentIsFresh || !current || restored.lastMessageAt > current.lastMessageAt)) {
    states.set(session, restored);
    return restored;
  }
  if (currentIsFresh && current) return current;

  const created = freshState(now);
  states.set(session, created);
  persistConversationState(session, created);
  return created;
}

export function hydrateConversationLocation(session: string, locationContext: string): ConversationState {
  const state = getConversationState(session);
  const region = detectRegion(locationContext);
  if (!region) return state;
  const now = Date.now();
  const currentIsFresh =
    !!state.currentLocation && now - state.currentLocation.timestamp <= CURRENT_LOCATION_TTL_MS;
  if (!currentIsFresh) {
    state.currentLocation = {
      region,
      timestamp: now,
      confidence: 'medium',
      source: 'session_context',
    };
    state.lastMessageAt = now;
    persistConversationState(session, state);
  }
  return state;
}

export function setConversationPhase(session: string, phase: ConversationPhase): ConversationState {
  const state = getConversationState(session);
  state.conversationPhase = phase;
  state.lastMessageAt = Date.now();
  persistConversationState(session, state);
  return state;
}

export function detectTimeContext(message: string): SandraTimeContext {
  const text = normalize(message);
  if (/\b(?:morgen fruh|morgen vormittag)\b/u.test(text)) return 'tomorrow_morning';
  if (/\b(?:heute abend|heut abend|abendessen|zum abendessen)\b/u.test(text)) return 'tonight';
  if (/\b(?:morgen)\b/u.test(text)) return 'tomorrow';
  if (/\b(?:wochenende|samstag|sonntag)\b/u.test(text)) return 'weekend';
  if (/\b(?:fruhstuck|fruhstucken)\b/u.test(text)) return 'breakfast';
  if (/\b(?:mittagessen|zu mittag)\b/u.test(text)) return 'lunch';
  if (/\b(?:abendessen|dinner)\b/u.test(text)) return 'dinner';
  if (/\b(?:gleich|nachher|spater)\b/u.test(text)) return 'soon';
  if (/\b(?:jetzt|gerade|im moment|sofort)\b/u.test(text)) return 'now';
  if (/\b(?:heute)\b/u.test(text)) return 'today';
  return 'unspecified';
}

export function detectPreferences(message: string): SandraPreference[] {
  const text = normalize(message);
  const values: SandraPreference[] = [];
  if (/\b(?:nah|nahe|in der nahe|nicht zu weit|zu weit)\b/u.test(text)) values.push('nearby');
  if (/\b(?:gunstig\w*|billig\w*|preiswert\w*|zu teuer|weniger teuer)\b/u.test(text)) values.push('cheap');
  if (/\b(?:ruhig\w*|ruhe|nicht so laut)\b/u.test(text)) values.push('quiet');
  if (/\b(?:direkt am strand|am strand|strandlage|beachfront|meerblick)\b/u.test(text)) values.push('beachfront');
  if (/\b(?:hund|hundefreundlich|dog friendly)\b/u.test(text)) values.push('dog_friendly');
  if (/\b(?:keine walking street|nicht walking street|ohne walking street)\b/u.test(text)) values.push('no_walking_street');
  return [...new Set(values)];
}

export function inferIntent(message: string): SandraIntent {
  // One canonical intent gateway: safety/scope decisions are classified before
  // local-search rules so a blocked topic can never inherit a previous place.
  if (urgentHealthReply(message)) {
    return { kind: 'emergency', category: 'health_emergency', raw: message, confidence: 'high' };
  }
  if (outOfScopeReply(message)) {
    return { kind: 'blocked', category: 'out_of_scope', raw: message, confidence: 'high' };
  }
  if (unsupportedSearchLanguageReply(message)) {
    return { kind: 'unsupported_language', raw: message, confidence: 'high' };
  }
  if (unsupportedRegionReply(message)) {
    return { kind: 'unsupported_region', raw: message, confidence: 'high' };
  }

  const text = normalize(message);
  const rules: Array<[RegExp, string]> = [
    [/\b(?:apotheke|pharmacy|medikament|tabletten)\b/u, 'apotheken'],
    [/\b(?:zahnarzt|dentist|zahn)\b/u, 'zahnarzt'],
    [/\b(?:arzt|doktor|klinik|krankenhaus|hospital)\b/u, 'aerzte'],
    [/\b(?:restaurant|essen|hunger|fruhstuck|mittagessen|abendessen)\b/u, 'restaurants'],
    [/\b(?:hotel|unterkunft|zimmer)\b/u, 'hotels'],
    [/\b(?:taxi|bolt|grab|bus|transport|mietwagen|roller)\b/u, 'transport'],
    [/\b(?:werkstatt|abschlepp\w*|pannenhilfe)\b/u, 'fahrzeughilfe'],
    [/\b(?:handwerker|klimaanlage|schlussel\w*|schloss\w*|reparatur|handy .*kaputt)\b/u, 'dienstleistungen'],
    [/\b(?:immigration|visum|visa|behorde)\b/u, 'behoerden'],
    [/\b(?:unternehmen|freizeit|ausflug|tennis|fitness|strand)\b/u, 'freizeit'],
  ];
  for (const [pattern, category] of rules) {
    if (pattern.test(text)) return { kind: 'local_search', category, raw: message, confidence: 'high' };
  }
  // Explicit follow-up phrases describe the already active result/task. They must
  // not be reinterpreted by a weaker taxonomy match as an unrelated new domain.
  if (isTaskContinuation(message)) {
    return { kind: 'conversation', raw: message, confidence: 'high' };
  }
  const masterMatches = matchSandraMasterDomains(message);
  if (masterMatches.length > 0) {
    return { kind: 'local_search', category: masterMatches[0].id, raw: message, confidence: 'high' };
  }
  return { kind: 'conversation', raw: message, confidence: 'medium' };
}

function looksLikeBareLocation(message: string): boolean {
  const text = normalize(message).replace(/[.!?,;:]+/gu, ' ').trim();
  return detectRegion(text) !== null && text.split(/\s+/u).length <= 5;
}

function splitTemporalRegions(message: string): { current: SandraRegion | null; future: SandraRegion | null } {
  const normalizedMessage = normalize(message);
  const marker = normalizedMessage.match(/\b(?:heute abend|morgen fruh|morgen|spater|nachher|am wochenende)\b/u);
  if (!marker || marker.index === undefined) return { current: null, future: null };
  const before = message.slice(0, marker.index);
  const after = message.slice(marker.index);
  return {
    current: detectRegion(before),
    future: detectRegion(after),
  };
}

function explicitCurrentLocation(message: string): boolean {
  const text = normalize(message);
  return /\b(?:ich bin|bin gerade|jetzt bin ich|befinde mich|ich stehe|wir sind)\b/u.test(text) && !/\b(?:heute abend|morgen|spater|nachher)\b/u.test(text);
}

function explicitFutureLocation(message: string): boolean {
  const text = normalize(message);
  return /\b(?:heute abend|morgen|spater|nachher|am wochenende)\b/u.test(text) && /\b(?:bin ich|sind wir|werde ich|werden wir|in)\b/u.test(text);
}

function isTaskContinuation(message: string): boolean {
  const text = normalize(message);
  return /\b(?:noch zwei|noch eine|noch eins|mehr|weitere|der erste|der zweite|der dritte|die erste|die zweite|die dritte|das erste|das zweite|das dritte|telefon|telefonnummer|adresse|offnungszeit|wie komme ich|route|dahin|zu teuer|zu weit|gefallt mir|passt|nehme ich)\b/u.test(text);
}

function isPreferenceOnlyContinuation(message: string): boolean {
  if (detectPreferences(message).length === 0) return false;
  const text = normalize(message);
  return !/\b(?:suche|such|brauche|benotige|finde|gibt es|zeig|zeige|empfiehl|kaufen|mieten|buchen|apotheke|pharmacy|zahnarzt|dentist|arzt|doktor|klinik|krankenhaus|hospital|restaurant|essen|hotel|unterkunft|zimmer|taxi|bolt|grab|bus|transport|mietwagen|roller|werkstatt|abschlepp\w*|pannenhilfe|handwerker|klimaanlage|schlussel\w*|schloss\w*|immigration|visum|visa|behorde|freizeit|ausflug|tennis|fitness)\b/u.test(text);
}

export function updateConversationState(
  session: string,
  message: string,
): ConversationState {
  const state = getConversationState(session);
  const now = Date.now();
  state.lastMessageAt = now;
  state.conversationPhase = 'UNDERSTANDING';

  const region = detectRegion(message);
  const time = detectTimeContext(message);
  const temporalRegions = splitTemporalRegions(message);
  if (time !== 'unspecified') state.timeContext = time;

  if (temporalRegions.current && temporalRegions.future && time !== 'unspecified' && time !== 'now') {
    state.currentLocation = {
      region: temporalRegions.current,
      timestamp: now,
      confidence: 'high',
      source: 'explicit_user_statement',
    };
    state.futureLocations[time] = {
      region: temporalRegions.future,
      timestamp: now,
      confidence: 'high',
      source: 'explicit_user_statement',
    };
  } else if (region) {
    const locationState: LocationState = {
      region,
      timestamp: now,
      confidence: 'high',
      source: 'explicit_user_statement',
    };
    if (explicitFutureLocation(message) && time !== 'unspecified' && time !== 'now') {
      state.futureLocations[time] = locationState;
    } else if (explicitCurrentLocation(message) || looksLikeBareLocation(message) || state.waitingFor === 'location') {
      state.currentLocation = locationState;
      // An explicit present-location statement ends a previously sticky future
      // time context. Follow-up searches now resolve to the newly stated place.
      if (time === 'unspecified') state.timeContext = 'now';
    }
  }

  const intent = inferIntent(message);
  if (intent.kind === 'emergency') {
    state.currentIntent = intent;
    state.pendingIntent = undefined;
    state.waitingFor = undefined;
    state.conversationPhase = 'EMERGENCY';
    persistConversationState(session, state);
    return state;
  }
  if (intent.kind === 'blocked' || intent.kind === 'unsupported_language' || intent.kind === 'unsupported_region') {
    // Safety/scope messages are intentionally non-destructive: preserve the
    // user's previous local task so a later valid follow-up can continue, but
    // never mutate/search using the blocked message itself.
    state.conversationPhase = 'BLOCKED';
    persistConversationState(session, state);
    return state;
  }

  const preferences = detectPreferences(message);

  if (state.waitingFor === 'location' && region) {
    state.waitingFor = undefined;
    state.currentIntent = state.pendingIntent;
    state.pendingIntent = undefined;
    state.conversationPhase = 'SEARCHING_LOCAL';
    persistConversationState(session, state);
    return state;
  }

  if (state.currentIntent?.kind === 'local_search' && isPreferenceOnlyContinuation(message)) {
    state.activePreferences = [...new Set([...state.activePreferences, ...preferences])];
    state.conversationPhase = 'SEARCHING_LOCAL';
  } else if (intent.kind === 'local_search') {
    if (state.currentTopic && state.currentTopic !== intent.category) {
      state.previousTopic = state.currentTopic;
      state.activePreferences = [];
    }
    if (preferences.length) state.activePreferences = [...new Set([...state.activePreferences, ...preferences])];
    state.currentTopic = intent.category;
    state.currentIntent = intent;
    if (!region && !resolveRelevantRegion(state, time)) {
      state.pendingIntent = intent;
      state.waitingFor = 'location';
      state.conversationPhase = 'WAITING_FOR_LOCATION';
    } else {
      state.pendingIntent = undefined;
      state.waitingFor = undefined;
      state.conversationPhase = 'SEARCHING_LOCAL';
    }
  } else if (state.currentIntent?.kind === 'local_search' && (preferences.length > 0 || isTaskContinuation(message))) {
    if (preferences.length) state.activePreferences = [...new Set([...state.activePreferences, ...preferences])];
    state.conversationPhase = 'SEARCHING_LOCAL';
  } else {
    state.currentIntent = intent;
    state.conversationPhase = 'IDLE';
  }

  persistConversationState(session, state);
  return state;
}

export function resolveRelevantRegion(
  state: ConversationState,
  requestedTime: SandraTimeContext = state.timeContext,
): SandraRegion | null {
  const effectiveTime = requestedTime === 'unspecified' ? state.timeContext : requestedTime;
  const future = effectiveTime !== 'unspecified' && effectiveTime !== 'now'
    ? state.futureLocations[effectiveTime]
    : undefined;
  if (future) return future.region;
  if (state.currentLocation && Date.now() - state.currentLocation.timestamp <= CURRENT_LOCATION_TTL_MS) {
    return state.currentLocation.region;
  }
  return null;
}

export function pendingLocationReply(state: ConversationState): string | null {
  if (state.waitingFor !== 'location' || !state.pendingIntent) return null;
  const category = state.pendingIntent.category;
  if (category === 'restaurants') return 'Klar 😊 Wo bist du gerade ungefähr? Dann suche ich dir etwas Passendes in deiner Nähe.';
  if (category === 'apotheken') return 'Klar. Wo bist du gerade ungefähr? Dann suche ich dir direkt eine Apotheke in deiner Nähe.';
  if (category === 'aerzte' || category === 'zahnarzt') return 'Klar. Sag mir kurz, wo du gerade ungefähr bist, dann suche ich dir etwas Passendes in deiner Nähe.';
  return 'Klar. Wo bist du gerade ungefähr? Dann schaue ich direkt für dich.';
}

export function buildSearchMessage(message: string, state: ConversationState): string {
  const region = resolveRelevantRegion(state, detectTimeContext(message));
  const preferenceText = state.activePreferences.length ? ` Präferenzen: ${state.activePreferences.join(', ')}.` : '';
  const timeText = state.timeContext !== 'unspecified' ? ` Zeitbezug: ${state.timeContext}.` : '';
  const regionText = region ? ` Gebiet: ${region}.` : '';
  const bareRegion = detectRegion(message) !== null && normalize(message).replace(/[.!?,;:]+/gu, ' ').trim().split(/\s+/u).length <= 5;
  const messageIntent = inferIntent(message);
  const continuingTask =
    state.currentIntent?.kind === 'local_search' &&
    (bareRegion || messageIntent.kind === 'conversation');
  const base = continuingTask
    ? `${state.currentIntent?.raw ?? `Ich brauche ${state.currentIntent?.category ?? 'etwas Passendes'}.`} Zusätzliche Anforderung: ${message}`
    : message;
  return `${base}${regionText}${timeText}${preferenceText}`.trim();
}

export function resetTaskPreferences(state: ConversationState): void {
  state.activePreferences = [];
}
