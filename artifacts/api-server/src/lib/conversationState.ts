import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectRegion, type SandraRegion } from './sandraKnowledge';
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
  | 'TRANSLATION_MODE';

export type SandraIntent = {
  kind: string;
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
  // Session IDs have already been validated by the route. Replacing anything
  // unexpected keeps this helper safe if it is ever reused elsewhere.
  return join(SESSION_STATE_DIR, `${session.replace(/[^0-9a-z-]/giu, '_')}.json`);
}

function loadPersistedState(session: string, now: number): ConversationState | null {
  try {
    const parsed = JSON.parse(readFileSync(persistedStatePath(session), 'utf8')) as ConversationState;
    if (!parsed || typeof parsed.lastMessageAt !== 'number' || now - parsed.lastMessageAt > STATE_TTL_MS) {
      try { unlinkSync(persistedStatePath(session)); } catch {}
      return null;
    }
    if (!parsed.futureLocations || !Array.isArray(parsed.activePreferences)) return null;
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
    // In-memory state remains available if the host filesystem is temporarily
    // unavailable. Persistence is a resilience layer, not a hard dependency.
  }
}

function normalize(value: string): string {
  return value.toLocaleLowerCase('de-DE').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ß/gu, 'ss');
}

export function getConversationState(session: string): ConversationState {
  const now = Date.now();
  const current = states.get(session);
  if (current && now - current.lastMessageAt <= STATE_TTL_MS) return current;
  const restored = loadPersistedState(session, now);
  if (restored) {
    states.set(session, restored);
    return restored;
  }
  const created: ConversationState = {
    futureLocations: {},
    timeContext: 'unspecified',
    activePreferences: [],
    conversationPhase: 'IDLE',
    lastMessageAt: now,
  };
  states.set(session, created);
  persistConversationState(session, created);
  return created;
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
  // Future markers must win when one message states both the current and a later location,
  // e.g. "Ich bin jetzt in Naklua, später bin ich in Jomtien".
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
  const text = normalize(message);
  const rules: Array<[RegExp, string, string]> = [
    [/\b(?:apotheke|pharmacy|medikament|tabletten)\b/u, 'local_search', 'apotheken'],
    [/\b(?:zahnarzt|dentist|zahn)\b/u, 'local_search', 'zahnarzt'],
    [/\b(?:arzt|doktor|klinik|krankenhaus|hospital)\b/u, 'local_search', 'aerzte'],
    [/\b(?:restaurant|essen|hunger|fruhstuck|mittagessen|abendessen)\b/u, 'local_search', 'restaurants'],
    [/\b(?:hotel|unterkunft|zimmer)\b/u, 'local_search', 'hotels'],
    [/\b(?:taxi|bolt|grab|bus|transport|mietwagen|roller)\b/u, 'local_search', 'transport'],
    [/\b(?:werkstatt|abschlepp\w*|pannenhilfe)\b/u, 'local_search', 'fahrzeughilfe'],
    [/\b(?:handwerker|klimaanlage|schlussel\w*|schloss\w*|reparatur|handy .*kaputt)\b/u, 'local_search', 'dienstleistungen'],
    [/\b(?:immigration|visum|visa|behorde)\b/u, 'local_search', 'behoerden'],
    [/\b(?:unternehmen|freizeit|ausflug|tennis|fitness|strand)\b/u, 'local_search', 'freizeit'],
  ];
  for (const [pattern, kind, category] of rules) {
    if (pattern.test(text)) return { kind, category, raw: message, confidence: 'high' };
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
    }
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

  const intent = inferIntent(message);
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
    // A region explicitly written in this search is sufficient even when the
    // user did not first state it separately as their current location.
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
  const future = effectiveTime !== 'unspecified' ? state.futureLocations[effectiveTime] : undefined;
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
    (bareRegion || messageIntent.kind !== 'local_search');
  const base = continuingTask
    ? `${state.currentIntent?.raw ?? `Ich brauche ${state.currentIntent?.category ?? 'etwas Passendes'}.`} Zusätzliche Anforderung: ${message}`
    : message;
  return `${base}${regionText}${timeText}${preferenceText}`.trim();
}

export function resetTaskPreferences(state: ConversationState): void {
  state.activePreferences = [];
}