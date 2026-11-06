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

  function renderState(state, chart, activity, coin) {
    document.getElementById("modeBadge").textContent = state.mode || "PAPER";
    document.getElementById("equity").textContent = money(state.equity);
    const pnl = Number(state.pnl || 0);
    const pnlEl = document.getElementById("pnl");
    pnlEl.textContent = (pnl >= 0 ? "+" : "") + money(pnl);
    pnlEl.className = "pnl " + (pnl >= 0 ? "up" : "down");
    document.getElementById("asOf").textContent = "seq " + state.seq + " · " + state.time + " · PAPER";
    const settings = state.settings || {};
    document.getElementById("stopPct").textContent = settings.stop_pct + "%";
    document.getElementById("trailPct").textContent = settings.trail_pct + "%";
    document.getElementById("stackPct").textContent = settings.stack_pct + "%";
    document.getElementById("timeoutH").textContent = settings.timeout_h + "h";
    if (typeof drawChart === "function") drawChart(document.getElementById("chart"), (chart && chart.points) || []);
    const list = document.getElementById("activity");
    list.innerHTML = "";
    ((activity && activity.items) || []).slice(0, 8).forEach(function (item) {
      const li = document.createElement("li");
      li.textContent = item.text || "";
      list.appendChild(li);
    });
    const card = document.getElementById("coinCard");
    if (coin) {
      document.getElementById("coinName").textContent = coin.name || coin.symbol || coin.mint;
      const a = document.getElementById("coinLink");
      a.href = coin.url || "#";
      a.textContent = "Open on FOMO";
      card.classList.remove("hidden");
    }
  }

  async function refresh() {
    const state = await getJson("state.json");
    const chart = await getJson("chart.json");
    const activity = await getJson("activity.json");
    let coin = null;
    if (state.coins && state.coins[0]) {
      try { coin = await getJson("coin/" + state.coins[0] + ".json"); } catch (e) { coin = null; }
    }
    renderState(state, chart, activity, coin);
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
