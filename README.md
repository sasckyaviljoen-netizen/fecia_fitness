# Road to 70.3 — Triathlon Training Tracker

A personal, installable training tracker for a 70.3 (half-Ironman) plan.
Tap a session to see the workout, tick it off, log how it felt, drag sessions
between days, and keep your FTP/paces up to date. It installs to your iPhone
home screen as a full-screen app, works offline at the pool or on the bike, and
syncs your progress across devices through a hosted database.

- **Frontend:** one static page (`index.html`) — the original UI, unchanged in look.
- **Offline-first:** every tap saves to on-device storage instantly, with no signal needed.
- **Database:** Supabase (free hosted Postgres) with row-level security, so only
  you can read your data. Changes sync across devices with last-write-wins per key.
- **Installable:** PWA manifest + service worker → add to iPhone home screen.

Out of the box the app runs **local-only** on one device. Do the two setup
steps below to turn on cross-device cloud sync.

---

## 1. Publish it (GitHub Pages — free)

1. Push this repo to GitHub (the `main` branch).
2. On GitHub: **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Set branch to **`main`** and folder to **`/ (root)`**, then **Save**.
5. Wait ~1 minute. Your app is live at
   `https://<your-username>.github.io/<repo-name>/`.

### Add it to your iPhone
1. Open that URL in **Safari** (must be Safari, not Chrome, for install to work).
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the home-screen icon — it opens full-screen like a native app.

That alone gives you an installable, offline tracker that saves on the phone.

---

## 2. Turn on cloud sync (Supabase — free)

Do this if you want your progress to sync between iPhone, iPad, and laptop.

### a. Create the database
1. Go to [supabase.com](https://supabase.com) → sign up → **New project**
   (any name; remember the database password). Wait for it to finish setting up.
2. Open **SQL Editor → New query**, paste the contents of
   [`schema.sql`](./schema.sql), and click **Run**. This creates the `app_state`
   table and the security rules that keep your data private to your login.

### b. Make sign-up instant (recommended for a single user)
- **Authentication → Sign In / Providers → Email** (or **Providers**): turn
  **Confirm email** *off*. Now creating an account logs you straight in with no
  confirmation email. (Leave it on if you prefer; you'll just click a link once.)

### c. Connect the app
1. In Supabase: **Project Settings → API**. Copy:
   - **Project URL**
   - the **anon / public** key
2. Open [`config.js`](./config.js) in this repo and paste them in:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGci...your-anon-key..."
   };
   ```
   The anon key is meant to be public — your data is protected by the row-level
   security rules from `schema.sql`, so it's safe to commit.
3. Commit and push. GitHub Pages redeploys in ~1 minute.

### d. Sign in
- Reopen the app. A **Sync** chip appears top-right. Tap it → **Create account**
  (first time) or **Sign in**. Use the *same email + password on every device*
  and your training stays in sync.
- Offline is fine — it keeps saving locally and syncs when you're back online
  (on app open, on reconnect, and when another device makes a change).

> **Optional — instant push between devices:** uncomment the last line of
> `schema.sql` (`alter publication supabase_realtime add table public.app_state;`)
> and run it, to enable Supabase Realtime. Not required; the app already syncs on
> app-open and reconnect.

---

## How data is stored

The app keeps six buckets — progress, settings, logs, day moves, added sessions,
and edits. Each is a row in `app_state` keyed by your user id, stored as JSON.
Reads/writes always go to on-device storage first (instant, offline-safe); the
sync layer mirrors them to Supabase and pulls newer versions back, resolving any
conflict by most-recent-write per bucket.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The app UI + logic (unchanged design). |
| `config.js` | Your Supabase URL + anon key. Edit this to enable sync. |
| `sync.js` | Offline-first storage adapter, auth, and sync engine. |
| `sw.js` | Service worker — offline caching / installability. |
| `manifest.webmanifest` | PWA metadata (name, icons, colors). |
| `schema.sql` | Supabase table + row-level-security policies. |
| `icons/` | App icons (regenerate with `python3 scripts/make_icons.py`). |

## Reset / troubleshooting

- **"Sync" chip missing:** `config.js` still has empty values, or the page
  didn't redeploy yet.
- **Signed in but not syncing:** confirm you ran `schema.sql`, and that you're
  using the same login on each device. Tap the chip → **Sync now**.
- **Start fresh on a device:** in-app **Reset all progress**, or clear the site
  data in Safari settings.
