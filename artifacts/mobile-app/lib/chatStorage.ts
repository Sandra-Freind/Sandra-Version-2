import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SandraMap } from '@workspace/api-client-react';

const LEGACY_CHAT_HISTORY_KEY = 'sandra.mobile.chat-history.v1';
const CHAT_HISTORY_KEY = 'sandra.mobile.chat-history.v2';
const CORRUPT_HISTORY_KEY = 'sandra.mobile.chat-history.corrupt';
export const MAX_STORED_MESSAGES = 100;
export const MAX_STORED_BYTES = 250_000;

export type StoredChatMessage = {
  id: string;
  text: string;
  role: 'user' | 'sandra';
  maps?: SandraMap[];
};

export type ChatSelection = {
  region?: string;
  search?: string;
};

type ChatHistoryV2 = {
  version: 2;
  messages: StoredChatMessage[];
  selection?: ChatSelection;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSandraMap(value: unknown): value is SandraMap {
  if (!isRecord(value)) return false;
  return ['title', 'query', 'url'].every((key) => {
    const field = value[key];
    return field === undefined || typeof field === 'string';
  });
}

function isStoredMessage(value: unknown): value is StoredChatMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.text === 'string' &&
    (value.role === 'user' || value.role === 'sandra') &&
    (value.maps === undefined ||
      (Array.isArray(value.maps) && value.maps.every(isSandraMap)))
  );
}

function validMessages(value: unknown): StoredChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isStoredMessage).slice(-MAX_STORED_MESSAGES);
}

function byteLength(value: string): number {
  // TextEncoder is not consistently available in older React Native engines.
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function deriveSelection(messages: StoredChatMessage[]): ChatSelection | undefined {
  const regionPatterns: Array<[string, RegExp]> = [
    ['Naklua', /\b(?:naklua|nakluea|na kluea)\b/i],
    ['Wongamat', /\b(?:wongamat|wong amat)\b/i],
    ['Central Pattaya', /\b(?:central pattaya|pattaya klang)\b/i],
    ['Pratumnak', /\b(?:pratumnak|pratamnak|phra tamnak)\b/i],
    ['Jomtien', /\b(?:jomtien|jomtian|chomtien)\b/i],
    ['Darkside / East Pattaya', /\b(?:darkside|dark side|east pattaya|nong prue)\b/i],
  ];
  let region: string | undefined;
  for (let index = messages.length - 1; index >= 0 && !region; index -= 1) {
    region = regionPatterns.find(([, pattern]) =>
      pattern.test(messages[index].text),
    )?.[0];
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const map = messages[index].maps?.find(
      (candidate) => candidate.query?.trim() || candidate.title?.trim(),
    );
    if (map) {
      const search = map.query?.trim() || map.title?.trim();
      if (search) {
        return { search, region };
      }
    }
  }
  return undefined;
}

function makeHistory(messages: StoredChatMessage[]): ChatHistoryV2 {
  const limited = messages.slice(-MAX_STORED_MESSAGES);
  const fitting: StoredChatMessage[] = [];
  for (let index = limited.length - 1; index >= 0; index -= 1) {
    const candidate = limited[index];
    const next = [candidate, ...fitting];
    const candidateHistory = {
      version: 2 as const,
      messages: next,
      selection: deriveSelection(next),
    };
    if (byteLength(JSON.stringify(candidateHistory)) > MAX_STORED_BYTES) {
      continue;
    }
    fitting.unshift(candidate);
  }
  return { version: 2, messages: fitting, selection: deriveSelection(fitting) };
}

async function quarantine(raw: string): Promise<void> {
  try {
    // Keep one bounded diagnostic copy rather than silently destroying a user's history.
    await AsyncStorage.setItem(CORRUPT_HISTORY_KEY, raw.slice(0, MAX_STORED_BYTES));
  } catch {
    // Storage may itself be unavailable; loading must still leave the app usable.
  }
}

function parseV2(raw: string): ChatHistoryV2 | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 2 || !Array.isArray(parsed.messages)) {
      return null;
    }
    return makeHistory(validMessages(parsed.messages));
  } catch {
    return null;
  }
}

function parseLegacy(raw: string): StoredChatMessage[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? validMessages(parsed) : null;
  } catch {
    return null;
  }
}

export async function loadChatHistory(): Promise<StoredChatMessage[]> {
  try {
    const current = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
    if (current) {
      const parsed = parseV2(current);
      if (parsed) {
        // Rewrites malformed-but-recoverable entries and reapplies current limits.
        const normalized = JSON.stringify(parsed);
        if (normalized !== current) await AsyncStorage.setItem(CHAT_HISTORY_KEY, normalized);
        return parsed.messages;
      }
      await quarantine(current);
      await AsyncStorage.removeItem(CHAT_HISTORY_KEY);
    }

    const legacy = await AsyncStorage.getItem(LEGACY_CHAT_HISTORY_KEY);
    if (!legacy) return [];
    const messages = parseLegacy(legacy);
    if (!messages) {
      await quarantine(legacy);
      await AsyncStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);
      return [];
    }

    // Write the new version before retiring v1, so interrupted migrations are retryable.
    await AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(makeHistory(messages)));
    await AsyncStorage.removeItem(LEGACY_CHAT_HISTORY_KEY);
    return makeHistory(messages).messages;
  } catch {
    // A full device or an unavailable storage backend must never prevent a safe restart.
    return [];
  }
}

export async function loadChatContext(): Promise<ChatSelection | undefined> {
  try {
    const current = await AsyncStorage.getItem(CHAT_HISTORY_KEY);
    if (!current) return undefined;
    return parseV2(current)?.selection;
  } catch {
    return undefined;
  }
}

export async function saveChatHistory(messages: StoredChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(makeHistory(validMessages(messages))));
}