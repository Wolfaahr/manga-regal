# Manga-Regal – Veröffentlichung

Diese Version enthält **keine persönliche Manga-Sammlung im Quellcode**.

## Supabase
Die Datenbank wird über `supabase/schema.sql` eingerichtet. Die App verwendet Supabase Auth,
Row Level Security und einen privaten Cover-Bucket.

`config.js` enthält nur Project URL + Publishable Key. Das ist für eine Browser-App vorgesehen.
Ein Service-Role-/Secret-Key darf niemals in dieses Repository.

## Sammlung importieren
Die persönliche Sammlung wird separat mit `PRIVATE_COLLECTION_IMPORT.sql` importiert.
Diese Datei gehört **nicht** in GitHub und ist absichtlich nicht Bestandteil dieses Public-Pakets.

## GitHub Pages
Dieses Paket kann in ein **neues öffentliches Repository** hochgeladen werden.
Empfohlen: ein frisches Repository verwenden, damit ältere private Seed-Daten nicht in der
öffentlichen Git-Historie landen.

Danach:
1. Repository → Settings → Pages
2. Source: GitHub Actions
3. Workflow abwarten
4. Die von GitHub angezeigte Pages-URL öffnen
5. Mit dem in Supabase angelegten Benutzer anmelden

Ohne Login wird nur der Login-Bildschirm angezeigt. Die Sammlung wird erst nach erfolgreicher
Supabase-Anmeldung geladen.
