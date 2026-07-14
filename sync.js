/*  Road to 70.3 — offline-first cloud sync
 *  ---------------------------------------
 *  Defines window.storage (the adapter the app boots against) so every read
 *  and write hits on-device localStorage instantly — the app works fully with
 *  no signal. When Supabase is configured and you are signed in, changes are
 *  mirrored to a hosted Postgres table and pulled back from your other devices
 *  using last-write-wins per key.
 *
 *  Loaded BEFORE the main app script, so window.storage exists at boot.
 */
(function () {
  "use strict";

  var LS = window.localStorage;
  var META_KEY = "__sync_meta_v1";   // { storageKey: updatedAtISO }
  var DIRTY_KEY = "__sync_dirty_v1"; // [storageKey, ...] pending push
  var LASTSYNC_KEY = "__sync_last_v1";

  function readJSON(k, fallback) {
    try { var v = LS.getItem(k); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function writeJSON(k, o) { try { LS.setItem(k, JSON.stringify(o)); } catch (e) {} }
  function nowISO() { return new Date().toISOString(); }
  function ms(iso) { var t = Date.parse(iso); return isNaN(t) ? 0 : t; }

  var meta = readJSON(META_KEY, {});
  var dirty = readJSON(DIRTY_KEY, []);

  function markDirty(k) {
    if (dirty.indexOf(k) === -1) { dirty.push(k); writeJSON(DIRTY_KEY, dirty); }
  }
  function clearDirty(k) {
    var i = dirty.indexOf(k);
    if (i !== -1) { dirty.splice(i, 1); writeJSON(DIRTY_KEY, dirty); }
  }

  /* ---- window.storage: the adapter the app uses ---- */
  window.storage = {
    get: function (k) {
      // Instant, offline-safe read from the local mirror.
      try { var v = LS.getItem(k); return Promise.resolve(v != null ? { value: v } : null); }
      catch (e) { return Promise.resolve(null); }
    },
    set: function (k, v) {
      try { LS.setItem(k, v); } catch (e) {}
      meta[k] = nowISO();
      writeJSON(META_KEY, meta);
      markDirty(k);
      schedulePush();
    }
  };

  /* ---- Supabase wiring (optional) ---- */
  var cfg = window.APP_CONFIG || {};
  var configured = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  var sb = null, user = null, pushTimer = null, syncing = false;

  function haveLib() { return typeof window.supabase !== "undefined" && window.supabase.createClient; }

  if (configured && haveLib()) {
    try {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: "tri-auth" }
      });
    } catch (e) { console.warn("Supabase init failed", e); sb = null; }
  }

  function online() { return navigator.onLine !== false; }

  /* Pull every row for this user and apply last-write-wins per key. */
  function pull() {
    if (!sb || !user || !online()) return Promise.resolve(false);
    return sb.from("app_state").select("key,value,updated_at").eq("user_id", user.id)
      .then(function (res) {
        if (res.error) { console.warn("pull error", res.error.message); return false; }
        var changed = false;
        (res.data || []).forEach(function (row) {
          var localTs = meta[row.key];
          var remoteNewer = !localTs || ms(row.updated_at) > ms(localTs);
          if (remoteNewer) {
            try { LS.setItem(row.key, JSON.stringify(row.value)); } catch (e) {}
            meta[row.key] = row.updated_at;
            clearDirty(row.key); // remote won this key
            changed = true;
          }
        });
        writeJSON(META_KEY, meta);
        if (changed && typeof window.__rehydrate === "function") window.__rehydrate();
        return changed;
      })
      .catch(function (e) { console.warn("pull failed", e); return false; });
  }

  /* Push all dirty keys (local edits not yet on the server). */
  function pushDirty() {
    if (!sb || !user || !online() || !dirty.length) return Promise.resolve();
    var rows = dirty.slice().map(function (k) {
      var raw = LS.getItem(k);
      var val;
      try { val = raw != null ? JSON.parse(raw) : null; } catch (e) { val = raw; }
      return { user_id: user.id, key: k, value: val, updated_at: meta[k] || nowISO() };
    });
    return sb.from("app_state").upsert(rows, { onConflict: "user_id,key" })
      .then(function (res) {
        if (res.error) { console.warn("push error", res.error.message); return; }
        rows.forEach(function (r) { clearDirty(r.key); });
        writeJSON(LASTSYNC_KEY, nowISO());
      })
      .catch(function (e) { console.warn("push failed", e); });
  }

  function schedulePush() {
    if (!sb || !user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushDirty(); }, 1200); // debounce bursts of taps
  }

  /* Full sync cycle: pull (server -> local), then push (local -> server). */
  function sync() {
    if (syncing || !sb || !user) return Promise.resolve();
    syncing = true;
    setStatus("syncing");
    return pull().then(pushDirty).then(function () {
      writeJSON(LASTSYNC_KEY, nowISO());
    }).finally(function () { syncing = false; renderStatus(); });
  }
  window.__syncNow = sync;

  /* ---- Auth + status UI (injected, so index.html stays close to the design) ---- */
  var chip, modal, statusEl, lastState = "";

  function injectUI() {
    var css = document.createElement("style");
    css.textContent =
      ".synchip{position:fixed;top:calc(env(safe-area-inset-top,0) + 10px);right:12px;z-index:30;" +
      "display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--line);" +
      "color:var(--muted);font-weight:700;font-size:11.5px;padding:6px 11px;border-radius:99px;cursor:pointer;" +
      "box-shadow:0 2px 8px rgba(52,50,44,.08);font-family:inherit;-webkit-tap-highlight-color:transparent}" +
      ".synchip .dot{width:7px;height:7px;border-radius:50%;background:var(--faint)}" +
      ".synchip.ok .dot{background:var(--good)}.synchip.warn .dot{background:var(--bike)}" +
      ".synchip.busy .dot{background:var(--swim)}" +
      ".syncov{position:fixed;inset:0;z-index:40;background:rgba(52,50,44,.34);display:none;" +
      "align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)}" +
      ".syncov.show{display:flex}" +
      ".syncmodal{background:var(--surface);width:100%;max-width:440px;border-radius:20px 20px 0 0;" +
      "padding:22px 20px calc(env(safe-area-inset-bottom,0) + 22px);box-shadow:0 -8px 40px rgba(52,50,44,.25)}" +
      "@media(min-width:480px){.syncov{align-items:center}.syncmodal{border-radius:20px;margin-bottom:0}}" +
      ".syncmodal h3{font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px}" +
      ".syncmodal p.sub{color:var(--muted);font-size:13px;font-weight:500;margin-bottom:16px;line-height:1.5}" +
      ".syncmodal label{display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:10px}" +
      ".syncmodal input{display:block;width:100%;margin-top:6px;border:1px solid var(--line);border-radius:11px;" +
      "padding:12px 13px;font-family:inherit;font-size:16px;color:var(--text);background:var(--surface2);font-weight:600}" +
      ".syncmodal .btnrow{display:flex;gap:9px;margin-top:6px}" +
      ".syncmodal button{flex:1;font-family:inherit;font-size:13.5px;font-weight:700;padding:13px;border-radius:12px;cursor:pointer;border:1px solid var(--line)}" +
      ".syncmodal .primary{background:var(--text);color:var(--bg);border-color:var(--text)}" +
      ".syncmodal .ghost{background:var(--surface2);color:var(--muted)}" +
      ".syncmodal .err{color:#c0392b;font-size:12.5px;font-weight:600;margin-top:12px;min-height:1px;line-height:1.5}" +
      ".syncmodal .ok{color:var(--good)}" +
      ".syncmodal .meta{font-size:12.5px;color:var(--muted);font-weight:600;line-height:1.7;margin:2px 0 16px}" +
      ".syncmodal .meta b{color:var(--text)}" +
      ".syncmodal .close{position:absolute;top:14px;right:16px;font-size:22px;color:var(--faint);cursor:pointer;line-height:1;background:none;border:none;padding:4px}";
    document.head.appendChild(css);

    chip = document.createElement("button");
    chip.className = "synchip";
    chip.innerHTML = '<span class="dot"></span><span class="lbl">Sync</span>';
    chip.onclick = openModal;
    document.body.appendChild(chip);

    var ov = document.createElement("div");
    ov.className = "syncov";
    ov.innerHTML = '<div class="syncmodal" style="position:relative"><button class="close">&times;</button><div class="syncbody"></div></div>';
    ov.addEventListener("click", function (e) { if (e.target === ov) closeModal(); });
    ov.querySelector(".close").onclick = closeModal;
    document.body.appendChild(ov);
    modal = ov;
  }

  function setStatus(state) { lastState = state; renderStatus(); }

  function renderStatus() {
    if (!chip) return;
    var lbl = chip.querySelector(".lbl");
    chip.classList.remove("ok", "warn", "busy");
    if (!configured) { chip.style.display = "none"; return; }
    if (syncing) { chip.classList.add("busy"); lbl.textContent = "Syncing…"; return; }
    if (!online()) { chip.classList.add("warn"); lbl.textContent = "Offline"; return; }
    if (!user) { lbl.textContent = "Sign in"; return; }
    chip.classList.add("ok");
    lbl.textContent = dirty.length ? "Saving…" : "Synced";
  }

  function openModal() { renderModalBody(); modal.classList.add("show"); }
  function closeModal() { modal.classList.remove("show"); }

  function fmtLast() {
    var t = LS.getItem(LASTSYNC_KEY);
    if (!t) return "never";
    var d = Date.parse(t); if (isNaN(d)) return "never";
    var mins = Math.round((Date.now() - d) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    return new Date(d).toLocaleDateString();
  }

  function renderModalBody() {
    var body = modal.querySelector(".syncbody");
    if (!configured) {
      body.innerHTML = '<h3>Cloud sync</h3><p class="sub">Cloud sync isn\'t set up yet. Add your Supabase URL and key in <b>config.js</b> to sync across devices. Until then your training is saved on this device.</p>';
      return;
    }
    if (!user) {
      body.innerHTML =
        '<h3>Sync across devices</h3>' +
        '<p class="sub">Sign in to back up your plan and pick it up on any device. Use the same login everywhere.</p>' +
        '<label>Email<input type="email" id="syncEmail" autocomplete="username" inputmode="email" placeholder="you@email.com"></label>' +
        '<label>Password<input type="password" id="syncPass" autocomplete="current-password" placeholder="6+ characters"></label>' +
        '<div class="btnrow"><button class="ghost" id="syncSignup">Create account</button><button class="primary" id="syncSignin">Sign in</button></div>' +
        '<div class="err" id="syncErr"></div>';
      body.querySelector("#syncSignin").onclick = function () { doAuth("in"); };
      body.querySelector("#syncSignup").onclick = function () { doAuth("up"); };
      var pass = body.querySelector("#syncPass");
      pass.addEventListener("keydown", function (e) { if (e.key === "Enter") doAuth("in"); });
    } else {
      body.innerHTML =
        '<h3>Cloud sync on</h3>' +
        '<div class="meta">Signed in as <b>' + escapeHtml(user.email || "you") + '</b><br>' +
        'Last synced <b>' + fmtLast() + '</b>' + (dirty.length ? ' · ' + dirty.length + ' pending' : '') + '</div>' +
        '<div class="btnrow"><button class="ghost" id="syncOut">Sign out</button><button class="primary" id="syncGo">Sync now</button></div>' +
        '<div class="err" id="syncErr"></div>';
      body.querySelector("#syncGo").onclick = function () {
        sync().then(function () { renderModalBody(); });
      };
      body.querySelector("#syncOut").onclick = function () {
        sb.auth.signOut().then(function () { closeModal(); });
      };
    }
  }

  function escapeHtml(s) {
    return (("" + s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
  }

  function showErr(msg, ok) {
    var el = modal.querySelector("#syncErr");
    if (el) { el.textContent = msg; el.className = "err" + (ok ? " ok" : ""); }
  }

  function doAuth(mode) {
    if (!sb) return;
    var email = (modal.querySelector("#syncEmail") || {}).value;
    var pass = (modal.querySelector("#syncPass") || {}).value;
    email = (email || "").trim();
    if (!email || !pass) { showErr("Enter your email and password."); return; }
    showErr(mode === "up" ? "Creating account…" : "Signing in…", true);
    var p = mode === "up"
      ? sb.auth.signUp({ email: email, password: pass })
      : sb.auth.signInWithPassword({ email: email, password: pass });
    p.then(function (res) {
      if (res.error) { showErr(res.error.message); return; }
      if (mode === "up" && res.data && res.data.user && !res.data.session) {
        showErr("Account created — check your email to confirm, then sign in.", true);
        return;
      }
      // onAuthStateChange handles the rest.
    }).catch(function (e) { showErr((e && e.message) || "Something went wrong."); });
  }

  /* ---- boot the sync layer ---- */
  function onSignedIn(u) {
    user = u;
    renderStatus();
    if (modal && modal.classList.contains("show")) renderModalBody();
    sync();
    try {
      // Best-effort realtime; falls back to focus/online pulls if unavailable.
      sb.channel("app_state_" + u.id)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "app_state", filter: "user_id=eq." + u.id },
          function () { if (!syncing) pull(); })
        .subscribe();
    } catch (e) {}
  }
  function onSignedOut() {
    user = null;
    renderStatus();
    if (modal && modal.classList.contains("show")) renderModalBody();
  }

  document.addEventListener("DOMContentLoaded", function () {
    injectUI();
    renderStatus();
    if (!sb) return;
    sb.auth.getSession().then(function (res) {
      var s = res && res.data && res.data.session;
      if (s && s.user) onSignedIn(s.user);
    });
    sb.auth.onAuthStateChange(function (event, session) {
      if (session && session.user) onSignedIn(session.user);
      else onSignedOut();
    });
    window.addEventListener("online", function () { renderStatus(); sync(); });
    window.addEventListener("offline", renderStatus);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && user) sync();
    });
  });
})();
