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
`node --test tests/*.test.js`

GitHub Actions prüft JavaScript-Syntax und Reihenverwaltung vor dem Deployment.
