(function () {
  const REPO = "geek7coin/desk-data";
  const REF = "data";
  const PATH_KEY = "desk_data_path";
  const TOKEN_KEY = "desk_gh_token";
  const SEEN_KEY = "desk_stream_seen";
  const POLL_MS = 15000;
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const GROUP_ORDER = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
  const LAYER_NAMES = {
    1: "Mint authority", 2: "Freeze authority", 3: "Dev wallet", 4: "Top 10 holders",
    5: "Liquidity", 6: "Pool age", 7: "Bundled wallets", 8: "Delegations"
  };

  const qs = new URLSearchParams(location.search);
  const LOCAL = qs.get("src") === "local";
  const EMPTY = qs.get("empty") === "1";
  const SNAP_PREFIX = qs.get("pack") === "pos" ? "snap-pos/" : "snap/";

  const setup = document.getElementById("setup");
  const appEl = document.getElementById("app");
  const errorBanner = document.getElementById("errorBanner");
  const tokenInput = document.getElementById("tokenInput");
  const setupMsg = document.getElementById("setupMsg");
  const toastEl = document.getElementById("toast");

  let store = {
    state: null, charts: {}, activity: null, account: null, settings: null,
    stream: null, coins: {}, audits: {}, decisions: {}
  };
  let lastGood = null;
  let lastUpdate = null;
  let offline = false;
  let retryLeft = 0;
  let retryTimer = null;
  let pollTimer = null;
  let loaded = false;
  let failFetches = false;
  let chartRange = "LIVE";
  let route = { name: "home", mint: null };
  let prevTab = "home";
  let originTab = "home";
  let odoPrev = "";
  let lastPointN = 0;
  let markFade = 1;
  let slide = 1;
  let animTimer = null;
  let auditGen = 0;
  let reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", function (e) {
    reduced = e.matches;
  });

  function captureHash() {
    const raw = location.hash || "";
    const pathMatch = raw.match(/^#d=([A-Za-z0-9_-]+)$/);
    if (pathMatch) {
      localStorage.setItem(PATH_KEY, pathMatch[1]);
      history.replaceState(null, "", location.pathname + location.search);
      return;
    }
    const tMatch = raw.match(/^#t=([^&]+)$/);
    if (tMatch) {
      localStorage.setItem(TOKEN_KEY, decodeURIComponent(tMatch[1]));
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function dataPath() { return localStorage.getItem(PATH_KEY) || ""; }
  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }

  function isReduced() { return reduced; }

  async function getJson(relPath) {
    if (failFetches) throw new Error("data fetch failed");
    if (LOCAL) {
      const res = await fetch(SNAP_PREFIX + relPath + "?n=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("data fetch failed");
      return res.json();
    }
    const dp = dataPath();
    if (!dp) throw new Error("missing data path");
    const path = "d/" + dp + "/" + relPath;
    const url = "https://api.github.com/repos/" + REPO + "/contents/" + path + "?ref=" + REF;
    const headers = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const t = token();
    if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(url, { headers: headers, cache: "no-store" });
    if (res.status === 401 || res.status === 403) throw new Error("GitHub token needed or rate-limited");
    if (!res.ok) throw new Error("data fetch failed");
    const body = await res.json();
    const text = atob((body.content || "").replace(/\n/g, ""));
    return JSON.parse(text);
  }

  function applyCoinHref(a, coin) {
    if (!a || !coin) return;
    if (coin.url) a.setAttribute("href", coin.url);
    if (coin.coin_url) a.setAttribute("href", coin.coin_url);
    a.setAttribute("rel", "noopener noreferrer");
  }
  function applyProfileHref(profile, profileUrl) {
    if (profile && profileUrl) profile.setAttribute("href", profileUrl);
  }
  function applyItemHref(a, item) {
    if (a && item && item.url) a.setAttribute("href", item.url);
    if (a) a.setAttribute("rel", "noopener noreferrer");
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function money(n) {
    const x = Number(n);
    if (isNaN(x)) return "—";
    return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPrice(n) {
    if (n == null || n === "n/a") return "n/a";
    const x = Number(n);
    if (isNaN(x)) return "n/a";
    if (Math.abs(x) >= 1) return "$" + money(x);
    if (Math.abs(x) >= 0.01) return "$" + x.toFixed(4);
    const s = x.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
    return "$" + s;
  }

  function formatStat(v, kind) {
    if (v == null || v === "" || v === "n/a") return "n/a";
    if (kind === "holders") return String(v);
    const x = Number(v);
    if (isNaN(x)) return String(v);
    return "$" + x.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const wall = String(iso).match(/T(\d{2}:\d{2})/);
    if (wall) return wall[1];
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Berlin" });
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove("hidden");
    setTimeout(function () { toastEl.classList.add("hidden"); }, 1800);
  }

  function odometerRender(root, value) {
    const next = "$" + money(value);
    const prev = odoPrev || next;
    root.textContent = "";
    const digits = "0123456789";
    let delay = 0;
    const changes = [];
    for (let i = 0; i < next.length; i++) {
      const ch = next[i];
      if (digits.indexOf(ch) === -1) {
        root.appendChild(el("span", "odo-ch", ch));
      } else {
        const wrap = el("span", "odo-digit");
        const strip = el("span", "odo-strip");
        for (let d = 0; d < 10; d++) strip.appendChild(el("span", "", String(d)));
        wrap.appendChild(strip);
        root.appendChild(wrap);
        const from = (prev[i] && digits.indexOf(prev[i]) >= 0) ? Number(prev[i]) : Number(ch);
        strip.style.transition = "none";
        strip.style.transform = "translateY(" + (-from) + "em)";
        changes.push({ strip: strip, to: Number(ch), i: i });
      }
    }
    const changed = changes.filter(function (c, idx) {
      const ch = next[c.i];
      const old = prev[c.i];
      return ch !== old;
    });
    requestAnimationFrame(function () {
      changed.reverse().forEach(function (c, idx) {
        const wait = isReduced() ? 0 : idx * 30;
        setTimeout(function () {
          if (!isReduced()) c.strip.style.transition = "transform 600ms ease-out";
          c.strip.style.transform = "translateY(" + (-c.to) + "em)";
        }, wait);
      });
      changes.forEach(function (c) {
        if (next[c.i] === (prev[c.i] || "")) c.strip.style.transform = "translateY(" + (-c.to) + "em)";
      });
    });
    odoPrev = next;
  }

  function paperMode(state) {
    return !state || (state.mode || "PAPER") !== "LIVE";
  }

  function emptyLayers() {
    return [1, 2, 3, 4, 5, 6, 7, 8].map(function (n) {
      return { n: n, name: LAYER_NAMES[n], pass: null, value: "not checked" };
    });
  }

  function maybeEmpty() {
    if (!EMPTY || !store.state) return;
    store.state = JSON.parse(JSON.stringify(store.state));
    (store.state.cards || []).forEach(function (card) {
      if (card.name === "scanner") { card.feed = []; card.headline = "0 pools"; }
      if (card.name === "auditor") {
        card.layers = []; card.taken_apart = 0; card.rejected = 0;
        card.status_text = "taking apart..."; card.headline = "0 taken apart";
      }
      if (card.name === "executor") { card.trades = 0; card.headline = "0 trades"; card.bar = null; }
      if (card.name === "analyst") { card.score = null; }
    });
    Object.keys(store.charts).forEach(function (k) {
      store.charts[k] = { range: k, points: [], marks: [], start: store.state.start, mode: store.state.mode };
    });
    store.activity = { items: [], page_size: 30 };
    Object.keys(store.audits).forEach(function (mint) {
      store.audits[mint] = {
        mint: mint, name: (store.audits[mint] && store.audits[mint].name) || mint.slice(0, 6),
        layers: emptyLayers(), status: "empty", headline: "No coin taken apart yet", subhead: "", url: (store.audits[mint] || {}).url, passed: null
      };
    });
    Object.keys(store.coins).forEach(function (mint) {
      store.coins[mint].position = null;
      store.coins[mint].exit = null;
      store.coins[mint].button = "Buy on FOMO";
      store.coins[mint].price_change_since_entry = null;
    });
    Object.keys(store.decisions).forEach(function (name) {
      store.decisions[name] = { agent: name, items: [] };
    });
    if (store.stream) store.stream = { seq: store.stream.seq || 0, events: [], updated: store.stream.updated };
  }

  function cardByName(name) {
    const cards = (store.state && store.state.cards) || [];
    return cards.find(function (c) { return c.name === name; }) || null;
  }

  function renderAgentCard(card, compact) {
    const root = el("article", "agent-card");
    if (!compact) root.className = "full-card";
    if (!card) return root;
    const title = el("h3", "", card.title || card.name);
    if (card.color) title.style.color = card.color;
    root.appendChild(title);
    root.appendChild(el("div", "headline", card.headline || ""));
    if (card.name === "scanner") {
      const feed = card.feed || [];
      if (!feed.length) root.appendChild(el("div", "empty-msg", "Listening for graduations"));
      else {
        const box = el("div", "agent-feed");
        feed.slice(0, 8).forEach(function (item) {
          const row = el("div", "row");
          if (item.strike) {
            row.appendChild(el("span", "strike", item.name || item.mint));
            row.appendChild(el("span", "strike-reason", item.reason || item.text || ""));
          } else {
            row.appendChild(el("span", "", item.text || (item.name + " · → auditor")));
          }
          box.appendChild(row);
        });
        root.appendChild(box);
      }
    } else if (card.name === "auditor") {
      const grid = el("div", "layer-grid");
      const layers = card.layers || [];
      for (let i = 0; i < 8; i++) {
        const layer = layers[i] || { n: i + 1, value: "", pass: null };
        const strip = el("div", "layer-strip", layer.value || layer.name || ("Layer " + (i + 1)));
        if (layer.pass === true) strip.classList.add("ok");
        if (layer.pass === false) strip.classList.add("bad");
        grid.appendChild(strip);
      }
      root.appendChild(grid);
      root.appendChild(el("div", "meta-row", card.status_text || "taking apart..."));
      root.appendChild(el("div", "meta-row", (card.rejected || 0) + " rejected"));
    } else if (card.name === "analyst") {
      const wrap = el("div", "score-wrap");
      const cvs = document.createElement("canvas");
      cvs.width = 120; cvs.height = 120;
      cvs.style.width = "120px"; cvs.style.height = "120px";
      wrap.appendChild(cvs);
      wrap.appendChild(el("div", "", "Scoring"));
      root.appendChild(wrap);
      requestAnimationFrame(function () {
        if (typeof drawScoreRing === "function") drawScoreRing(cvs, card.score, card.threshold || 70);
      });
    } else if (card.name === "executor") {
      root.appendChild(el("div", "meta-row", card.size_text || ""));
      if (card.bar) root.appendChild(el("div", "exec-bar", card.bar));
    } else if (card.name === "risk") {
      const pills = el("div", "pills");
      const stop = (card.pills && card.pills.stop) || "";
      const trail = (card.pills && card.pills.trail) || "";
      if (stop) pills.appendChild(el("span", "pill pill-red", stop));
      if (trail) pills.appendChild(el("span", "pill pill-green", trail));
      root.appendChild(pills);
    }
    return root;
  }

  function activityTitle(item) {
    return item.title || item.text || "";
  }
  function activitySub(item) {
    if (item.subtitle) return item.subtitle;
    const time = fmtTime(item.time);
    if (item.kind === "bought") return "Executor · " + time;
    if (item.kind === "sold") return "Risk · trailing stop";
    if (item.kind === "stopped") return "Risk · stop";
    if (item.kind === "rejected" && item.agent === "analyst") return "Analyst · chase " + (item.value || "");
    if (item.kind === "rejected") return "Auditor · " + (item.reason || "");
    return (item.agent || "") + (time ? " · " + time : "");
  }
  function activityValue(item) {
    if (item.kind === "rejected" && (item.value == null || item.value === "")) return "Skipped";
    return item.value || "";
  }
  function valueTone(item) {
    const v = String(item.value || "");
    if (item.kind === "stopped" || v.indexOf("-") === 0) return "down";
    if (item.kind === "sold" || v.indexOf("+") === 0) return "up";
    return "";
  }

  function renderActivityList(target, items, emptyText) {
    target.textContent = "";
    if (!items || !items.length) {
      target.appendChild(el("div", "empty-msg", emptyText));
      return;
    }
    items.forEach(function (item) {
      const btn = el("button", "act-row");
      btn.type = "button";
      const grow = el("div", "grow");
      grow.appendChild(el("div", "title", activityTitle(item)));
      grow.appendChild(el("div", "sub", activitySub(item)));
      btn.appendChild(grow);
      const right = el("div", "right", activityValue(item));
      const tone = valueTone(item);
      if (tone) right.classList.add(tone);
      btn.appendChild(right);
      btn.addEventListener("click", function () {
        if (!item.mint) return;
        if (item.tap === "auditor" || item.kind === "rejected") openAudit(item.mint);
        else openCoin(item.mint);
      });
      target.appendChild(btn);
    });
  }

  function renderHome() {
    const state = store.state;
    if (!state) return;
    document.getElementById("homeLoading").classList.add("hidden");
    document.getElementById("homeBody").classList.remove("hidden");
    const paper = paperMode(state);
    document.getElementById("paperBadgeHome").classList.toggle("hidden", !paper);
    odometerRender(document.getElementById("balanceOdo"), state.balance);
    const pct = Number(state.today_pct || 0);
    const today = document.getElementById("todayPct");
    today.textContent = (pct >= 0 ? "+" : "") + Number(pct).toFixed(2) + "%";
    today.className = "today " + (pct >= 0 ? "up" : "down");
    const mult = Number(state.multiplier || 0);
    document.getElementById("multiplier").textContent = mult.toFixed(2) + "×";
    const running = state.agents_running != null ? state.agents_running : 5;
    document.getElementById("agentsHeading").textContent = "Agents · " + running + " running";
    const carousel = document.getElementById("agentCarousel");
    carousel.textContent = "";
    (state.cards || []).forEach(function (card) { carousel.appendChild(renderAgentCard(card, true)); });
    const chart = store.charts[chartRange] || { points: [], marks: [], start: state.start };
    const empty = !chart.points || chart.points.length < 2;
    document.getElementById("chartEmpty").classList.toggle("hidden", !empty);
    if (empty) document.getElementById("chartEmpty").textContent = "Waiting for the first trade";
    const n = (chart.points || []).length;
    if (!isReduced() && n > lastPointN && lastPointN > 0) {
      slide = 0;
      markFade = 0;
      const t0 = performance.now();
      cancelAnimationFrame(animTimer);
      function step(now) {
        const p = Math.min(1, (now - t0) / 250);
        slide = p;
        markFade = Math.min(1, (now - t0) / 200);
        if (typeof drawLineChart === "function") {
          drawLineChart(document.getElementById("homeChart"), {
            points: chart.points, marks: chart.marks, start: chart.start, slide: slide, markFade: markFade
          });
        }
        if (p < 1) animTimer = requestAnimationFrame(step);
      }
      animTimer = requestAnimationFrame(step);
    } else if (typeof drawLineChart === "function") {
      drawLineChart(document.getElementById("homeChart"), {
        points: chart.points || [], marks: chart.marks || [], start: chart.start, slide: 1, markFade: 1
      });
    }
    lastPointN = n;
    document.querySelectorAll("#rangeSwitch button").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-range") === chartRange);
    });
    const items = ((store.activity && store.activity.items) || []).slice(0, 5);
    renderActivityList(document.getElementById("homeActivity"), items, "Nothing yet tonight");
    const seen = Number(localStorage.getItem(SEEN_KEY) || 0);
    const seq = store.stream && store.stream.seq || 0;
    document.getElementById("bellDot").classList.toggle("hidden", !(seq > seen));
  }

  function renderAgents() {
    const body = document.getElementById("agentsBody");
    document.getElementById("agentsLoading").classList.add("hidden");
    body.classList.remove("hidden");
    body.textContent = "";
    const readonly = !store.account || store.account.readonly !== false;
    AGENTS.forEach(function (name) {
      const card = cardByName(name) || { name: name, title: name, status: "running" };
      const box = el("article", "full-card");
      box.id = "agent-" + name;
      const top = el("div", "agent-top");
      const dot = el("span", "status-dot" + (card.status === "paused" ? " paused" : ""));
      top.appendChild(dot);
      const title = el("h3", "", card.title || name);
      if (card.color) title.style.color = card.color;
      top.appendChild(title);
      let count = card.headline || "";
      if (name === "auditor") count = (card.taken_apart || 0) + " today";
      if (name === "scanner") count = card.headline || "";
      if (name === "executor") count = (card.trades || 0) + " today";
      top.appendChild(el("span", "count", count));
      const sw = el("button", "switch" + (card.status !== "paused" ? " on" : ""));
      sw.type = "button";
      sw.appendChild(document.createElement("i"));
      sw.disabled = true;
      const riskLocked = name === "risk" && card.open > 0;
      top.appendChild(sw);
      box.appendChild(top);
      if (readonly) box.appendChild(el("p", "hint", "Pause and resume go through the Grok Bot app."));
      if (riskLocked) box.appendChild(el("p", "hint", "Risk is locked while a position is open."));
      const dec = (store.decisions[name] && store.decisions[name].items) || [];
      const list = el("div", "decisions");
      if (!dec.length) list.appendChild(el("div", "empty-msg", "No decisions yet"));
      dec.slice(0, 20).forEach(function (item) {
        const row = el("div", "decision");
        row.appendChild(el("time", "", fmtTime(item.time)));
        const mid = el("div", "");
        if (item.url) {
          const a = el("a", "", item.name || item.mint || "");
          const fake = { url: item.url };
          applyItemHref(a, fake);
          mid.appendChild(a);
        } else {
          mid.appendChild(el("div", "", item.name || item.mint || ""));
        }
        mid.appendChild(el("div", "verdict", (item.verdict || "") + (item.reason ? " · " + item.reason : "")));
        row.appendChild(mid);
        list.appendChild(row);
      });
      box.appendChild(list);
      const settingsBtn = el("button", "settings-link", "Settings");
      settingsBtn.type = "button";
      settingsBtn.addEventListener("click", function () {
        go("account");
        setTimeout(function () {
          const node = document.getElementById("settings-" + name);
          if (node) node.scrollIntoView({ behavior: isReduced() ? "auto" : "smooth" });
        }, 50);
      });
      box.appendChild(settingsBtn);
      body.appendChild(box);
    });
  }

  function renderActivity() {
    document.getElementById("activityLoading").classList.add("hidden");
    const body = document.getElementById("activityBody");
    body.classList.remove("hidden");
    renderActivityList(body, (store.activity && store.activity.items) || [], "Nothing yet tonight");
  }

  function renderAccount() {
    document.getElementById("accountLoading").classList.add("hidden");
    const body = document.getElementById("accountBody");
    body.classList.remove("hidden");
    body.textContent = "";
    const account = store.account || {};
    const state = store.state || {};
    const readonly = account.readonly !== false;
    const modeBox = el("article", "full-card");
    modeBox.appendChild(el("h3", "", "Mode"));
    const sw = el("div", "mode-switch");
    ["PAPER", "LIVE"].forEach(function (mode) {
      const btn = el("button", mode === (state.mode || account.mode || "PAPER") ? "active" : "", mode);
      btn.type = "button";
      btn.disabled = true;
      sw.appendChild(btn);
    });
    modeBox.appendChild(sw);
    const confirm = el("div", "field");
    confirm.appendChild(el("label", "", "Type LIVE to confirm"));
    const confirmInput = document.createElement("input");
    confirmInput.type = "text";
    confirmInput.placeholder = "LIVE";
    confirmInput.disabled = true;
    confirm.appendChild(confirmInput);
    modeBox.appendChild(confirm);
    modeBox.appendChild(el("p", "hint", "Switching to LIVE needs at least 1 full PAPER night and typing LIVE. On this hosting the switch is read-only and goes through the Grok Bot app."));
    const stack = el("div", "field");
    stack.appendChild(el("label", "", "Stack"));
    const stackInput = document.createElement("input");
    stackInput.type = "text";
    stackInput.value = account.stack != null ? money(account.stack) : money(state.balance);
    stackInput.disabled = true;
    stack.appendChild(stackInput);
    modeBox.appendChild(stack);
    body.appendChild(modeBox);

    const profile = el("a", "row-link");
    profile.appendChild(el("div", "", "Your FOMO profile"));
    profile.appendChild(el("span", "", "Open"));
    const profileUrl = account.profile_url;
    applyProfileHref(profile, profileUrl);
    body.appendChild(profile);

    const invite = el("button", "row-link");
    invite.type = "button";
    invite.appendChild(el("div", "", "Invite a friend"));
    invite.appendChild(el("span", "", "Share"));
    invite.addEventListener("click", function () {
      const url = account.signup_url;
      if (!url) return;
      if (navigator.share) {
        navigator.share({ url: url, title: "Invite a friend" }).catch(function () {
          copyLink(url);
        });
      } else {
        copyLink(url);
      }
    });
    body.appendChild(invite);

    const groups = (store.settings && store.settings.groups) || {};
    GROUP_ORDER.forEach(function (group) {
      const block = el("section", "");
      block.id = "settings-" + group;
      block.appendChild(el("h2", "group-title", group[0].toUpperCase() + group.slice(1)));
      const items = groups[group] || {};
      Object.keys(items).forEach(function (key) {
        const spec = items[key];
        const row = el("div", "setting");
        const label = el("div", "label");
        label.appendChild(el("span", "", key));
        if (spec.min != null && spec.max != null) {
          label.appendChild(el("span", "range", spec.min + " – " + spec.max));
        }
        row.appendChild(label);
        const numeric = spec.kind === "float" || spec.kind === "int" || (typeof spec.value === "number");
        if (spec.choices && spec.choices.length) {
          const sel = document.createElement("input");
          sel.type = "text";
          sel.value = String(spec.value);
          sel.disabled = true;
          sel.className = "num";
          sel.style.width = "100%";
          row.appendChild(sel);
        } else if (spec.kind === "bool" || spec.value === true || spec.value === false) {
          const s = el("button", "switch" + (spec.value === true || spec.value === "true" || spec.value === 1 ? " on" : ""));
          s.type = "button";
          s.disabled = true;
          s.appendChild(document.createElement("i"));
          row.appendChild(s);
        } else if (numeric && spec.min != null && spec.max != null) {
          const range = document.createElement("input");
          range.type = "range";
          range.min = spec.min;
          range.max = spec.max;
          range.step = spec.kind === "int" ? "1" : "any";
          range.value = spec.value;
          range.disabled = true;
          const num = document.createElement("input");
          num.type = "number";
          num.className = "num";
          num.min = spec.min;
          num.max = spec.max;
          num.value = spec.value;
          num.disabled = true;
          row.appendChild(range);
          row.appendChild(num);
        } else {
          const inp = document.createElement("input");
          inp.type = "text";
          inp.value = String(spec.value);
          inp.disabled = true;
          inp.className = "num";
          inp.style.width = "100%";
          row.appendChild(inp);
        }
        block.appendChild(row);
      });
      body.appendChild(block);
    });

    const notify = el("article", "full-card");
    notify.appendChild(el("h3", "", "Notifier"));
    notify.appendChild(el("p", "", "Discord connected"));
    notify.appendChild(el("p", "hint", "Send test push · via the Grok Bot app"));
    body.appendChild(notify);

    const push = el("article", "full-card");
    push.appendChild(el("h3", "", "Notifications"));
    push.appendChild(el("p", "", "No web push on this hosting, pushes go to Discord"));
    body.appendChild(push);
  }

  function copyLink(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { showToast("Link copied"); }).catch(function () { showToast("Link copied"); });
    } else {
      showToast("Link copied");
    }
  }

  function renderCoin() {
    document.getElementById("coinLoading").classList.add("hidden");
    const body = document.getElementById("coinBody");
    body.classList.remove("hidden");
    body.textContent = "";
    const mint = route.mint;
    const coin = store.coins[mint];
    if (!coin) {
      body.appendChild(el("div", "empty-msg", "Coin not in tonight's snapshots"));
      return;
    }
    document.getElementById("coinTitle").textContent = coin.name || coin.symbol || "Coin";
    document.getElementById("paperBadgeCoin").classList.toggle("hidden", !paperMode(store.state || { mode: coin.mode }));
    const meta = el("div", "coin-meta");
    const age = coin.age || "";
    meta.appendChild(el("span", "", (coin.symbol || "X") + " · Solana · " + age));
    if (coin.shield) meta.appendChild(el("span", "shield", coin.shield));
    body.appendChild(meta);
    body.appendChild(el("div", "price-lg", formatPrice(coin.price)));
    if (coin.price_change_since_entry != null) {
      const ch = Number(coin.price_change_since_entry);
      const since = el("div", "since " + (ch >= 0 ? "up" : "down"), (ch >= 0 ? "▲ +" : "▼ ") + Math.abs(ch).toFixed(2) + "% since entry");
      since.style.color = ch >= 0 ? "#00d35a" : "#ff453a";
      body.appendChild(since);
    }
    const canvas = document.createElement("canvas");
    canvas.id = "coinChart";
    canvas.setAttribute("aria-label", "Price candles");
    body.appendChild(canvas);
    requestAnimationFrame(function () {
      if (typeof drawCandles === "function") {
        drawCandles(canvas, {
          candles: coin.candles || [],
          exitLine: (coin.position && coin.exit && coin.exit.current_exit_line != null) ? coin.exit.current_exit_line : null
        });
      }
    });
    const stats = el("div", "stats");
    const s = coin.stats || {};
    [["Market cap", formatStat(s.mcap)], ["Liquidity", formatStat(s.liq)],
     ["24h volume", formatStat(s.vol24h)], ["Holders", formatStat(s.holders, "holders")]].forEach(function (pair) {
      const box = el("div", "stat");
      box.appendChild(el("div", "k", pair[0]));
      box.appendChild(el("div", "v", pair[1]));
      stats.appendChild(box);
    });
    body.appendChild(stats);
    if (s.updated) {
      const age = Date.now() - Date.parse(s.updated);
      if (!isNaN(age) && age > 2 * 60 * 1000) {
        body.appendChild(el("div", "stat-updated", "updated " + fmtTime(s.updated)));
      }
    }
    if (coin.position) {
      const pos = el("article", "full-card");
      pos.appendChild(el("h3", "", "Your position · $" + money(coin.position.size_usd) + " in · Executor"));
      body.appendChild(pos);
      if (coin.exit) {
        const ex = el("article", "full-card exit-card");
        [["Stop line", formatPrice(coin.exit.stop_line)], ["Trail line", formatPrice(coin.exit.trail_line)],
         ["Time left", coin.exit.timeout_left_h != null ? coin.exit.timeout_left_h + "h" : "n/a"]].forEach(function (pair) {
          const line = el("div", "line");
          line.appendChild(el("span", "", pair[0]));
          line.appendChild(el("span", "", pair[1]));
          ex.appendChild(line);
        });
        body.appendChild(ex);
      }
    }
    const btn = el("a", "fomo-btn", coin.button || (coin.position ? "Sell on FOMO" : "Buy on FOMO"));
    applyCoinHref(btn, coin);
    body.appendChild(btn);
  }

  function sentLayersFor(mint) {
    const map = {};
    const events = ((store.stream && store.stream.events) || []).filter(function (e) {
      return e.kind === "audit_layer" && e.mint === mint && e.n != null;
    }).sort(function (a, b) { return (a.seq || 0) - (b.seq || 0) || (Number(a.n) - Number(b.n)); });
    let run = [];
    events.forEach(function (e) {
      const n = Number(e.n);
      if (!n) return;
      if (n === 1) run = [e];
      else if (run.length && n === Number(run[run.length - 1].n) + 1) run.push(e);
    });
    run.forEach(function (e) {
      if (e.pass === null || e.pass === undefined) return;
      map[Number(e.n)] = { n: Number(e.n), name: e.name, pass: e.pass, value: e.value, source: "stream" };
    });
    const audit = store.audits[mint];
    ((audit && audit.layers) || []).forEach(function (layer) {
      if (layer.pass !== null && layer.pass !== undefined) map[layer.n] = layer;
    });
    return map;
  }

  function renderAuditFrame(mint, revealed, running) {
    const body = document.getElementById("auditBody");
    body.textContent = "";
    const audit = store.audits[mint] || { layers: emptyLayers(), status: "empty", headline: "No coin taken apart yet", name: mint };
    document.getElementById("auditTitle").textContent = audit.name || "Auditor";
    const sent = sentLayersFor(mint);
    const known = Object.keys(sent).length;
    if (audit.status === "empty" && !known) {
      body.appendChild(el("div", "empty-msg", "No coin taken apart yet"));
    } else {
      const stack = el("div", "coin-stack");
      const beam = el("div", "coin-beam");
      stack.appendChild(beam);
      for (let n = 1; n <= 8; n++) {
        const layer = revealed[n];
        const disc = el("div", "coin-disc");
        disc.setAttribute("data-n", String(n));
        disc.style.top = ((n - 1) * 22) + "px";
        disc.style.zIndex = String(10 - n);
        const mark = el("span", "disc-mark", "");
        if (layer && layer.pass === true) { disc.classList.add("ok"); mark.textContent = "✓"; }
        else if (layer && layer.pass === false) { disc.classList.add("bad"); mark.textContent = "✕"; }
        disc.appendChild(mark);
        stack.appendChild(disc);
      }
      body.appendChild(stack);
      const failed = Object.keys(revealed).some(function (key) { return revealed[key] && revealed[key].pass === false; });
      const complete = Object.keys(revealed).length >= Object.keys(sentLayersFor(mint)).length && Object.keys(revealed).length > 0;
      if (audit.headline && (audit.status === "rejected" || audit.status === "cleared") && (failed || complete)) {
        body.appendChild(el("div", "headline", audit.headline));
        body.appendChild(el("p", "subhead", audit.subhead || (audit.status === "rejected" ? ("Grok Bot won't buy " + (audit.name || "")) : "Sent to Executor")));
      }
      const rows = el("div", "value-rows");
      for (let n = 1; n <= 8; n++) {
        const layer = revealed[n];
        const row = el("div", "value-row");
        row.appendChild(el("span", "k", LAYER_NAMES[n]));
        let text;
        let cls = "";
        if (layer) {
          text = layer.value || "";
        } else if (running === n) {
          text = "…";
        } else {
          text = "not checked";
          cls = "not-checked";
        }
        row.appendChild(el("span", cls, text));
        rows.appendChild(row);
      }
      body.appendChild(rows);
    }
    const enabled = ((((store.settings || {}).groups || {}).auditor || {})["auditor.enabled"] || {}).value;
    const tog = el("div", "row-link");
    tog.appendChild(el("div", "", "Take apart before buying"));
    const sw = el("button", "switch" + (enabled === false || enabled === "false" || enabled === 0 ? "" : " on"));
    sw.type = "button";
    sw.disabled = true;
    sw.appendChild(document.createElement("i"));
    tog.appendChild(sw);
    body.appendChild(tog);
    if (!store.account || store.account.readonly !== false) {
      body.appendChild(el("p", "hint", "This toggle is read-only here. Changes go through the Grok Bot app."));
    }
    const coin = store.coins[mint] || { url: audit.url, coin_url: audit.url };
    const btn = el("a", "fomo-btn", "Open on FOMO");
    applyCoinHref(btn, coin);
    body.appendChild(btn);
    return body.querySelector(".coin-beam");
  }

  async function playAudit(mint) {
    const gen = ++auditGen;
    document.getElementById("auditLoading").classList.add("hidden");
    document.getElementById("auditBody").classList.remove("hidden");
    window.__deskAuditDone = false;
    const revealed = {};
    function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
    const existing = store.audits[mint] || {};
    if (existing.status === "empty" && !Object.keys(sentLayersFor(mint)).length) {
      renderAuditFrame(mint, revealed);
      window.__deskAuditDone = true;
      document.getElementById("screen-audit").setAttribute("data-audit-done", "1");
      return;
    }
    if (isReduced()) {
      const sent = sentLayersFor(mint);
      for (let n = 1; n <= 8; n++) if (sent[n]) revealed[n] = sent[n];
      renderAuditFrame(mint, revealed);
      window.__deskAuditDone = true;
      document.getElementById("screen-audit").setAttribute("data-audit-done", "1");
      return;
    }
    renderAuditFrame(mint, revealed);
    for (let n = 1; n <= 8; n++) {
      if (gen !== auditGen) return;
      let sent = sentLayersFor(mint);
      let guard = 0;
      while (!sent[n] && guard < 8) {
        const beam = renderAuditFrame(mint, revealed, n);
        positionBeam(beam, n, true);
        await wait(350);
        try { store.audits[mint] = await getJson("audit/" + mint + ".json"); store.stream = await getJson("stream.json"); } catch (e) {}
        sent = sentLayersFor(mint);
        guard += 1;
      }
      if (!sent[n]) break;
      const beam = renderAuditFrame(mint, revealed, n);
      positionBeam(beam, n, true);
      await wait(350);
      revealed[n] = sent[n];
      renderAuditFrame(mint, revealed);
      await wait(150);
      if (sent[n].pass === false) break;
    }
    if (gen === auditGen) {
      window.__deskAuditDone = true;
      document.getElementById("screen-audit").setAttribute("data-audit-done", "1");
    }
  }

  function positionBeam(beam, n, on) {
    if (!beam) return;
    const disc = document.querySelector('.coin-disc[data-n="' + n + '"]');
    if (!disc) return;
    const mid = disc.offsetTop + disc.offsetHeight / 2 - 4;
    beam.style.top = mid + "px";
    beam.style.opacity = on ? "1" : "0";
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (node) {
      node.classList.toggle("hidden", node.getAttribute("data-screen") !== name);
    });
    document.querySelectorAll(".tabbar button").forEach(function (btn) {
      const tab = btn.getAttribute("data-tab");
      const overlay = name === "coin" || name === "audit";
      btn.classList.toggle("active", overlay ? (tab === originTab) : (tab === name));
    });
  }

  function go(name, mint) {
    if (name === "home" || name === "agents" || name === "activity" || name === "account") {
      prevTab = name;
      if (name === "home" || name === "agents" || name === "activity") originTab = name;
    }
    route = { name: name, mint: mint || null };
    showScreen(name);
    if (name === "home") renderHome();
    if (name === "agents") renderAgents();
    if (name === "activity") {
      renderActivity();
      if (store.stream) localStorage.setItem(SEEN_KEY, String(store.stream.seq || 0));
      document.getElementById("bellDot").classList.add("hidden");
    }
    if (name === "account") renderAccount();
    if (name === "coin") {
      document.getElementById("coinLoading").classList.remove("hidden");
      document.getElementById("coinBody").classList.add("hidden");
      ensureCoin(mint);
    }
    if (name === "audit") {
      document.getElementById("auditLoading").classList.remove("hidden");
      document.getElementById("auditBody").classList.add("hidden");
      document.getElementById("screen-audit").removeAttribute("data-audit-done");
      ensureAudit(mint);
    }
    updateError();
  }

  function openCoin(mint) { go("coin", mint); }
  function openAudit(mint) { go("audit", mint); }

  async function ensureCoin(mint) {
    if (!mint) { renderCoin(); return; }
    try {
      if (!store.coins[mint]) store.coins[mint] = await getJson("coin/" + mint + ".json");
      if (EMPTY && store.coins[mint]) {
        store.coins[mint].position = null;
        store.coins[mint].exit = null;
        store.coins[mint].button = "Buy on FOMO";
        store.coins[mint].price_change_since_entry = null;
      }
    } catch (e) {}
    if (route.name === "coin" && route.mint === mint) renderCoin();
  }
  async function ensureAudit(mint) {
    if (!mint) { renderAuditFrame("", {}); window.__deskAuditDone = true; return; }
    try {
      if (!store.audits[mint]) store.audits[mint] = await getJson("audit/" + mint + ".json");
      if (EMPTY && store.audits[mint]) {
        store.audits[mint] = {
          mint: mint,
          name: store.audits[mint].name,
          url: store.audits[mint].url,
          layers: emptyLayers(),
          status: "empty",
          headline: "No coin taken apart yet",
          subhead: "",
          passed: null
        };
      }
    } catch (e) {}
    if (route.name === "audit" && route.mint === mint) playAudit(mint);
  }

  function updateError() {
    const when = lastUpdate ? fmtTime(lastUpdate) : "—";
    const text = "Desk offline · retrying in " + retryLeft + "s · last update " + when;
    errorBanner.classList.add("hidden");
    document.querySelectorAll(".error-slot").forEach(function (slot) {
      if (!offline) {
        slot.classList.add("hidden");
        slot.textContent = "";
      } else {
        slot.textContent = text;
        slot.classList.remove("hidden");
      }
    });
  }

  function searchIndex() {
    const out = [];
    const seen = {};
    function add(mint, name, symbol) {
      if (!mint || seen[mint]) return;
      seen[mint] = true;
      out.push({ mint: mint, name: name || mint.slice(0, 6), symbol: symbol || "" });
    }
    ((store.state && store.state.cards) || []).forEach(function (card) {
      (card.feed || []).forEach(function (item) { add(item.mint, item.name, item.symbol); });
    });
    ((store.activity && store.activity.items) || []).forEach(function (item) { add(item.mint, item.title, ""); });
    Object.keys(store.coins).forEach(function (mint) {
      const c = store.coins[mint];
      add(mint, c.name, c.symbol);
    });
    return out;
  }

  function runSearch(q) {
    const box = document.getElementById("searchResults");
    box.textContent = "";
    const query = (q || "").trim().toLowerCase();
    if (!query) return;
    searchIndex().filter(function (item) {
      return (item.name || "").toLowerCase().indexOf(query) >= 0 ||
        (item.symbol || "").toLowerCase().indexOf(query) >= 0 ||
        (item.mint || "").toLowerCase().indexOf(query) >= 0;
    }).forEach(function (item) {
      const btn = el("button", "act-row");
      btn.type = "button";
      const grow = el("div", "grow");
      grow.appendChild(el("div", "title", item.name));
      grow.appendChild(el("div", "sub", item.symbol ? item.symbol + " · " + item.mint : item.mint));
      btn.appendChild(grow);
      btn.addEventListener("click", function () {
        document.getElementById("searchOverlay").classList.add("hidden");
        openCoin(item.mint);
      });
      box.appendChild(btn);
    });
  }

  async function loadAll() {
    const state = await getJson("state.json");
    const account = await getJson("account.json");
    const settings = await getJson("settings.json");
    const activity = await getJson("activity/0.json");
    const stream = await getJson("stream.json").catch(function () { return { events: [], seq: 0 }; });
    const charts = {};
    for (let i = 0; i < ["LIVE", "1H", "4H", "1D", "1W", "ALL"].length; i++) {
      const range = ["LIVE", "1H", "4H", "1D", "1W", "ALL"][i];
      charts[range] = await getJson("chart/" + range + ".json");
    }
    const decisions = {};
    for (let i = 0; i < AGENTS.length; i++) {
      const name = AGENTS[i];
      decisions[name] = await getJson("agents/" + name + "/decisions.json");
    }
    store.state = state;
    store.account = account;
    store.settings = settings;
    store.activity = activity;
    store.stream = stream;
    store.charts = charts;
    store.decisions = decisions;
    if (route.mint) {
      try { store.coins[route.mint] = await getJson("coin/" + route.mint + ".json"); } catch (e) {}
      try { store.audits[route.mint] = await getJson("audit/" + route.mint + ".json"); } catch (e) {}
    }
    maybeEmpty();
    lastGood = store;
    lastUpdate = state.time;
    loaded = true;
    window.__deskReady = true;
    document.body.setAttribute("data-app-ready", "1");
  }

  async function refresh() {
    try {
      await loadAll();
      offline = false;
      retryLeft = 0;
      updateError();
      go(route.name, route.mint);
    } catch (err) {
      if (!loaded) throw err;
      offline = true;
      retryLeft = Math.round(POLL_MS / 1000);
      updateError();
    }
  }

  function tickRetry() {
    if (!offline) return;
    retryLeft -= 1;
    if (retryLeft <= 0) {
      retryLeft = Math.round(POLL_MS / 1000);
      refresh().catch(function () {});
    }
    updateError();
  }

  document.getElementById("avatarBtn").addEventListener("click", function () { go("account"); });
  document.getElementById("brandBtn").addEventListener("click", function () { go("home"); });
  document.getElementById("seeAllActivity").addEventListener("click", function () { go("activity"); });
  document.getElementById("bellBtn").addEventListener("click", function () { go("activity"); });
  document.getElementById("searchBtn").addEventListener("click", function () {
    document.getElementById("searchOverlay").classList.remove("hidden");
    document.getElementById("searchInput").focus();
  });
  document.getElementById("searchClose").addEventListener("click", function () {
    document.getElementById("searchOverlay").classList.add("hidden");
  });
  document.getElementById("searchInput").addEventListener("input", function (e) { runSearch(e.target.value); });
  document.getElementById("coinBack").addEventListener("click", function () { go(prevTab); });
  document.getElementById("auditBack").addEventListener("click", function () { go(prevTab); });
  document.querySelectorAll(".tabbar button").forEach(function (btn) {
    btn.addEventListener("click", function () { go(btn.getAttribute("data-tab")); });
  });
  document.querySelectorAll("#rangeSwitch button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      chartRange = btn.getAttribute("data-range");
      lastPointN = 0;
      renderHome();
    });
  });
  document.getElementById("saveToken").addEventListener("click", function () {
    const value = (tokenInput.value || "").trim();
    if (!value) { setupMsg.textContent = "Token is empty."; return; }
    localStorage.setItem(TOKEN_KEY, value);
    tokenInput.value = "";
    setupMsg.textContent = "Saved on this device.";
    boot();
  });

  function showSetup(message) {
    setup.classList.remove("hidden");
    appEl.classList.add("hidden");
    setupMsg.textContent = message || "";
  }
  function showApp() {
    setup.classList.add("hidden");
    appEl.classList.remove("hidden");
  }

  async function boot() {
    captureHash();
    if (!LOCAL && !dataPath()) {
      showSetup("Open this app once with #d=… in the URL so it can remember the data path.");
      return;
    }
    showApp();
    try {
      await refresh();
    } catch (err) {
      if (!LOCAL && !token()) showSetup("Add a read-only GitHub token to load live snapshots.");
      else {
        offline = true;
        retryLeft = Math.round(POLL_MS / 1000);
        updateError();
      }
    }
  }

  if ("serviceWorker" in navigator && !LOCAL) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  window.__deskFail = function (on) { failFetches = !!on; };
  window.__deskGoto = function (name, mint) { go(name, mint); };
  window.__deskRefresh = refresh;
  window.__deskReady = false;
  window.__deskAuditDone = false;

  boot();
  pollTimer = setInterval(function () {
    if (LOCAL || dataPath()) refresh().catch(function () {});
  }, POLL_MS);
  setInterval(tickRetry, 1000);
})();
