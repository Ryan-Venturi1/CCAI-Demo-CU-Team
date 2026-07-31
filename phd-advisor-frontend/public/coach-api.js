/* coach-api.js — real backend wiring for PhD Navigator.
   This replaces the prototype's mocked auth/chat/session calls with the SAME
   endpoints the (now-removed) v2 app used. Exposes window.CoachAPI.

   Backend base URL resolution (this is a static app — there is no build-time
   process.env), in priority order:
     1. window.PHD_API_BASE         (set inline in index.html if you want)
     2. localStorage['phd-api-base'] (handy for pointing a deployed UI at an API)
     3. http(s)://<current-host>:8000  (matches the docker-compose dev setup)

   Every network call degrades gracefully: if the backend is unreachable the
   relevant method falls back to local/demo behavior so the UI never hard-fails.
*/
// ---------------------------------------------------------------------------
// Per-account localStorage namespacing. Every app key (phd-*) is transparently
// suffixed with the signed-in account, so signing out and signing in as
// someone else NEVER shows the previous person's documents, plan, chats, or
// check-ins. Legacy unscoped data is migrated to the first account that reads
// it. Auth/session keys and device-level settings stay unscoped.
// ---------------------------------------------------------------------------
(function () {
  const GLOBAL_KEYS = new Set(["authToken", "user", "phd-api-base", "phd-coach-authed"]);
  const APP_PREFIX = /^phd-/;
  const raw = {
    get: Storage.prototype.getItem,
    set: Storage.prototype.setItem,
    rem: Storage.prototype.removeItem,
  };
  const scope = () => {
    try {
      const u = JSON.parse(raw.get.call(window.localStorage, "user") || "null");
      const id = u && (u.id || u._id || u.email);
      return id ? String(id).toLowerCase() : "";
    } catch (e) { return ""; }
  };
  const nsKey = (k) => {
    if (typeof k !== "string" || !APP_PREFIX.test(k) || GLOBAL_KEYS.has(k)) return k;
    const s = scope();
    return s ? `${k}@@${s}` : k;
  };
  Storage.prototype.getItem = function (k) {
    const nk = nsKey(k);
    let v = raw.get.call(this, nk);
    if (v == null && nk !== k) {
      // One-time adoption: pre-namespacing data belongs to whoever signs in first.
      const legacy = raw.get.call(this, k);
      if (legacy != null) { raw.set.call(this, nk, legacy); raw.rem.call(this, k); v = legacy; }
    }
    return v;
  };
  Storage.prototype.setItem = function (k, v) { return raw.set.call(this, nsKey(k), v); };
  Storage.prototype.removeItem = function (k) { return raw.rem.call(this, nsKey(k)); };
})();

(function () {
  const TOKEN_KEY = "authToken";   // same keys the backend/v2 used
  const USER_KEY = "user";

  function base() {
    if (window.PHD_API_BASE) return String(window.PHD_API_BASE).replace(/\/$/, "");
    try {
      const ls = localStorage.getItem("phd-api-base");
      if (ls) return ls.replace(/\/$/, "");
    } catch (e) {}
    const host = (typeof location !== "undefined" && location.hostname) ? location.hostname : "localhost";
    const proto = (typeof location !== "undefined" && location.protocol === "https:") ? "https:" : "http:";
    return `${proto}//${host}:8000`;
  }

  const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const rawUser = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch (e) { return null; } };
  const isAuthed = () => !!token();
  const PROFILE_PLACEHOLDERS = new Set([
    "string",
    "undefined",
    "null",
    "none",
    "n/a",
    "na",
    "unknown",
    "choose your program",
    "select your program",
    "choose your university",
    "select your university"
  ]);

  function cleanProfileValue(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    if (PROFILE_PLACEHOLDERS.has(text.toLowerCase())) return "";
    return text;
  }

  function firstProfileValue(...values) {
    for (const value of values) {
      const clean = cleanProfileValue(value);
      if (clean) return clean;
    }
    return "";
  }

  function setAuth(tok, user) {
    try {
      if (tok) localStorage.setItem(TOKEN_KEY, tok);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {}
  }
  function clearAuth() {
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch (e) {}
  }

  function initialsFor(name, email) {
    const src = (name || email || "").trim();
    if (!src) return "PhD";
    return src.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "PhD";
  }

  // Normalized user for the UI (falls back to the prototype's demo identity).
  function getUser() {
    const u = rawUser();
    const demo = window.MOCK_USER || { name: "PhD Student", email: "", stage: "", program: "" };
    if (!u) return demo;
    const name = firstProfileValue(u.name, [u.firstName, u.lastName].filter(Boolean).join(" "), u.full_name, u.email, demo.name);
    const email = firstProfileValue(u.email, demo.email);
    return {
      name, email,
      initials: u.initials || initialsFor(name, email),
      stage: firstProfileValue(u.academicStage, u.stage, demo.stage),
      institution: firstProfileValue(u.institution, demo.institution),
      program: firstProfileValue(u.program, u.researchArea, demo.program)
    };
  }

  function authHeaders(json = true) {
    const h = {};
    if (json) h["Content-Type"] = "application/json";
    const t = token();
    if (t) h["Authorization"] = `Bearer ${t}`;
    return h;
  }

  // fetch() has no default timeout, so a request that never gets a response
  // never settles and whatever awaited it spins forever. The API sleeps when
  // idle and a cold start can take tens of seconds, which is exactly when this
  // bites. Every call that a human is waiting on should use this.
  async function fetchT(url, opts, ms) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) {} }, ms || 20000);
    try {
      return await fetch(url, ctrl ? Object.assign({}, opts, { signal: ctrl.signal }) : opts);
    } catch (e) {
      if (e && e.name === "AbortError") {
        const err = new Error("The server didn't respond in time.");
        err.timeout = true;
        throw err;
      }
      throw e;
    } finally { clearTimeout(timer); }
  }

  const DEPLOYED_API = "https://phd-navigator-api.onrender.com";

  // ---------------------------------------------------------------------------
  // Same-origin first.
  //
  // Calling https://phd-navigator-api.onrender.com directly is a cross-origin
  // request to a hostname that blockers pattern-match — `*.onrender.com` is on
  // several ad-block/privacy lists because free hosting gets abused. When an
  // extension matches it the request dies as `TypeError: Failed to fetch`
  // before leaving the browser, and no app-side handling can recover it.
  //
  // So we ask our OWN origin first: /api/... is proxied to the backend by
  // vercel.json (deployed) and src/setupProxy.js (dev). Nothing third-party to
  // match, and no CORS exchange at all.
  //
  // If no proxy is configured the request comes back as the SPA's index.html
  // (200, text/html) rather than failing — so that is treated as "no proxy
  // here", remembered, and every later call goes direct.
  // ---------------------------------------------------------------------------
  let proxyMode = null;   // null = untested, true = proxy works, false = go direct

  // Two ways "no proxy here" shows up: an SPA host rewrites /api to index.html
  // (200 text/html), and a plain static host 404s it. Neither is the API.
  const noProxyHere = (res) =>
    res.status === 404 ||
    (res.headers.get("content-type") || "").indexOf("text/html") !== -1;

  async function apiFetch(path, opts, ms) {
    if (proxyMode !== false && typeof location !== "undefined" && location.origin) {
      try {
        const res = await fetchT(location.origin + path, opts, ms);
        if (!noProxyHere(res)) { proxyMode = true; return res; }
        proxyMode = false;   // not the API answering — go direct from here on
      } catch (e) {
        // A same-origin request that fails outright means no proxy (dev server
        // without setupProxy, or a static host). Fall through to direct.
        proxyMode = false;
      }
    }

    try {
      return await fetchT(base() + path, opts, ms);
    } catch (e) {
      const local = /localhost|127\.0\.0\.1/.test(base());
      if (!local || base() === DEPLOYED_API) throw e;
      window.PHD_API_BASE = DEPLOYED_API;
      return fetchT(DEPLOYED_API + path, opts, ms);
    }
  }

  // Which route the API is actually using — surfaced by diagnose().
  const routeInUse = () => proxyMode === true ? "same-origin proxy"
    : proxyMode === false ? "direct to " + base() : "not yet determined";

  // Paste `await CoachAPI.diagnose()` in the console. "Can't reach the server"
  // covers a wrong base URL, a blocked origin, an expired token and a real
  // outage — this says which one, instead of leaving it to guesswork.
  async function diagnose() {
    const out = {
      apiBase: base(),
      origin: typeof location !== "undefined" ? location.origin : "(none)",
      hasToken: !!token(),
      tokenKind: token() === "demo-token" ? "demo (never syncs)" : token() ? "real" : "none",
      route: routeInUse(),
      build: "same-origin-proxy-20260728"
    };
    try {
      const res = await apiFetch("/api/wellness/summary", { headers: authHeaders() }, 15000);
      out.route = routeInUse();
      out.reachable = true;
      out.status = res.status;
      out.verdict = res.status === 200 ? "OK — the API is reachable and the token works."
        : res.status === 401 || res.status === 403 ? "Reached the API, but the token was rejected. Sign out and back in."
        : `Reached the API; it answered ${res.status}.`;
    } catch (e) {
      out.reachable = false;
      out.error = `${e.name}: ${e.message}`;
      out.verdict = e.timeout
        ? "The request timed out — the API is asleep or very slow."
        : /localhost|127\.0\.0\.1/.test(base())
          ? "Pointed at a local backend that isn't running. Start uvicorn, or set localStorage['phd-api-base'] to the deployed API."
          : "The request never got a response: offline, DNS, a blocked origin (CORS), or a browser extension. Check the Network tab for the failed request.";
    }
    console.table ? console.table(out) : console.log(out);
    return out;
  }

  async function jsonOrThrow(res) {
    let data = null;
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error((data && (data.detail || data.message)) || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- Auth ---------------------------------------------------------------
  async function login(email, password) {
    const res = await fetch(`${base()}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await jsonOrThrow(res);
    setAuth(data.access_token, data.user);
    return getUser();
  }

  async function signup({ firstName, lastName, email, password, academicStage = "", institution = "", program = "", researchArea = "" }) {
    const res = await fetch(`${base()}/auth/signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, email, password, academicStage, institution, program, researchArea: researchArea || program })
    });
    const data = await jsonOrThrow(res);
    const user = {
      ...(data.user || {}),
      institution: firstProfileValue(data.user && data.user.institution, institution),
      program: firstProfileValue(data.user && data.user.program, program, data.user && data.user.researchArea),
      researchArea: firstProfileValue(data.user && data.user.researchArea, researchArea, program)
    };
    setAuth(data.access_token, user);
    return getUser();
  }

  // Offline/demo fallback: create a local session so the app stays usable when
  // there is no backend (mirrors v2's behavior).
  function demoAuth({ email, name, stage, institution, program }) {
    const display = name || (email || "demo@local").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    setAuth("demo-token", { name: display, email: email || "demo@local", stage, institution, program, researchArea: program });
    return getUser();
  }

  // ---- Config -------------------------------------------------------------
  async function getConfig() {
    const res = await apiFetch(`/api/config`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }

  // ---- Chat sessions ------------------------------------------------------
  async function listSessions() {
    const res = await apiFetch(`/api/chat-sessions`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function createSession(title) {
    const res = await apiFetch(`/api/chat-sessions`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ title: title || `Chat ${new Date().toLocaleDateString()}` })
    });
    const s = await jsonOrThrow(res);
    return s && s.id;
  }
  async function getSession(id) {
    const res = await apiFetch(`/api/chat-sessions/${id}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function renameSession(id, title) {
    const res = await apiFetch(`/api/chat-sessions/${id}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ title })
    });
    return jsonOrThrow(res);
  }
  async function deleteSession(id) {
    const res = await apiFetch(`/api/chat-sessions/${id}`, { method: "DELETE", headers: authHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  }
  async function truncateMessages(sessionId, fromMessageId) {
    if (!sessionId || !fromMessageId) return null;
    const res = await apiFetch(`/api/chat-sessions/${sessionId}/messages/truncate`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ from_message_id: fromMessageId })
    });
    return jsonOrThrow(res);
  }
  async function uploadDocument({ file, sessionId, filename }) {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file, filename || file.name || "document.txt");
    const qs = sessionId ? `?chat_session_id=${encodeURIComponent(sessionId)}` : "";
    const res = await fetch(`${base()}/upload-document${qs}`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }
  async function saveMessage(sessionId, message) {
    if (!sessionId) return;
    try {
      await apiFetch(`/api/chat-sessions/${sessionId}/messages`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ session_id: sessionId, message })
      });
    } catch (e) { /* best-effort */ }
  }
  async function switchChat(sessionId) {
    const res = await fetch(`${base()}/switch-chat`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ chat_session_id: sessionId })
    });
    return jsonOrThrow(res);
  }
  async function newChat(title) {
    const res = await fetch(`${base()}/new-chat`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ title: title || `Chat ${new Date().toLocaleDateString()}` })
    });
    return jsonOrThrow(res);
  }

  // ---- Streaming chat -----------------------------------------------------
  // Calls onEvent({type, data}) for every NDJSON line the backend streams.
  // type ∈ "advisor" | "clarification" | "progress" | "error".
  async function streamChat({ userInput, userMessageId, sessionId, responseLength = "medium", activeAdvisors, advisorSkill, studentContext, contextSource, eligibleForMemory = true, retryOfMessageId, retryUserInput, onEvent }) {
    const res = await fetch(`${base()}/chat-stream`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        user_input: userInput,
        user_message_id: userMessageId || null,
        response_length: responseLength,
        chat_session_id: sessionId || null,
        active_advisors: activeAdvisors || null,
        advisor_skill: advisorSkill || null,
        student_context: studentContext || null,
        context_source: contextSource || null,
        eligible_for_memory: eligibleForMemory !== false,
        retry_of_message_id: retryOfMessageId || null,
        retry_user_input: retryUserInput || null
      })
    });
    if (!res.ok || !res.body) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let payload; try { payload = JSON.parse(line); } catch (e) { continue; }
        onEvent && onEvent({ type: payload.type, data: payload.data || {} });
      }
    }
  }

  async function replyToAdvisor({ userInput, advisorId, originalMessageId, sessionId }) {
    const res = await fetch(`${base()}/reply-to-advisor`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ user_input: userInput, advisor_id: advisorId, original_message_id: originalMessageId, chat_session_id: sessionId })
    });
    return jsonOrThrow(res);
  }

  async function defenseAnswerFeedback({ format, items, difficulty, areasOfFocus } = {}) {
    const res = await apiFetch(`/api/workspace/defense/answer-feedback`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        format: format || "defense",
        difficulty: difficulty || "standard",
        areas_of_focus: areasOfFocus || "",
        items: items || []
      })
    });
    return jsonOrThrow(res);
  }
  async function resolveDefenseMemberProfile(member) {
    const res = await apiFetch(`/api/defense/member-profile`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ member })
    });
    return jsonOrThrow(res);
  }

  async function parseDefenseMaterial(file) {
    const form = new FormData();
    form.append("file", file, file?.name || "defense-material");
    const res = await apiFetch(`/api/defense/materials/parse`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }

  async function parseDefenseDeck(file, { renderSlides = true } = {}) {
    const form = new FormData();
    form.append("file", file, file?.name || "defense-deck.pptx");
    form.append("render_slides", renderSlides ? "true" : "false");
    const res = await apiFetch(`/api/defense/deck`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }

  async function analyzeDefensePresentation({
    mediaBlob, deckFile, deckName, slides, format, targetPresentationMinutes,
    audienceLevels, audienceInterests
  }) {
    const form = new FormData();
    if (deckFile) form.append("deck", deckFile, deckFile.name || deckName || "defense-deck.pptx");
    if (mediaBlob) form.append("media", mediaBlob, mediaBlob.type?.startsWith("audio/") ? "presentation-audio.webm" : "presentation-video.webm");
    if (slides) form.append("slides_json", JSON.stringify(slides || []));
    form.append("deck_name", deckName || "Slide deck");
    form.append("format", format || "defense");
    form.append("target_presentation_minutes", String(targetPresentationMinutes || 20));
    form.append("audience_levels_json", JSON.stringify(audienceLevels || []));
    form.append("audience_interests_json", JSON.stringify(audienceInterests || []));
    const res = await apiFetch(`/api/defense/presentation/analyze`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }

  async function generateDefenseQuestions({
    format, thesisTitle, researchSummary, materials, committeeMembers, questionCount = 6,
    difficulty, targetPresentationMinutes, areasOfFocus, audienceLevels, audienceInterests,
    defensePriorities
  }) {
    const res = await apiFetch(`/api/defense/questions`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        format: format || "defense",
        thesis_title: thesisTitle || "",
        research_summary: researchSummary || "",
        materials: materials || [],
        committee_members: committeeMembers || [],
        question_count: questionCount,
        difficulty: difficulty || "standard",
        target_presentation_minutes: targetPresentationMinutes || 20,
        areas_of_focus: areasOfFocus || "",
        audience_levels: audienceLevels || [],
        audience_interests: audienceInterests || [],
        defense_priorities: defensePriorities || []
      })
    });
    return jsonOrThrow(res);
  }

  // ---- Workspace sync (deadlines / notes / reading / funding / faculty) ----
  // Per-user, backend-persisted state for the home tools. Callers should treat
  // these as best-effort: localStorage stays the offline source of truth.
  async function getWorkspaceState() {
    const res = await apiFetch(`/api/workspace/state`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function putWorkspaceSection(section, items) {
    const res = await apiFetch(`/api/workspace/state/${encodeURIComponent(section)}`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ items })
    });
    return jsonOrThrow(res);
  }
  async function suggestReading({ topic, program, milestone, alreadyHave, count } = {}) {
    const res = await apiFetch(`/api/workspace/reading/suggest`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        topic: topic || "", program: program || "", milestone: milestone || "",
        already_have: alreadyHave || [], count: count || 6
      })
    });
    return jsonOrThrow(res);
  }
  // ---- Plan builder (template-grounded generation + assistant retrofit) ----
  async function planBaseTemplate() {
    const res = await apiFetch(`/api/plan/base-template`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function planGenerate({ handbookText, program, institution, profile } = {}) {
    const res = await apiFetch(`/api/plan/generate`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        handbook_text: handbookText || "", program: program || "", institution: institution || "",
        profile: profile || {}
      })
    });
    return jsonOrThrow(res);
  }
  async function planImport({ csvText, profile } = {}) {
    const res = await apiFetch(`/api/plan/import`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ csv_text: csvText || "", profile: profile || {} })
    });
    return jsonOrThrow(res);
  }
  async function planWalkthrough({ title, section, objective, notes, days, program, field } = {}) {
    const res = await apiFetch(`/api/plan/walkthrough`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        title: title || "", section: section || "", objective: objective || "",
        notes: notes || "", days: days || "", program: program || "", field: field || ""
      })
    });
    return jsonOrThrow(res);
  }
  async function planRetrofit({ plan, change, profile } = {}) {
    const res = await apiFetch(`/api/plan/retrofit`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ plan: plan || {}, change: change || "", profile: profile || {} })
    });
    return jsonOrThrow(res);
  }

  async function suggestMeetingAgenda({ withName, withRole, program, milestone, milestoneTasks, priorNotes, focus } = {}) {
    const res = await apiFetch(`/api/workspace/meeting/suggest`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        with_name: withName || "", with_role: withRole || "", program: program || "",
        milestone: milestone || "", milestone_tasks: milestoneTasks || [],
        prior_notes: priorNotes || "", focus: focus || ""
      })
    });
    return jsonOrThrow(res);
  }
  async function analyzeMeetingRecording({ mediaBlob, agenda, withName, title } = {}) {
    const form = new FormData();
    form.append("media", mediaBlob, mediaBlob && mediaBlob.type && mediaBlob.type.includes("mp4") ? "meeting-audio.mp4" : "meeting-audio.webm");
    form.append("agenda_json", JSON.stringify(agenda || []));
    form.append("with_name", withName || "");
    form.append("title", title || "");
    const res = await apiFetch(`/api/workspace/meeting/analyze-recording`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }
  async function extractMeetingActions({ notes, agenda } = {}) {
    const res = await apiFetch(`/api/workspace/meeting/actions`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ notes: notes || "", agenda: agenda || [] })
    });
    return jsonOrThrow(res);
  }
  async function citeUrl(url) {
    const res = await apiFetch(`/api/workspace/citation/url`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ url })
    });
    return jsonOrThrow(res);
  }
  async function suggestFunding({ program, institution, topic, stage, count } = {}) {
    const res = await apiFetch(`/api/workspace/funding/suggest`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        program: program || "", institution: institution || "",
        topic: topic || "", stage: stage || "", count: count || 6
      })
    });
    return jsonOrThrow(res);
  }

  // ---- Document library (server-persisted Documents page) ------------------
  async function listLibraryDocs() {
    const res = await apiFetch(`/api/library/documents`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function getLibraryDoc(id) {
    const res = await apiFetch(`/api/library/documents/${id}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function uploadLibraryDoc({ file, source }) {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file, file.name || "document.txt");
    form.append("source", source || "documents");
    const res = await apiFetch(`/api/library/documents`, {
      method: "POST", headers: authHeaders(false), body: form
    });
    return jsonOrThrow(res);
  }
  async function saveLibraryDoc(id, { name, content, reanalyze } = {}) {
    const res = await apiFetch(`/api/library/documents/${id}`, {
      method: "PUT", headers: authHeaders(),
      body: JSON.stringify({ name, content, reanalyze: !!reanalyze })
    });
    return jsonOrThrow(res);
  }
  async function deleteLibraryDoc(id) {
    const res = await apiFetch(`/api/library/documents/${id}`, {
      method: "DELETE", headers: authHeaders()
    });
    return jsonOrThrow(res);
  }
  async function analyzeLibraryDoc(id) {
    const res = await apiFetch(`/api/library/documents/${id}/analyze`, {
      method: "POST", headers: authHeaders()
    });
    return jsonOrThrow(res);
  }
  async function compareLibraryDoc(id, againstId) {
    const res = await apiFetch(`/api/library/documents/${id}/compare`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify(againstId ? { against_id: againstId } : {})
    });
    return jsonOrThrow(res);
  }
  async function getKnowledge() {
    const res = await apiFetch(`/api/library/knowledge`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function saveKnowledge(markdown) {
    const res = await apiFetch(`/api/library/knowledge`, {
      method: "PUT", headers: authHeaders(), body: JSON.stringify({ markdown })
    });
    return jsonOrThrow(res);
  }

  // ---- Wellness -------------------------------------------------------------
  async function wellnessCheckin(payload) {
    const res = await fetch(`${base()}/api/wellness/checkin`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify(payload || {})
    });
    return jsonOrThrow(res);
  }
  async function wellnessSummary() {
    const res = await fetch(`${base()}/api/wellness/summary`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function wellnessHistory(days = 30) {
    const res = await apiFetch(`/api/wellness/checkins?days=${days}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function insightsBrain(context = {}, force = false) {
    const res = await fetch(`${base()}/api/insights/brain`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ context, force })
    });
    return jsonOrThrow(res);
  }
  async function wellnessInsight(context = {}, force = false) {
    const res = await apiFetch(`/api/wellness/insight`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ context, force })
    });
    return jsonOrThrow(res);
  }

  // ---- Calendar & mail integrations (Google / Outlook) ---------------------
  async function integrationsStatus() {
    const res = await apiFetch(`/api/integrations/status`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function integrationConnect(provider) {
    const res = await apiFetch(`/api/integrations/${provider}/connect`, { headers: authHeaders() });
    return jsonOrThrow(res); // { auth_url } — open in a popup
  }
  async function integrationDisconnect(provider) {
    const res = await apiFetch(`/api/integrations/${provider}/disconnect`, {
      method: "POST", headers: authHeaders()
    });
    return jsonOrThrow(res);
  }
  async function calendarNext(days = 14) {
    const res = await apiFetch(`/api/integrations/calendar/next?days=${days}`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function calendarBrief() {
    const res = await apiFetch(`/api/integrations/calendar/brief`, { headers: authHeaders() });
    return jsonOrThrow(res);
  }
  async function calendarPush({ title, date, time, durationMinutes, notes, provider } = {}) {
    const res = await apiFetch(`/api/integrations/calendar/push`, {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        title: title || "Untitled", date: date || "", time: time || "",
        duration_minutes: durationMinutes || 60, notes: notes || "", provider: provider || ""
      })
    });
    return jsonOrThrow(res);
  }
  async function driveCreateDoc({ name, html } = {}) {
    const res = await apiFetch(`/api/integrations/google/drive/doc`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ name: name || "Document", html: html || "" })
    });
    return jsonOrThrow(res); // { id, url }
  }
  async function mailScanReadings(days = 14) {
    const res = await apiFetch(`/api/integrations/mail/scan-readings`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({ days })
    });
    return jsonOrThrow(res);
  }

  window.CoachAPI = {
    base, token, isAuthed, setAuth, clearAuth, getUser, getRawUser: rawUser, initialsFor,
    login, signup, demoAuth, getConfig,
    listSessions, createSession, getSession, renameSession, deleteSession, truncateMessages, uploadDocument, saveMessage, switchChat, newChat,
    streamChat, replyToAdvisor,
    resolveDefenseMemberProfile, parseDefenseMaterial, parseDefenseDeck, analyzeDefensePresentation, generateDefenseQuestions, defenseAnswerFeedback,
    getWorkspaceState, putWorkspaceSection, suggestReading, suggestFunding, citeUrl,
    suggestMeetingAgenda, extractMeetingActions, analyzeMeetingRecording,
    planBaseTemplate, planGenerate, planRetrofit, planWalkthrough, planImport,
    listLibraryDocs, getLibraryDoc, uploadLibraryDoc, saveLibraryDoc, deleteLibraryDoc, analyzeLibraryDoc, compareLibraryDoc,
    getKnowledge, saveKnowledge,
    wellnessCheckin, wellnessSummary, wellnessHistory, wellnessInsight, insightsBrain,
    integrationsStatus, integrationConnect, integrationDisconnect,
    calendarNext, calendarBrief, calendarPush, mailScanReadings, driveCreateDoc
  };
})();
