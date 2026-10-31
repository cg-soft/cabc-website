(() => {
  const FRONTEND_VERSION = "1.0.1+14ef89ea2853";
  const app = document.querySelector("#app"), dialog = document.querySelector("#dialog");
  const state = { token: null, user: null, config: null, month: null, selected: null, calendar: null, generation: 0, loginNotice: null, showWildcard: null, actingMemberId: null, schedulingPending: false };
  dialog.addEventListener("close", () => { if (!dialog.open) dialog.replaceChildren(); });
  dialog.addEventListener("cancel", event => {
    if (dialog.dataset.passwordPending === "true" || dialog.dataset.memberPending === "true" || dialog.dataset.gamePending === "true" || state.schedulingPending) event.preventDefault();
  });
  let slideTimer, toastTimer, slide = 0, paused = false;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dateLabel = (value, options = { month: "long", day: "numeric" }) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const timeLabel = (value) => { const [h, m] = value.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
  const brand = '<span class="brand">Chinese American<br>Bridge Club</span>';
  const button = (label, action, cls = "") => `<button type="button" class="${cls}" data-action="${action}">${label}</button>`;
  const installHelp = () => `<p class="install-help">${button("Add this calendar to your iPhone", "install-app", "text-button")}</p>`;
  const defaultGameDate = () => {
    const firstOfMonth = `${state.month || state.config.today.slice(0, 7)}-01`;
    return firstOfMonth > state.config.today ? firstOfMonth : state.config.today;
  };
  const wildcardList = () => state.calendar?.wildcards || [];
  const wildcardById = id => wildcardList().find(w => w.id === id) || null;
  const partnerWildcardType = id => wildcardById(id)?.type || null;
  const schedulingMember = () => (actingForMember() && state.calendar?.members?.find(member => member.id === state.actingMemberId)) || state.user;
  // Fail closed when new browser assets are paired with a server that has not
  // been upgraded/restarted: older servers ignore memberId on scheduling writes.
  const actingForMember = () => state.user?.role === "admin" && state.actingMemberId !== null && !!state.calendar?.registrationRevisions;
  const schedulingFields = gameId => actingForMember() ? {
    memberId: state.actingMemberId, revision: state.calendar.registrationRevisions?.[gameId], confirm: true
  } : {};
  function drawActingControls() {
    const container = document.querySelector("#acting-controls");
    if (!container) return;
    const restoreFocus = document.activeElement === container.querySelector("select");
    const status = document.querySelector("#acting-status");
    if (status) status.replaceChildren();
    const identity = `<span class="identity">${esc(state.user?.name)}</span>`;
    if (state.user?.role !== "admin") { container.innerHTML = identity; state.actingMemberId = null; return; }
    if (!state.calendar.registrationRevisions) {
      state.actingMemberId = null;
      container.innerHTML = identity;
      if (status) status.innerHTML = '<p class="small-note acting-unavailable" role="status">Acting for is unavailable until the updated server is running. Complete the server upgrade and restart, then reload this page. Scheduling remains for your own account.</p>';
      return;
    }
    if (state.actingMemberId !== null && !state.calendar.members.some(member =>
      member.id === state.actingMemberId && member.active !== 0 && !wildcardById(member.id))) {
      state.actingMemberId = null;
      toast("That member is no longer available. Scheduling has returned to Myself.");
    }
    const members = state.calendar.members.filter(member => member.active !== 0 && member.id !== state.user.id && !wildcardById(member.id));
    const selected = schedulingMember();
    container.innerHTML = `<label class="acting-identity"><span>Acting for</span><select data-acting="member" aria-label="Acting for">
      <option value="">Myself (${esc(state.user.name)})</option>${members.map(member => `<option value="${member.id}"${member.id === state.actingMemberId ? " selected" : ""}>${esc(member.name)} · #${member.id}</option>`).join("")}
      </select>${actingForMember() ? `<span class="acting-signed-in">Signed in as ${esc(state.user.name)}</span>` : ""}</label>`;
    if (status && actingForMember()) status.innerHTML = `<section class="acting-context" role="status" aria-label="Administrator scheduling"><div><strong>Acting for ${esc(selected.name)}</strong><p>Registration and team controls below apply to this member. Signed in as ${esc(state.user.name)}. Changes are recorded.</p></div>${button("Return to myself", "acting-reset", "text-button")}</section>`;
    container.querySelector("select").disabled = state.schedulingPending;
    if (restoreFocus && !state.schedulingPending) container.querySelector("select").focus();
  }
  // A partnership row appears once: real pairs via the lower member id, guest
  // placeholders via their single one-directional row. Standby and unavailable
  // are member states, not pairs. Placeholder-owned rows are never listed.
  const pairRowsFor = list => list.filter(e => e.partner_id && !wildcardById(e.member_id) &&
    (partnerWildcardType(e.partner_id) === "guest" || (!partnerWildcardType(e.partner_id) && e.member_id < e.partner_id)));
  function toast(message) {
    clearTimeout(toastTimer); const el = document.querySelector("#toast");
    el.textContent = message; el.classList.add("visible");
    toastTimer = setTimeout(() => el.classList.remove("visible"), 5000);
  }
  async function api(route, method = "GET", body, format = "json") {
    if (window.navigator?.onLine === false) throw new Error("You’re offline. Reconnect to the internet and try again. No changes have been sent.");
    let response;
    try { response = await fetch(`${window.CABC_API || ""}/api${route}`, {
      method, credentials: "same-origin", cache: "no-store", headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
      }, body: body !== undefined ? JSON.stringify(body) : undefined
    }); } catch {
      throw new Error("Unable to connect to the club. Check your connection and try again. If you were saving a change, refresh the calendar to check whether it was saved.");
    }
    const result = response.ok && format === "blob" ? await response.blob() : await response.json();
    if (!response.ok) {
      if (response.status === 401 && route !== "/login") {
        state.token = null; state.user = null; state.calendar = null; state.actingMemberId = null;
        if (dialog.open) dialog.close();
        location.hash = "#login";
      }
      throw new Error(result.error || "Unable to complete that request.");
    }
    return result;
  }
  const header = (controls, home = false, extraClass = "") => `<header class="site-header ${home ? "over-photo" : ""} ${extraClass}">${brand}<nav aria-label="Main navigation">${controls}</nav></header>`;
  function route() {
    state.generation++;
    clearInterval(slideTimer);
    if (dialog.open) dialog.close();
    const screen = location.hash.slice(1) || "home";
    document.body.className = screen === "home" ? "home" : "";
    if (screen.startsWith("email-opt-out/")) renderEmailOptOut(screen.slice("email-opt-out/".length));
    else if (screen === "email-opted-out") {
      document.title = "Email preferences | Chinese American Bridge Club";
      app.innerHTML = header(button("Home", "home", "quiet")) + '<main class="simple-page"><h1>Email notifications stopped</h1><p>You will no longer receive registration and cancellation emails. Your game registrations have not changed.</p><p>Sign in and open Email notifications to turn them back on.</p>' + button("Sign in", "login", "primary") + '</main>';
    }
    else if (screen === "home") renderHome();
    else if (screen === "about") renderAbout();
    else if (screen === "calendar" && state.user) renderCalendar();
    else renderLogin();
    window.scrollTo(0, 0);
  }
  function renderHome() {
    document.title = "Chinese American Bridge Club";
    app.innerHTML = `
      <main class="home-scene">
        <figure class="slideshow" tabindex="0" aria-label="Illustrative bridge photographs. Press Space to pause or resume the slideshow.">
          <img class="slide ${slide === 0 ? "active" : ""}" src="./slides/table.webp" alt="Playing cards on a green felt table in warm sunlight.">
          <img class="slide ${slide === 1 ? "active" : ""}" src="./slides/room.webp" alt="A sunlit room with a card table and four chairs." ${slide === 0 ? 'loading="lazy"' : ""}>
          <figcaption><span class="slide-counter">${String(slide + 1).padStart(2, "0")} <span>/ 02</span></span><span class="slide-note">Illustrative photography<span class="pause-hint"> · Space to pause</span></span></figcaption>
        </figure>
        ${header(button("About", "about", "photo-outline") + button("Login", "login", "photo-solid"), true)}
      </main>`;
    const figure = app.querySelector("figure");
    paused = false;
    figure.addEventListener("focus", () => { paused = true; });
    figure.addEventListener("keydown", (event) => { if (event.code === "Space") { event.preventDefault(); paused = !paused; toast(paused ? "Slideshow paused." : "Slideshow resumed."); } });
    slideTimer = setInterval(() => {
      if (paused || document.hidden || figure.matches(":hover") || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      slide = 1 - slide;
      app.querySelectorAll(".slide").forEach((img, i) => img.classList.toggle("active", i === slide));
      app.querySelector(".slide-counter").innerHTML = `${String(slide + 1).padStart(2, "0")} <span>/ 02</span>`;
    }, 6500);
  }
  function renderAbout() {
    document.title = "About | Chinese American Bridge Club";
    app.innerHTML = header(button("Home", "home", "quiet") + button("Login", "login", "primary")) +
      `<main class="simple-page"><p class="eyebrow">Chinese American Bridge Club</p><h1>About the club</h1><p>We’re making a new home for our bridge community.</p><p class="muted">More about the club will be added here soon.</p>
      <section class="version-panel" aria-labelledby="version-heading"><h2 id="version-heading">Website version</h2>
      <dl><div><dt>Frontend</dt><dd>${esc(FRONTEND_VERSION)}</dd></div>
      <div><dt>Backend</dt><dd data-backend-version>Checking…</dd></div>
      <div><dt>Backend started</dt><dd data-backend-started>Checking…</dd></div></dl>
      <p class="version-status" data-version-status role="status">Checking the running backend.</p></section>
      <div class="small-note">The homepage currently uses illustrative photographs, not photographs of the club’s venue.</div></main>`;
    void loadBackendVersion(app.querySelector(".version-panel"));
  }
  async function loadBackendVersion(panel) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const show = (version, started, message) => {
      if (!panel.isConnected) return;
      panel.querySelector("[data-backend-version]").textContent = version;
      panel.querySelector("[data-backend-started]").textContent = started;
      panel.querySelector("[data-version-status]").textContent = message;
    };
    try {
      const response = await fetch(`${window.CABC_API || ""}/api/version`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        show("Not reported", "Not reported", [401, 404].includes(response.status) ?
          "The backend did not report a version. It may be an older release." : "The backend version is unavailable.");
        return;
      }
      const data = await response.json();
      if (typeof data.version !== "string" || !/^[A-Za-z0-9.+_-]{1,80}$/.test(data.version)) {
        show("Not reported", "Not reported", "The backend did not report a valid version.");
        return;
      }
      const started = typeof data.startedAt === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(data.startedAt) &&
        Number.isFinite(Date.parse(data.startedAt)) ? data.startedAt : "Not reported";
      show(data.version, started, data.version === FRONTEND_VERSION ?
        "Frontend and backend versions match." :
        "Different frontend and backend versions are loaded. Check for a partial deployment, an older running server or a cached frontend.");
    } catch {
      show("Unavailable", "Not reported", "Unable to check the backend version. The frontend version is shown above.");
    } finally { clearTimeout(timeout); }
  }
  function renderEmailOptOut(token) {
    document.title = "Stop email notifications | Chinese American Bridge Club";
    const valid = /^[a-f0-9]{64}$/.test(token);
    app.innerHTML = header(button("Home", "home", "quiet")) + `<main class="simple-page"><h1>Stop email notifications?</h1>
      ${valid ? `<p>This stops registration and cancellation emails for the account associated with this link. It does not change any game registrations.</p>
      <form id="email-opt-out-form" data-token="${token}"><p class="form-error" role="alert"></p><button type="submit" class="primary">Stop emails</button></form><p>You can turn emails back on in Email notifications after signing in.</p>`
      : '<p>This email link is invalid. Sign in to change Email notifications instead.</p>'}</main>`;
  }
  function renderLogin() {
    document.title = "Login | Chinese American Bridge Club";
    app.innerHTML = header(button("Home", "home", "quiet")) + `
      <main class="login-layout"><div class="login-photo" role="img" aria-label="Illustrative green felt card table"></div>
      <section class="login-panel"><p class="eyebrow">Members & administrators</p><h1>Welcome back.</h1><p class="muted">Sign in to find your next game and partner.</p>
      ${state.loginNotice ? `<p class="login-notice" role="status">${esc(state.loginNotice)}</p>` : ""}
      <form id="login-form"><label>Email<input name="email" type="email" autocomplete="username" required maxlength="180"></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
      <p class="form-error" role="alert"></p><button class="primary wide" type="submit">Login</button></form>
      <p class="small-note">Need an account or a password reset? Contact your club administrator.</p>
      <div id="preview-access"></div>${installHelp()}</section></main>`;
    state.loginNotice = null;
    showPreview();
  }
  async function showPreview() {
    const container = document.querySelector("#preview-access");
    if (!container) return;
    try {
      if (!state.config) state.config = await api("/config");
      if (state.config.preview && container.isConnected) container.innerHTML = `<div class="preview-access"><p>Private preview · sample members & dates</p><div>${button("Try member view", "preview-member", "text-button")}${button("Try administrator view", "preview-admin", "text-button")}</div></div>`;
    } catch { if (container.isConnected) container.innerHTML = '<p class="form-error" role="alert">The service is unavailable. Please try again later.</p>'; }
  }
  function calendarShell() {
    return header(`${state.user.role === "admin" ? `<div id="acting-controls"><span class="identity">${esc(state.user.name)}</span></div>` : `<span class="identity">${esc(state.user.name)}</span>`}${button("Home", "home", "quiet")}${button("Log out", "logout", "quiet")}`, false, "calendar-header") +
      `<main class="calendar-page"><div class="calendar-heading"><div><p class="eyebrow">Members’ calendar</p><h1>Playing dates</h1></div>
      <div class="admin-actions">${button("Export my games", "export-games", "quiet")}${button("Change password", "change-password", "quiet")}<span id="email-settings"></span>${state.user.role === "admin" ? `${button("Add member", "add-member", "quiet")}${button("Deactivate member", "deactivate-member", "quiet")}${button("+ Add date", "add-date", "primary")}` : ""}</div></div>
      ${state.config?.preview ? '<p class="preview-line">Private preview · fictional members and sample dates</p>' : ""}
      ${state.user.role === "admin" ? '<div id="acting-status"></div>' : ""}
      <div id="calendar-content" aria-busy="true"><div class="loading-surface">Loading the calendar…</div></div>${installHelp()}</main>`;
  }
  async function renderCalendar() {
    document.title = "Playing dates | Chinese American Bridge Club";
    state.month = null; state.selected = null; state.showWildcard = null;
    app.innerHTML = calendarShell();
    await loadCalendar();
  }
  async function loadCalendar() {
    const generation = ++state.generation;
    const container = document.querySelector("#calendar-content");
    if (!container) return;
    container.setAttribute("aria-busy", "true");
    try {
      if (!state.config) state.config = await api("/config");
      const response = await api(`/calendar${state.month ? `?month=${state.month}` : ""}`);
      if (generation !== state.generation || !container.isConnected) return;
      state.calendar = response;
      state.user = response.user;
      state.month = response.month;
      state.config.today = response.today;
      if (!response.games.some(g => g.date === state.selected))
        state.selected = response.games.find(g => g.date >= response.today)?.date || response.games[0]?.date || null;
      drawCalendar();
    } catch (error) {
      if (container.isConnected) container.innerHTML = `<div class="loading-surface"><p role="alert">${esc(error.message)}</p>${button("Try again", "retry", "quiet")}</div>`;
    } finally { if (container.isConnected) container.setAttribute("aria-busy", "false"); }
  }
  function gameCount(game, pairs) {
    if (game.event_type !== "teams") return `${pairs} ${pairs === 1 ? "pair" : "pairs"}`;
    const count = (state.calendar.teams || []).filter(team => team.game_id === game.id).length;
    return `${count} ${count === 1 ? "team" : "teams"}`;
  }
  function drawCalendar() {
    const emailSettings = document.querySelector("#email-settings");
    if (emailSettings) emailSettings.innerHTML = state.calendar.notificationsAvailable ? button("Email notifications", "email-settings", "quiet") : "";
    const { games, entries, today } = state.calendar;
    drawActingControls();
    if (!state.calendar.months.length) {
      document.querySelector("#calendar-content").innerHTML = `<section class="no-games"><p class="eyebrow">Members’ calendar</p><h2>No upcoming games</h2><p>There are no games scheduled for today or later.</p><p class="muted">${state.user.role === "admin" ? "Use Add date to schedule the next game." : "Please check back when the club adds more playing dates."}</p></section>`;
      return;
    }
    const [year, month] = state.month.split("-").map(Number);
    const start = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = [];
    const showWildcard = state.showWildcard ? wildcardById(state.showWildcard) : null;
    for (let i = 0; i < Math.ceil((start + days) / 7) * 7; i++) {
      const day = i - start + 1;
      if (day < 1 || day > days) { cells.push('<div class="day empty" aria-hidden="true"></div>'); continue; }
      const date = `${state.month}-${String(day).padStart(2, "0")}`;
      const game = games.find(g => g.date === date);
      const own = game && entries.find(e => e.game_id === game.id && e.member_id === schedulingMember().id);
      const count = game ? pairRowsFor(entries.filter(e => e.game_id === game.id)).length : 0;
      const assignments = showWildcard && game ? showWildcard.schedule.filter(r => r.gameId === game.id).length : 0;
      const label = `<span class="day-number ${date === today ? "today-number" : ""}">${day}</span>`;
      cells.push(game ? `<button class="day playing ${state.selected === date ? "selected" : ""} ${date < today ? "past" : ""}" data-date="${date}" aria-pressed="${state.selected === date}" aria-label="${game.name ? `${esc(game.name)}, ` : ""}${game.event_type === "teams" ? "Team event, " : ""}${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric" }))}, ${timeLabel(game.time)}, ${gameCount(game, count)}${assignments ? `, ${assignments} ${showWildcard.name}` : ""}${own ? ", registered" : ""}">
        <span class="day-top">${label}${own ? '<span class="registration-mark" aria-label="Registered">✓</span>' : ""}</span>${game.name ? `<span class="game-name">${esc(game.name)}</span>` : ""}${game.event_type === "teams" ? '<span class="event-type">Team event</span>' : ""}<span class="game-time">${timeLabel(game.time)}</span><span class="game-meta">${gameCount(game, count)}${assignments ? `<span class="wildcard-badge"> · ${assignments} ${esc(showWildcard.name)}</span>` : ""}</span></button>` :
        `<div class="day">${label}</div>`);
    }
    const agenda = games.map(game => {
      const own = entries.find(e => e.game_id === game.id && e.member_id === schedulingMember().id);
      const count = pairRowsFor(entries.filter(e => e.game_id === game.id)).length;
      const partner = state.calendar.members.find(m => m.id === own?.partner_id);
      const ownType = own ? partnerWildcardType(own.partner_id) : null;
      const status = own ? (ownType ? { guest: "Playing with a guest", standby: "On standby", unavailable: "Unavailable" }[ownType] : partner ? `With ${partner.name}` : "Registered · partner needed") :
        game.date < today ? "Registration closed" : "Choose your partner";
      const assignments = showWildcard ? showWildcard.schedule.filter(r => r.gameId === game.id).length : 0;
      return `<button class="agenda-date ${game.date === state.selected ? "selected" : ""} ${game.date < today ? "past" : ""}" data-date="${game.date}" aria-pressed="${game.date === state.selected}" aria-label="${game.name ? `${esc(game.name)}, ` : ""}${game.event_type === "teams" ? "Team event, " : ""}${esc(dateLabel(game.date, {weekday:"long",month:"long",day:"numeric"}))}, ${timeLabel(game.time)}, ${gameCount(game, count)}${assignments ? `, ${assignments} ${showWildcard.name}` : ""}, ${esc(status)}">
        <span class="agenda-number"><span>${dateLabel(game.date,{month:"short"})}</span><strong>${Number(game.date.slice(-2))}</strong></span>
        <span class="agenda-copy"><strong>${esc(game.name || dateLabel(game.date,{weekday:"long"}))}</strong>${game.event_type === "teams" ? '<span class="event-type">Team event</span>' : ""}<span>${game.name ? `${dateLabel(game.date,{weekday:"short"})} · ` : ""}${timeLabel(game.time)} <span aria-hidden="true">·</span> ${gameCount(game, count)}${assignments ? ` <span aria-hidden="true">·</span> ${assignments} × ${esc(showWildcard.name)}` : ""}</span><span class="agenda-status">${esc(status)}</span></span>
        <span class="agenda-indicator" aria-hidden="true">${own ? "✓" : "›"}</span></button>`;
    }).join("");
    document.querySelector("#calendar-content").innerHTML = `<div class="calendar-layout"><section class="calendar" aria-label="Playing dates calendar">
      <div class="month-nav"><div class="month-title"><h2>${dateLabel(`${state.month}-01`, { month: "long", year: "numeric" })}</h2><p>${games.length} playing ${games.length === 1 ? "date" : "dates"} · Pacific time</p></div><div class="month-controls">${wildcardList().length ? `<label class="show-filter">Show<select data-show="wildcard" aria-label="Show which schedule"><option value="">All members</option>${wildcardList().map(w => `<option value="${w.id}"${state.showWildcard === w.id ? " selected" : ""}>${esc(w.name)}</option>`).join("")}</select></label>` : ""}${button("‹", "previous", "icon-button")}${button("Upcoming", "today", "quiet compact")}${button("›", "next", "icon-button")}</div></div>
      <div class="weekdays" aria-hidden="true">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<span>${d}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.join("")}</div>
      <div class="playing-agenda">${agenda}</div>
      <p class="calendar-note"><span class="legend-square"></span>Playing date <span class="legend-check">✓</span>${actingForMember() ? `${esc(schedulingMember().name)}’s registration` : "Your registration"}</p>
      </section><aside class="dance-card" aria-label="Dance card" tabindex="-1">${danceCard()}</aside></div>`;
    app.querySelector('[data-action="previous"]').setAttribute("aria-label", "Previous month");
    app.querySelector('[data-action="next"]').setAttribute("aria-label", "Next month");
    app.querySelector('[data-action="previous"]').disabled = state.calendar.months.indexOf(state.month) <= 0;
    app.querySelector('[data-action="next"]').disabled = state.calendar.months.indexOf(state.month) === state.calendar.months.length - 1;
  }
  function wildcardPanel() {
    const wildcard = wildcardById(state.showWildcard);
    if (!wildcard) { state.showWildcard = null; return null; }
    const grouped = new Map();
    for (const row of wildcard.schedule) {
      if (!grouped.has(row.gameId))
        grouped.set(row.gameId, { gameId: row.gameId, date: row.date, time: row.time, gameName: row.gameName, eventType: row.eventType, members: [] });
      grouped.get(row.gameId).members.push(row.memberName);
    }
    const items = [...grouped.values()];
    return `<div class="dance-date-header"><div><p class="eyebrow">Placeholder schedule</p><h2>${esc(wildcard.name)}</h2><p class="muted">Upcoming assignments · Pacific time</p></div></div>
      ${items.length ? `<ol class="wildcard-schedule">${items.map(g => `<li><button type="button" data-action="wildcard-jump" data-jump="${g.date}"><span class="jump-date"><strong>${dateLabel(g.date, { month: "short", day: "numeric" })}</strong><span>${dateLabel(g.date, { weekday: "short" })} · ${timeLabel(g.time)}</span></span><span class="jump-copy"><strong>${esc(g.gameName || dateLabel(g.date, { weekday: "long" }))}</strong><span>${g.eventType === "teams" ? "Team event · " : ""}${g.members.length} assignment${g.members.length === 1 ? "" : "s"}</span><span class="jump-members">${g.members.map(esc).join(", ")}</span></span></button></li>`).join("")}</ol>` : '<p class="empty-copy">No upcoming assignments.</p>'}
      <p class="small-note">Read-only view. Set Show to All members to return to your dance card.</p>`;
  }
  function danceCard() {
    if (state.showWildcard) {
      const panel = wildcardPanel();
      if (panel) return panel;
    }
    const { games, entries, members, today } = state.calendar;
    const game = games.find(g => g.date === state.selected);
    if (!game) return '<p class="muted">Select a playing date to see its dance card.</p>';
    const list = entries.filter(e => e.game_id === game.id);
    const own = list.find(e => e.member_id === schedulingMember().id);
    const pairs = pairRowsFor(list);
    const singles = list.filter(e => !e.partner_id && !wildcardById(e.member_id));
    const unavailableMembers = list.filter(e => partnerWildcardType(e.partner_id) === "unavailable");
    const standbyMembers = list.filter(e => partnerWildcardType(e.partner_id) === "standby");
    const name = id => members.find(m => m.id === id)?.name || "Member";
    const available = members.filter(m => m.active !== 0 && m.id !== schedulingMember().id &&
      (wildcardById(m.id) || !list.find(e => e.member_id === m.id)?.partner_id));
    const closed = game.date < today;
    const acting = actingForMember(), subject = esc(schedulingMember().name);
    const cancelLabel = acting ? `Cancel registration for ${subject}` : "Cancel my registration";
    let registration = "";
    if (closed) registration = '<p class="closed-note">Registration for this date is closed.</p>';
    else if (own?.partner_id) {
      const type = partnerWildcardType(own.partner_id);
      const cancel = button(cancelLabel, "cancel", "text-button danger");
      registration = type === "guest"
        ? `<div class="your-registration"><p class="eyebrow">${acting ? `${subject}’s partnership` : "Your partnership"}</p><strong>${esc(name(own.partner_id))}</strong><p>${acting ? subject + " is" : "You’re"} playing with a guest.</p>${cancel}</div>`
        : type
          ? `<div class="your-registration"><p class="eyebrow">${acting ? `${subject}’s status` : "Your status"}</p><strong>${esc(name(own.partner_id))}</strong><p>${acting ? subject + " is" : "You’re"} ${type === "standby" ? "on standby for this game and can substitute at the last moment." : "marked unavailable for this game and cannot be chosen as a partner."}</p>${cancel}</div>`
          : `<div class="your-registration"><p class="eyebrow">${acting ? `${subject}’s partnership` : "Your partnership"}</p><strong>${esc(name(own.partner_id))}</strong><p>Both players are registered.</p>${cancel}</div>`;
    } else registration = `<form id="register-form" data-game="${game.id}"><label>${acting ? `${subject}: ${own ? "add a partner" : "join this game"}` : own ? "You’re registered. Add a partner?" : "Join this game"}<select name="partner" aria-label="Choose a partner">
      <option value="">${own ? "Choose an available member" : acting ? "Looking for a partner" : "I’m looking for a partner"}</option>${available.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}
      </select></label><p class="small-note">Choosing a partner registers both players.${wildcardList().length ? " Hyphenated names such as -Guest- are shared placeholders." : ""}</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">${acting ? `Register for ${subject}` : own ? "Register partnership" : "Register"}</button></form>${own ? button(cancelLabel, "cancel", "text-button danger") : ""}`;
    return `<div class="dance-date-header"><div class="selected-date-number" aria-hidden="true"><span>${dateLabel(game.date,{month:"short"})}</span><strong>${Number(game.date.slice(-2))}</strong></div><div><p class="eyebrow">Dance card</p><h2>${esc(game.name || dateLabel(game.date, { weekday: "long", month: "long", day: "numeric" }))}</h2>${game.name ? `<p class="muted game-date-label">${dateLabel(game.date, { weekday: "long", month: "long", day: "numeric" })}</p>` : ""}<p class="muted">${timeLabel(game.time)} · Pacific time</p>${state.user.role === "admin" && !closed ? `<div class="game-admin-actions">${button("Edit game", "edit-game", "text-button")}${button("Delete game", "delete-game", "text-button danger")}</div>` : ""}</div></div>
      ${game.event_type === "teams" ? '<p class="team-intro"><strong>Team event</strong> · Register as a pair, then join another pair to make a team of four.</p>' : ""}
      <div class="registration-area">${registration}</div>${game.event_type === "teams" ? teamCard(game, own, pairs, name, closed) : `<div class="pair-heading"><h3>Registered pairs</h3><span>${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"}</span></div>
      ${pairs.length ? `<ol class="pairs">${pairs.map(e => `<li><span>${esc(e.name)}</span><span>${esc(name(e.partner_id))}</span></li>`).join("")}</ol>` : '<p class="empty-copy">No pairs yet. There’s a place for you.</p>'}`}
      ${singles.length ? `<div class="waiting"><h3>Looking for a partner</h3>${singles.map(e => `<p>${esc(e.name)}${e.member_id === schedulingMember().id ? acting ? " (selected member)" : " (you)" : ""}</p>`).join("")}</div>` : ""}
      ${standbyMembers.length ? `<div class="waiting"><h3>Standby</h3>${standbyMembers.map(e => `<p>${esc(e.name)}${e.member_id === schedulingMember().id ? acting ? " (selected member)" : " (you)" : ""}</p>`).join("")}</div>` : ""}
      ${unavailableMembers.length ? `<div class="waiting"><h3>Unavailable</h3>${unavailableMembers.map(e => `<p>${esc(e.name)}${e.member_id === schedulingMember().id ? acting ? " (selected member)" : " (you)" : ""}</p>`).join("")}</div>` : ""}`;
  }
  function teamCard(game, own, pairs, name, closed) {
    const teams = (state.calendar.teams || []).filter(team => team.game_id === game.id);
    const occupied = new Set(teams.flatMap(team => team.memberIds));
    const mine = teams.find(team => team.memberIds.includes(schedulingMember().id));
    const waiting = pairs.filter(pair => !occupied.has(pair.member_id));
    const available = waiting.filter(pair => pair.member_id !== schedulingMember().id && pair.partner_id !== schedulingMember().id);
    const label = pair => `${name(pair.member_id)} + ${name(pair.partner_id)}`;
    const ownType = own ? partnerWildcardType(own.partner_id) : null;
    const complete = !!own?.partner_id && ownType !== "unavailable" && ownType !== "standby";
    let controls = "";
    if (!closed) {
      if (mine) controls = `<div class="your-registration team-status"><p class="eyebrow">${actingForMember() ? `${esc(schedulingMember().name)}’s team is complete` : "Your team is complete"}</p><p>Both pairs are registered together.</p>${button("Leave team", "leave-team", "text-button danger")}</div>`;
      else if (complete && available.length) controls = `<form id="team-form" data-game="${game.id}" data-own-partner="${own.partner_id}" class="team-form"><label>Choose another pair<select name="pair" aria-label="Choose another pair" required><option value="">Select an available pair</option>${available.map(pair => `<option value="${pair.member_id}:${pair.partner_id}">${esc(label(pair))}</option>`).join("")}</select></label><p class="small-note">Forms the team immediately for all four players. No acceptance is required.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Form team</button></form>`;
      else controls = `<p class="team-help">${complete ? "This pair is registered. No other pair is available yet; check back to form a team." : ownType ? "Unavailable and standby members cannot form teams." : "Register with a partner first. Then either player can combine with another registered pair."}</p>`;
    }
    return `${controls}<div class="pair-heading"><h3>Registered teams</h3><span>${teams.length} ${teams.length === 1 ? "team" : "teams"}</span></div>
      ${teams.length ? `<ol class="team-list">${teams.map((team, index) => `<li class="team-item ${team.id === mine?.id ? "own-team" : ""}"><div class="team-label">Team ${index + 1}${team.id === mine?.id ? `<span>${actingForMember() ? "Selected member’s team" : "Your team"}</span>` : ""}</div>${pairs.filter(pair => team.memberIds.includes(pair.member_id)).map(pair => `<p>${esc(label(pair))}</p>`).join("")}</li>`).join("")}</ol>` : '<p class="empty-copy">No complete teams yet.</p>'}
      <div class="pair-heading"><h3>Pairs seeking teammates</h3><span>${waiting.length}</span></div>
      ${waiting.length ? `<ol class="pairs">${waiting.map(pair => `<li><span>${esc(name(pair.member_id))}</span><span>${esc(name(pair.partner_id))}</span></li>`).join("")}</ol>` : '<p class="empty-copy">No pairs waiting for teammates.</p>'}`;
  }
  async function chooseDeactivation() {
    const userId = state.user?.id;
    const result = await api("/members/manage");
    if (state.user?.id !== userId) return;
    const admins = result.members.filter(member => member.active && member.role === "admin").length;
    openDialog("Deactivate a member", `<p>Select an account to review before making any changes. This does not delete past game records.</p>
      <form id="deactivate-select-form"><label>Member<select name="memberId" aria-label="Member to deactivate" required><option value="">Choose a member</option>${result.members.map(member => {
        const last = member.active && member.role === "admin" && admins === 1;
        const suffix = !member.active ? " (inactive)" : last ? " (last active administrator)" : member.role === "admin" ? " (administrator)" : "";
        return `<option value="${member.id}" ${!member.active || last ? "disabled" : ""}>${esc(member.name)} · ${esc(member.email)}${esc(suffix)}${member.id === userId ? " (you)" : ""}</option>`;
      }).join("")}</select></label><p class="small-note">Inactive accounts and the last active administrator cannot be selected.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Review deactivation</button>${button("Cancel", "close-dialog", "quiet wide")}</form>`);
    dialog.querySelector('[name="memberId"]').focus();
  }
  async function reviewDeactivation(id) {
    const userId = state.user?.id;
    const plan = await api(`/members/${id}/deactivate`);
    if (state.user?.id !== userId) return;
    const self = plan.member.id === userId;
    openDialog("Confirm deactivation", `<div class="deactivate-summary"><p><strong>${esc(plan.member.name)}</strong></p><p>${esc(plan.member.email)}</p></div>
      ${plan.member.active ? `<p>${plan.isWildcard ? "This is a shared placeholder account. Deactivating it removes its future assignments; affected members remain registered as singles." : "This will block sign-in, sign the member out on every device and remove them from available-partner lists."}</p>
      <ul class="deactivate-effects">${plan.isWildcard ? `<li>Remove <strong>${plan.assignmentCount}</strong> future assignment${plan.assignmentCount === 1 ? "" : "s"} across <strong>${plan.affectedGames}</strong> game${plan.affectedGames === 1 ? "" : "s"}.</li><li>Keep affected members registered as singles.</li><li>Preserve the account and all registrations before today.</li>` : `<li>Cancel <strong>${plan.registrationCount}</strong> registration${plan.registrationCount === 1 ? "" : "s"} for today or later (${esc(plan.today)}, Pacific time).</li><li>Dissolve <strong>${plan.teamCount}</strong> affected team${plan.teamCount === 1 ? "" : "s"}.</li><li>Keep former partners registered as singles and unaffected pairs together.</li><li>Preserve the account and all registrations before today.</li>`}</ul>
      ${self ? '<p class="form-error">You are deactivating your own account. You will be signed out and cannot sign in again.</p>' : ""}` : '<p>This account is already inactive. No further changes will be made.</p>'}
      ${!plan.canDeactivate && plan.member.active ? '<p class="form-error">The last active administrator cannot be deactivated.</p>' : ""}
      <form id="deactivate-confirm-form" data-member="${plan.member.id}" data-revision="${plan.revision}"><p class="form-error" role="alert"></p><button type="submit" class="danger-primary wide" ${!plan.canDeactivate ? "disabled" : ""}>Deactivate member</button>${button("Cancel", "close-dialog", "quiet wide")}</form>`);
    // Default keyboard focus to the non-destructive choice, never confirmation.
    dialog.querySelector('#deactivate-confirm-form [data-action="close-dialog"]').focus();
  }
  function openDialog(title, content) {
    dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2>${button("×", "close-dialog", "close-button")}</div>${content}`;
    dialog.querySelector(".close-button").setAttribute("aria-label", "Close dialog");
    dialog.showModal();
  }
  async function manageGame(mode) {
    const selected = state.calendar.games.find(game => game.date === state.selected);
    if (!selected || state.user.role !== "admin") return;
    const token = state.token, generation = state.generation;
    const plan = await api(`/games/${selected.id}/manage`);
    if (state.token !== token || state.generation !== generation || state.selected !== selected.date) return;
    const game = plan.game;
    const summary = `<div class="game-summary"><p><strong>${esc(game.name || "Unnamed game")}</strong></p><p>${dateLabel(game.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · ${timeLabel(game.time)} Pacific</p><p>${game.event_type === "teams" ? "Teams" : "Pairs"} · ${plan.registrationCount} registered member${plan.registrationCount === 1 ? "" : "s"} · ${plan.teamCount} team${plan.teamCount === 1 ? "" : "s"}</p></div>`;
    const attrs = `data-game="${game.id}" data-revision="${esc(plan.revision)}"`;
    if (mode === "delete-game") {
      openDialog("Delete this game?", `${summary}<p>This permanently deletes this game and all its registrations and teams. Member accounts and other games will not change. This cannot be undone.</p><p class="small-note">Previously imported calendar files will not update automatically.</p><form id="delete-game-form" ${attrs}><p class="form-error" role="alert"></p><button type="submit" class="danger-primary wide">Delete game</button>${button("Cancel", "close-dialog", "quiet wide")}</form>`);
      dialog.querySelector('#delete-game-form [data-action="close-dialog"]').focus();
    } else {
      openDialog("Edit game", `${summary}<form id="edit-game-form" ${attrs}><label>Game name (optional)<input name="name" value="${esc(game.name)}" maxlength="80" autocomplete="off"></label><label>Date<input name="date" type="date" value="${game.date}" min="${state.calendar.today}" required></label><label>Start time (Pacific)<input name="time" type="time" value="${game.time}" required></label><p class="small-note">Registrations, partnerships and teams stay with this game. Event type is fixed. Let registered players know about schedule changes; imported calendar files will not update automatically.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Save changes</button>${button("Cancel", "close-dialog", "quiet wide")}</form>`);
    }
  }
  async function enter(result) {
    state.token = result.token; state.user = result.member; state.calendar = null; state.selected = null; state.month = null; state.showWildcard = null; state.actingMemberId = null;
    if (location.hash === "#calendar") route(); else location.hash = "#calendar";
  }
  document.addEventListener("change", event => {
    const actingSelect = event.target.closest('select[data-acting="member"]');
    if (actingSelect) {
      if (state.schedulingPending || dialog.open || document.querySelector("#calendar-content")?.getAttribute?.("aria-busy") === "true") { actingSelect.value = state.actingMemberId || ""; return; }
      state.actingMemberId = actingSelect.value ? Number(actingSelect.value) : null;
      state.showWildcard = null; state.generation++;
      drawCalendar(); return;
    }
    const select = event.target.closest('select[data-show="wildcard"]');
    if (!select) return;
    if (document.querySelector("#calendar-content")?.getAttribute?.("aria-busy") === "true") { select.value = state.showWildcard || ""; return; }
    state.showWildcard = select.value ? Number(select.value) : null;
    drawCalendar();
  });
  document.addEventListener("click", async (event) => {
    if (state.schedulingPending) { event.preventDefault(); return; }
    const date = event.target.closest("[data-date]");
    if (date) {
      if (document.querySelector("#calendar-content")?.getAttribute?.("aria-busy") === "true") return;
      state.selected = date.dataset.date; drawCalendar();
      if (matchMedia("(max-width: 800px)").matches) {
        const panel = app.querySelector(".dance-card");
        panel.focus({ preventScroll: true });
        panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      } else app.querySelector(`.calendar-grid [data-date="${state.selected}"]`).focus({ preventScroll: true });
      return;
    }
    const control = event.target.closest("[data-action]");
    if (!control || control.disabled) return;
    const action = control.dataset.action;
    try {
      if (["home", "about", "login"].includes(action)) { location.hash = `#${action}`; return; }
      if (action === "install-app") {
        openDialog("Add CABC to your iPhone", `<ol class="install-steps"><li>Open the club website in <strong>Safari</strong> on your iPhone.</li><li>Open <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>. You may need to scroll through the actions.</li><li>If offered, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li></ol><p class="small-note">Use the new CABC Calendar icon to open the calendar. Sign in when asked. An internet connection is required; registrations are never queued offline. A fresh launch may require signing in again.</p>${button("Done", "close-dialog", "primary wide")}`);
        return;
      }
      if (action === "close-dialog") {
        if (dialog.dataset.passwordPending === "true" || dialog.dataset.memberPending === "true" || dialog.dataset.gamePending === "true" || state.schedulingPending) return;
        dialog.close(); return;
      }
      if (action.startsWith("preview-")) {
        control.disabled = true; await enter(await api("/preview", "POST", { role: action === "preview-admin" ? "admin" : "member" })); return;
      }
      if (action === "logout") {
        try { await api("/logout", "POST", {}); }
        finally { state.token = null; state.user = null; state.calendar = null; state.showWildcard = null; state.actingMemberId = null; location.hash = "#login"; }
        return;
      }
      if (action === "export-games") {
        const token = state.token;
        if (!token) return;
        control.disabled = true; control.textContent = "Exporting…";
        try {
          const file = await api("/calendar/export.ics", "GET", undefined, "blob");
          if (state.token !== token) return; // Do not download after a logout/account change.
          const url = URL.createObjectURL(file);
          const link = document.createElement("a");
          link.href = url; link.download = "cabc-my-games.ics";
          document.body.append(link); link.click(); link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          toast("Calendar file downloaded. Imported games will not update automatically.");
        } finally { control.textContent = "Export my games"; }
        return;
      }
      if (action === "email-settings") {
        const token = state.token, result = await api("/email/preferences");
        if (state.token !== token) return;
        openDialog("Email notifications", `<form id="email-preferences-form"><p>These preferences belong to your signed-in account, ${esc(state.user.name)}, even when acting for another member.</p>
          <label>Registration and cancellation emails<select name="enabled" aria-label="Registration and cancellation emails"><option value="true"${result.enabled ? " selected" : ""}>On (default)</option><option value="false"${result.enabled ? "" : " selected"}>Off</option></select></label>
          <p class="small-note">Includes partner registrations, cancellations and cancelled games. Turning emails off does not change registrations. Messages already being delivered may still arrive.</p>
          <p class="form-error" role="alert"></p><button type="submit" class="primary wide">Save email preferences</button>${button("Cancel", "close-dialog", "quiet wide")}</form>`);
        return;
      }
      if (action === "change-password") {
        if (!state.user) return;
        openDialog("Change password", `<form id="password-form">
          <p class="small-note" id="password-help">Use 12 to 128 characters. After changing your password, you’ll be signed out on all devices, including this one.</p>
          <label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label>
          <label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128" aria-describedby="password-help"></label>
          <label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label>
          <p class="form-error" role="alert"></p>
          <button type="submit" class="primary wide">Update password</button>
          ${button("Cancel", "close-dialog", "quiet wide")}
        </form>`);
        dialog.querySelector('[name="currentPassword"]').focus();
      }
      if (["previous", "next", "today", "retry"].includes(action)) {
        if (action === "today") { state.month = null; state.selected = null; }
        if (action === "previous" || action === "next") {
          const months = state.calendar.months;
          const index = months.indexOf(state.month) + (action === "next" ? 1 : -1);
          if (!months[index]) return;
          state.month = months[index]; state.selected = null;
        }
        await loadCalendar(); return;
      }
      if (action === "add-date") openDialog("Add a playing date", `<form id="date-form"><label>Game name (optional)<input name="name" maxlength="80" autocomplete="off" placeholder="For example, Monday Duplicate"></label><label>Event type<select name="eventType" aria-label="Event type"><option value="pairs">Pairs</option><option value="teams">Teams (two pairs)</option></select></label><label>Date<input name="date" type="date" min="${state.config.today}" value="${defaultGameDate()}" required></label><label>Start time (Pacific)<input name="time" type="time" value="11:30" required></label><p class="small-note">Event type is fixed when the date is created.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Add date</button></form>`);
      if (action === "edit-game" || action === "delete-game") {
        control.disabled = true;
        try { await manageGame(action); } finally { if (control.isConnected) control.disabled = false; }
      }
      if (action === "add-member") openDialog("Add a member", `<form id="member-form"><label>Full name<input name="name" required minlength="2" maxlength="80" autocomplete="off"></label><label>Email<input name="email" type="email" required maxlength="180" autocomplete="off"></label><label>Initial password<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="small-note">Use at least 12 characters. Share the credentials privately with the member.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Create member</button></form>`);
      if (action === "deactivate-member") { control.disabled = true; await chooseDeactivation(); }
      if (action === "acting-reset") {
        if (state.schedulingPending || dialog.open || document.querySelector("#calendar-content")?.getAttribute?.("aria-busy") === "true") return;
        state.actingMemberId = null; state.showWildcard = null; state.generation++; drawCalendar(); return;
      }
      if (action === "wildcard-jump") {
        const jump = control.dataset.jump;
        state.month = jump.slice(0, 7); state.selected = jump;
        await loadCalendar();
        if (matchMedia("(max-width: 800px)").matches) {
          const panel = app.querySelector(".dance-card");
          panel.focus({ preventScroll: true });
          panel.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
        } else app.querySelector(`.calendar-grid [data-date="${state.selected}"]`).focus({ preventScroll: true });
        return;
      }
      if (action === "cancel") {
        const game = state.calendar.games.find(g => g.date === state.selected);
        const own = state.calendar.entries.find(e => e.game_id === game.id && e.member_id === schedulingMember().id);
        const teamed = (state.calendar.teams || []).some(team => team.game_id === game.id && team.memberIds.includes(schedulingMember().id));
        const partnerNote = own?.partner_id && !partnerWildcardType(own.partner_id) ? " The partner will remain registered and be listed as looking for a partner." : "";
        openDialog(actingForMember() ? `Cancel registration for ${esc(schedulingMember().name)}?` : "Cancel your registration?", `<p>${actingForMember() ? esc(schedulingMember().name) : "You"} will be removed from the game on ${dateLabel(game.date)}.${partnerNote}${teamed ? " The team will dissolve. The other pair will stay registered together and become available for another team." : ""}</p><form id="cancel-form" data-game="${game.id}"><p class="form-error" role="alert"></p><button type="submit" class="primary wide">${actingForMember() ? "Yes, cancel this registration" : "Yes, cancel my registration"}</button>${button("Keep registration", "close-dialog", "quiet wide")}</form>`);
        dialog.querySelector('[data-action="close-dialog"].wide').focus();
      }
      if (action === "leave-team") {
        const game = state.calendar.games.find(g => g.date === state.selected);
        const team = state.calendar.teams.find(t => t.game_id === game.id && t.memberIds.includes(schedulingMember().id));
        if (!team) return;
        openDialog(actingForMember() ? `Dissolve ${esc(schedulingMember().name)}’s team?` : "Leave your team?", `<p>This dissolves the team. Both pairs will remain registered and become available to form new teams.</p><form id="leave-team-form" data-game="${game.id}" data-team="${esc(team.id)}"><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Yes, leave team</button>${button("Keep team", "close-dialog", "quiet wide")}</form>`);
        dialog.querySelector('[data-action="close-dialog"].wide').focus();
      }
    } catch (error) { toast(error.message); }
    finally { if (control.isConnected) control.disabled = false; }
  });
  document.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.target, submit = form.querySelector('[type="submit"]');
    if (!submit || submit.disabled) return;
    if (state.schedulingPending) return;
    const fields = Object.fromEntries(new FormData(form)); const error = form.querySelector(".form-error");
    if (error) error.textContent = "";
    submit.disabled = true;
    const scheduling = ["register-form", "cancel-form", "team-form", "leave-team-form"].includes(form.id);
    const actingName = actingForMember() ? schedulingMember().name : null;
    if (scheduling) {
      state.schedulingPending = true;
      app.querySelectorAll('[data-acting], [data-action="acting-reset"]').forEach(control => { control.disabled = true; });
      if (dialog.open) dialog.querySelectorAll('[data-action="close-dialog"]').forEach(control => { control.disabled = true; });
    }
    try {
      if (form.id === "login-form") { await enter(await api("/login", "POST", fields)); return; }
      if (form.id === "email-preferences-form") {
        dialog.dataset.memberPending = "true";
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = true; });
        await api("/email/preferences", "PATCH", { enabled: fields.enabled === "true" });
        dialog.close(); toast(fields.enabled === "true" ? "Email notifications are on." : "Email notifications are off.");
        return;
      }
      if (form.id === "email-opt-out-form") {
        await api("/email/opt-out", "POST", { token: form.dataset.token });
        location.hash = "#email-opted-out";
        return;
      }
      if (form.id === "password-form") {
        if (fields.newPassword !== fields.confirmPassword) throw new Error("The new passwords do not match.");
        if (fields.newPassword === fields.currentPassword) throw new Error("Choose a new password different from your current password.");
        dialog.dataset.passwordPending = "true";
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = true; });
        submit.textContent = "Updating…";
        await api("/password", "POST", fields);
        form.reset();
        dialog.close();
        state.token = null; state.user = null; state.calendar = null;
        state.month = null; state.selected = null; state.generation++;
        clearTimeout(toastTimer);
        document.querySelector("#toast").classList.remove("visible");
        document.querySelector("#toast").textContent = "";
        state.loginNotice = "Password changed. Please sign in with your new password.";
        location.hash = "#login";
        return;
      }
      if (form.id === "register-form") {
        if (!fields.partner && state.calendar.entries.some(e => e.game_id === Number(form.dataset.game) && e.member_id === schedulingMember().id))
          throw new Error("Choose a partner, or leave your existing registration as it is.");
        await api(`/games/${form.dataset.game}/entry`, "POST", { partnerId: fields.partner ? Number(fields.partner) : null, ...schedulingFields(form.dataset.game) });
        await loadCalendar();
        if (actingName) toast(`Registration saved for ${actingName}.`);
        else if (fields.partner && partnerWildcardType(Number(fields.partner)) === "guest") toast("You’re playing with a guest.");
        else if (fields.partner && partnerWildcardType(Number(fields.partner)) === "standby") toast("You’re on standby for this game.");
        else if (fields.partner && partnerWildcardType(Number(fields.partner)) === "unavailable") toast("You’re marked unavailable for this game.");
        else toast(fields.partner ? "Partnership registered for both players." : "You’re registered and looking for a partner.");
      }
      if (form.id === "cancel-form") { await api(`/games/${form.dataset.game}/entry`, "DELETE", schedulingFields(form.dataset.game)); dialog.close(); await loadCalendar(); toast(actingName ? `Registration cancelled for ${actingName}.` : "Your registration has been cancelled."); }
      if (form.id === "team-form") {
        const [pairMemberId, pairPartnerId] = fields.pair.split(":").map(Number);
        await api(`/games/${form.dataset.game}/team`, "POST", { pairMemberId, pairPartnerId, ownPartnerId: Number(form.dataset.ownPartner), ...schedulingFields(form.dataset.game) });
        await loadCalendar(); toast("Team formed. All four players are registered together.");
      }
      if (form.id === "leave-team-form") {
        await api(`/games/${form.dataset.game}/team`, "DELETE", { teamId: form.dataset.team, ...schedulingFields(form.dataset.game) });
        dialog.close(); await loadCalendar(); toast("Team dissolved. Both pairs remain registered.");
      }
      if (form.id === "date-form") { const result = await api("/games", "POST", fields); dialog.close(); state.month = result.date.slice(0, 7); state.selected = result.date; await loadCalendar(); toast("Playing date added."); }
      if (form.id === "edit-game-form" || form.id === "delete-game-form") {
        dialog.dataset.gamePending = "true";
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = true; });
        const deleting = form.id === "delete-game-form";
        submit.textContent = deleting ? "Deleting…" : "Saving…";
        const result = await api(`/games/${form.dataset.game}/manage`, deleting ? "DELETE" : "PATCH",
          { ...fields, revision: form.dataset.revision, ...(deleting ? { confirm: true } : {}) });
        dialog.close();
        state.showWildcard = null;
        if (!deleting) { state.month = result.date.slice(0, 7); state.selected = result.date; }
        else state.selected = null;
        await loadCalendar();
        toast(deleting ? "Game deleted, including its registrations and teams." : "Game saved. Registrations and teams have been preserved.");
      }
      if (form.id === "member-form") { await api("/members", "POST", fields); dialog.close(); await loadCalendar(); toast("Member created. Share their credentials privately."); }
      if (form.id === "deactivate-select-form") await reviewDeactivation(Number(fields.memberId));
      if (form.id === "deactivate-confirm-form") {
        dialog.dataset.memberPending = "true";
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = true; });
        submit.textContent = "Deactivating…";
        const result = await api(`/members/${form.dataset.member}/deactivate`, "POST", { confirm: true, revision: form.dataset.revision });
        dialog.close();
        if (result.self) {
          state.token = null; state.user = null; state.calendar = null;
          state.loginNotice = "Your account has been deactivated. Contact another club administrator if you need assistance.";
          location.hash = "#login";
        } else {
          await loadCalendar();
          toast(result.alreadyInactive ? "This member was already inactive." : "Member deactivated. Past game records have been preserved.");
        }
      }
    } catch (err) {
      if (scheduling) {
        // Refresh stale availability after a conflict instead of leaving invalid options.
        if (dialog.open) dialog.close();
        if (state.user) await loadCalendar();
        toast(err.message);
      } else if (form.id === "deactivate-confirm-form" && state.user) {
        try { await reviewDeactivation(Number(form.dataset.member)); }
        catch (refreshError) {
          if (dialog.open) dialog.close();
          toast(refreshError.message);
          return;
        }
        const currentError = dialog.querySelector("#deactivate-confirm-form .form-error");
        if (currentError) currentError.textContent = err.message;
        else toast(err.message);
      } else if (error?.isConnected) error.textContent = err.message; else toast(err.message);
    }
    finally {
      if (scheduling) {
        state.schedulingPending = false;
        app.querySelectorAll('[data-acting], [data-action="acting-reset"]').forEach(control => { control.disabled = false; });
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(control => { control.disabled = false; });
      }
      if (form.id === "edit-game-form" || form.id === "delete-game-form") {
        delete dialog.dataset.gamePending;
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = false; });
        if (submit.isConnected) submit.textContent = form.id === "delete-game-form" ? "Delete game" : "Save changes";
      }
      if (form.id === "deactivate-confirm-form" || form.id === "email-preferences-form") {
        delete dialog.dataset.memberPending;
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = false; });
        if (submit.isConnected) submit.textContent = form.id === "email-preferences-form" ? "Save email preferences" : "Deactivate member";
      }
      if (form.id === "password-form") {
        delete dialog.dataset.passwordPending;
        dialog.querySelectorAll('[data-action="close-dialog"]').forEach(button => { button.disabled = false; });
        if (submit.isConnected) submit.textContent = "Update password";
      }
      if (submit.isConnected) submit.disabled = false;
    }
  });
  window.addEventListener("hashchange", route);
  function refreshVisibleCalendar() {
    if (!document.hidden && state.user && location.hash === "#calendar" &&
        !dialog.open && !state.schedulingPending) loadCalendar();
  }
  document.addEventListener("visibilitychange", refreshVisibleCalendar);
  window.addEventListener("online", refreshVisibleCalendar);
  window.addEventListener("pageshow", event => { if (event.persisted) refreshVisibleCalendar(); });
  route();
})();
