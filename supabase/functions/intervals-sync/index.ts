// Road to 70.3 — intervals.icu proxy (Supabase Edge Function)
// -----------------------------------------------------------
// The browser can't call intervals.icu directly (no CORS, and the API key must
// stay off the public site). This function holds your intervals.icu key as a
// secret, verifies the caller is signed in to *your* Supabase auth, fetches
// your recent activities, and returns a trimmed list the app matches to your
// plan.
//
// Secrets to set (Dashboard -> Edge Functions -> intervals-sync -> Secrets, or
// `supabase secrets set`):
//   INTERVALS_ATHLETE_ID   e.g. i123456   (Settings -> Developer on intervals.icu)
//   INTERVALS_API_KEY      your intervals.icu API key
//
// Deploy note: set "Verify JWT" OFF for this function — we verify the user
// ourselves below so that browser CORS preflight (which carries no token) works.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // --- verify the caller is signed in to this project's auth ---
  // Server-side we must pass the token to getUser() explicitly — the no-arg form
  // looks for a browser session that doesn't exist here and returns 401.
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supa = createClient(supaUrl, anon);
  const { data: { user }, error: authErr } = await supa.auth.getUser(token);
  if (!user) {
    console.error("auth check failed:", authErr && authErr.message);
    return json({ error: "unauthorized" }, 401);
  }

  // --- config ---
  const athlete = Deno.env.get("INTERVALS_ATHLETE_ID");
  const key = Deno.env.get("INTERVALS_API_KEY");
  if (!athlete || !key) {
    return json({ error: "intervals.icu not configured (missing secrets)" }, 500);
  }

  const basic = "Basic " + btoa("API_KEY:" + key);
  const base = `https://intervals.icu/api/v1/athlete/${athlete}`;
  const MARK = "r703-"; // external_id prefix — how we recognise workouts this app created

  // --- read the body once ---
  let b: any = {};
  try { b = await req.json(); } catch (_) { /* no body -> defaults */ }
  const action = b?.action || "read";

  // ===== PUSH: create/replace planned workouts on the intervals.icu calendar =====
  // These sync to Garmin via the athlete's existing intervals.icu → Garmin link.
  // external_id + upsert makes re-pushing idempotent (updates, never duplicates).
  if (action === "push") {
    const workouts = Array.isArray(b.workouts) ? b.workouts : [];
    if (!workouts.length) return json({ error: "no workouts to push" }, 400);
    const events = workouts.map((w: any) => ({
      category: "WORKOUT",
      start_date_local: (w.date || "").slice(0, 10) + "T00:00:00",
      type: w.type || "Run",
      name: w.name || "Workout",
      description: w.description || "",
      external_id: String(w.external_id || (MARK + Math.random())),
    }));
    let r: Response;
    try {
      r = await fetch(`${base}/events/bulk?upsert=true`, {
        method: "POST",
        headers: { Authorization: basic, "Content-Type": "application/json" },
        body: JSON.stringify(events),
      });
    } catch (e) { return json({ error: "intervals.icu unreachable", detail: String(e) }, 502); }
    const txt = await r.text().catch(() => "");
    if (!r.ok) return json({ error: `intervals.icu ${r.status}`, detail: txt.slice(0, 400) }, 502);
    return json({ pushed: events.length });
  }

  // ===== CLEAR: delete planned WORKOUT events in a future window =====
  // scope "all" removes every planned workout (old ones too, for a clean slate);
  // otherwise only the ones this app created (external_id starts r703-).
  if (action === "clear") {
    const now0 = new Date();
    const oldest0 = b.oldest || ymd(now0);
    const newest0 = b.newest || ymd(new Date(now0.getTime() + 300 * 86400000));
    const onlyMine = b.scope !== "all";
    let list: any[] = [];
    try {
      const lr = await fetch(`${base}/events?oldest=${oldest0}&newest=${newest0}&category=WORKOUT`, { headers: { Authorization: basic } });
      list = await lr.json().catch(() => []);
    } catch (e) { return json({ error: "intervals.icu unreachable", detail: String(e) }, 502); }
    const targets = (Array.isArray(list) ? list : [])
      .filter((e: any) => onlyMine ? String(e.external_id || "").startsWith(MARK) : true);
    let deleted = 0;
    for (const e of targets) {
      try {
        const dr = await fetch(`${base}/events/${e.id}`, { method: "DELETE", headers: { Authorization: basic } });
        if (dr.ok) deleted++;
      } catch (_) { /* skip */ }
    }
    return json({ deleted, scanned: targets.length });
  }

  // ===== READ (default): fetch recent activities to auto-tick completed sessions =====
  let oldest = b?.oldest || "", newest = b?.newest || "";
  const now = new Date();
  if (!newest) newest = ymd(now);
  if (!oldest) oldest = ymd(new Date(now.getTime() - 120 * 86400000));
  let resp: Response;
  try {
    resp = await fetch(`${base}/activities?oldest=${oldest}&newest=${newest}`, { headers: { Authorization: basic } });
  } catch (e) {
    return json({ error: "intervals.icu unreachable", detail: String(e) }, 502);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return json({ error: `intervals.icu ${resp.status}`, detail: text.slice(0, 300) }, 502);
  }
  const acts = await resp.json().catch(() => []);
  const activities = (Array.isArray(acts) ? acts : []).map((a: any) => ({
    date: (a.start_date_local || a.start_date || "").slice(0, 10),
    type: a.type || "",
    name: a.name || "",
    distance: a.distance ?? null,     // metres
    moving_time: a.moving_time ?? null, // seconds
  })).filter((a: any) => a.date);

  return json({ activities, window: { oldest, newest } });
});
