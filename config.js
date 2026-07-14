/*  Road to 70.3 — cloud sync config
 *  ---------------------------------
 *  Paste your Supabase project URL and anon (public) key below to turn on
 *  cross-device sync. Until you do, the app happily runs local-only on this
 *  device. The anon key is designed to be public — your data is protected by
 *  Row Level Security (see schema.sql), so it is safe to commit this file.
 *
 *  Where to find these:  Supabase dashboard -> Project Settings -> API
 *    - "Project URL"      -> SUPABASE_URL
 *    - "anon public" key  -> SUPABASE_ANON_KEY
 */
window.APP_CONFIG = {
  SUPABASE_URL: "",       // e.g. "https://abcdefgh.supabase.co"
  SUPABASE_ANON_KEY: ""   // e.g. "eyJhbGciOiJIUzI1NiIsInR..."
};
