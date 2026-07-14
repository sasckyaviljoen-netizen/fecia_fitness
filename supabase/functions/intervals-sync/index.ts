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
  const authHeader = req.headers.get("Authorization") || "";
  const supaUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supa = createClient(supaUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  // --- config ---
  const athlete = Deno.env.get("INTERVALS_ATHLETE_ID");
  const key = Deno.env.get("INTERVALS_API_KEY");
  if (!athlete || !key) {
    return json({ error: "intervals.icu not configured (missing secrets)" }, 500);
  }

  // --- date window (default: last 120 days) ---
  let oldest = "", newest = "";
  try {
    const b = await req.json();
    oldest = b?.oldest || "";
    newest = b?.newest || "";
  } catch (_) { /* no body -> defaults */ }
  const now = new Date();
  if (!newest) newest = ymd(now);
  if (!oldest) oldest = ymd(new Date(now.getTime() - 120 * 86400000));

  // --- fetch activities from intervals.icu (Basic auth: user "API_KEY") ---
  const url =
    `https://intervals.icu/api/v1/athlete/${athlete}/activities?oldest=${oldest}&newest=${newest}`;
  const basic = "Basic " + btoa("API_KEY:" + key);
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Authorization: basic } });
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
