import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createHash } from "node:crypto";
import {
  catalogPlaceMatchesQuery,
  catalogReply,
  sandraCatalog,
  storeVerifiedPlaces,
} from "../lib/sandraCatalogRuntime";
import {
  buildSearchMessage,
  detectTimeContext,
  getConversationState,
  pendingLocationReply,
  resolveRelevantRegion,
  updateConversationState,
} from "../lib/conversationState";
import {
  addressMatchesRegion,
  addressConflictsWithRegion,
  candidateMatchesIntent,
  companionIdentityReply,
  courtesyReply,
  detectRegion,
  extractLocalSearchIntent,
  PLACE_FRESHNESS_NOTICE,
  greetingReply,
  outOfScopeReply,
  researchLocalPlaces,
  regionLabel,
  shouldUseLocalWebFallback,
  type SandraRegion,
  urgentHealthReply,
  unsupportedSearchLanguageReply,
  unsupportedRegionReply,
} from "../lib/sandraKnowledge";

const router: IRouter = Router();
const CHAT_TIMEOUT_MS = 50_000;
const INTERPRETER_TIMEOUT_MS = 90_000;
const MAX_CHAT_MESSAGE_LENGTH = 4_000;
const MAX_AUDIO_BASE64_LENGTH = 22_000_000;
const MAX_AUDIO_BYTES = 16_000_000;
const SESSION_PATTERN =
  /^v3-([0-9a-z]{8,12})-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-caf",
  "audio/x-m4a",
]);
const rateLimitBuckets = new Map<
  string,
  { count: number; resetAt: number }
>();
const searchRegions = new Map<
  string,
  { region: SandraRegion; expiresAt: number }
>();
const SEARCH_REGION_TTL_MS = 24 * 60 * 60 * 1_000;
const searchQueries = new Map<
  string,
  { query: string; expiresAt: number }
>();
const sessionActivity = new Map<string, { expiresAt: number }>();
const SESSION_INACTIVITY_TTL_MS = 24 * 60 * 60 * 1_000;

function configuredBaseUrl(): string {
  const value =
    process.env.SANDRA_API_BASE_URL?.trim() || "https://sandra-bot.com/";
  return value.endsWith("/") ? value : `${value}/`;
}

function sessionKey(req: Request): string {
  const supplied = req.header("x-sandra-session")?.trim();
  if (supplied && SESSION_PATTERN.test(supplied)) return supplied;
  throw new Error("A validated Sandra session is required.");
}

function requireSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const supplied = req.header("x-sandra-session")?.trim();
  const match = supplied?.match(SESSION_PATTERN);
  const issuedAt = match?.[1] ? Number.parseInt(match[1], 36) : Number.NaN;
  const now = Date.now();
  if (
    !supplied ||
    !match ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now + 5 * 60_000 ||
    now - issuedAt > SESSION_ABSOLUTE_TTL_MS
  ) {
    res.status(400).json({
      code: "SANDRA_SESSION_REQUIRED",
      message: "Die Sandra-Sitzung fehlt oder ist ungültig.",
    });
    return;
  }
  const activity = sessionActivity.get(supplied);
  if (activity && activity.expiresAt <= now) {
    sessionActivity.delete(supplied);
    searchRegions.delete(supplied);
    searchQueries.delete(supplied);
    rememberedPlaces.delete(supplied);
    res.status(400).json({
      code: "SANDRA_SESSION_REQUIRED",
      message: "Die Sandra-Sitzung ist abgelaufen und wird erneuert.",
    });
    return;
  }
  sessionActivity.set(supplied, {
    expiresAt: now + SESSION_INACTIVITY_TTL_MS,
  });
  if (sessionActivity.size > 10_000) {
    for (const [key, value] of sessionActivity) {
      if (value.expiresAt <= now) sessionActivity.delete(key);
    }
    while (sessionActivity.size > 10_000) {
      const oldestKey = sessionActivity.keys().next().value;
      if (typeof oldestKey !== "string") break;
      sessionActivity.delete(oldestKey);
    }
  }
  next();
}

function upstreamSessionCookie(req: Request): string {
  const digest = createHash("sha256")
    .update(`sandra-mobile:${sessionKey(req)}`)
    .digest("hex");
  return `PHPSESSID=${digest}`;
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

function isValidBase64(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_AUDIO_BASE64_LENGTH &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  );
}

function validateChatInput(req: Request, res: Response): boolean {
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (
    req.body?.mode !== "chat" ||
    message.length === 0 ||
    message.length > MAX_CHAT_MESSAGE_LENGTH
  ) {
    res.status(400).json({
      code: "SANDRA_CHAT_INPUT",
      message:
        "Die Nachricht ist leer, ungültig oder länger als 4.000 Zeichen.",
    });
    return false;
  }

  req.body = { ...req.body, message };
  return true;
}

type SandraMap = {
  title: string;
  query: string;
  url: string;
};

type VerifiedPlace = SandraMap & {
  address: string;
  category: string;
  description: string;
  source?: string;
  checkedAt?: string;
  phone: string;
  hours: string;
  catalogId?: string;
};

function availableDetail(value?: string): string {
  const text = value?.trim() ?? "";
  return /^(?:nicht angegeben|nicht verfügbar|keine angabe|unbekannt|unknown|not available|n\/a|-)$/iu.test(
    text,
  )
    ? ""
    : text;
}

const rememberedPlaces = new Map<
  string,
  {
    places: VerifiedPlace[];
    lastShown: VerifiedPlace[];
    selected?: VerifiedPlace;
    expiresAt: number;
  }
>();
const REMEMBERED_PLACE_TTL_MS = 6 * 60 * 60 * 1_000;

function valueAfterLabel(
  lines: string[],
  label: RegExp,
): string {
  const labelIndex = lines.findIndex((line) => label.test(line));
  if (labelIndex < 0) return "";
  return lines.slice(labelIndex + 1).find((line) => line.length > 0) ?? "";
}

function valueOnOrAfterLabel(lines: string[], label: RegExp): string {
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(label);
    if (!match) continue;
    const inline = match[1]?.trim();
    if (inline) return inline;
    return lines.slice(index + 1).find((line) => line.length > 0) ?? "";
  }
  return "";
}

function placesFromVerifiedReply(reply: string): VerifiedPlace[] {
  const lines = reply.split(/\r?\n/).map((line) => line.trim());
  const places: VerifiedPlace[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const titleMatch = lines[index]?.match(/^\d+\.\s+(.+)$/);
    if (!titleMatch) continue;

    const title = titleMatch[1]?.trim();
    let end = index + 1;
    while (end < lines.length && !/^\d+\.\s+/.test(lines[end] ?? "")) end += 1;
    const block = lines.slice(index + 1, end);
    const address = valueAfterLabel(block, /^(?:📍\s*)?Adresse:\s*$/i);
    const phone = valueAfterLabel(block, /^(?:📞\s*)?Telefon:\s*$/i);
    const hours = valueAfterLabel(
      block,
      /^(?:🕒\s*)?Öffnungszeiten:\s*$/i,
    );
    const category =
      block.find(
        (line) =>
          line.length > 0 &&
          !/^(?:ℹ️|📍|📞|🕒|✓|Quelle:|Quellenstand:)/iu.test(line),
      ) ?? "";
    const description =
      block.find((line) => /^ℹ️/u.test(line))?.replace(/^ℹ️\s*/u, "") ?? "";
    const source = valueOnOrAfterLabel(
      block,
      /^(?:Quelle|Source):\s*(.*)$/iu,
    );
    const checkedAt = valueOnOrAfterLabel(
      block,
      /^(?:Geprüft|Zuletzt geprüft|Quellenstand|Checked):\s*(.*)$/iu,
    );

    if (!title || !address) continue;
    const query = `${title}, ${address}`;
    places.push({
      title,
      query,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      address,
      category,
      description,
      source,
      checkedAt,
      phone,
      hours,
    });
    if (places.length >= 10) break;
  }

  return places;
}

function rememberVerifiedPlaces(session: string, places: VerifiedPlace[]): void {
  if (places.length === 0) return;
  const now = Date.now();
  const existing = rememberedPlaces.get(session)?.places ?? [];
  const merged = [...existing, ...places].reduce<VerifiedPlace[]>((all, place) => {
    const index = all.findIndex(
      (candidate) =>
        candidate.title.toLocaleLowerCase("de-DE") ===
          place.title.toLocaleLowerCase("de-DE") &&
        candidate.address.toLocaleLowerCase("de-DE") ===
          place.address.toLocaleLowerCase("de-DE"),
    );
    if (index < 0) {
      all.push(place);
      return all;
    }
    const previous = all[index];
    all[index] = {
      ...previous,
      ...place,
      catalogId: place.catalogId ?? previous?.catalogId,
    };
    return all;
  }, []);
  rememberedPlaces.set(session, {
    places: merged.slice(-20),
    lastShown: places.slice(-3),
    selected: undefined,
    expiresAt: now + REMEMBERED_PLACE_TTL_MS,
  });

  if (rememberedPlaces.size > 5_000) {
    for (const [key, value] of rememberedPlaces) {
      if (value.expiresAt <= now) rememberedPlaces.delete(key);
    }
    while (rememberedPlaces.size > 5_000) {
      const oldestKey = rememberedPlaces.keys().next().value;
      if (typeof oldestKey !== "string") break;
      rememberedPlaces.delete(oldestKey);
    }
  }
}

function rememberSearchRegion(session: string, message: string): void {
  const region = detectRegion(message);
  if (!region) return;
  const now = Date.now();
  searchRegions.set(session, {
    region,
    expiresAt: now + SEARCH_REGION_TTL_MS,
  });
  if (searchRegions.size > 5_000) {
    for (const [key, value] of searchRegions) {
      if (value.expiresAt <= now) searchRegions.delete(key);
    }
    while (searchRegions.size > 5_000) {
      const oldestKey = searchRegions.keys().next().value;
      if (typeof oldestKey !== "string") break;
      searchRegions.delete(oldestKey);
    }
  }
}

function rememberSearchQuery(session: string, message: string): void {
  const normalized = message
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const { categories, criteria } = extractLocalSearchIntent(message);
  const localRequest =
    /\b(?:wo|suche|such|brauche|finde|gibt es|zeig|empfiehl|kaufen|mieten|reparieren|buchen)\b/u.test(
      normalized,
    );
  const detailRequest =
    /\b(?:adresse|telefon|telefonnummer|offnungszeit|wann.*off|schliess|erster|zweiter|dritter)\b/u.test(
      normalized,
    );
  const now = Date.now();
  const existing = searchQueries.get(session);
  if ((categories.length > 0 || localRequest) && !detailRequest) {
    rememberedPlaces.delete(session);
    searchQueries.set(session, {
      query: message,
      expiresAt: now + SEARCH_REGION_TTL_MS,
    });
  } else if (
    criteria.length > 0 &&
    existing &&
    existing.expiresAt > now
  ) {
    searchQueries.set(session, {
      query: `${existing.query}. Zusätzliche Kriterien: ${message}`,
      expiresAt: now + SEARCH_REGION_TTL_MS,
    });
  }
  if (searchQueries.size > 5_000) {
    for (const [key, value] of searchQueries) {
      if (value.expiresAt <= now) searchQueries.delete(key);
    }
    while (searchQueries.size > 5_000) {
      const oldestKey = searchQueries.keys().next().value;
      if (typeof oldestKey !== "string") break;
      searchQueries.delete(oldestKey);
    }
  }
}

async function hydrateSessionContext(req: Request): Promise<void> {
  const session = sessionKey(req);
  if (!currentSearchRegion(session, "")) {
    const regionContext = req.header("x-sandra-region-context")?.trim().slice(0, 100);
    if (regionContext) rememberSearchRegion(session, regionContext);
  }
  const rawSearchContext = req
    .header("x-sandra-search-context")
    ?.trim()
    .slice(0, 600);
  // This header is derived from a previously verified map result, not from a
  // new user search. English business names and addresses must survive a
  // server restart so the catalog can restore the selected place.
  const searchContext = rawSearchContext || undefined;
  if (!searchQueries.has(session) && searchContext) {
    searchQueries.set(session, {
      query: searchContext,
      expiresAt: Date.now() + SEARCH_REGION_TTL_MS,
    });
  }
  const region = currentSearchRegion(session, "");
  if (region && searchContext && !rememberedPlaces.has(session)) {
    const saved = await sandraCatalog.searchVerified({
      region,
      query: searchContext,
      limit: 10,
    });
    const exact = saved.filter((place) => {
      const normalizedContext = searchContext.toLocaleLowerCase("de-DE");
      return (
        normalizedContext.includes(place.name.toLocaleLowerCase("de-DE")) ||
        normalizedContext.includes(place.address.toLocaleLowerCase("de-DE"))
      );
    });
    if (exact.length > 0) {
      rememberVerifiedPlaces(
        session,
        exact.map((place) => {
          const query = `${place.name}, ${place.address}`;
          return {
            title: place.name,
            query,
            url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
            address: place.address,
            category: place.category,
            description: place.description ?? "",
            phone: availableDetail(place.phone),
            hours: availableDetail(place.hours),
            catalogId: place.id,
          };
        }),
      );
    }
  }
}

function effectiveSearchQuery(session: string, message: string): string {
  const current = searchQueries.get(session);
  if (!current || current.expiresAt <= Date.now()) {
    if (current) searchQueries.delete(session);
    return message;
  }
  const intent = extractLocalSearchIntent(message);
  return intent.categories.length === 0 && intent.criteria.length > 0
    ? current.query
    : message;
}

function currentSearchRegion(
  session: string,
  message: string,
): SandraRegion | null {
  const explicit = detectRegion(message);
  if (explicit) return explicit;
  const stateRegion = resolveRelevantRegion(
    getConversationState(session),
    detectTimeContext(message),
  );
  if (stateRegion) return stateRegion;
  const remembered = searchRegions.get(session);
  if (!remembered) return null;
  if (remembered.expiresAt <= Date.now()) {
    searchRegions.delete(session);
    return null;
  }
  return remembered.region;
}

function selectRememberedPlace(
  session: string,
  message: string,
): VerifiedPlace | undefined {
  const remembered = rememberedPlaces.get(session);
  if (!remembered) return undefined;
  if (remembered.expiresAt <= Date.now()) {
    rememberedPlaces.delete(session);
    return undefined;
  }
  const normalized = message.toLocaleLowerCase("de-DE");
  const intentText = normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/gu, "ss");
  const named = remembered.places.find((candidate) =>
    normalized.includes(candidate.title.toLocaleLowerCase("de-DE")),
  );
  if (named) {
    remembered.selected = named;
    return named;
  }
  const ordinalMatch = intentText.match(
    /\b(?:der|die|das|den|dem|vom|von|nummer|nr\.?)?\s*(erste[nrsm]?|zweite[nrsm]?|dritte[nrsm]?|[1-3])(?:\s+vorschlag)?\b/u,
  );
  if (!ordinalMatch) {
    if (remembered.selected) return remembered.selected;
    if (remembered.lastShown.length === 1) {
      remembered.selected = remembered.lastShown[0];
      return remembered.selected;
    }
    return undefined;
  }
  const ordinal = ordinalMatch[1] ?? "";
  const index = /^(?:erst|1)/u.test(ordinal)
    ? 0
    : /^(?:zweit|2)/u.test(ordinal)
      ? 1
      : 2;
  const selected = remembered.lastShown[index];
  if (selected) remembered.selected = selected;
  return selected;
}

function placeDetailReply(
  session: string,
  message: string,
): { reply: string; maps: SandraMap[] } | null {
  const withFreshnessNotice = (reply: string) =>
    `${reply}\n\n${PLACE_FRESHNESS_NOTICE}`;
  const normalized = message.toLocaleLowerCase("de-DE");
  const intentText = normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/gu, "ss");
  const place = selectRememberedPlace(session, message);
  if (!place) return null;

  if (
    /\b(?:wann.*(?:off|schliess)|offnungszeit|schlusszeit|wie lange.*(?:offen|geoffnet)|bis wann.*offen|hat .* offen|ist .* geoffnet|offnet )/u.test(intentText)
  ) {
    if (!place.hours) {
      return {
        reply: withFreshnessNotice(
          `Gern 😊 Für ${place.title} liegen mir momentan keine geprüften Öffnungszeiten vor.`,
        ),
        maps: [place],
      };
    }
    return {
      reply: withFreshnessNotice(
        `Gern 😊 ${place.title} hat laut meinem geprüften Eintrag ${place.hours} geöffnet.`,
      ),
      maps: [place],
    };
  }

  const asksForPhone =
    /\b(telefon|telefonnummer|anrufen|rufnummer)\b/u.test(normalized);
  const asksForAddress =
    /\b(adresse|wo ist|wo liegt|standort)\b/u.test(normalized);

  if (asksForPhone && asksForAddress) {
    const phoneDetail = place.phone
      ? `Die Telefonnummer lautet ${place.phone}.`
      : "Eine geprüfte Telefonnummer liegt Sandra momentan nicht vor.";
    return {
      reply: withFreshnessNotice(
        `${place.title} findest du hier: ${place.address}. ${phoneDetail}`,
      ),
      maps: [place],
    };
  }

  if (asksForPhone) {
    if (!place.phone) {
      return {
        reply: withFreshnessNotice(
          `Gern 😊 Für ${place.title} liegt mir momentan keine geprüfte Telefonnummer vor.`,
        ),
        maps: [place],
      };
    }
    return {
      reply: withFreshnessNotice(
        `Natürlich 😊 Die Telefonnummer von ${place.title} lautet ${place.phone}.`,
      ),
      maps: [place],
    };
  }

  if (asksForAddress) {
    return {
      reply: withFreshnessNotice(
        `Klar 😊 ${place.title} findest du hier: ${place.address}.`,
      ),
      maps: [place],
    };
  }

  if (/\b(?:wie komme ich|route|google maps|maps|navigier|bring mich|dahin)\b/u.test(intentText)) {
    return {
      reply: `Klar 😊 Hier ist der Google-Maps-Link zu ${place.title}. Öffne ihn einfach, dann übernimmt Google Maps die Route für dich.`,
      maps: [place],
    };
  }

  if (/\b(?:gefallt mir|passt|nehme ich|nehmen wir|den nehme|die nehme|das nehme)\b/u.test(intentText)) {
    return {
      reply: `Okay 😊 ${place.title} passt. Wenn du noch Adresse, Telefonnummer, Öffnungszeiten oder den Google-Maps-Link brauchst, sag einfach kurz Bescheid.`,
      maps: [place],
    };
  }

  if (
    /\b(?:der|die|das|den|dem|vom|von|nummer|nr\.?)?\s*(?:erste[nrsm]?|zweite[nrsm]?|dritte[nrsm]?|[1-3])(?:\s+vorschlag)?\b/u.test(intentText)
  ) {
    return {
      reply: `Okay 😊 Du meinst ${place.title}. Wenn du Adresse, Telefonnummer, Öffnungszeiten oder den Google-Maps-Link brauchst, sag einfach kurz Bescheid.`,
      maps: [place],
    };
  }

  return null;
}

async function placeFeedbackReply(
  session: string,
  message: string,
): Promise<{ reply: string; maps: SandraMap[] } | null> {
  const normalized = message
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (
    !/\b(?:falsch|stimmt nicht|gibt es nicht mehr|dauerhaft geschlossen|umgezogen|telefonnummer.*falsch|offnungszeiten.*falsch)\b/u.test(
      normalized,
    )
  ) {
    return null;
  }
  const place = selectRememberedPlace(session, message);
  if (!place) {
    return {
      reply:
        "Ich kann den Hinweis noch keinem der letzten Treffer eindeutig zuordnen. Nenne bitte den Namen oder sage erster, zweiter oder dritter Treffer.",
      maps: [],
    };
  }
  let catalogId = place.catalogId;
  if (!catalogId) {
    const region = currentSearchRegion(session, message);
    const created = await sandraCatalog.upsert({
      name: place.title,
      category: "Nutzerhinweis zu bestehendem Sandra-Eintrag",
      address: place.address,
      phone: place.phone || undefined,
      hours: place.hours || undefined,
      region: region ?? undefined,
      status: "pending",
    });
    catalogId = created.place.id;
    place.catalogId = catalogId;
  }
  await sandraCatalog.queueUserHint(catalogId, message.slice(0, 500));
  return {
    reply: `Danke. Ich habe deinen Hinweis zu ${place.title} zur Prüfung vorgemerkt. Der Eintrag ist bis zur Prüfung gesperrt und wird nicht gelöscht.`,
    maps: [place],
  };
}

function requestedMoreCount(message: string): number | null {
  const text = message
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ß/gu, "ss");
  if (/\b(?:noch|weitere?)\s+(?:zwei|2)\b/u.test(text)) return 2;
  if (/\b(?:noch|weitere?)\s+(?:eine|einen|eins|1)\b/u.test(text)) return 1;
  if (/\b(?:mehr|weitere|noch welche|noch mehr)\b/u.test(text)) return 3;
  return null;
}

async function moreResultsReply(
  session: string,
  message: string,
): Promise<{ reply: string; maps: SandraMap[] } | null> {
  const count = requestedMoreCount(message);
  if (!count) return null;
  const state = getConversationState(session);
  const region = resolveRelevantRegion(state, detectTimeContext(message)) ?? currentSearchRegion(session, message);
  const rememberedQuery = searchQueries.get(session);
  const baseIntent =
    state.currentIntent?.kind === "local_search"
      ? state.currentIntent.raw
      : rememberedQuery && rememberedQuery.expiresAt > Date.now()
        ? rememberedQuery.query
        : undefined;
  if (!region || !baseIntent) return null;

  const existing = rememberedPlaces.get(session)?.places ?? [];
  const excluded = new Set(existing.map((place) => place.title.toLocaleLowerCase("de-DE")));
  const searchMessage = buildSearchMessage(baseIntent, state);

  const saved = (await sandraCatalog.searchVerified({ region, query: searchMessage, limit: 50 }))
    .filter((place) => catalogPlaceMatchesQuery(place, searchMessage))
    .filter((place) => !excluded.has(place.name.toLocaleLowerCase("de-DE")))
    .slice(0, count);

  let nextPlaces: VerifiedPlace[] = saved.map((place) => {
    const query = `${place.name}, ${place.address}`;
    return {
      title: place.name,
      query,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      address: place.address,
      category: place.category,
      description: place.description ?? "",
      source: place.sources[0]?.url,
      checkedAt: place.checkedAt,
      phone: availableDetail(place.phone),
      hours: availableDetail(place.hours),
      catalogId: place.id,
    };
  });

  let reply = "";
  if (saved.length > 0) {
    reply = catalogReply(saved, region).reply;
  }

  if (nextPlaces.length < count) {
    const excludedNames = [...excluded, ...nextPlaces.map((place) => place.title.toLocaleLowerCase("de-DE"))];
    const researched = await researchLocalPlaces(
      `${searchMessage} Bereits gezeigt und nicht wiederholen: ${excludedNames.join(", ")}.`,
      region,
    );
    if (researched) {
      const researchedPlaces = placesFromVerifiedReply(researched.reply)
        .filter((place) => !excluded.has(place.title.toLocaleLowerCase("de-DE")))
        .filter((place) => !nextPlaces.some((candidate) => candidate.title.toLocaleLowerCase("de-DE") === place.title.toLocaleLowerCase("de-DE")))
        .slice(0, count - nextPlaces.length);
      if (researchedPlaces.length > 0) {
        if (researched.verifiedPlaces?.length) {
          await storeVerifiedPlaces(researched.verifiedPlaces, region);
        }
        nextPlaces = [...nextPlaces, ...researchedPlaces];
        reply = researched.reply;
      }
    }
  }

  if (nextPlaces.length === 0) {
    return {
      reply: `Ich habe gerade keine weiteren ausreichend geprüften Treffer in ${regionLabel(region)} gefunden. 😊`,
      maps: [],
    };
  }
  rememberVerifiedPlaces(session, nextPlaces);

  if (!reply || saved.length > 0) {
    const blocks = nextPlaces.map((place, index) => {
      const details = [
        `${index + 1}. ${place.title}`,
        place.category,
        place.description ? `ℹ️ ${place.description}` : "",
        "📍 Adresse:",
        place.address,
        place.phone ? `📞 Telefon:\n${place.phone}` : "",
        place.hours ? `🕒 Öffnungszeiten:\n${place.hours}` : "",
      ].filter(Boolean);
      return details.join("\n");
    });
    reply = blocks.join("\n\n");
  }

  return {
    reply: `Gern 😊 Hier ${nextPlaces.length === 1 ? "ist noch eine passende Möglichkeit" : `sind noch ${nextPlaces.length} passende Möglichkeiten`} für dich:\n\n${reply}`,
    maps: nextPlaces.map(({ title, query, url }) => ({ title, query, url })),
  };
}

function addMissingMaps(
  body: string,
  contentType: string | null,
  session: string,
): string {
  if (!contentType?.toLowerCase().includes("application/json")) return body;

  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object") return body;

    const response = parsed as Record<string, unknown>;
    if (typeof response.reply === "string") {
      rememberVerifiedPlaces(
        session,
        placesFromVerifiedReply(response.reply),
      );
    }
    if (Array.isArray(response.maps) && response.maps.length > 0) return body;
    if (typeof response.reply !== "string") return body;

    const maps = placesFromVerifiedReply(response.reply);
    return maps.length > 0 ? JSON.stringify({ ...response, maps }) : body;
  } catch {
    return body;
  }
}

function rateLimit(scope: string, maximum: number, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = `${scope}:${sessionKey(req)}`;
    const existing = rateLimitBuckets.get(key);
    const bucket =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;

    if (bucket.count >= maximum) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", retryAfter.toString());
      res.status(429).json({
        code: "SANDRA_RATE_LIMIT",
        message: `Zu viele Anfragen. Bitte warte ${retryAfter} Sekunden und versuche es erneut.`,
      });
      return;
    }

    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);

    if (rateLimitBuckets.size > 5_000) {
      for (const [bucketKey, value] of rateLimitBuckets) {
        if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
      }
      while (rateLimitBuckets.size > 5_000) {
        const oldestKey = rateLimitBuckets.keys().next().value;
        if (typeof oldestKey !== "string") break;
        rateLimitBuckets.delete(oldestKey);
      }
    }

    next();
  };
}

async function forwardJson(
  req: Request,
  res: Response,
  upstreamPath: string,
  enrichMaps = false,
): Promise<void> {
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) {
    res.status(503).json({
      code: "SANDRA_API_NOT_CONFIGURED",
      message:
        "Die originale Sandra-API ist noch nicht konfiguriert. Setze SANDRA_API_BASE_URL auf die bestehende PHP-Sandra.",
    });
    return;
  }

  const upstreamUrl = new URL(upstreamPath, baseUrl);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: upstreamSessionCookie(req),
      },
      body: JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    const upstreamBody = await upstream.text();
    const contentType = upstream.headers.get("content-type");
    let body = upstreamBody;
    let responseStatus = upstream.status;
    if (enrichMaps) {
      const session = sessionKey(req);
      const requestedRegion = currentSearchRegion(
        session,
        typeof req.body?.message === "string" ? req.body.message : "",
      );
      let unsafeUpstreamRegion: SandraRegion | null = null;
      try {
        const parsed = JSON.parse(upstreamBody) as { reply?: unknown };
        const upstreamReply =
          typeof parsed.reply === "string" ? parsed.reply : "";
        const region =
          requestedRegion ?? detectRegion(upstreamReply);
        const upstreamPlaces = placesFromVerifiedReply(upstreamReply);
        const searchQuery = effectiveSearchQuery(
          session,
          typeof req.body?.message === "string" ? req.body.message : "",
        );
        const regionConflict =
          region !== null &&
          upstreamPlaces.some((place) =>
            addressConflictsWithRegion(place.address, region),
          );
        const upstreamInvalid =
          region !== null &&
          upstreamPlaces.length > 0 &&
          upstreamPlaces.some(
            (place) =>
              !addressMatchesRegion(place.address, region) ||
              !/^https:\/\//iu.test(place.source ?? "") ||
              !/\b20\d{2}[-./]\d{1,2}[-./]\d{1,2}\b/u.test(
                place.checkedAt ?? "",
              ) ||
              !candidateMatchesIntent(
                searchQuery,
                extractLocalSearchIntent(searchQuery),
                place.title,
                place.category,
                place.description,
                place.hours,
              ),
          );
        const upstreamRequiresVerification =
          region !== null && upstreamPlaces.length > 0;
        const localSearchRequiresVerification = region !== null;
        if (
          regionConflict ||
          upstreamInvalid ||
          upstreamRequiresVerification ||
          localSearchRequiresVerification
        ) {
          unsafeUpstreamRegion = region;
        }
        if (
          upstream.ok &&
          region === null
        ) {
          body = JSON.stringify({
            reply:
              "In welcher von Sandras sechs Regionen suchst du? Wähle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya. Ohne eindeutige Region gebe ich keinen Treffer aus.",
            maps: [],
          });
          responseStatus = 200;
        } else if (
          upstream.ok &&
          (regionConflict ||
            upstreamInvalid ||
            upstreamRequiresVerification ||
            localSearchRequiresVerification ||
            shouldUseLocalWebFallback(
              upstreamReply,
              req.body.message,
              region,
            ))
        ) {
          const catalogPlaces = (
            await sandraCatalog.searchVerified({
              region,
              query: searchQuery,
              limit: 50,
            })
          )
            .filter((place) => catalogPlaceMatchesQuery(place, searchQuery))
            .slice(0, 3);
          if (catalogPlaces.length > 0) {
            const savedReply = catalogReply(catalogPlaces, region);
            body = JSON.stringify(savedReply);
            responseStatus = 200;
            rememberVerifiedPlaces(
              session,
              catalogPlaces.map((place) => {
                const query = `${place.name}, ${place.address}`;
                return {
                  title: place.name,
                  query,
                  url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
                  address: place.address,
                  category: place.category,
                  description: place.description ?? "",
                  phone: availableDetail(place.phone),
                  hours: availableDetail(place.hours),
                  catalogId: place.id,
                };
              }),
            );
          } else {
            const preferredCandidates = upstreamPlaces
              .map(
                (place) =>
                  `${place.title} | ${place.category} | ${place.address} | ${place.source ?? ""}`,
              )
              .join("\n");
            const phpCandidateHint =
              preferredCandidates ||
              upstreamReply.replace(/\s+/gu, " ").trim().slice(0, 1_500);
            const researched = await researchLocalPlaces(
              phpCandidateHint
                ? `${searchQuery}\nVorrangig zu prüfender Kandidatenhinweis aus Sandras PHP-Bestand; nicht ungeprüft übernehmen:\n${phpCandidateHint}`
                : searchQuery,
              region,
            );
            if (researched) {
              const stored = researched.verifiedPlaces?.length
                ? await storeVerifiedPlaces(researched.verifiedPlaces, region)
                : [];
              body = JSON.stringify({
                reply: researched.reply,
                maps: researched.maps,
              });
              responseStatus = 200;
              if (stored.length > 0) {
                rememberVerifiedPlaces(
                  session,
                  stored.map((place) => {
                    const query = `${place.name}, ${place.address}`;
                    return {
                      title: place.name,
                      query,
                      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
                      address: place.address,
                      category: place.category,
                      description: place.description ?? "",
                      phone: availableDetail(place.phone),
                      hours: availableDetail(place.hours),
                      catalogId: place.id,
                    };
                  }),
                );
              }
            } else {
              body = JSON.stringify({
                reply: `In ${regionLabel(region)} habe ich momentan keinen ausreichend geprüften Eintrag gefunden. Ich zeige dir deshalb keine Adresse aus einer anderen Region.`,
                maps: [],
              });
              responseStatus = 200;
            }
          }
        }
      } catch {
        const safeRegion = unsafeUpstreamRegion ?? requestedRegion;
        if (safeRegion) {
          body = JSON.stringify({
            reply: `In ${regionLabel(safeRegion)} habe ich momentan keinen ausreichend geprüften Eintrag gefunden. Ich zeige dir deshalb keine Adresse aus einer anderen Region.`,
            maps: [],
          });
        } else {
          body = JSON.stringify({
            reply:
              "In welcher von Sandras sechs Regionen suchst du? Wähle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya. Ohne eindeutige Region gebe ich keinen Treffer aus.",
            maps: [],
          });
        }
        responseStatus = 200;
      }
      body = addMissingMaps(body, "application/json", session);
    }
    res.status(responseStatus);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      contentType ?? "application/json; charset=UTF-8",
    );
    res.send(body);
  } catch (error) {
    if (isTimeoutError(error)) {
      res.status(504).json({
        code: "SANDRA_API_TIMEOUT",
        message:
          "Sandra braucht momentan zu lange für die Antwort. Bitte versuche es erneut.",
      });
      return;
    }
    res.status(502).json({
      code: "SANDRA_API_UNREACHABLE",
      message:
        "Die originale Sandra-API ist momentan nicht erreichbar. Es werden keine Ersatzdaten verwendet.",
    });
  }
}

type InterpreterResult = {
  ok: boolean;
  heard?: string;
  translated?: string;
  audio?: string;
  error?: string;
};

async function runLocalOriginalInterpreter(
  audio: Buffer,
  mime: string,
  fileName: string,
  target: "de" | "th",
): Promise<InterpreterResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const sourceLanguage = target === "th" ? "de" : "th";
  let heard = "";

  // Speech recognition is the most failure-prone part of the interpreter.
  // Try the fast transcription model first and transparently retry once with
  // the higher-capability transcription model before returning a speech error.
  for (const model of ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"] as const) {
    const transcriptionForm = new FormData();
    transcriptionForm.append(
      "file",
      new Blob([new Uint8Array(audio)], { type: mime }),
      fileName,
    );
    transcriptionForm.append("model", model);
    transcriptionForm.append("language", sourceLanguage);

    try {
      const transcriptionResponse = await fetch(
        "https://api.openai.com/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: transcriptionForm,
          signal: AbortSignal.timeout(25_000),
        },
      );
      if (!transcriptionResponse.ok) continue;
      const transcription = (await transcriptionResponse.json()) as {
        text?: unknown;
      };
      heard =
        typeof transcription.text === "string" ? transcription.text.trim() : "";
      if (heard) break;
    } catch {
      // Retry with the alternate transcription model below.
    }
  }

  if (!heard) return { ok: false, error: "speech" };

  const sourceName = target === "th" ? "German" : "Thai";
  const targetName = target === "th" ? "Thai" : "German";
  const translationResponse = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content: `Translate from ${sourceName} to ${targetName}. Output only the translation. Keep the same meaning and sentence type. A question stays a question.`,
          },
          { role: "user", content: heard },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    },
  );
  if (!translationResponse.ok) return { ok: false, error: "translation" };
  const translation = (await translationResponse.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const translated =
    typeof translation.choices?.[0]?.message?.content === "string"
      ? translation.choices[0].message.content
          .trim()
          .replace(/^["'«»]|["'«»]$/gu, "")
      : "";
  if (!translated) return { ok: false, error: "translation" };

  const speechResponse = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1",
      voice: "nova",
      speed: 1.05,
      input: translated,
      response_format: "mp3",
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!speechResponse.ok) return { ok: false, error: "tts" };
  const spokenAudio = Buffer.from(await speechResponse.arrayBuffer());
  if (spokenAudio.length === 0) return { ok: false, error: "tts" };

  return {
    ok: true,
    heard,
    translated,
    audio: spokenAudio.toString("base64"),
  };
}

async function forwardAudio(req: Request, res: Response): Promise<void> {
  const baseUrl = configuredBaseUrl();
  const upstreamUrl = new URL(
    process.env.SANDRA_API_INTERPRETER_AUDIO_PATH?.trim() || "translate.php",
    baseUrl,
  );

  try {
    const audioBase64 =
      typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
    const target = req.body?.target === "de" ? "de" : req.body?.target === "th" ? "th" : "";
    const requestedMime =
      typeof req.body?.mime === "string" ? req.body.mime.toLowerCase() : "";
    const mime = AUDIO_MIME_TYPES.has(requestedMime)
      ? requestedMime
      : "audio/mp4";
    const fileName =
      typeof req.body?.fileName === "string" && req.body.fileName.length <= 120
        ? req.body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")
        : "sprache.m4a";

    if (!target || !isValidBase64(audioBase64)) {
      res.status(400).json({
        code: "SANDRA_INTERPRETER_INPUT",
        message: "Die Audioaufnahme ist ungültig oder zu groß.",
      });
      return;
    }

    const boundary = `----SandraMobile${Date.now().toString(16)}`;
    const audio = Buffer.from(audioBase64, "base64");
    if (audio.length < 64 || audio.length > MAX_AUDIO_BYTES) {
      res.status(400).json({
        code: "SANDRA_INTERPRETER_INPUT",
        message: "Die Audioaufnahme ist ungültig oder zu groß.",
      });
      return;
    }
    const prefix = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="target"\r\n\r\n${target}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${fileName}"\r\n` +
        `Content-Type: ${mime}\r\n\r\n`,
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: Buffer.concat([prefix, audio, suffix]),
      signal: AbortSignal.timeout(INTERPRETER_TIMEOUT_MS),
    });

    const body = await upstream.text();
    let upstreamResult: InterpreterResult | null = null;
    try {
      upstreamResult = JSON.parse(body) as InterpreterResult;
    } catch {
      upstreamResult = null;
    }

    if (
      upstream.ok &&
      upstreamResult?.ok === false &&
      upstreamResult.error === "speech"
    ) {
      const localResult = await runLocalOriginalInterpreter(
        audio,
        mime,
        fileName,
        target,
      );
      if (localResult) {
        res.status(200);
        res.setHeader("Cache-Control", "no-store");
        res.json(localResult);
        return;
      }
    }

    res.status(upstream.status);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") ?? "application/json; charset=UTF-8",
    );
    res.send(body);
  } catch (error) {
    if (isTimeoutError(error)) {
      res.status(504).json({
        code: "SANDRA_INTERPRETER_TIMEOUT",
        message:
          "Die Übersetzung dauert momentan zu lange. Bitte versuche es erneut.",
      });
      return;
    }
    res.status(502).json({
      code: "SANDRA_INTERPRETER_UNREACHABLE",
      message:
        "Der originale Sandra-Dolmetscher ist momentan nicht erreichbar.",
    });
  }
}

router.post("/chat", requireSession, rateLimit("chat", 30), async (req, res) => {
  if (!validateChatInput(req, res)) return;
  const session = sessionKey(req);
  const originalMessage = req.body.message;

  // Block forbidden/general/off-scope requests before they can mutate local
  // search state or inherit a previous local place/region.
  const earlyUnsupportedReply = outOfScopeReply(originalMessage);
  if (earlyUnsupportedReply) {
    res.json({ reply: earlyUnsupportedReply, maps: [] });
    return;
  }

  await hydrateSessionContext(req);
  const state = updateConversationState(session, originalMessage);
  rememberSearchRegion(session, originalMessage);
  rememberSearchQuery(session, originalMessage);

  const urgentReply = urgentHealthReply(originalMessage);
  if (urgentReply) {
    state.conversationPhase = "EMERGENCY";
    res.json({ reply: urgentReply, maps: [] });
    return;
  }
  const languageReply = unsupportedSearchLanguageReply(originalMessage);
  if (languageReply) {
    res.json({ reply: languageReply, maps: [] });
    return;
  }
  const feedbackReply = await placeFeedbackReply(session, originalMessage);
  if (feedbackReply) {
    res.json(feedbackReply);
    return;
  }
  const detailReply = placeDetailReply(session, originalMessage);
  if (detailReply) {
    res.json(detailReply);
    return;
  }
  const moreReply = await moreResultsReply(session, originalMessage);
  if (moreReply) {
    res.json(moreReply);
    return;
  }
  const politeReply = courtesyReply(originalMessage);
  if (politeReply) {
    res.json({ reply: politeReply, maps: [] });
    return;
  }
  const helloReply = greetingReply(originalMessage);
  if (helloReply) {
    res.json({ reply: helloReply, maps: [] });
    return;
  }
  const identityReply = companionIdentityReply(originalMessage);
  if (identityReply) {
    res.json({ reply: identityReply, maps: [] });
    return;
  }
  const askLocation = pendingLocationReply(state);
  if (askLocation) {
    res.json({ reply: askLocation, maps: [] });
    return;
  }
  const wrongRegionReply = unsupportedRegionReply(originalMessage);
  if (wrongRegionReply) {
    res.json({ reply: wrongRegionReply, maps: [] });
    return;
  }

  req.body = {
    ...req.body,
    message: buildSearchMessage(originalMessage, state),
  };
  void forwardJson(
    req,
    res,
    process.env.SANDRA_API_CHAT_PATH?.trim() || "sandra-bot.php",
    true,
  );
});

router.post(
  "/interpreter/german-thai",
  requireSession,
  rateLimit("interpreter-text", 30),
  (req, res) => {
    void forwardJson(
      req,
      res,
      process.env.SANDRA_API_GERMAN_THAI_PATH?.trim() || "deutsch-thai.php",
    );
  },
);

router.post(
  "/interpreter/thai-german",
  requireSession,
  rateLimit("interpreter-text", 30),
  (req, res) => {
    void forwardJson(
      req,
      res,
      process.env.SANDRA_API_THAI_GERMAN_PATH?.trim() || "thai-deutsch.php",
    );
  },
);

router.post(
  "/interpreter/audio",
  requireSession,
  rateLimit("interpreter-audio", 8),
  (req, res) => {
    void forwardAudio(req, res);
  },
);

export default router;