(function () {
  const REPO = "geek7coin/desk";
  const REF = "data";
  const PATH_KEY = "desk_data_path";
  const TOKEN_KEY = "desk_gh_token";
  const POLL_MS = 15000;

  const setup = document.getElementById("setup");
  const board = document.getElementById("board");
  const errorEl = document.getElementById("error");
  const tokenInput = document.getElementById("tokenInput");
  const setupMsg = document.getElementById("setupMsg");

  function captureHash() {
    const match = (location.hash || "").match(/^#d=([A-Za-z0-9_-]+)$/);
    if (match) {
      localStorage.setItem(PATH_KEY, match[1]);
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  function dataPath() {
    return localStorage.getItem(PATH_KEY) || "";
  }

  function token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function showError(text) {
    errorEl.textContent = text;
    errorEl.classList.toggle("hidden", !text);
  }

  function money(n) {
    return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function getJson(relPath) {
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
    if (res.status === 401 || res.status === 403) {
      throw new Error("GitHub token needed or rate-limited");
    }
    if (!res.ok) throw new Error("data fetch failed");
    const body = await res.json();
    const text = atob((body.content || "").replace(/\n/g, ""));
    return JSON.parse(text);
  }

  function renderState(state, chart, activity, coin, account, settingsFile) {
    document.getElementById("modeBadge").textContent = state.mode || "PAPER";
    const balance = state.balance != null ? state.balance : state.equity;
    document.getElementById("equity").textContent = money(balance);
    const pnl = Number(state.today_pct != null ? state.today_pct : state.pnl || 0);
    const pnlEl = document.getElementById("pnl");
    pnlEl.textContent = (pnl >= 0 ? "+" : "") + Number(pnl).toFixed(2) + (state.today_pct != null ? "%" : "");
    pnlEl.className = "pnl " + (pnl >= 0 ? "up" : "down");
    document.getElementById("asOf").textContent = "seq " + state.seq + " · " + state.time + " · " + (state.mode || "PAPER");
    const groups = (settingsFile && settingsFile.groups) || {};
    const risk = groups.risk || {};
    const exec = groups.executor || {};
    const settings = state.settings || {};
    const stop = (risk["risk.stop_pct"] && risk["risk.stop_pct"].value) || settings.stop_pct;
    const trail = (risk["risk.trail_pct"] && risk["risk.trail_pct"].value) || settings.trail_pct;
    const stack = (exec["executor.stack_pct"] && exec["executor.stack_pct"].value) || settings.stack_pct;
    const timeout = (risk["risk.timeout_h"] && risk["risk.timeout_h"].value) || settings.timeout_h;
    document.getElementById("stopPct").textContent = stop + "%";
    document.getElementById("trailPct").textContent = trail + "%";
    document.getElementById("stackPct").textContent = stack + "%";
    document.getElementById("timeoutH").textContent = timeout + "h";
    if (typeof drawChart === "function") drawChart(document.getElementById("chart"), (chart && chart.points) || []);
    const list = document.getElementById("activity");
    list.innerHTML = "";
    ((activity && activity.items) || []).slice(0, 8).forEach(function (item) {
      const li = document.createElement("li");
      if (item.url) {
        const a = document.createElement("a");
        a.setAttribute("href", item.url);
        a.setAttribute("rel", "noopener noreferrer");
        a.textContent = item.text || item.title || item.url;
        li.appendChild(a);
      } else {
        li.textContent = item.text || "";
      }
      list.appendChild(li);
    });
    const profile = document.getElementById("profileLink");
    const profileUrl = (account && account.profile_url) || state.profile_url;
    if (profileUrl) {
      profile.setAttribute("href", profileUrl);
    }
    const card = document.getElementById("coinCard");
    if (coin) {
      document.getElementById("coinName").textContent = coin.name || coin.symbol || coin.mint;
      const a = document.getElementById("coinLink");
      if (coin.url) {
        a.setAttribute("href", coin.url);
      }
      a.textContent = coin.button || "Buy on FOMO";
      card.classList.remove("hidden");
    }
  }

  async function refresh() {
    const state = await getJson("state.json");
    const chart = await getJson("chart/LIVE.json").catch(function () { return getJson("chart.json"); });
    const activity = await getJson("activity/0.json").catch(function () { return getJson("activity.json"); });
    const account = await getJson("account.json").catch(function () { return {}; });
    const settingsFile = await getJson("settings.json").catch(function () { return null; });
    let coin = null;
    const firstMint = state.cards && state.cards[0] && state.cards[0].feed && state.cards[0].feed[0] && state.cards[0].feed[0].mint;
    if (firstMint) {
      try { coin = await getJson("coin/" + firstMint + ".json"); } catch (e) { coin = null; }
    }
    renderState(state, chart, activity, coin, account, settingsFile);
    showError("");
    document.title = "Desk · PAPER";
  }

  function showSetup(message) {
    setup.classList.remove("hidden");
    board.classList.add("hidden");
    setupMsg.textContent = message || "";
  }

  function showBoard() {
    setup.classList.add("hidden");
    board.classList.remove("hidden");
  }

  document.getElementById("saveToken").addEventListener("click", function () {
    const value = (tokenInput.value || "").trim();
    if (!value) {
      setupMsg.textContent = "Token is empty.";
      return;
    }
    localStorage.setItem(TOKEN_KEY, value);
    tokenInput.value = "";
    setupMsg.textContent = "Saved on this device.";
    boot();
  });

  async function boot() {
    captureHash();
    if (!dataPath()) {
      showSetup("Open this app once with #d=… in the URL so it can remember the data path.");
      return;
    }
    showBoard();
    try {
      await refresh();
    } catch (err) {
      if (!token()) {
        showSetup("Add a read-only GitHub token to load live snapshots.");
      } else {
        showError("Could not load snapshots yet.");
      }
    }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }

  boot();
  setInterval(function () {
    if (dataPath()) refresh().catch(function () {});
  }, POLL_MS);
})();
