# Manga-Regal PWA

Mobile-first private manga collection app.

## Privacy model
- The website source code may be hosted publicly.
- Collection data is stored in Supabase and requires authentication.
- Row Level Security restricts rows to the authenticated user.
- Cover files are stored in a private Supabase Storage bucket.
- The Supabase publishable key in `config.js` is intentionally client-side and is not an admin secret.

**Never put a Supabase service-role/secret key into this repository.**

The setup notes are in `START_HIER.md`.

## Reihen verwalten
Nach dem Anmelden können Reihen online angelegt, bearbeitet und gelöscht werden.
Die Gesamtzahl umfasst erschienene und angekündigte Bände. Zusätzliche Bände werden
als fehlend ergänzt; vorhandene Banddaten und Besitzmarkierungen bleiben erhalten.
Die Gesamtzahl kann deshalb nicht unter eine bereits vorhandene Bandnummer sinken.
Zum Löschen einer Reihe muss ihr Titel bestätigt werden. Die Datenbank entfernt die
zugehörigen Banddaten per Cascade. Bereits hochgeladene Coverdateien bleiben im
privaten Storage erhalten.

Speichern verwendet wiederholbare Einfügevorgänge mit einer festen Reihen-ID.
Bei einem Verbindungsabbruch kann erneut gespeichert werden, um fehlende Bände zu
ergänzen. Die einzelnen Datenbankaufrufe bilden keine gemeinsame Transaktion.

## Prüfungen
`npm ci --ignore-scripts` und `npm test`

GitHub Actions prüft JavaScript-Syntax und Reihenverwaltung vor dem Deployment.

## Offline und Synchronisierung
- Cache, Bildcache und Warteschlange sind pro Supabase-Benutzer getrennt.
- Besitzänderungen werden zuerst lokal gespeichert, anschließend übertragen.
- Beim Verbindungsaufbau, Fensterfokus, manuell und alle 30 Sekunden im sichtbaren
  Fenster wird abgeglichen. Dazu ist keine Supabase-Realtime-Konfiguration nötig.
- Bedingte Updates über `updated_at` erkennen konkurrierende Änderungen. Der
  Konfliktdialog bietet Online-Stand oder lokale Änderung an. Gelöschte Bände
  werden nicht automatisch neu angelegt.
- Abmelden wartet auf erledigte Besitzänderungen; anschließend werden lokale
  Sammlungs- und Bilddaten entfernt. Bei abgelaufener Anmeldung bleibt die
  benutzergebundene Warteschlange für die nächste Anmeldung erhalten.
- Bereits geladene private Cover sind offline verfügbar, externe Links nicht
  garantiert. Browser können lokalen Speicher bei Platzmangel löschen.

## Backups
Der Export erzeugt eine JSON-Datei auf dem Gerät, mit explizit ausgewählten
Sammlungsfeldern und eingebetteten privaten Coverbildern. Zugangsdaten,
Benutzer-IDs und temporäre Bild-URLs werden nicht exportiert. Externe Cover werden
als HTTPS-Links gesichert. Fehlende private Bilder brechen den Export sichtbar ab.

Importe werden vor dem Schreiben validiert und mit Vorschau angezeigt. Standard
ist „nur ergänzen“. Aktualisierung vorhandener Reihen muss ausdrücklich gewählt
werden und ordnet nach Titel + Sprache zu. Mehrdeutige Zuordnungen werden
übersprungen. Andere Reihen und zusätzliche Bände werden nicht gelöscht.

Der Import ist keine einzelne Datenbanktransaktion. Bei Fehlern zeigt die App
Teilfortschritt; solange die Vorschau geöffnet bleibt, kann mit denselben IDs
erneut gestartet werden. Vorhandene Reihen können dadurch bewusst überschrieben
werden: vor einer Wiederherstellung ist ein aktueller Export sinnvoll.
Backups sind private Dateien und gehören nicht in das öffentliche Repository.

## Cover und Ausgaben
Reihen und einzelne Bände unterstützen eigene JPG-, PNG- und WebP-Cover bis 10 MB.
Uploads werden validiert, auf maximal 1600 Pixel verkleinert und neu kodiert.
Ein Band kann eine eigene Bezeichnung (z. B. Sprache/Sonderausgabe) erhalten.

Die Suche bietet einen änderbaren Suchbegriff, AniList-Reihenmotive und
MangaDex-Bandcover, bevorzugt nach Bandnummer und Sprache. Externe Provider sind
nicht immer erreichbar; Metadaten garantieren keine bestimmte Verlagsausgabe.
Treffer müssen vor Übernahme geprüft werden. Externe Verknüpfungen werden
angezeigt und ausdrücklich gewählt, statt unbemerkt als Upload-Ersatz zu dienen.
Entfernen oder Ersetzen einer Zuordnung löscht keine alten privaten Bilddateien.

## Veröffentlichung
GitHub Actions führt Syntax-, Logik- und DOM-Ablauftests mit erfundenen Daten aus.
Nur eine explizite Liste öffentlicher App-Dateien wird auf GitHub Pages geladen;
Tests, Abhängigkeiten und SQL-Dateien gehören nicht zum Deployment.
