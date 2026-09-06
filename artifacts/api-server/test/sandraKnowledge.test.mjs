import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const source = await readFile(
  new URL("../src/lib/sandraKnowledge.ts", import.meta.url),
  "utf8",
);
const compiled = await transform(source, {
  loader: "ts",
  format: "esm",
  target: "es2022",
});
const knowledge = await import(
  `data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`,
);

const {
  addressConflictsWithRegion,
  addressMatchesRegion,
  candidateMatchesIntent,
  detectRegion,
  extractLocalSearchIntent,
  outOfScopeReply,
  companionIdentityReply,
  urgentHealthReply,
  unsupportedSearchLanguageReply,
} = knowledge;

test("erkennt alle sechs Regionen in deutschen Suchformulierungen", () => {
  for (const [message, region] of [
    ["Hotel in Nakluea", "naklua"],
    ["Restaurant in Wong Amat", "wongamat"],
    ["Apotheke in Central Pattaya", "central"],
    ["Wohnung am Phra Tamnak", "pratumnak"],
    ["Restaurant in Jomtian", "jomtien"],
    ["Tierarzt in Nong Prue", "darkside"],
  ]) {
    assert.equal(detectRegion(message), region, message);
  }
});

test("begrenzt die lokale Suche auf deutsche Formulierungen", () => {
  assert.match(
    unsupportedSearchLanguageReply("Find me a dentist in Central Pattaya."),
    /ausschließlich auf Deutsch/,
  );
  assert.match(
    unsupportedSearchLanguageReply("I want a restaurant in Jomtien."),
    /ausschließlich auf Deutsch/,
  );
  assert.match(
    unsupportedSearchLanguageReply("Dentist in Jomtien."),
    /ausschließlich auf Deutsch/,
  );
  assert.match(
    unsupportedSearchLanguageReply("Grocery in Jomtien."),
    /ausschließlich auf Deutsch/,
  );
  assert.match(
    unsupportedSearchLanguageReply("หาร้านอาหารในวงศ์อมาตย์"),
    /Deutsch–Thai-Dolmetscher/,
  );
  assert.equal(
    unsupportedSearchLanguageReply("Wo ist das Foodland in Central Pattaya?"),
    null,
  );
  assert.equal(
    unsupportedSearchLanguageReply(
      "Wie lautet die Telefonnummer von Dream Drugstore, dem ersten Treffer aus der Jomtien-Suche?",
    ),
    null,
  );
});

test("trennt Na Jomtien, Wongamat und Naklua sowie Central und South Pattaya", () => {
  assert.equal(detectRegion("Villa in Na Jomtian"), null);
  assert.equal(addressMatchesRegion("Na Jomtien, Sattahip", "jomtien"), false);
  assert.equal(addressConflictsWithRegion("Na Jomtien, Sattahip", "jomtien"), true);
  assert.equal(detectRegion("Hotel Wong Amat, Naklua"), "wongamat");
  assert.equal(addressMatchesRegion("Wongamat, Naklua", "naklua"), false);
  assert.equal(addressConflictsWithRegion("Wongamat, Naklua", "naklua"), true);
  assert.equal(detectRegion("restaurant in South Pattaya"), null);
  assert.equal(addressMatchesRegion("South Pattaya", "central"), false);
  assert.equal(addressConflictsWithRegion("South Pattaya", "central"), true);
});

test("behandelt Nong Prue und Grenzstraßen konservativ", () => {
  assert.equal(detectRegion("Garage in Nongpru"), "darkside");
  assert.equal(addressMatchesRegion("Nong Prue, Bang Lamung", "darkside"), true);
  assert.equal(detectRegion("Café an der Thap Phraya Road"), null);
  assert.equal(detectRegion("Apotheke Thepprasit Road"), null);
  assert.equal(addressMatchesRegion("Thepprasit Road", "jomtien"), false);
  assert.equal(addressConflictsWithRegion("Thappraya Road", "pratumnak"), true);
  assert.equal(detectRegion("Condo Pratumnak an Thappraya"), "pratumnak");
  assert.equal(
    addressMatchesRegion("Pratumnak, Thappraya Road", "pratumnak"),
    true,
  );
});

test("versteht freie, fehlerhafte Formulierungen und kombinierte Suchkriterien", () => {
  assert.equal(detectRegion("brauch ne drugstore im jomtiem"), "jomtien");
  assert.equal(detectRegion("suche was im ostlichen Pattaya"), "darkside");
  assert.deepEqual(
    extractLocalSearchIntent(
      "Deutscher Zahnarzt in Jomtien mit Parkplatz, rollstuhlgerecht und 24 Stunden geöffnet",
    ),
    {
      categories: ["Zahnarzt / dentist"],
      criteria: [
        "deutschsprachig",
        "Parkplatz",
        "24 Stunden geöffnet",
        "rollstuhlgerecht",
      ],
    },
  );
  assert.deepEqual(
    extractLocalSearchIntent("Nur jetzt geöffnete Kliniken.").criteria,
    ["jetzt geöffnet"],
  );
  assert.deepEqual(extractLocalSearchIntent("pharmacy für Kinder"), {
    categories: ["Apotheke / pharmacy / drugstore"],
    criteria: ["kindergeeignet"],
  });
});

test("verwechselt Behörden und öffentliche Anlaufstellen nicht mit beliebigen Betrieben", () => {
  const query =
    "Wo finde ich eine Behörde oder öffentliche Anlaufstelle in Naklua?";
  const intent = extractLocalSearchIntent(query);
  assert.deepEqual(intent.categories, ["Behörde / öffentliche Anlaufstelle"]);
  assert.equal(
    candidateMatchesIntent(
      query,
      intent,
      "Studio 69 Darkside Bar & Grill",
      "Bar & Grill",
      "Eine Bar mit Restaurant.",
    ),
    false,
  );
  assert.equal(
    candidateMatchesIntent(
      query,
      intent,
      "Pattaya Immigration Office",
      "Government office",
      "Öffentliche Immigrationsbehörde.",
    ),
    true,
  );
});

test("versteht deutsche Reparatur- und Kriterienformulierungen genau", () => {
  assert.deepEqual(
    extractLocalSearchIntent(
      "Mein Handydisplay ist kaputt, wer repariert das in Jomtiem?",
    ).categories,
    ["Handyreparatur"],
  );
  assert.deepEqual(
    extractLocalSearchIntent(
      "Kinderfreundliches Restaurant in Jomtien, das jetzt geöffnet ist.",
    ).criteria,
    ["kindergeeignet", "jetzt geöffnet"],
  );
  const clinicQuery = "Ich brauche eine normale Klinik in Central Pattaya.";
  const clinicIntent = extractLocalSearchIntent(clinicQuery);
  assert.equal(
    candidateMatchesIntent(
      clinicQuery,
      clinicIntent,
      "Modern Smile Dental Center",
      "Zahnarzt",
      "Eine moderne Zahnklinik.",
    ),
    false,
  );
});

test("führt reine Kriterien-Folgefragen mit bestehender Region fort", () => {
  assert.equal(
    knowledge.shouldUseLocalWebFallback(
      "Gerne. In welcher Gegend suchst du genau?",
      "Nur kinderfreundliche Restaurants.",
      "jomtien",
    ),
    true,
  );
});

test("weist bei Adressvorschlägen auf kurzfristige Änderungen hin", () => {
  assert.match(knowledge.PLACE_FRESHNESS_NOTICE, /ruf vor der Fahrt kurz an/);
  assert.match(knowledge.PLACE_FRESHNESS_NOTICE, /Adresse stimmt/);
  assert.match(knowledge.PLACE_FRESHNESS_NOTICE, /Öffnungszeiten aktuell/);
});

test("bleibt warm, aber wird nicht zum Zeitvertreib-Chatbot", () => {
  assert.match(outOfScopeReply("Erzähl mir einen Witz"), /nicht als Zeitvertreib gedacht/);
  assert.match(companionIdentityReply("Wer bist du?"), /ortskundige Freundin/);
});

test("reagiert bei möglichem Notfall empathisch und handlungsorientiert", () => {
  const reply = urgentHealthReply("Ich habe starke Atemnot und bekomme keine Luft");
  assert.match(reply, /Das klingt ernst/);
  assert.match(reply, /1669/);
  assert.match(reply, /Fahre bitte nicht selbst/);
});
