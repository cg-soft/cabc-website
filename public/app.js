(() => {
  const app = document.querySelector("#app"), dialog = document.querySelector("#dialog");
  const state = { token: null, user: null, config: null, month: null, selected: null, calendar: null, generation: 0 };
  dialog.addEventListener("close", () => { if (!dialog.open) dialog.replaceChildren(); });
  let slideTimer, toastTimer, slide = 0, paused = false;
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dateLabel = (value, options = { month: "long", day: "numeric" }) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  const timeLabel = (value) => { const [h, m] = value.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
  const brand = '<span class="brand">Chinese American<br>Bridge Club</span>';
  const button = (label, action, cls = "") => `<button type="button" class="${cls}" data-action="${action}">${label}</button>`;
  function toast(message) {
    clearTimeout(toastTimer); const el = document.querySelector("#toast");
    el.textContent = message; el.classList.add("visible");
    toastTimer = setTimeout(() => el.classList.remove("visible"), 5000);
  }
  async function api(route, method = "GET", body) {
    const response = await fetch(`${window.CABC_API || ""}/api${route}`, {
      method, credentials: "same-origin", headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
      }, body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401 && route !== "/login") {
        state.token = null; state.user = null; state.calendar = null;
        if (dialog.open) dialog.close();
        location.hash = "#login";
      }
      throw new Error(result.error || "Unable to complete that request.");
    }
    return result;
  }
  const header = (controls, home = false) => `<header class="site-header ${home ? "over-photo" : ""}">${brand}<nav aria-label="Main navigation">${controls}</nav></header>`;
  function route() {
    state.generation++;
    clearInterval(slideTimer);
    if (dialog.open) dialog.close();
    const screen = location.hash.slice(1) || "home";
    document.body.className = screen === "home" ? "home" : "";
    if (screen === "home") renderHome();
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
      `<main class="simple-page"><p class="eyebrow">Chinese American Bridge Club</p><h1>About the club</h1><p>We’re making a new home for our bridge community.</p><p class="muted">More about the club will be added here soon.</p><div class="small-note">The homepage currently uses illustrative photographs, not photographs of the club’s venue.</div></main>`;
  }
  function renderLogin() {
    document.title = "Login | Chinese American Bridge Club";
    app.innerHTML = header(button("Home", "home", "quiet")) + `
      <main class="login-layout"><div class="login-photo" role="img" aria-label="Illustrative green felt card table"></div>
      <section class="login-panel"><p class="eyebrow">Members & administrators</p><h1>Welcome back.</h1><p class="muted">Sign in to find your next game and partner.</p>
      <form id="login-form"><label>Email<input name="email" type="email" autocomplete="username" required maxlength="180"></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="128"></label>
      <p class="form-error" role="alert"></p><button class="primary wide" type="submit">Login</button></form>
      <p class="small-note">Need an account or a password reset? Contact your club administrator.</p>
      <div id="preview-access"></div></section></main>`;
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
    return header(`<span class="identity">${esc(state.user.name)}</span>${button("Home", "home", "quiet")}${button("Log out", "logout", "quiet")}`) +
      `<main class="calendar-page"><div class="calendar-heading"><div><p class="eyebrow">Members’ calendar</p><h1>Playing dates</h1></div>
      ${state.user.role === "admin" ? `<div class="admin-actions">${button("Add member", "add-member", "quiet")}${button("+ Add date", "add-date", "primary")}</div>` : ""}</div>
      ${state.config?.preview ? '<p class="preview-line">Private preview · fictional members and sample dates</p>' : ""}
      <div id="calendar-content" aria-busy="true"><div class="loading-surface">Loading the calendar…</div></div></main>`;
  }
  async function renderCalendar() {
    document.title = "Playing dates | Chinese American Bridge Club";
    state.month = null; state.selected = null;
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
      state.month = response.month;
      state.config.today = response.today;
      if (!response.games.some(g => g.date === state.selected))
        state.selected = response.games.find(g => g.date >= response.today)?.date || response.games[0]?.date || null;
      drawCalendar();
    } catch (error) {
      if (container.isConnected) container.innerHTML = `<div class="loading-surface"><p role="alert">${esc(error.message)}</p>${button("Try again", "retry", "quiet")}</div>`;
    } finally { if (container.isConnected) container.setAttribute("aria-busy", "false"); }
  }
  function drawCalendar() {
    const { games, entries, today } = state.calendar;
    if (!state.calendar.months.length) {
      document.querySelector("#calendar-content").innerHTML = `<section class="no-games"><p class="eyebrow">Members’ calendar</p><h2>No upcoming games</h2><p>There are no games scheduled for today or later.</p><p class="muted">${state.user.role === "admin" ? "Use Add date to schedule the next game." : "Please check back when the club adds more playing dates."}</p></section>`;
      return;
    }
    const [year, month] = state.month.split("-").map(Number);
    const start = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < Math.ceil((start + days) / 7) * 7; i++) {
      const day = i - start + 1;
      if (day < 1 || day > days) { cells.push('<div class="day empty" aria-hidden="true"></div>'); continue; }
      const date = `${state.month}-${String(day).padStart(2, "0")}`;
      const game = games.find(g => g.date === date);
      const own = game && entries.find(e => e.game_id === game.id && e.member_id === state.user.id);
      const count = game ? entries.filter(e => e.game_id === game.id && e.partner_id).length / 2 : 0;
      const label = `<span class="day-number ${date === today ? "today-number" : ""}">${day}</span>`;
      cells.push(game ? `<button class="day playing ${state.selected === date ? "selected" : ""} ${date < today ? "past" : ""}" data-date="${date}" aria-pressed="${state.selected === date}" aria-label="${game.name ? `${esc(game.name)}, ` : ""}${esc(dateLabel(date, { weekday: "long", month: "long", day: "numeric" }))}, ${timeLabel(game.time)}, ${count} pairs${own ? ", registered" : ""}">
        <span class="day-top">${label}${own ? '<span class="registration-mark" aria-label="Registered">✓</span>' : ""}</span>${game.name ? `<span class="game-name">${esc(game.name)}</span>` : ""}<span class="game-time">${timeLabel(game.time)}</span><span class="game-meta">${count} ${count === 1 ? "pair" : "pairs"}</span></button>` :
        `<div class="day">${label}</div>`);
    }
    const agenda = games.map(game => {
      const own = entries.find(e => e.game_id === game.id && e.member_id === state.user.id);
      const count = entries.filter(e => e.game_id === game.id && e.partner_id).length / 2;
      const partner = state.calendar.members.find(m => m.id === own?.partner_id);
      const status = own ? (partner ? `With ${partner.name}` : "Registered · partner needed") :
        game.date < today ? "Registration closed" : "Choose your partner";
      return `<button class="agenda-date ${game.date === state.selected ? "selected" : ""} ${game.date < today ? "past" : ""}" data-date="${game.date}" aria-pressed="${game.date === state.selected}" aria-label="${game.name ? `${esc(game.name)}, ` : ""}${esc(dateLabel(game.date, {weekday:"long",month:"long",day:"numeric"}))}, ${timeLabel(game.time)}, ${count} ${count === 1 ? "pair" : "pairs"}, ${esc(status)}">
        <span class="agenda-number"><span>${dateLabel(game.date,{month:"short"})}</span><strong>${Number(game.date.slice(-2))}</strong></span>
        <span class="agenda-copy"><strong>${esc(game.name || dateLabel(game.date,{weekday:"long"}))}</strong><span>${game.name ? `${dateLabel(game.date,{weekday:"short"})} · ` : ""}${timeLabel(game.time)} <span aria-hidden="true">·</span> ${count} ${count === 1 ? "pair" : "pairs"}</span><span class="agenda-status">${esc(status)}</span></span>
        <span class="agenda-indicator" aria-hidden="true">${own ? "✓" : "›"}</span></button>`;
    }).join("");
    document.querySelector("#calendar-content").innerHTML = `<div class="calendar-layout"><section class="calendar" aria-label="Playing dates calendar">
      <div class="month-nav"><div class="month-title"><h2>${dateLabel(`${state.month}-01`, { month: "long", year: "numeric" })}</h2><p>${games.length} playing ${games.length === 1 ? "date" : "dates"} · Pacific time</p></div><div class="month-controls">${button("‹", "previous", "icon-button")}${button("Upcoming", "today", "quiet compact")}${button("›", "next", "icon-button")}</div></div>
      <div class="weekdays" aria-hidden="true">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d => `<span>${d}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.join("")}</div>
      <div class="playing-agenda">${agenda}</div>
      <p class="calendar-note"><span class="legend-square"></span>Playing date <span class="legend-check">✓</span>Your registration</p>
      </section><aside class="dance-card" aria-label="Dance card" tabindex="-1">${danceCard()}</aside></div>`;
    app.querySelector('[data-action="previous"]').setAttribute("aria-label", "Previous month");
    app.querySelector('[data-action="next"]').setAttribute("aria-label", "Next month");
    app.querySelector('[data-action="previous"]').disabled = state.calendar.months.indexOf(state.month) <= 0;
    app.querySelector('[data-action="next"]').disabled = state.calendar.months.indexOf(state.month) === state.calendar.months.length - 1;
  }
  function danceCard() {
    const { games, entries, members, today } = state.calendar;
    const game = games.find(g => g.date === state.selected);
    if (!game) return '<p class="muted">Select a playing date to see its dance card.</p>';
    const list = entries.filter(e => e.game_id === game.id);
    const own = list.find(e => e.member_id === state.user.id);
    const pairs = list.filter(e => e.partner_id && e.member_id < e.partner_id);
    const singles = list.filter(e => !e.partner_id);
    const name = id => members.find(m => m.id === id)?.name || "Member";
    const available = members.filter(m => m.id !== state.user.id && !list.find(e => e.member_id === m.id)?.partner_id);
    const closed = game.date < today;
    let registration = "";
    if (closed) registration = '<p class="closed-note">Registration for this date is closed.</p>';
    else if (own?.partner_id) registration = `<div class="your-registration"><p class="eyebrow">Your partnership</p><strong>${esc(name(own.partner_id))}</strong><p>You’re both registered.</p>${button("Cancel my registration", "cancel", "text-button danger")}</div>`;
    else registration = `<form id="register-form" data-game="${game.id}"><label>${own ? "You’re registered. Add a partner?" : "Join this game"}<select name="partner" aria-label="Choose a partner">
      <option value="">${own ? "Choose an available member" : "I’m looking for a partner"}</option>${available.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join("")}
      </select></label><p class="small-note">Choosing a partner registers both of you.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">${own ? "Register partnership" : "Register"}</button></form>${own ? button("Cancel my registration", "cancel", "text-button danger") : ""}`;
    return `<div class="dance-date-header"><div class="selected-date-number" aria-hidden="true"><span>${dateLabel(game.date,{month:"short"})}</span><strong>${Number(game.date.slice(-2))}</strong></div><div><p class="eyebrow">Dance card</p><h2>${esc(game.name || dateLabel(game.date, { weekday: "long", month: "long", day: "numeric" }))}</h2>${game.name ? `<p class="muted game-date-label">${dateLabel(game.date, { weekday: "long", month: "long", day: "numeric" })}</p>` : ""}<p class="muted">${timeLabel(game.time)} · Pacific time</p>${state.user.role === "admin" && !closed ? button("Edit name", "edit-name", "text-button edit-name") : ""}</div></div>
      <div class="registration-area">${registration}</div><div class="pair-heading"><h3>Registered pairs</h3><span>${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"}</span></div>
      ${pairs.length ? `<ol class="pairs">${pairs.map(e => `<li><span>${esc(e.name)}</span><span>${esc(name(e.partner_id))}</span></li>`).join("")}</ol>` : '<p class="empty-copy">No pairs yet. There’s a place for you.</p>'}
      ${singles.length ? `<div class="waiting"><h3>Looking for a partner</h3>${singles.map(e => `<p>${esc(e.name)}${e.member_id === state.user.id ? " (you)" : ""}</p>`).join("")}</div>` : ""}`;
  }
  function openDialog(title, content) {
    dialog.innerHTML = `<div class="dialog-heading"><h2 id="dialog-title">${title}</h2>${button("×", "close-dialog", "close-button")}</div>${content}`;
    dialog.querySelector(".close-button").setAttribute("aria-label", "Close dialog");
    dialog.showModal();
  }
  async function enter(result) {
    state.token = result.token; state.user = result.member; state.calendar = null; state.selected = null; state.month = null;
    if (location.hash === "#calendar") route(); else location.hash = "#calendar";
  }
  document.addEventListener("click", async (event) => {
    const date = event.target.closest("[data-date]");
    if (date) {
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
      if (action === "close-dialog") { dialog.close(); return; }
      if (action.startsWith("preview-")) {
        control.disabled = true; await enter(await api("/preview", "POST", { role: action === "preview-admin" ? "admin" : "member" })); return;
      }
      if (action === "logout") {
        try { await api("/logout", "POST", {}); }
        finally { state.token = null; state.user = null; state.calendar = null; location.hash = "#login"; }
        return;
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
      if (action === "add-date") openDialog("Add a playing date", `<form id="date-form"><label>Game name (optional)<input name="name" maxlength="80" autocomplete="off" placeholder="For example, Monday Duplicate"></label><label>Date<input name="date" type="date" min="${state.config.today}" value="${state.config.today}" required></label><label>Start time (Pacific)<input name="time" type="time" value="11:30" required></label><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Add date</button></form>`);
      if (action === "edit-name") {
        const game = state.calendar.games.find(g => g.date === state.selected);
        openDialog("Edit game name", `<form id="name-form" data-game="${game.id}"><label>Game name (optional)<input name="name" value="${esc(game.name)}" maxlength="80" autocomplete="off"></label><p class="small-note">Changing the name keeps this date and all partnerships intact. Leave it blank to remove the name.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Save name</button></form>`);
      }
      if (action === "add-member") openDialog("Add a member", `<form id="member-form"><label>Full name<input name="name" required minlength="2" maxlength="80" autocomplete="off"></label><label>Email<input name="email" type="email" required maxlength="180" autocomplete="off"></label><label>Initial password<input name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></label><p class="small-note">Use at least 12 characters. Share the credentials privately with the member.</p><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Create member</button></form>`);
      if (action === "cancel") {
        const game = state.calendar.games.find(g => g.date === state.selected);
        const own = state.calendar.entries.find(e => e.game_id === game.id && e.member_id === state.user.id);
        openDialog("Cancel your registration?", `<p>You will be removed from the game on ${dateLabel(game.date)}.${own?.partner_id ? " Your partner will remain registered and be listed as looking for a partner." : ""}</p><form id="cancel-form" data-game="${game.id}"><p class="form-error" role="alert"></p><button type="submit" class="primary wide">Yes, cancel my registration</button></form>`);
      }
    } catch (error) { toast(error.message); }
    finally { if (control.isConnected) control.disabled = false; }
  });
  document.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.target, submit = form.querySelector('[type="submit"]');
    const fields = Object.fromEntries(new FormData(form)); const error = form.querySelector(".form-error");
    if (error) error.textContent = "";
    submit.disabled = true;
    try {
      if (form.id === "login-form") { await enter(await api("/login", "POST", fields)); return; }
      if (form.id === "register-form") {
        if (!fields.partner && state.calendar.entries.some(e => e.game_id === Number(form.dataset.game) && e.member_id === state.user.id))
          throw new Error("Choose a partner, or leave your existing registration as it is.");
        await api(`/games/${form.dataset.game}/entry`, "POST", { partnerId: fields.partner ? Number(fields.partner) : null });
        await loadCalendar(); toast(fields.partner ? "Partnership registered for both players." : "You’re registered and looking for a partner.");
      }
      if (form.id === "cancel-form") { await api(`/games/${form.dataset.game}/entry`, "DELETE", {}); dialog.close(); await loadCalendar(); toast("Your registration has been cancelled."); }
      if (form.id === "date-form") { const result = await api("/games", "POST", fields); dialog.close(); state.month = result.date.slice(0, 7); state.selected = result.date; await loadCalendar(); toast("Playing date added."); }
      if (form.id === "name-form") { await api(`/games/${form.dataset.game}/name`, "POST", fields); dialog.close(); await loadCalendar(); toast("Game name saved."); }
      if (form.id === "member-form") { await api("/members", "POST", fields); dialog.close(); await loadCalendar(); toast("Member created. Share their credentials privately."); }
    } catch (err) { if (error?.isConnected) error.textContent = err.message; else toast(err.message); }
    finally { if (submit.isConnected) submit.disabled = false; }
  });
  window.addEventListener("hashchange", route);
  route();
})();
