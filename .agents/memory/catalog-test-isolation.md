---
name: Katalogtests ohne Testspuren
description: Verhindert, dass mobile Praxistests echte Sandra-Treffer dauerhaft sperren oder Prüfwarteschlangen verfälschen.
---

Praxistests der Nutzerhinweis-Funktion dürfen keine Testmeldung im aktiven Katalog, in der Prüfwarteschlange, im Auditprotokoll oder in anschließend erzeugten Katalog-Backups zurücklassen. Entweder einen ausdrücklich isolierten Testeintrag verwenden oder die gesamte Testwirkung unmittelbar danach gezielt entfernen und den vorherigen verifizierten Zustand wiederherstellen.

**Why:** Eine realistische mobile Meldung sperrt den betroffenen Treffer absichtlich sofort. Bei einem Test mit einem echten verifizierten Ort würde dieser Schutzmechanismus sonst die produktive Suchgrundlage verfälschen.

**How to apply:** Vor einem End-to-End-Test der Meldefunktion den Datenweg und die Bereinigung festlegen. Nach dem Test Status, Prüfwarteschlange, Auditlog und testbedingt erzeugte Sicherungen kontrollieren; anschließend die API neu starten, damit kein veralteter Zustand im Arbeitsspeicher bleibt.