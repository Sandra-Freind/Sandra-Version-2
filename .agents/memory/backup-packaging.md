---
name: Direkt entpackbare Backups
description: Bestätigte Verpackungsform für vollständige Sicherungen oberhalb der direkten Dateiobergrenze.
---

Große Sandra-Sicherungen als mehrere normale, eigenständig entpackbare ZIP-Dateien bereitstellen. Projekt und Daten bilden eine ZIP; umfangreiche Programmbibliotheken werden auf weitere normale ZIPs verteilt und in denselben Zielordner entpackt. Keine `.bin`-Fragmente oder andere Teile anbieten, die zuerst zusammengesetzt werden müssen.

**Why:** Der Nutzer hat die direkt entpackbaren ZIPs erfolgreich verwendet und ausdrücklich bestätigt, dass diese Methode funktioniert.

**How to apply:** Wenn eine vollständige Sicherung die Größenobergrenze einer einzelnen bereitgestellten Datei überschreitet, logisch getrennte ZIPs unterhalb der Grenze erzeugen, einzeln prüfen und mit einer kurzen Entpackreihenfolge bereitstellen.