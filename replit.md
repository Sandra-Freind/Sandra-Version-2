# Sandra

Sandra ist eine deutschsprachige lokale Such- und Orientierungshilfe für Pattaya mit regionalem Kontext, geprüfter Recherche, Karten und einem vorhandenen Deutsch-Thai-Dolmetscher.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API-Proxy starten
- `pnpm --filter @workspace/mobile-app run dev` — Expo-App starten
- `pnpm run typecheck` — TypeScript-Prüfung
- `pnpm --filter @workspace/api-spec run codegen` — API-Client und Validierung aus OpenAPI neu erzeugen

## Stack

- Expo / React Native für iPhone und iPad
- Express / TypeScript als sicherer mobiler Proxy
- Bestehende PHP-Sandra unter `https://sandra-bot.com` als fachliches Original-Backend
- Generierter React-Query-Client aus `lib/api-spec/openapi.yaml`

## Where things live

- `artifacts/mobile-app/app/(tabs)/index.tsx` — mobile Sandra-Oberfläche
- `artifacts/mobile-app/lib/sandraApi.ts` — mobile Gesprächsverbindung
- `artifacts/api-server/src/routes/sandra.ts` — Proxy zur bestehenden PHP-Sandra
- `lib/api-spec/openapi.yaml` — Vertrag der mobilen API
- `attached_assets/Blueprint_*.docx` — verbindliche fachliche Spezifikation
- `attached_assets/Sandra-Komplett-*.zip` — gelieferter Originalstand

## Architecture decisions

- Das bestehende PHP-Backend bleibt die fachliche Quelle; die mobile App ersetzt seine Gesprächslogik nicht.
- Der Express-Dienst vermittelt zwischen Expo und PHP und hält die PHP-Session pro mobiler Installation zusammen.
- Sandra beantwortet konkrete lokale Suchwünsche aus allen Bereichen, aber keine allgemeinen Wetter-, Nachrichten-, Politik-, Sport-, Börsen-, Datums- oder Wissensfragen.
- Verbindliche Teilregionen sind Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien und Darkside/East Pattaya. Vorschläge aus anderen Regionen dürfen nicht als Treffer der gesuchten Region ausgegeben werden.
- Bei fehlenden Einträgen im PHP-Bestand recherchiert der Server im Internet. Übernommen werden nur HTTPS-Quellen, vollständige Adressen in der gewünschten Region und ausdrücklich belegte Detailfelder.
- Die produktive URL ist standardmäßig `https://sandra-bot.com`; `SANDRA_API_BASE_URL` kann sie ohne Codeänderung überschreiben.
- Fehler werden ausdrücklich angezeigt. Es gibt keine Mock-API und keine erfundenen Ersatzdaten.

## Product

- Persönlicher Chat mit Sandra
- Sitzungsübergreifender Gesprächskontext über das Original-Backend
- Kartenlinks aus echten Sandra-Ergebnissen
- Deutsch-Thai-Dolmetscher mit echter Geräteaufnahme, Transkription, Übersetzung und Audioausgabe über die vorhandene Original-API

## Geschützte Gestaltung

- Farben, Schriften, Layout, Buttons, Icons, Animationen und sichtbare Abstände des gelieferten Sandra-Designs nicht neu gestalten.
- Nur notwendige technische Größen-, Safe-Area-, Tastatur- und Touch-Anpassungen für mobile Geräte sind erlaubt.

## Gotchas

- Den generierten API-Client nicht direkt bearbeiten; zuerst OpenAPI ändern und anschließend Codegen ausführen.
- API-Schlüssel bleiben ausschließlich im bestehenden Backend oder in Replit Secrets und dürfen nie in die Expo-App gelangen.
- Der mobile Dolmetscher verwendet `expo-audio` und lädt Aufnahmen über `/api/sandra/interpreter/audio` zu Sandras vorhandenem `translate.php`.