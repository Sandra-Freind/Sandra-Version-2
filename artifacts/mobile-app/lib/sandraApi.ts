import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  sandraChat,
  translateSandraAudio,
  type SandraAudioRequest,
  type SandraInterpreterResponse,
  type SandraReply,
} from '@workspace/api-client-react';
import { loadChatContext } from './chatStorage';

const SESSION_KEY = 'sandra.mobile.session';
const SESSION_VERSION = 'v3-';

export type SandraResponse = SandraReply;

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null;
  return typeof error.status === 'number' ? error.status : null;
}

function errorDataMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null;
  const data = error.data;
  if (!data || typeof data !== 'object' || !('message' in data)) return null;
  return typeof data.message === 'string' && data.message.trim()
    ? data.message.trim()
    : null;
}

function errorDataCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null;
  const data = error.data;
  if (!data || typeof data !== 'object' || !('code' in data)) return null;
  return typeof data.code === 'string' ? data.code : null;
}

export function getSandraErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const serverMessage = errorDataMessage(error);
  if (serverMessage) return serverMessage;

  switch (errorStatus(error)) {
    case 400:
      return 'Die Eingabe konnte nicht verarbeitet werden.';
    case 413:
      return 'Die Aufnahme ist zu groß. Bitte sprich etwas kürzer.';
    case 429:
      return 'Zu viele Anfragen. Bitte warte kurz und versuche es erneut.';
    case 502:
      return 'Sandra ist momentan nicht erreichbar. Bitte versuche es erneut.';
    case 503:
      return 'Sandra ist momentan nicht verfügbar. Bitte versuche es später erneut.';
    case 504:
      return 'Sandra braucht momentan zu lange. Bitte versuche es erneut.';
  }

  if (error instanceof TypeError) {
    return 'Keine Verbindung zu Sandra. Bitte prüfe deine Internetverbindung.';
  }
  if (error instanceof Error && error.name === 'ResponseParseError') {
    return 'Sandra hat eine unvollständige Antwort gesendet. Bitte versuche es erneut.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

function createSessionId() {
  return `${SESSION_VERSION}${Date.now().toString(36)}-${Crypto.randomUUID()}`;
}

async function getSessionId() {
  const existing = await AsyncStorage.getItem(SESSION_KEY);
  if (existing?.startsWith(SESSION_VERSION)) return existing;
  const created = createSessionId();
  await AsyncStorage.setItem(SESSION_KEY, created);
  return created;
}

async function renewSessionId(previous: string): Promise<string> {
  const existing = await AsyncStorage.getItem(SESSION_KEY);
  if (existing?.startsWith(SESSION_VERSION) && existing !== previous) return existing;
  const created = createSessionId();
  await AsyncStorage.setItem(SESSION_KEY, created);
  return created;
}

async function withSessionRetry<T>(
  request: (sessionId: string) => Promise<T>,
): Promise<T> {
  const sessionId = await getSessionId();
  try {
    return await request(sessionId);
  } catch (error) {
    if (errorDataCode(error) !== 'SANDRA_SESSION_REQUIRED') throw error;
    // The contract asks for one transparent renewal only; a second failure is surfaced.
    return request(await renewSessionId(sessionId));
  }
}

export async function sendSandraMessage(message: string): Promise<SandraResponse> {
  const context = await loadChatContext();
  return withSessionRetry((sessionId) =>
    sandraChat(
      { message, mode: 'chat' },
      {
        headers: {
          'x-sandra-session': sessionId,
          ...(context?.region
            ? { 'x-sandra-region-context': context.region }
            : {}),
          ...(context?.search
            ? { 'x-sandra-search-context': context.search }
            : {}),
        },
      },
    ),
  );
}

export async function translateSandraRecording(
  recording: SandraAudioRequest,
): Promise<SandraInterpreterResponse> {
  return withSessionRetry((sessionId) =>
    translateSandraAudio(recording, {
      headers: {
        'x-sandra-session': sessionId,
      },
    }),
  );
}