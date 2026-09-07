# Sandra Version 2 – Finalisierung und Teststatus

Stand: 2026-09-07

Diese Version ist ausschließlich aus dem zuletzt gelieferten Sandra-Version-2-Projekt hervorgegangen. Sandra Version 1 wurde nicht verändert.

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
- umfassende Pattaya-Mastertaxonomie als internes Verständnisvokabular, nicht als sichtbares Menü
- Mastertaxonomie mit Gastronomie, Einkaufen/Produkten, Medizin, Fachärzten, Zahnmedizin, Diagnostik, Reha, psychischer Gesundheit, Pflege, Wellness, Sport, Freizeit, Nachtleben, Transport, Fahrzeugen, Handwerk/Hausservice, Haushalt, Immobilien, Behörden/Visa, Recht/Finanzen/Versicherungen, Technik, Haustieren, Familie/Bildung, Business, Post/Versand, Veranstaltungen, sozialen Angeboten, Sprache/Übersetzung und Notfall/Sicherheit
- Routing der Mastertaxonomie durch den Gesprächszustand, damit natürliche Formulierungen wie „meine Waschmaschine ist kaputt“, „ich brauche einen Lungenarzt“ oder „wo kann ich Padel spielen“ als Pattaya-Hilfeauftrag erkannt werden

## Unverändert erhalten

- exakt sechs Regionen: Naklua, Wongamat, Central Pattaya, Pratumnak, Jomtien, Darkside / East Pattaya
- bestehende Recherche- und Validierungslogik
- vorhandener forwardJson-Sicherheits-/Validierungsweg
- kompletter Deutsch↔Thai-Dolmetscherblock
- keine GPS-Funktion und keine eigene Navigation
- maximal drei erste Vorschläge

## Teststatus

- Mastertaxonomie-Coverage-Test: bestanden
- Integration der Mastertaxonomie in den Gesprächszustand: Workflow bestanden
- Deep-Conversation-Regression auf dem Integrationsstand: bestanden
- Deutsch↔Thai-Live-Interpreter-Roundtrip auf Hostinger: bestanden
- Malformed-Audio-Grenztests: bestanden
- ein Live-Protokolltest scheiterte nicht an Sandra-Code, sondern an einem GitHub-Runner-Netzwerkfehler `Network is unreachable`; dieser Test wird auf dem finalen Integrationsstand erneut ausgeführt
- vollständige Live-Region/Kategorie-, Kontext-, Scope-, Protokoll-, Interpreter-, Build- und Regressionstests werden nach diesem Commit erneut auf dem finalen Integrationsstand gestartet

## Qualitätsziel

Sandra ist keine Chatpartnerin zum Zeitvertreib. Sie ist die freundliche, ortskundige Pattaya-Helferin für Urlauber, Langzeitbesucher, Expats und Auswanderer. Der Nutzer spricht natürlich; Sandra erkennt Bedarf, Gebiet, Zeit, Präferenzen und Folgekontext und sucht konkrete, möglichst verifizierte Hilfe. Dynamische lokale Fakten werden nicht erfunden.
