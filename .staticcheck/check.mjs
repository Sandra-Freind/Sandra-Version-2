// mnt/data/sandra_newstand_review/artifacts/api-server/src/lib/sandraKnowledge.ts
var REGION_PATTERNS = {
  naklua: /(?:\b(?:naklua|nakluea|na[ -]?kluea|na[ -]?klua)\b|นาเกลือ)/u,
  wongamat: /(?:\b(?:wongamat|wong amat|wongamart)\b|วงศ์?อมาตย์|วงศ์อมาต)/u,
  central: /(?:\b(?:central pattaya|pattaya central|pattaya klang|central pattaya road|pattaya mitte|zentrum (?:von )?pattaya)\b|พัทยากลาง)/u,
  pratumnak: /(?:\b(?:pratumnak|pratamnak|phra[ -]?tamnak|phra[ -]?tamn[aä]k|khao phra tamnak)\b|เขาพระตำหนัก|พระตำหนัก)/u,
  jomtien: /(?:\b(?:jomtien|jomtian|jomtiem|chomtien|chom tien)\b|จอมเทียน)/u,
  darkside: /(?:\b(?:dark[ -]?side|east(?:ern)? pattaya|pattaya east|ostlich(?:e|en|es)? pattaya|nong[ -]?prue|nongpru)\b|หนองปรือ|พัทยาตะวันออก|ดาร์กไซด์)/u
};
var NA_JOMTIEN_PATTERN = /(?:\b(?:na[ -]?jomtien|na[ -]?jomtian|na[ -]?jomtiem|na[ -]?chomtien)\b|นาจอมเทียน)/u;
var SOUTH_PATTAYA_PATTERN = /(?:\b(?:south pattaya|pattaya south|pattaya tai|sudpattaya|south of pattaya)\b|พัทยาใต้)/u;
var BORDER_ROAD_PATTERN = /(?:\b(?:thappraya|thap[ -]?phraya|tappraya|thepprasit|thep[ -]?prasit)\b|เทพประสิทธิ์|ทัพพระยา)/u;
function normalized(value) {
  return value.toLocaleLowerCase("de-DE").normalize("NFD").replace(/[\u0300-\u036f]/gu, "").replace(/ß/gu, "ss");
}
function detectRegion(message) {
  const text = normalized(message);
  if (NA_JOMTIEN_PATTERN.test(text)) return null;
  if (REGION_PATTERNS.wongamat.test(text)) return "wongamat";
  if (REGION_PATTERNS.naklua.test(text)) return "naklua";
  if (REGION_PATTERNS.pratumnak.test(text)) return "pratumnak";
  if (REGION_PATTERNS.jomtien.test(text) && !BORDER_ROAD_PATTERN.test(text)) {
    return "jomtien";
  }
  if (REGION_PATTERNS.darkside.test(text) && !BORDER_ROAD_PATTERN.test(text)) {
    return "darkside";
  }
  if (REGION_PATTERNS.central.test(text) && !SOUTH_PATTAYA_PATTERN.test(text)) {
    return "central";
  }
  return null;
}
function extractLocalSearchIntent(message) {
  const text = normalized(message);
  const categoryRules = [
    [
      "Apotheke / pharmacy / drugstore",
      /(?:\b(?:apotheke|pharmacy|drugstore|chemist)\b|ยา|รานยา)/u
    ],
    ["Zahnarzt / dentist", /\b(?:zahnarzt|dentist|dental|ทันต)\b/u],
    ["Arzt / Klinik", /\b(?:arzt|doctor|clinic|klinik(?:en)?|hospital|โรงพยาบาล|แพทย์)\b/u],
    ["Tierarzt / veterinarian", /(?:\b(?:tierarzt|veterinarian|veterinary|vet clinic)\b|สัตวแพทย)/u],
    ["Restaurant / Essen", /(?:\b(?:restaurant|essen|food|cafe|café)\b|อาหาร)/u],
    [
      "Handyreparatur",
      /\b(?:handyreparatur|mobiltelefonreparatur|phone repair|mobile repair)\b|\b(?:handy|mobiltelefon|smartphone|handydisplay)\b.{0,50}\b(?:reparier\w*|kaputt|display|akku)\b/u
    ],
    ["Autowerkstatt", /\b(?:autowerkstatt|kfz werkstatt|car repair|auto repair|garage)\b/u],
    ["Lebensmittelgesch\xE4ft", /(?:\b(?:lebensmittel|supermarkt|supermarket|grocery)\b|ตลาด|รานขายของชา)/u],
    ["Friseur", /\b(?:friseur|haarsalon|hairdresser|barber|salon)\b/u],
    ["Reinigungsdienst", /\b(?:reinigung|reinigungsdienst|cleaning service|cleaner)\b/u],
    ["Handwerker", /\b(?:handwerker|elektriker|klempner|schlüsseldienst|electrician|plumber|locksmith)\b/u],
    [
      "Beh\xF6rde / \xF6ffentliche Anlaufstelle",
      /\b(?:behorde|amt|verwaltung|rathaus|polizei|police|immigration|district office|municipal office|government office|offentliche anlaufstelle)\b/u
    ],
    ["Werkstatt / Reparatur", /\b(?:werkstatt|garage|reparatur|repair|service center|service centre)\b/u]
  ];
  const categories = categoryRules.flatMap(
    ([label, pattern]) => pattern.test(text) ? [label] : []
  );
  const criterionRules = [
    [
      "deutschsprachig",
      /\b(?:deutschsprachig(?:e[rsnm]?)?|deutsch(?:er|e|en)?|german(?: speaking)?)\b/u
    ],
    ["Parkplatz", /\b(?:parkplatz|parking)\b/u],
    ["24 Stunden ge\xF6ffnet", /\b(?:24 ?stunden|24 ?hours?|rund um die uhr)\b/u],
    [
      "rollstuhlgerecht",
      /\b(?:rollstuhlgerecht(?:e[rsnm]?)?|rollstuhlfreundlich(?:e[rsnm]?)?|rollstuhl|wheelchair|barrierefrei)\b/u
    ],
    [
      "kindergeeignet",
      /\b(?:kinderfreundlich\w*|kindfreundlich\w*|kinder|family friendly|children)\b/u
    ],
    ["jetzt ge\xF6ffnet", /\b(?:jetzt geoffnet\w*|open now|geoffnet jetzt)\b/u]
  ];
  const criteria = criterionRules.flatMap(
    ([label, pattern]) => pattern.test(text) ? [label] : []
  );
  return { categories, criteria };
}
function unsupportedRegionReply(message) {
  const text = normalized(message);
  if (NA_JOMTIEN_PATTERN.test(text)) {
    return "Na Jomtien geh\xF6rt nicht zu Sandras Region Jomtien. Ich gebe deshalb keine Jomtien-Treffer als passend aus. W\xE4hle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.";
  }
  if (SOUTH_PATTAYA_PATTERN.test(text)) {
    return "South Pattaya geh\xF6rt nicht zu Sandras Region Central Pattaya. Ich gebe deshalb keine Central-Pattaya-Treffer als passend aus. W\xE4hle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.";
  }
  if (/\b(?:sattahip|bang saray|bang sare|si racha|sriracha)\b/u.test(text)) {
    return "Der genannte Ort liegt au\xDFerhalb von Sandras sechs Pattaya-Regionen. Ich gebe deshalb keine Treffer aus einer anderen Gegend aus. W\xE4hle bitte Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien oder Darkside / East Pattaya.";
  }
  return null;
}
function companionIdentityReply(message) {
  const text = normalized(message);
  if (!/\b(wer bist du|was kannst du|wobei kannst du mir helfen)\b/u.test(text)) {
    return null;
  }
  return "Ich bin Sandra. Ich helfe dir, passende Orte, Betriebe und Anlaufstellen in Pattaya und Umgebung zu finden. Sag mir einfach, was du suchst und in welcher Gegend.";
}
function courtesyReply(message) {
  const text = normalized(message).replace(/[.!?,;:]+/gu, " ").trim();
  if (/\b(?:danke|vielen dank)\b/u.test(text) && /\b(?:reicht|genug|passt|alles klar)\b/u.test(text)) {
    return "Sehr gern \u{1F60A} Wenn du sp\xE4ter wieder etwas in Pattaya suchst, bin ich f\xFCr dich da.";
  }
  if (/^(?:danke|vielen dank|nein danke)$/u.test(text)) return "Sehr gern \u{1F60A}";
  if (/^(?:tschuss|auf wiedersehen|bis spater)$/u.test(text)) {
    return "Bis sp\xE4ter \u{1F60A}";
  }
  return null;
}
function greetingReply(message) {
  const text = normalized(message).replace(/[.!?,;:]+/gu, " ").trim();
  if (/^(?:hallo|hallo sandra|hi|hi sandra|guten morgen|guten tag|guten abend)$/u.test(
    text
  )) {
    return "Hallo \u{1F60A} Was suchst du in Pattaya und in welcher Gegend soll ich f\xFCr dich schauen?";
  }
  return null;
}

// mnt/data/sandra_newstand_review/.staticcheck/check.ts
var cases = [
  ["Jomtien", detectRegion("Ich bin in Jomtien")],
  ["Naklua", detectRegion("Ich bin in Naklua")],
  ["Wongamat", detectRegion("Ich suche etwas in Wongamat")],
  ["Central", detectRegion("Central Pattaya")],
  ["Pratumnak", detectRegion("Pratumnak")],
  ["Darkside", detectRegion("Darkside Pattaya")],
  ["Na Jomtien excluded", detectRegion("Na Jomtien")],
  ["Sattahip unsupported", unsupportedRegionReply("Ich brauche ein Restaurant in Sattahip")],
  ["intent pharmacy", extractLocalSearchIntent("Ich suche eine g\xFCnstige Apotheke in Jomtien")],
  ["greeting", greetingReply("Hallo Sandra")],
  ["courtesy", courtesyReply("Danke")],
  ["identity", companionIdentityReply("Wer bist du?")]
];
for (const c of cases) console.log(JSON.stringify(c));
