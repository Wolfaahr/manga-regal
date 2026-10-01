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
