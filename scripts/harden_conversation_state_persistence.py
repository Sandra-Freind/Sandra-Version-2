from pathlib import Path

p = Path('artifacts/api-server/src/lib/conversationState.ts')
text = p.read_text(encoding='utf-8')

imports = "import { detectRegion, type SandraRegion } from './sandraKnowledge';\n"
new_imports = "import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\nimport { detectRegion, type SandraRegion } from './sandraKnowledge';\n"
if imports not in text:
    raise SystemExit('conversationState import marker not found')
text = text.replace(imports, new_imports, 1)

marker = "const CURRENT_LOCATION_TTL_MS = 8 * 60 * 60 * 1000;\n"
insert = r'''const SESSION_STATE_DIR = process.env.SANDRA_SESSION_STATE_DIR?.trim() || join(process.cwd(), '.sandra-session-state');

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
'''
if marker not in text:
    raise SystemExit('TTL marker not found')
text = text.replace(marker, marker + insert, 1)

old_get = r'''export function getConversationState(session: string): ConversationState {
  const now = Date.now();
  const current = states.get(session);
  if (current && now - current.lastMessageAt <= STATE_TTL_MS) return current;
  const created: ConversationState = {
    futureLocations: {},
    timeContext: 'unspecified',
    activePreferences: [],
    conversationPhase: 'IDLE',
    lastMessageAt: now,
  };
  states.set(session, created);
  return created;
}
'''
new_get = r'''export function getConversationState(session: string): ConversationState {
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
'''
if old_get not in text:
    raise SystemExit('getConversationState block not found')
text = text.replace(old_get, new_get, 1)

# Persist before every return from updateConversationState and at normal end.
old_wait = r'''    state.conversationPhase = 'SEARCHING_LOCAL';
    return state;
  }

  const intent = inferIntent(message);'''
new_wait = r'''    state.conversationPhase = 'SEARCHING_LOCAL';
    persistConversationState(session, state);
    return state;
  }

  const intent = inferIntent(message);'''
if old_wait not in text:
    raise SystemExit('waiting-for-location return marker not found')
text = text.replace(old_wait, new_wait, 1)

old_end = r'''  return state;
}

export function resolveRelevantRegion('''
new_end = r'''  persistConversationState(session, state);
  return state;
}

export function resolveRelevantRegion('''
if old_end not in text:
    raise SystemExit('updateConversationState final return marker not found')
text = text.replace(old_end, new_end, 1)

p.write_text(text, encoding='utf-8')
assert 'loadPersistedState' in text
assert 'persistConversationState(session, state);' in text
print('SANDRA_CONVERSATION_PERSISTENCE_PATCH_OK')
