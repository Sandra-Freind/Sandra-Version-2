export type SandraRegion =
  | "naklua"
  | "wongamat"
  | "central"
  | "pratumnak"
  | "jomtien"
  | "darkside";

export const PLACE_FRESHNESS_NOTICE =
  "Hinweis: Bitte ruf vor der Fahrt kurz an und bestätige, dass der Betrieb noch existiert, die Adresse stimmt und die Öffnungszeiten aktuell sind.";

export type LocalSearchReply = {
  reply: string;
  maps: Array<{ title: string; query: string; url: string }>;
  verifiedPlaces?: LocalVerifiedPlace[];
};

export type LocalVerifiedPlace = {
  name: string;
  category: string;
  address: string;
  phone?: string;
  hours?: string;
  description?: string;
  sources: string[];
  checkedAt: string;
  sourceDate?: string;
};

type WebPlace = {
  name?: unknown;
  category?: unknown;
  address?: unknown;
  phone?: unknown;
  hours?: unknown;
  description?: unknown;
  source_url?: unknown;
  address_source_url?: unknown;
  description_source_url?: unknown;
  phone_source_url?: unknown;
  hours_source_url?: unknown;
  source_date?: unknown;
  source_date_url?: unknown;
  operating_status?: unknown;
};

type ResponsesOutput = {
  type?: string;
  status?: string;
  action?: { sources?: Array<{ url?: string }> };
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: Array<{ type?: string; url?: string }>;
  }>;
};

type ResponsesResult = {
  status?: string;
  output?: ResponsesOutput[];
};

const REGION_LABELS: Record<SandraRegion, string> = {
  naklua: "Naklua",
  wongamat: "Wongamat",
  central: "Central Pattaya",
  pratumnak: "Pratumnak",
  jomtien: "Jomtien",
  darkside: "Darkside / East Pattaya",
};

const REGION_PATTERNS: Record<SandraRegion, RegExp> = {
  naklua:
    /(?:\b(?:naklua|nakluea|na[ -]?kluea|na[ -]?klua)\b|นาเกลือ)/u,
  wongamat:
    /(?:\b(?:wongamat|wong amat|wongamart)\b|วงศ์?อมาตย์|วงศ์อมาต)/u,
  central:
    /(?:\b(?:central pattaya|pattaya central|pattaya klang|central pattaya road|pattaya mitte|zentrum (?:von )?pattaya)\b|พัทยากลาง)/u,
  pratumnak:
    /(?:\b(?:pratumnak|pratamnak|phra[ -]?tamnak|phra[ -]?tamn[aä]k|khao phra tamnak)\b|เขาพระตำหนัก|พระตำหนัก)/u,
  jomtien:
    /(?:\b(?:jomtien|jomtian|jomtiem|chomtien|chom tien)\b|จอมเทียน)/u,
  darkside:
    /(?:\b(?:dark[ -]?side|east(?:ern)? pattaya|pattaya east|ostlich(?:e|en|es)? pattaya|nong[ -]?prue|nongpru)\b|หนองปรือ|พัทยาตะวันออก|ดาร์กไซด์)/u,
};

const NA_JOMTIEN_PATTERN =
  /(?:\b(?:na[ -]?jomtien|na[ -]?jomtian|na[ -]?jomtiem|na[ -]?chomtien)\b|นาจอมเทียน)/u;
const SOUTH_PATTAYA_PATTERN =
  /(?:\b(?:south pattaya|pattaya south|pattaya tai|sudpattaya|south of pattaya)\b|พัทยาใต้)/u;
const BORDER_ROAD_PATTERN =
  /(?:\b(?:thappraya|thap[ -]?phraya|tappraya|thepprasit|thep[ -]?prasit)\b|เทพประสิทธิ์|ทัพพระยา)/u;

function normalized(value: string): string {
  return value
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    // Only remove Latin combining accents. Removing every Unicode diacritic
    // corrupts Thai region names by stripping their tone and vowel marks.
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/ß/gu, "ss");
}

function cleanText(value: unknown, maximum = 300): string {
  return typeof value === "string"
    ? value.replace(/\s+/gu, " ").trim().slice(0, maximum)
    : "";
}

function verifiedOptionalText(value: unknown, maximum: number): string {
  const text = cleanText(value, maximum);
  return /^(?:nicht angegeben|nicht verfügbar|keine angabe|unbekannt|unknown|not available|n\/a|-)$/iu.test(
    text,
  )
    ? ""
    : text;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function comparableUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.hostname.toLocaleLowerCase("en-US")}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

function urlWasSearched(value: string, searchedSources: Set<string>): boolean {
  const comparable = comparableUrl(value);
  return (
    comparable !== null &&
    [...searchedSources].some(
      (source) => comparableUrl(source) === comparable,
    )
  );
}

export function detectRegion(message: string): SandraRegion | null {
  const text = normalized(message);
  // Na Jomtien and the two boundary roads must never silently become Jomtien.
  // An explicit region alongside a boundary road remains unambiguous.
  if (NA_JOMTIEN_PATTERN.test(text)) return null;
  if (REGION_PATTERNS.wongamat.test(text)) return "wongamat";
  if (REGION_PATTERNS.naklua.test(text)) return "naklua";
  if (REGION_PATTERNS.pratumnak.test(text)) return "pratumnak";
  if (REGION_PATTERNS.jomtien.test(text) && !BORDER_ROAD_PATTERN.test(text)) {
    return "jomtien";
  }
  // Explicit Central Pattaya beats the administrative district name Nong Prue
  // that appears in many Central Pattaya postal addresses.
  if (REGION_PATTERNS.central.test(text) && !SOUTH_PATTAYA_PATTERN.test(text)) {
    return "central";
  }
  if (REGION_PATTERNS.darkside.test(text) && !BORDER_ROAD_PATTERN.test(text)) {
    return "darkside";
  }
  return null;
}

export function addressMatchesRegion(address: string, region: SandraRegion): boolean {
  const text = normalized(address);
  if (NA_JOMTIEN_PATTERN.test(text)) {
    return false;
  }
  // A named Pratumnak address on Thappraya is usable; an otherwise bare
  // boundary road remains deliberately unassigned.
  if (BORDER_ROAD_PATTERN.test(text)) return detectRegion(text) === region;
  switch (region) {
    case "wongamat":
      return REGION_PATTERNS.wongamat.test(text);
    case "naklua":
      return (
        REGION_PATTERNS.naklua.test(text) &&
        !REGION_PATTERNS.wongamat.test(text)
      );
    case "pratumnak":
      return REGION_PATTERNS.pratumnak.test(text);
    case "jomtien":
      return REGION_PATTERNS.jomtien.test(text);
    case "darkside":
      return REGION_PATTERNS.darkside.test(text);
    case "central":
      return (
        REGION_PATTERNS.central.test(text) && !SOUTH_PATTAYA_PATTERN.test(text)
      );
  }
}

export function addressConflictsWithRegion(
  address: string,
  region: SandraRegion,
): boolean {
  const text = normalized(address);
  const detected = detectRegion(address);
  if (
    (region === "jomtien" && NA_JOMTIEN_PATTERN.test(text)) ||
    (region === "central" && SOUTH_PATTAYA_PATTERN.test(text)) ||
    ((region === "jomtien" || region === "pratumnak" || region === "darkside") &&
      BORDER_ROAD_PATTERN.test(text) &&
      detected !== region)
  ) {
    return true;
  }
  return detected !== null && detected !== region;
}

export type LocalSearchIntent = {
  categories: string[];
  criteria: string[];
};

/** Extracts only explicit filters; the original message remains the search query. */
export function extractLocalSearchIntent(message: string): LocalSearchIntent {
  const text = normalized(message);
  const categoryRules: Array<[string, RegExp]> = [
    [
      "Apotheke / pharmacy / drugstore",
      /(?:\b(?:apotheke|pharmacy|drugstore|chemist|medikament\w*|tablett\w*)\b|ยา|รานยา)/u,
    ],
    ["Zahnarzt / dentist", /\b(?:zahnarzt|dentist|dental|ทันต)\b/u],
    ["Arzt / Klinik", /\b(?:arzt|doctor|clinic|klinik(?:en)?|hospital|โรงพยาบาล|แพทย์)\b/u],
    ["Tierarzt / veterinarian", /(?:\b(?:tierarzt|veterinarian|veterinary|vet clinic)\b|สัตวแพทย)/u],
    ["Restaurant / Essen", /(?:\b(?:restaurant|essen|hunger|hungrig\w*|food|cafe|café)\b|อาหาร)/u],
    [
      "Handyreparatur",
      /\b(?:handyreparatur|mobiltelefonreparatur|phone repair|mobile repair)\b|\b(?:handy|mobiltelefon|smartphone|handydisplay)\b.{0,50}\b(?:reparier\w*|kaputt|display|akku)\b/u,
    ],
    ["Autowerkstatt", /\b(?:autowerkstatt|kfz werkstatt|car repair|auto repair|garage)\b/u],
    ["Lebensmittelgeschäft", /(?:\b(?:lebensmittel(?:geschaft)?|supermarkt|supermarket|grocery)\b|ตลาด|รานขายของชา)/u],
    ["Friseur", /\b(?:friseur|haarsalon|hairdresser|barber|salon)\b/u],
    ["Reinigungsdienst", /\b(?:reinigung|reinigungsdienst|cleaning service|cleaner)\b/u],
    ["Handwerker", /\b(?:handwerker|elektriker|klempner|schlüsseldienst|electrician|plumber|locksmith)\b/u],
    [
      "Behörde / öffentliche Anlaufstelle",
      /\b(?:behorde|amt|verwaltung|rathaus|polizei|police|immigration|district office|municipal office|government office|offentliche anlaufstelle)\b/u,
    ],
    ["Werkstatt / Reparatur", /\b(?:werkstatt|garage|reparatur|repair|service center|service centre)\b/u],
  ];
  const categories = categoryRules.flatMap(([label, pattern]) =>
    pattern.test(text) ? [label] : [],
  );
  const criterionRules: Array<[string, RegExp]> = [
    [
      "deutschsprachig",
      /\b(?:deutschsprachig(?:e[rsnm]?)?|deutsch(?:er|e|en)?|german(?: speaking)?)\b/u,
    ],
    ["Parkplatz", /\b(?:parkplatz|parking)\b/u],
    ["24 Stunden geöffnet", /\b(?:24 ?stunden|24 ?hours?|rund um die uhr)\b/u],
    [
      "rollstuhlgerecht",
      /\b(?:rollstuhlgerecht(?:e[rsnm]?)?|rollstuhlfreundlich(?:e[rsnm]?)?|rollstuhl|wheelchair|barrierefrei)\b/u,
    ],
    [
      "kindergeeignet",
      /\b(?:kinderfreundlich\w*|kindfreundlich\w*|kinder|family friendly|children)\b/u,
    ],
    ["jetzt geöffnet", /\b(?:jetzt geoffnet\w*|open now|geoffnet jetzt)\b/u],
    ["günstig", /\b(?:gunstig\w*|billig\w*|preiswert\w*|cheap|affordable|budget)\b/u],
    ["ruhig", /\b(?:ruhig\w*|quiet|calm)\b/u],
    ["direkt am Strand", /\b(?:direkt am strand|am strand|beachfront|beach front|seafront|sea front|oceanfront)\b/u],
    ["hundefreundlich", /\b(?:hundefreundlich\w*|hund erlaubt|dog friendly|pet friendly|dog_friendly)\b/u],
    ["nicht Walking Street", /\b(?:keine walking street|nicht walking street|ohne walking street|no walking street|no_walking_street)\b/u],
  ];
  const criteria = criterionRules.flatMap(([label, pattern]) =>
    pattern.test(text) ? [label] : [],
  );
  return { categories, criteria };
}

export function candidateMatchesIntent(
  message: string,
  intent: LocalSearchIntent,
  name: string,
  category: string,
  description: string,
  hours = "",
): boolean {
  const candidate = normalized(`${name} ${category} ${description}`);
  const request = normalized(message);
  if (
    intent.categories.includes("Apotheke / pharmacy / drugstore") &&
    (!/(?:\b(?:apotheke|pharmacy|drugstore|chemist)\b|รานยา)/u.test(candidate) ||
      (/\b(?:cannabis|weed|ganja|dispensary)\b/u.test(candidate) &&
        !/\b(?:cannabis|weed|ganja)\b/u.test(request)))
  ) {
    return false;
  }
  if (
    intent.categories.includes("Arzt / Klinik") &&
    /\b(?:zahnarzt|dentist|dental)\b/u.test(candidate) &&
    !/\b(?:zahnarzt|dentist|dental)\b/u.test(request)
  ) {
    return false;
  }
  // Specific subtypes must not degrade into a generic category match.
  if (/\b(?:klempner|plumber)\b/u.test(request) && !/\b(?:klempner|plumber)\b/u.test(candidate)) return false;
  if (/\b(?:elektriker|electrician)\b/u.test(request) && !/\b(?:elektriker|electrician|electrical)\b/u.test(candidate)) return false;
  if (/\b(?:schlusseldienst|locksmith)\b/u.test(request) && !/\b(?:schlusseldienst|locksmith|schlusselservice|key service)\b/u.test(candidate)) return false;
  if (/\b(?:polizei|police)\b/u.test(request) && !/\b(?:polizei|police)\b/u.test(candidate)) return false;
  if (/\bimmigration\b/u.test(request) && !/\bimmigration\b/u.test(candidate)) return false;
  const requiredCategoryPatterns: Array<[string, RegExp]> = [
    ["Zahnarzt / dentist", /\b(?:zahnarzt|dentist|dental|ทันต)\b/u],
    ["Arzt / Klinik", /\b(?:arzt|doctor|clinic|klinik(?:en)?|hospital|แพทย์|โรงพยาบาล)\b/u],
    ["Tierarzt / veterinarian", /(?:\b(?:tierarzt|veterinarian|veterinary|vet clinic)\b|สัตวแพทย)/u],
    ["Restaurant / Essen", /(?:\b(?:restaurant|cafe|café|food|bar\s*&\s*grill)\b|อาหาร)/u],
    ["Handyreparatur", /\b(?:handyreparatur|phone repair|mobile repair|smartphone repair)\b/u],
    ["Autowerkstatt", /\b(?:autowerkstatt|car repair|auto repair|garage|service center|service centre)\b/u],
    ["Lebensmittelgeschäft", /(?:\b(?:lebensmittel(?:geschaft)?|supermarkt|supermarket|grocery)\b|ตลาด|รานขายของชา)/u],
    ["Friseur", /\b(?:friseur|haarsalon|hairdresser|barber|salon)\b/u],
    ["Reinigungsdienst", /\b(?:reinigung|cleaning service|cleaner)\b/u],
    ["Handwerker", /\b(?:handwerker|elektriker|klempner|schlüsseldienst|electrician|plumber|locksmith)\b/u],
    [
      "Behörde / öffentliche Anlaufstelle",
      /\b(?:behorde|amt|verwaltung|rathaus|polizei|police|immigration|district office|municipal office|government office)\b/u,
    ],
  ];
  for (const [label, pattern] of requiredCategoryPatterns) {
    if (intent.categories.includes(label) && !pattern.test(candidate)) return false;
  }
  const verifiedDetails = normalized(`${description}`);
  const verifiedHours = normalized(`${description} ${hours}`);
  for (const criterion of intent.criteria) {
    if (
      criterion === "deutschsprachig" &&
      !/\b(?:deutsch|german)\b/u.test(verifiedDetails)
    ) return false;
    if (
      criterion === "Parkplatz" &&
      !/\b(?:parkplatz|parking)\b/u.test(verifiedDetails)
    ) return false;
    if (
      criterion === "rollstuhlgerecht" &&
      !/\b(?:rollstuhl|wheelchair|barrierefrei)\b/u.test(verifiedDetails)
    ) return false;
    if (
      criterion === "kindergeeignet" &&
      !/\b(?:kinder|children|family friendly|kindfreundlich)\b/u.test(
        verifiedDetails,
      )
    ) return false;
    if (
      (criterion === "24 Stunden geöffnet" ||
        criterion === "jetzt geöffnet") &&
      !/\b(?:24 ?stunden|24 ?hours?|24\/7|rund um die uhr)\b/u.test(
        verifiedHours,
      )
    ) return false;
    if (criterion === "günstig" && !/\b(?:gunstig\w*|billig\w*|preiswert\w*|cheap|affordable|budget|lokale preise)\b/u.test(verifiedDetails)) return false;
    if (criterion === "ruhig" && !/\b(?:ruhig\w*|quiet|calm|entspannt\w*)\b/u.test(verifiedDetails)) return false;
    if (criterion === "direkt am Strand" && !/\b(?:direkt am strand|am strand|beachfront|beach front|seafront|sea front|oceanfront)\b/u.test(verifiedDetails)) return false;
    if (criterion === "hundefreundlich" && !/\b(?:hundefreundlich\w*|hund erlaubt|dog friendly|pet friendly)\b/u.test(verifiedDetails)) return false;
    if (criterion === "nicht Walking Street" && /\bwalking street\b/u.test(candidate)) return false;
  }
  return true;
}

export function regionLabel(region: SandraRegion): string {
  return REGION_LABELS[region];
}

export function unsupportedRegionReply(message: string): string | null {
  const text = normalized(message);
  if (NA_JOMTIEN_PATTERN.test(text)) {
    return "Na Jomtien gehört nicht zu Sandras Region Jomtien. Ich gebe deshalb keine Jomtien-Treffer als passend aus. Wähle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.";
  }
  if (SOUTH_PATTAYA_PATTERN.test(text)) {
    return "South Pattaya gehört nicht zu Sandras Region Central Pattaya. Ich gebe deshalb keine Central-Pattaya-Treffer als passend aus. Wähle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.";
  }
  if (/\b(?:sattahip|bang saray|bang sare|si racha|sriracha)\b/u.test(text)) {
    return "Der genannte Ort liegt außerhalb von Sandras sechs Pattaya-Regionen. Ich gebe deshalb keine Treffer aus einer anderen Gegend aus. Wähle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.";
  }
  return null;
}

export function shouldUseLocalWebFallback(
  upstreamReply: string,
  message: string,
  region: SandraRegion | null,
): region is SandraRegion {
  if (!region) return false;
  const reply = normalized(upstreamReply);
  if (
    /keine[^\n]*(?:eintrag|adresse|ergebnis|gefunden|vorhanden)|nichts[^\n]*(?:passend|gefunden)|konnte[^\n]*nicht[^\n]*finden/u.test(
      reply,
    )
  ) {
    return true;
  }

  const request = normalized(message);
  const intent = extractLocalSearchIntent(message);
  const clearLocalRequest =
    /\b(wo|suche|such|brauche|benotige|finde|gibt es|kennst|zeig|empfiehl|kaufen|mieten|reparieren|buchen|find|looking for|need|show|recommend)\b/u.test(
      request,
    ) ||
    /^หา/u.test(request) ||
    intent.categories.length > 0 ||
    intent.criteria.length > 0;
  const genericClarification =
    /was suchst du genau|in welcher gegend suchst du|welcher gegend von pattaya/u.test(
      reply,
    );
  return clearLocalRequest && genericClarification;
}

export function outOfScopeReply(message: string): string | null {
  const text = normalized(message);
  if (
    /\b(?:witz|witze|geschichte erzahlen|erzahl mir eine geschichte|unterhalte mich|langeweile|smalltalk|plaudern|einfach chatten)\b/u.test(text)
  ) {
    return "Ich bin gern freundlich an deiner Seite 😊, aber ich bin nicht als Zeitvertreib gedacht. Sag mir einfach, was du in Pattaya brauchst oder suchst, dann kümmere ich mich darum.";
  }
  if (
    /\b(wetter|regen|temperatur|nachrichten|politik|sport(?:ergebnis)?|borsenkurs|aktienkurs|uhrzeit|wie spat|welches datum)\b/u.test(
      text,
    )
  ) {
    return "Dabei kann ich dir nicht helfen. Ich finde für dich aber gern passende Orte, Betriebe und Anlaufstellen in Pattaya und Umgebung.";
  }
  const startsLikeGeneralQuestion =
    /^(?:wer|was|wie|warum|wieso|wann|welche|welcher|welches)\b/u.test(text);
  const hasLocalSearchPurpose =
    /\b(?:wo|suche|such|brauche|benotige|finde|gibt es|kennst|zeig|empfiehl|kaufen|mieten|reparieren|buchen|wie komme|unternehmen|machen|adresse|telefon|offnungszeit|offnet|schliesst|geoffnet)\b/u.test(
      text,
    );
  if (startsLikeGeneralQuestion && !hasLocalSearchPurpose) {
    return "Dabei kann ich dir nicht helfen. Ich finde für dich aber gern passende Orte, Betriebe und Anlaufstellen in Pattaya und Umgebung.";
  }
  return null;
}

export function unsupportedSearchLanguageReply(message: string): string | null {
  const text = message.trim();
  if (/[\u0E00-\u0E7F]/u.test(text)) {
    return "Sandras lokale Suche ist ausschließlich auf Deutsch. Bitte formuliere deine Suche auf Deutsch. Für Übersetzungen nutze den getrennten Deutsch–Thai-Dolmetscher.";
  }
  const hasGermanSearchContext =
    /\b(?:wo|suche|such|brauche|finde|gibt es|zeige|zeig|empfiehl|wie lautet|adresse|telefon|telefonnummer|öffnungszeit|öffnungszeiten|erster|ersten|zweiter|zweiten|dritter|dritten|treffer)\b/iu.test(
      text,
    );
  if (
    /\b(?:find me|please find|can you find|looking for|i am looking|i want|where (?:is|are|can i)|show me|recommend me|i need|do you know)\b/iu.test(
      text,
    )
    ||
    (!hasGermanSearchContext &&
      /\b(?:dentist|pharmacy|drugstore|doctor|veterinarian|veterinary|grocery|hairdresser|cleaning service|car repair|phone repair)\b/iu.test(
        text,
      ))
  ) {
    return "Sandras lokale Suche ist ausschließlich auf Deutsch. Bitte formuliere deine Suche auf Deutsch.";
  }
  return null;
}

export function companionIdentityReply(message: string): string | null {
  const text = normalized(message);
  if (!/\b(wer bist du|was kannst du|wobei kannst du mir helfen)\b/u.test(text)) {
    return null;
  }
  return "Ich bin Sandra 😊 Ich helfe dir wie eine gute ortskundige Freundin dabei, in Pattaya schnell das Passende zu finden. Sag mir einfach, was du brauchst und in welcher meiner sechs Gegenden du suchst.";
}

export function courtesyReply(message: string): string | null {
  const text = normalized(message).replace(/[.!?,;:]+/gu, " ").trim();
  if (
    /\b(?:danke|vielen dank)\b/u.test(text) &&
    /\b(?:reicht|genug|passt|alles klar)\b/u.test(text)
  ) {
    return "Sehr gern 😊 Wenn du später wieder etwas in Pattaya suchst, bin ich für dich da.";
  }
  if (/^(?:danke|vielen dank|nein danke)$/u.test(text)) return "Sehr gern 😊";
  if (/^(?:tschuss|auf wiedersehen|bis spater)$/u.test(text)) {
    return "Bis später 😊";
  }
  return null;
}

export function greetingReply(message: string): string | null {
  const text = normalized(message).replace(/[.!?,;:]+/gu, " ").trim();
  if (
    /^(?:hallo|hallo sandra|hi|hi sandra|guten morgen|guten tag|guten abend)$/u.test(
      text,
    )
  ) {
    return "Hallo 😊 Was suchst du in Pattaya und in welcher Gegend soll ich für dich schauen?";
  }
  return null;
}

export function urgentHealthReply(message: string): string | null {
  const text = normalized(message);
  if (
    !/\b(brustschmerz|brustschmerzen|atemnot|keine luft|bewusstlos|schlaganfall|starke blutung|stark blutet|lahmung)\b/u.test(
      text,
    )
  ) {
    return null;
  }
  return "Das klingt ernst. Bitte ruf jetzt sofort den thailändischen Rettungsdienst unter 1669 oder lass jemanden in deiner Nähe für dich anrufen. Fahre bitte nicht selbst.";
}

function parseJsonObject(value: string): { places?: WebPlace[] } | null {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/u)?.[1];
  const candidate = fenced ?? value;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const cleaned = candidate.slice(firstBrace, lastBrace + 1).trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    return parsed && typeof parsed === "object"
      ? (parsed as { places?: WebPlace[] })
      : null;
  } catch {
    return null;
  }
}

export async function researchLocalPlaces(
  message: string,
  region: SandraRegion,
): Promise<LocalSearchReply | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const regionLabel = REGION_LABELS[region];
  const intent = extractLocalSearchIntent(message);
  const explicitFilters = [...intent.categories, ...intent.criteria];
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.SANDRA_SEARCH_MODEL?.trim() || "gpt-4.1-mini",
      store: false,
      tools: [{ type: "web_search" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      instructions:
        `Du recherchierst lokale Orte und Dienstleistungen für Sandra in Pattaya. Datum in Thailand: ${today}. ` +
        `Gesuchte Teilregion: ${regionLabel}. Suche ausschließlich passend zur Nutzeranfrage und genau in dieser Teilregion. ` +
        "Na Jomtien ist nicht Jomtien; Wongamat ist nicht Naklua; Central Pattaya ist nicht South Pattaya. " +
        "Thappraya und Thepprasit sind Grenzstraßen: Ohne eine eindeutigere Adresse kein Ergebnis ausgeben. " +
        "Nutze zuerst Betreiberseiten; offizielle Stellen sind zweite Wahl, Verzeichnisse nur wenn keine Betreiberquelle auffindbar ist. " +
        "Die Betriebskategorie muss exakt zur Anfrage passen: Ein Tiergeschäft ist kein Tierarzt, ein Cannabis-Shop keine normale Apotheke und ein Elektronikgeschäft keine Handyreparatur. " +
        "Bei einer normalen Apothekensuche Cannabis-Dispensaries ausschließen, außer Cannabis wurde ausdrücklich verlangt. " +
        "Keine Orte, Adressen, Telefonnummern, Öffnungszeiten oder Koordinaten aus Modellwissen ergänzen. " +
        "Gib ausschließlich gültiges JSON zurück: " +
        '{"places":[{"name":"","category":"","address":"","phone":"","hours":"","description":"","source_url":"","address_source_url":"","description_source_url":"","phone_source_url":"","hours_source_url":"","source_date":"","source_date_url":"","operating_status":"open|unknown|permanently_closed"}]}. ' +
        "Maximal zwei Ergebnisse. Vollständige Adresse und source_url sind Pflicht. " +
        "Für Adresse, Telefon und Öffnungszeiten muss jeweils die konkrete aufgerufene Quellseite im zugehörigen source-Feld stehen. " +
        "Telefon und Öffnungszeiten nur eintragen, wenn die jeweilige Angabe auf der genannten Quellseite belegt ist; sonst Wert und Quellfeld leer lassen. " +
        "source_date ist nur ein auf der Quelle sichtbares Veröffentlichungs- oder Aktualisierungsdatum (sonst leer) und source_date_url muss diese Quelle belegen.",
      input:
        `Nutzeranfrage: ${message}\nVerbindliche Teilregion: ${regionLabel}` +
        (explicitFilters.length
          ? `\nExplizite Suchkriterien: ${explicitFilters.join(", ")}`
          : ""),
      text: {
        format: {
          type: "json_schema",
          name: "sandra_local_places",
          strict: true,
          schema: {
            type: "object",
            properties: {
              places: {
                type: "array",
                maxItems: 2,
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    category: { type: "string" },
                    address: { type: "string" },
                    phone: { type: "string" },
                    hours: { type: "string" },
                    description: { type: "string" },
                    source_url: { type: "string" },
                    address_source_url: { type: "string" },
                    description_source_url: { type: "string" },
                    phone_source_url: { type: "string" },
                    hours_source_url: { type: "string" },
                    source_date: { type: "string" },
                    source_date_url: { type: "string" },
                    operating_status: {
                      type: "string",
                      enum: ["open", "unknown", "permanently_closed"],
                    },
                  },
                  required: [
                    "name",
                    "category",
                    "address",
                    "phone",
                    "hours",
                    "description",
                    "source_url",
                    "address_source_url",
                    "description_source_url",
                    "phone_source_url",
                    "hours_source_url",
                    "source_date",
                    "source_date_url",
                    "operating_status",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["places"],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 1_800,
    }),
    signal: AbortSignal.timeout(48_000),
  });
  if (!response.ok) return null;

  const result = (await response.json()) as ResponsesResult;
  if (result.status !== "completed") return null;
  const searchedSources = new Set<string>();
  let outputText = "";
  for (const item of result.output ?? []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources ?? []) {
        const url = httpsUrl(source.url);
        if (url) searchedSources.add(url);
      }
    }
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text") outputText += content.text ?? "";
      for (const annotation of content.annotations ?? []) {
        const url = httpsUrl(annotation.url);
        if (annotation.type === "url_citation" && url) {
          searchedSources.add(url);
        }
      }
    }
  }

  const parsed = parseJsonObject(outputText);
  const accepted: Array<{
    name: string;
    category: string;
    address: string;
    phone: string;
    hours: string;
    description: string;
    source: string;
    sources: string[];
    sourceDate: string;
  }> = [];
  const seenNames = new Set<string>();

  for (const candidate of parsed?.places ?? []) {
    const name = cleanText(candidate.name, 120);
    const category = cleanText(candidate.category, 100);
    const address = cleanText(candidate.address, 240);
    const description = cleanText(candidate.description, 260);
    const source = httpsUrl(candidate.source_url);
    const addressSource = httpsUrl(candidate.address_source_url);
    const descriptionSource = httpsUrl(candidate.description_source_url);
    const sourceDateUrl = httpsUrl(candidate.source_date_url);
    const comparableName = normalized(name);
    const operatingStatus = cleanText(candidate.operating_status, 40);
    const phoneSource = httpsUrl(candidate.phone_source_url);
    const hoursSource = httpsUrl(candidate.hours_source_url);
    const phone =
      phoneSource && urlWasSearched(phoneSource, searchedSources)
        ? verifiedOptionalText(candidate.phone, 80)
        : "";
    const hours =
      hoursSource && urlWasSearched(hoursSource, searchedSources)
        ? verifiedOptionalText(candidate.hours, 160)
        : "";
    const verifiedDescription =
      descriptionSource &&
      urlWasSearched(descriptionSource, searchedSources)
        ? description
        : "";
    if (
      !name ||
      !address ||
      !source ||
      !addressSource ||
      operatingStatus === "permanently_closed" ||
      seenNames.has(comparableName) ||
      !addressMatchesRegion(address, region) ||
      !candidateMatchesIntent(
        message,
        intent,
        name,
        category,
        verifiedDescription,
        hours,
      ) ||
      !urlWasSearched(source, searchedSources) ||
      !urlWasSearched(addressSource, searchedSources)
    ) {
      continue;
    }

    const sourceDate =
      sourceDateUrl && urlWasSearched(sourceDateUrl, searchedSources)
        ? cleanText(candidate.source_date, 80)
        : "";
    const sources = [
      source,
      addressSource,
      descriptionSource &&
      urlWasSearched(descriptionSource, searchedSources)
        ? descriptionSource
        : null,
      phoneSource && urlWasSearched(phoneSource, searchedSources)
        ? phoneSource
        : null,
      hoursSource && urlWasSearched(hoursSource, searchedSources)
        ? hoursSource
        : null,
      sourceDateUrl && urlWasSearched(sourceDateUrl, searchedSources)
        ? sourceDateUrl
        : null,
    ].filter((value): value is string => Boolean(value));
    accepted.push({
      name,
      category,
      address,
      phone,
      hours,
      description: verifiedDescription,
      source,
      sources: [...new Set(sources)],
      sourceDate,
    });
    seenNames.add(comparableName);
    if (accepted.length === 2) break;
  }

  if (accepted.length === 0) return null;
  const replyParts = [
    `Klar 😊 Ich habe ${accepted.length} ${accepted.length === 1 ? "passenden geprüften Treffer" : "passende geprüfte Treffer"} in ${regionLabel} für dich gefunden (${today}):`,
  ];
  const maps = accepted.map((place, index) => {
    const details = [
      `${index + 1}. ${place.name}`,
      place.category,
      place.description ? `ℹ️ ${place.description}` : "",
      "📍 Adresse:",
      place.address,
      place.phone ? `📞 Telefon:\n${place.phone}` : "",
      place.hours ? `🕒 Öffnungszeiten:\n${place.hours}` : "",
      `✓ Geprüft: ${today}`,
      place.sourceDate ? `Quellenstand: ${place.sourceDate}` : "",
      `Quelle:\n${place.source}`,
    ].filter(Boolean);
    replyParts.push(details.join("\n"));
    const query = `${place.name}, ${place.address}`;
    return {
      title: place.name,
      query,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    };
  });
  return {
    reply: `${replyParts.join("\n\n")}\n\n${PLACE_FRESHNESS_NOTICE}`,
    maps,
    verifiedPlaces: accepted.map((place) => ({
      name: place.name,
      category: place.category,
      address: place.address,
      phone: place.phone || undefined,
      hours: place.hours || undefined,
      description: place.description || undefined,
      sources: place.sources,
      checkedAt: today,
      sourceDate: place.sourceDate || undefined,
    })),
  };
}