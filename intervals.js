/*  Road to 70.3 — intervals.icu auto-detect
 *  -----------------------------------------
 *  Calls the intervals-sync Edge Function for your recent activities, maps each
 *  to a discipline, and hands them to the app (window.__applyIntervalsActivities)
 *  which ticks off any un-done planned session on the same date + sport.
 *
 *  Runs automatically after each cloud sync (app open, focus, reconnect) and
 *  when you tap "Check intervals.icu now". Requires being signed in.
 */
(function () {
  "use strict";
  var LAST_KEY = "__intervals_last_v1";
  var running = false;

  function ymd(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  // Map an intervals.icu activity type to one of the plan disciplines.
  function mapType(t) {
    t = ("" + t).toLowerCase();
    if (t.indexOf("swim") >= 0) return "swim";
    if (t.indexOf("run") >= 0) return "run";
    if (t.indexOf("ride") >= 0 || t.indexOf("bike") >= 0 || t.indexOf("cycl") >= 0 ||
        t.indexOf("velomobile") >= 0 || t.indexOf("handcycle") >= 0) return "bike";
    if (t.indexOf("weight") >= 0 || t.indexOf("strength") >= 0 || t.indexOf("workout") >= 0 ||
        t.indexOf("yoga") >= 0 || t.indexOf("pilates") >= 0 || t.indexOf("crossfit") >= 0 ||
        t.indexOf("cross training") >= 0) return "strength";
    return null; // ignored (e.g. Walk, Hike, unknown)
  }

  function setStatus(msg) {
    var el = document.getElementById("ivStatus");
    if (el) el.textContent = msg;
  }

  async function run(manual) {
    var cloud = window.__cloud;
    if (!cloud) return;
    var sb = cloud.client(), user = cloud.user();
    if (!sb || !user) { if (manual) setStatus("Sign in to enable intervals.icu sync."); return; }
    if (navigator.onLine === false) { if (manual) setStatus("Offline — will check when back online."); return; }
    if (typeof window.__applyIntervalsActivities !== "function") return;
    if (running) return;
    running = true;
    if (manual) setStatus("Checking intervals.icu…");

    try {
      var now = new Date();
      var oldest = ymd(new Date(now.getTime() - 120 * 86400000));
      var newest = ymd(new Date(now.getTime() + 86400000)); // include today fully
      var res = await sb.functions.invoke("intervals-sync", { body: { oldest: oldest, newest: newest } });

      if (res.error) {
        console.warn("intervals-sync error", res.error);
        setStatus("Couldn't reach intervals.icu (is the function deployed?).");
        return;
      }
      var data = res.data || {};
      if (data.error) { setStatus("intervals.icu: " + data.error); return; }
      var acts = (data.activities || [])
        .map(function (a) { return { date: a.date, disc: mapType(a.type) }; })
        .filter(function (a) { return a.disc && a.date; });

      var ticked = window.__applyIntervalsActivities(acts) || 0;
      try { localStorage.setItem(LAST_KEY, new Date().toISOString()); } catch (e) {}
      renderIvStatus(acts.length, ticked, manual);
    } catch (e) {
      console.warn("intervals sync failed", e);
      setStatus("intervals.icu check failed — see console.");
    } finally {
      running = false;
    }
  }

  function fmtLast() {
    var t; try { t = localStorage.getItem(LAST_KEY); } catch (e) { t = null; }
    if (!t) return "not yet";
    var d = Date.parse(t); if (isNaN(d)) return "not yet";
    var mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return new Date(d).toLocaleDateString();
  }

  function renderIvStatus(found, ticked, manual) {
    var msg = "Last checked " + fmtLast() + ". ";
    if (ticked > 0) msg += ticked + " session" + (ticked > 1 ? "s" : "") + " ticked from your activities.";
    else if (manual) msg += "No new matching sessions found.";
    else msg += found + " recent activit" + (found === 1 ? "y" : "ies") + " scanned.";
    setStatus(msg);
  }

  window.__intervalsSync = run;

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("ivCheck");
    if (btn) btn.onclick = function () { run(true); };
    setStatus("Last checked " + fmtLast() + ".");
  });
})();
