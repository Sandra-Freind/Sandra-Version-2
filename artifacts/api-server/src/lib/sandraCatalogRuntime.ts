import path from "node:path";
import {
  SandraCatalog,
  type CatalogPlace,
  type CatalogSource,
} from "./sandraCatalog";
import {
  candidateMatchesIntent,
  extractLocalSearchIntent,
  PLACE_FRESHNESS_NOTICE,
  regionLabel,
  type LocalSearchReply,
  type LocalVerifiedPlace,
  type SandraRegion,
} from "./sandraKnowledge";

const dataDirectory =
  process.env.SANDRA_DATA_DIR?.trim() || path.resolve(process.cwd(), "data");

export const sandraCatalog = new SandraCatalog(
  path.join(dataDirectory, "sandra-catalog.json"),
  { maxBackups: 14, staleAfterDays: 90, lockWaitMs: 8_000 },
);

function sourceKind(url: string): CatalogSource["kind"] {
  const host = new URL(url).hostname.toLocaleLowerCase("en-US");
  if (
    /(?:google|facebook|instagram|tripadvisor|yelp|cybo|thaithurkic|foursquare|yellowpages)/u.test(
      host,
    )
  ) {
    return "directory";
  }
  return "operator";
}

function availableDetail(value?: string): string | undefined {
  const text = value?.trim();
  return text &&
    !/^(?:nicht angegeben|nicht verfügbar|keine angabe|unbekannt|unknown|not available|n\/a|-)$/iu.test(
      text,
    )
    ? text
    : undefined;
}

export async function storeVerifiedPlaces(
  places: LocalVerifiedPlace[],
  region: SandraRegion,
): Promise<CatalogPlace[]> {
  const stored: CatalogPlace[] = [];
  for (const place of places) {
    const checkedAt = new Date(place.checkedAt).toISOString();
    const sources = place.sources.map((url) => ({
      url,
      checkedAt,
      kind: sourceKind(url),
      note: place.sourceDate
        ? `Von der Quelle angegebener Stand: ${place.sourceDate}`
        : undefined,
    }));
    const result = await sandraCatalog.upsert({
      name: place.name,
      category: place.category,
      address: place.address,
      phone: availableDetail(place.phone),
      description: place.description,
      hours: availableDetail(place.hours),
      region,
      status: "verified",
      sources,
      checkedAt,
    });
    stored.push(result.place);
  }
  return stored;
}

export function catalogReply(
  places: CatalogPlace[],
  region: SandraRegion,
): LocalSearchReply {
  const replyParts = [
    `Klar 😊 Ich habe ${places.length} ${places.length === 1 ? "passenden geprüften Treffer" : "passende geprüfte Treffer"} in ${regionLabel(region)} für dich gefunden:`,
  ];
  const maps = places.map((place, index) => {
    const checkedDate = place.checkedAt.slice(0, 10);
    const details = [
      `${index + 1}. ${place.name}`,
      place.category,
      place.description ? `ℹ️ ${place.description}` : "",
      "📍 Adresse:",
      place.address,
      availableDetail(place.phone)
        ? `📞 Telefon:\n${availableDetail(place.phone)}`
        : "",
      availableDetail(place.hours)
        ? `🕒 Öffnungszeiten:\n${availableDetail(place.hours)}`
        : "",
      `✓ Zuletzt geprüft: ${checkedDate}`,
      place.sources[0]?.url ? `Quelle:\n${place.sources[0].url}` : "",
    ].filter(Boolean);
    replyParts.push(details.join("\n"));
    const query = place.coordinates
      ? `${place.coordinates.latitude},${place.coordinates.longitude}`
      : `${place.name}, ${place.address}`;
    return {
      title: place.name,
      query,
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
    };
  });
  return {
    reply: `${replyParts.join("\n\n")}\n\n${PLACE_FRESHNESS_NOTICE}`,
    maps,
  };
}

export function catalogPlaceMatchesQuery(
  place: CatalogPlace,
  query: string,
): boolean {
  const intent = extractLocalSearchIntent(query);
  if (
    !candidateMatchesIntent(
      query,
      intent,
      place.name,
      place.category,
      place.description ?? "",
      place.hours ?? "",
    )
  ) {
    return false;
  }
  const searchable = `${place.description ?? ""} ${place.hours ?? ""}`
    .toLocaleLowerCase("de-DE")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  for (const criterion of intent.criteria) {
    if (
      criterion === "deutschsprachig" &&
      !/\b(?:deutsch|german)\b/u.test(searchable)
    ) return false;
    if (criterion === "Parkplatz" && !/\b(?:parkplatz|parking)\b/u.test(searchable)) {
      return false;
    }
    if (
      criterion === "24 Stunden geöffnet" &&
      !/\b(?:24 ?stunden|24 ?hours?|24\/7|rund um die uhr)\b/u.test(searchable)
    ) return false;
    if (
      criterion === "rollstuhlgerecht" &&
      !/\b(?:rollstuhl|wheelchair|barrierefrei)\b/u.test(searchable)
    ) return false;
    if (
      criterion === "kindergeeignet" &&
      !/\b(?:kinder|children|family friendly|kindfreundlich)\b/u.test(searchable)
    ) return false;
    if (
      criterion === "jetzt geöffnet" &&
      !/\b(?:24 ?stunden|24 ?hours?|24\/7|rund um die uhr)\b/u.test(searchable)
    ) return false;
  }
  return true;
}
