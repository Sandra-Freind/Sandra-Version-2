import type { RequestHandler, Response } from 'express';
import { classifySandraPolicy } from '../lib/sandraPolicy';
import { hydrateConversationLocation } from '../lib/conversationState';

const SESSION_PATTERN = /^v3-[0-9a-z]+-[0-9a-f-]{8,}$/iu;

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function enrichInterpreterError(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const record = body as Record<string, unknown>;
  if (record.ok !== false || typeof record.error !== 'string') return body;

  const legacy = record.error;
  const contract: Record<string, { errorCode: string; stage: string; retryable: boolean }> = {
    speech: { errorCode: 'SPEECH_RECOGNITION_FAILED', stage: 'speech_to_text', retryable: true },
    transcription: { errorCode: 'SPEECH_RECOGNITION_FAILED', stage: 'speech_to_text', retryable: true },
    translation: { errorCode: 'TRANSLATION_FAILED', stage: 'translation', retryable: true },
    tts: { errorCode: 'SPEECH_SYNTHESIS_FAILED', stage: 'text_to_speech', retryable: true },
    audio: { errorCode: 'INVALID_AUDIO', stage: 'validation', retryable: false },
    language: { errorCode: 'UNSUPPORTED_INTERPRETER_LANGUAGE', stage: 'validation', retryable: false },
    upstream: { errorCode: 'UPSTREAM_UNAVAILABLE', stage: 'upstream', retryable: true },
  };
  const mapped = contract[legacy] ?? {
    errorCode: 'INTERPRETER_FAILED',
    stage: 'unknown',
    retryable: false,
  };
  return { ...record, ...mapped };
}

export const sandraApiContract: RequestHandler = (req, res, next) => {
  if (!req.path.startsWith('/sandra/')) return next();
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(enrichInterpreterError(body))) as Response['json'];
  next();
};

export const sandraChatPolicy: RequestHandler = (req, res, next) => {
  if (req.method !== 'POST' || req.path !== '/sandra/chat') return next();

  const session = headerValue(req.headers['x-sandra-session']);
  const locationContext = headerValue(req.headers['x-sandra-search-region']);
  if (session && SESSION_PATTERN.test(session) && locationContext) {
    hydrateConversationLocation(session, locationContext);
  }

  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return next();

  const decision = classifySandraPolicy(message);
  if (decision.kind === 'allow' || decision.kind === 'emergency') return next();

  return res.status(200).json({
    reply: decision.reply ?? 'Dabei kann ich dir nicht helfen.',
    maps: [],
    policyCode: decision.code,
  });
};
