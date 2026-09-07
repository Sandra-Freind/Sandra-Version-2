import {
  outOfScopeReply,
  urgentHealthReply,
  unsupportedRegionReply,
  unsupportedSearchLanguageReply,
} from './sandraKnowledge';

export type SandraPolicyKind =
  | 'allow'
  | 'emergency'
  | 'blocked'
  | 'unsupported_language'
  | 'unsupported_region';

export type SandraPolicyCode =
  | 'ALLOW'
  | 'HEALTH_EMERGENCY'
  | 'OUT_OF_SCOPE'
  | 'UNSUPPORTED_SEARCH_LANGUAGE'
  | 'OUTSIDE_PATTAYA_REGION';

export type SandraPolicyDecision = {
  kind: SandraPolicyKind;
  code: SandraPolicyCode;
  reply?: string;
};

const EXPLICIT_OUTSIDE_PATTAYA_PLACE = /\b(?:
  bangkok|krung\s*thep|
  phuket|
  chiang\s*mai|
  hua\s*hin|
  krabi|
  koh\s*samui|ko\s*samui|samui|
  ayutthaya|
  udon\s*thani|
  khon\s*kaen|
  nakhon\s*ratchasima|korat|
  rayong|
  chanthaburi|
  trat|
  pattani|
  hat\s*yai|hatyai|
  surat\s*thani|
  kanchanaburi|
  lopburi|lop\s*buri|
  sukhothai|
  phitsanulok|
  mae\s*hong\s*son|
  chiang\s*rai
)\b/ixu;

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/ß/gu, 'ss');
}

export function explicitOutsidePattayaReply(message: string): string | null {
  const text = normalize(message);
  if (!EXPLICIT_OUTSIDE_PATTAYA_PLACE.test(text)) return null;
  return 'Der genannte Ort liegt außerhalb von Sandras sechs Pattaya-Regionen. Ich gebe deshalb keine Treffer aus einer anderen Gegend aus. Wähle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.';
}

export function classifySandraPolicy(message: string): SandraPolicyDecision {
  const emergency = urgentHealthReply(message);
  if (emergency) {
    return { kind: 'emergency', code: 'HEALTH_EMERGENCY', reply: emergency };
  }

  const blocked = outOfScopeReply(message);
  if (blocked) {
    return { kind: 'blocked', code: 'OUT_OF_SCOPE', reply: blocked };
  }

  const unsupportedLanguage = unsupportedSearchLanguageReply(message);
  if (unsupportedLanguage) {
    return {
      kind: 'unsupported_language',
      code: 'UNSUPPORTED_SEARCH_LANGUAGE',
      reply: unsupportedLanguage,
    };
  }

  const unsupportedRegion = unsupportedRegionReply(message) ?? explicitOutsidePattayaReply(message);
  if (unsupportedRegion) {
    return {
      kind: 'unsupported_region',
      code: 'OUTSIDE_PATTAYA_REGION',
      reply: unsupportedRegion,
    };
  }

  return { kind: 'allow', code: 'ALLOW' };
}
