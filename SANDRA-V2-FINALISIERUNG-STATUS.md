# Sandra Version 2 – Finalisierung und Teststatus

Stand: 2026-09-06

Diese Version ist ausschließlich aus dem zuletzt gelieferten Sandra-Backup (Projekt/Daten + 12 Bibliotheks-ZIPs) hervorgegangen. Sandra Version 1 wurde nicht verändert.

## Ergänzt

- aufgabenbezogener Gesprächszustand mit aktuellem Thema und Intent
- aktuelle und zukünftige Ortsangaben innerhalb der sechs Sandra-Regionen
- Zeitkontext wie jetzt, heute Abend, morgen, Wochenende
- Präferenzen wie günstig, ruhig, strandnah, hundefreundlich
- Fortführung von Folgefragen wie „noch zwei“, „noch eine“, „weitere“
- Ausschluss bereits gezeigter Treffer bei weiteren Vorschlägen
- Fortführung des ursprünglichen Suchauftrags bei Aussagen wie „zu teuer“
- Maps-/Routen-Folgefrage zum ausgewählten Treffer
- wärmere, freundschaftliche und situationsabhängig empathische Formulierungen
- klare Begrenzung: Sandra bleibt Helferin/Finderin und wird nicht zum Zeitvertreib-/Smalltalk-Chatbot

## Unverändert erhalten

- exakt sechs Regionen: Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien, Darkside / East Pattaya
- verifizierter Katalog, Review, Audit und Backups
- bestehende Recherche- und Validierungslogik
- vorhandener forwardJson-Sicherheits-/Validierungsweg
- kompletter Deutsch↔Thai-Dolmetscherblock
- keine GPS-Funktion und keine eigene Navigation

## Teststatus

- 32/32 automatisierte Katalog-, Regions-, Such-, Kontext-, Empathie- und Scope-Tests bestanden
- API TypeScript: bestanden, nachdem die beim ZIP-Backup fehlenden Workspace-Verknüpfungen rekonstruiert und die Deklarationen frisch gebaut wurden
- Mobile TypeScript: bestanden, nachdem die Workspace-Deklarationen frisch gebaut wurden
- API-Produktionsbuild: bestanden
- API-Serverstart: bestanden
- /api/healthz: HTTP 200, {"status":"ok"}
- Route sandra.ts mit esbuild gebündelt: bestanden
- GPS-Code-Scan: keine aktive GPS-/expo-location-/Geolocation-Nutzung gefunden
- Interpreterblock und bestehender forwardJson-Block wurden gegenüber dem gelieferten V2-Stand nicht verändert

## Beim Test gefundene und behobene Fehler

1. Ein impliziter Folgesatz wie „noch zwei“ konnte nach „jetzt Naklua, heute Abend Jomtien“ wieder auf den aktuellen Ort Naklua zurückfallen. Behoben: der aktive Zeitkontext bleibt bei solchen Folgefragen erhalten.
2. „Der zweite ist mir zu teuer“ konnte den ursprünglichen Suchauftrag verlieren. Behoben: der aktuelle lokale Suchauftrag wird zusammen mit der neuen Präferenz weitergeführt.
3. Zeitvertreib-Anfragen wie „Erzähl mir einen Witz“ konnten theoretisch an die alte Chat-Pipeline weitergereicht werden. Behoben: freundliche Rückführung auf Sandras Pattaya-Helferzweck.

## Noch nicht als echter Live-Nachweis bestätigt

- reale OpenAI-Webrecherche über das öffentliche Netz
- echtes Hostinger-Deployment
- Mikrofon → STT → Übersetzung → TTS → Lautsprecher auf einem realen Handy
- kompletter Mobile-Deployment-Build in dieser Umgebung; das Build-Skript verlangt pnpm als ausführbaren Systembefehl und eine Deployment-Domain

Diese Punkte sind Live-/Deployment-Verifikation, keine noch fehlenden Sandra-Kernfunktionen.
