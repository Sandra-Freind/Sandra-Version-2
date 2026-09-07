import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSearchMessage,
  detectPreferences,
  detectTimeContext,
  getConversationState,
  hydrateConversationLocation,
  inferIntent,
  pendingLocationReply,
  resolveRelevantRegion,
  updateConversationState,
} from './conversationState';

function sid(name: string): string {
  return `test-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

test('all six regions remain stable across a location then local-search follow-up', () => {
  const cases = [
    ['Naklua', 'naklua'],
    ['Wongamat', 'wongamat'],
    ['Central Pattaya', 'central'],
    ['Pratumnak', 'pratumnak'],
    ['Jomtien', 'jomtien'],
    ['Darkside', 'darkside'],
  ] as const;
  for (const [spoken, expected] of cases) {
    const session = sid(expected);
    updateConversationState(session, `Ich bin in ${spoken}`);
    const state = updateConversationState(session, 'Ich suche ein Restaurant');
    assert.equal(resolveRelevantRegion(state), expected);
    assert.equal(state.waitingFor, undefined);
    assert.equal(state.currentIntent?.kind, 'local_search');
    assert.match(buildSearchMessage('Ich suche ein Restaurant', state), new RegExp(`Gebiet: ${expected}`));
  }
});

test('pending location is deterministic when no region has ever been supplied', () => {
  const session = sid('missing-location');
  const state = updateConversationState(session, 'Ich suche eine Apotheke');
  assert.equal(state.waitingFor, 'location');
  assert.equal(state.conversationPhase, 'WAITING_FOR_LOCATION');
  assert.ok(pendingLocationReply(state));
});

test('a later bare region fulfills a pending local search without losing the intent', () => {
  const session = sid('pending-resolve');
  updateConversationState(session, 'Ich brauche einen Zahnarzt');
  const state = updateConversationState(session, 'Jomtien');
  assert.equal(state.waitingFor, undefined);
  assert.equal(state.currentIntent?.category, 'zahnarzt');
  assert.equal(resolveRelevantRegion(state), 'jomtien');
});

test('preferences accumulate inside one task and reset on a genuine topic switch', () => {
  const session = sid('prefs');
  updateConversationState(session, 'Ich bin in Jomtien');
  updateConversationState(session, 'Ich suche ein Restaurant');
  let state = updateConversationState(session, 'Bitte ruhig und günstig');
  assert.deepEqual(new Set(state.activePreferences), new Set(['quiet', 'cheap']));
  state = updateConversationState(session, 'Jetzt brauche ich eine Apotheke');
  assert.equal(state.currentTopic, 'apotheken');
  assert.deepEqual(state.activePreferences, []);
});

test('current and future location contexts do not overwrite each other', () => {
  const session = sid('time-location');
  let state = updateConversationState(session, 'Ich bin jetzt in Naklua, später bin ich in Jomtien');
  assert.equal(state.currentLocation?.region, 'naklua');
  assert.equal(state.futureLocations.soon?.region, 'jomtien');
  assert.equal(resolveRelevantRegion(state, 'now'), 'naklua');
  assert.equal(resolveRelevantRegion(state, 'soon'), 'jomtien');

  state = updateConversationState(session, 'Ich bin in Pratumnak');
  assert.equal(state.timeContext, 'now');
  assert.equal(resolveRelevantRegion(state), 'pratumnak');
});

test('session hydration restores a missing location as session context', () => {
  const session = sid('hydrate');
  const hydrated = hydrateConversationLocation(session, 'Wongamat');
  assert.equal(hydrated.currentLocation?.region, 'wongamat');
  assert.equal(hydrated.currentLocation?.source, 'session_context');
  const state = updateConversationState(session, 'Ich suche einen Arzt');
  assert.equal(resolveRelevantRegion(state), 'wongamat');
  assert.equal(state.waitingFor, undefined);
});

test('politics and entertainment are classified before local continuation can inherit state', () => {
  const session = sid('blocked');
  updateConversationState(session, 'Ich bin in Jomtien');
  updateConversationState(session, 'Ich suche ein Restaurant');
  const before = getConversationState(session);
  const priorCategory = before.currentIntent?.category;
  const priorLocation = before.currentLocation?.region;

  const politicsIntent = inferIntent('Was gibt es politisch Neues?');
  assert.equal(politicsIntent.kind, 'blocked');
  let state = updateConversationState(session, 'Was gibt es politisch Neues?');
  assert.equal(state.conversationPhase, 'BLOCKED');
  assert.equal(state.currentIntent?.category, priorCategory);
  assert.equal(state.currentLocation?.region, priorLocation);

  const entertainmentIntent = inferIntent('Erzähl mir einen Witz und unterhalte mich');
  assert.equal(entertainmentIntent.kind, 'blocked');
  state = updateConversationState(session, 'Erzähl mir einen Witz und unterhalte mich');
  assert.equal(state.currentIntent?.category, priorCategory);
  assert.equal(state.currentLocation?.region, priorLocation);
});

test('health emergency has priority and receives a dedicated phase', () => {
  const session = sid('emergency');
  const intent = inferIntent('Ich bekomme plötzlich keine Luft und habe starke Brustschmerzen');
  assert.equal(intent.kind, 'emergency');
  const state = updateConversationState(session, 'Ich bekomme plötzlich keine Luft und habe starke Brustschmerzen');
  assert.equal(state.conversationPhase, 'EMERGENCY');
  assert.equal(state.currentIntent?.kind, 'emergency');
});

test('time and preference detectors cover common follow-up wording', () => {
  assert.equal(detectTimeContext('morgen früh'), 'tomorrow_morning');
  assert.equal(detectTimeContext('heute Abend'), 'tonight');
  assert.equal(detectTimeContext('später'), 'soon');
  assert.deepEqual(new Set(detectPreferences('nah, günstig, ruhig und hundefreundlich')), new Set(['nearby', 'cheap', 'quiet', 'dog_friendly']));
});

test('long dialogue keeps location, switches topics, and does not resurrect stale preferences', () => {
  const session = sid('long-dialogue');
  const messages = [
    'Ich bin in Central Pattaya',
    'Ich suche ein Restaurant',
    'Bitte ruhig',
    'Noch etwas günstiger',
    'Jetzt brauche ich einen Zahnarzt',
    'Wie komme ich dahin?',
    'Später bin ich in Jomtien',
    'Dort brauche ich eine Apotheke',
  ];
  let state = getConversationState(session);
  for (const message of messages) state = updateConversationState(session, message);
  assert.equal(state.currentIntent?.category, 'apotheken');
  assert.equal(resolveRelevantRegion(state), 'jomtien');
  assert.equal(state.previousTopic, 'zahnarzt');
  assert.deepEqual(state.activePreferences, []);
});
