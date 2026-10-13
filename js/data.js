/* Data layer for Roslyn American Darts.
   One module so a shared database can replace localStorage later.
   Reads: published Google Sheet via the gviz endpoint (Teams, Players, Matches).
   Writes: Apps Script web app doPost. localStorage is the fallback while
   config.js still has placeholders, and a pending queue if the sheet lags.
   Standings are calculated here from matches. Keep the formula in sync with
   apps-script/Code.gs (rebuildStandings_). */
(function (root) {
  "use strict";

  var CONFIG = root.RAD_CONFIG || {};
  var LOCAL_KEY = "rad.local.v1";
  var PENDING_KEY = "rad.pending.v1";
  var CACHE_KEY = "rad.cache.v1";
  var SECRET_KEY = "rad.admin.secret";

  var POINT_RULE = {
    game: 1,
    matchWin: 2,
    matchTie: 1,
    summary: "Points = games won, plus 2 for a match win, plus 1 for a tie. Rank is by points, then wins, then games won. Teams level on all three share a rank."
  };

  var state = { teams: [], players: [], matches: [] };
  var pending = [];
  var mode = "local";
  var loadError = "";
  var listeners = [];
  var lastTouched = [];
  var adminSecret = "";

  function isUnconfigured(value) {
    if (value == null) return true;
    var v = String(value).trim();
    if (!v) return true;
    return v.indexOf("YOUR_") === 0;
  }

  function sheetConfigured() {
    return !isUnconfigured(CONFIG.sheetId);
  }

  function scriptConfigured() {
    return !isUnconfigured(CONFIG.scriptUrl);
  }

  function uid(prefix) {
    var id;
    if (root.crypto && typeof root.crypto.randomUUID === "function") {
      id = root.crypto.randomUUID();
    } else {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    return prefix + id;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function nonNegInt(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n);
  }

  function asBool(value, fallback) {
    if (value === true || value === false) return value;
    var s = String(value == null ? "" : value).trim().toLowerCase();
    if (!s) return fallback;
    if (s === "true" || s === "yes" || s === "1" || s === "y") return true;
    if (s === "false" || s === "no" || s === "0" || s === "n") return false;
    return fallback;
  }

  function sheetDate(value) {
    if (value == null || value === "") return "";
    if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    var s = String(value).trim();
    var match = s.match(/^Date\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
      var month = String(Number(match[2]) + 1);
      var day = String(Number(match[3]));
      if (month.length < 2) month = "0" + month;
      if (day.length < 2) day = "0" + day;
      return match[1] + "-" + month + "-" + day;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s;
  }

  function gamesTally(games) {
    var home = 0;
    var away = 0;
    (games || []).forEach(function (game) {
      if (game.winner === "home") home += 1;
      else if (game.winner === "away") away += 1;
    });
    return { homeGamesWon: home, awayGamesWon: away };
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function upsertList(list, record) {
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === record.id) {
        list[i] = record;
        return list;
      }
    }
    list.push(record);
    return list;
  }

  /* SAMPLE starter used only in the localStorage fallback. */
  function buildSeed() {
    function roster(teamId, label) {
      var players = [];
      for (var n = 1; n <= 4; n += 1) {
        players.push({
          id: "p_" + teamId + "_" + n,
          teamId: teamId,
          name: "SAMPLE — " + label + " " + n,
          active: true,
          sample: true,
          updatedAt: "2026-10-01T00:00:00.000Z"
        });
      }
      return players;
    }

    function match(id, date, homeTeamId, awayTeamId, homeWins, awayWins) {
      var games = [];
      var i;
      for (i = 0; i < homeWins; i += 1) {
        games.push({
          label: "Game " + (games.length + 1),
          homePlayerId: "",
          homePlayerName: "",
          awayPlayerId: "",
          awayPlayerName: "",
          winner: "home"
        });
      }
      for (i = 0; i < awayWins; i += 1) {
        games.push({
          label: "Game " + (games.length + 1),
          homePlayerId: "",
          homePlayerName: "",
          awayPlayerId: "",
          awayPlayerName: "",
          winner: "away"
        });
      }
      return {
        id: id,
        date: date,
        homeTeamId: homeTeamId,
        awayTeamId: awayTeamId,
        homeGamesWon: homeWins,
        awayGamesWon: awayWins,
        games: games,
        submittedAt: date + "T00:00:00.000Z",
        updatedAt: date + "T00:00:00.000Z",
        sample: true
      };
    }

    var teams = [
      { id: "t_red", name: "SAMPLE — Team Red", active: true, sample: true, updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: "t_green", name: "SAMPLE — Team Green", active: true, sample: true, updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: "t_black", name: "SAMPLE — Team Black", active: true, sample: true, updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: "t_brass", name: "SAMPLE — Team Brass", active: true, sample: true, updatedAt: "2026-10-01T00:00:00.000Z" }
    ];

    return {
      teams: teams,
      players: roster("t_red", "Red").concat(roster("t_green", "Green"), roster("t_black", "Black"), roster("t_brass", "Brass")),
      matches: [
        match("m_sample_1", "2026-10-01", "t_red", "t_green", 5, 3),
        match("m_sample_2", "2026-10-08", "t_black", "t_brass", 4, 2),
        match("m_sample_3", "2026-10-08", "t_red", "t_brass", 3, 3)
      ]
    };
  }

  function calculateStandings(teams, matches) {
    var table = {};
    (teams || []).forEach(function (team) {
      if (!team || !team.id) return;
      table[team.id] = {
        teamId: team.id,
        teamName: team.name || "Unnamed team",
        active: team.active !== false,
        sample: !!team.sample,
        wins: 0,
        losses: 0,
        ties: 0,
        gamesWon: 0,
        points: 0
      };
    });

    (matches || []).forEach(function (match) {
      if (!match) return;
      var totals = match.games && match.games.length ? gamesTally(match.games) : {
        homeGamesWon: nonNegInt(match.homeGamesWon),
        awayGamesWon: nonNegInt(match.awayGamesWon)
      };
      var sides = [
        { id: match.homeTeamId, games: totals.homeGamesWon, other: totals.awayGamesWon },
        { id: match.awayTeamId, games: totals.awayGamesWon, other: totals.homeGamesWon }
      ];
      sides.forEach(function (side) {
        if (!side.id) return;
        if (!table[side.id]) {
          table[side.id] = {
            teamId: side.id,
            teamName: "Missing team (" + side.id + ")",
            active: true,
            sample: false,
            wins: 0,
            losses: 0,
            ties: 0,
            gamesWon: 0,
            points: 0
          };
        }
        var row = table[side.id];
        row.gamesWon += side.games;
        row.points += side.games * POINT_RULE.game;
        if (side.games > side.other) {
          row.wins += 1;
          row.points += POINT_RULE.matchWin;
        } else if (side.games < side.other) {
          row.losses += 1;
        } else {
          row.ties += 1;
          row.points += POINT_RULE.matchTie;
        }
      });
    });

    var rows = Object.keys(table).map(function (id) { return table[id]; }).filter(function (row) {
      return row.active || row.wins || row.losses || row.ties || row.gamesWon;
    });

    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.gamesWon !== a.gamesWon) return b.gamesWon - a.gamesWon;
      return String(a.teamName).localeCompare(String(b.teamName));
    });

    var lastKey = null;
    rows.forEach(function (row, index) {
      var key = row.points + ":" + row.wins + ":" + row.gamesWon;
      if (key !== lastKey) {
        row.rank = index + 1;
        lastKey = key;
      } else {
        row.rank = rows[index - 1].rank;
      }
    });
    return rows;
  }

  function previewMatchPoints(homeGamesWon, awayGamesWon) {
    var home = nonNegInt(homeGamesWon);
    var away = nonNegInt(awayGamesWon);
    function side(games, other) {
      var result = { gamesWon: games, wins: 0, losses: 0, ties: 0, points: games * POINT_RULE.game };
      if (games > other) {
        result.wins = 1;
        result.points += POINT_RULE.matchWin;
      } else if (games < other) {
        result.losses = 1;
      } else {
        result.ties = 1;
        result.points += POINT_RULE.matchTie;
      }
      return result;
    }
    return { home: side(home, away), away: side(away, home) };
  }

  function emptyStore() {
    return { teams: [], players: [], matches: [] };
  }

  function storage() {
    try {
      return root.localStorage;
    } catch (err) {
      return null;
    }
  }

  function readJson(key) {
    var store = storage();
    if (!store) return null;
    try {
      var raw = store.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function writeJson(key, value) {
    var store = storage();
    if (!store) return;
    store.setItem(key, JSON.stringify(value));
  }

  function normalizeTeam(row) {
    return {
      id: String(row.id || "").trim(),
      name: String(row.name || "").trim() || "Unnamed team",
      active: asBool(row.active, true),
      sample: asBool(row.sample, false),
      updatedAt: String(row.updatedAt || "")
    };
  }

  function normalizePlayer(row) {
    return {
      id: String(row.id || "").trim(),
      teamId: String(row.teamId || "").trim(),
      name: String(row.name || "").trim() || "Unnamed player",
      active: asBool(row.active, true),
      sample: asBool(row.sample, false),
      updatedAt: String(row.updatedAt || "")
    };
  }

  function normalizeGames(games) {
    if (!Array.isArray(games)) return [];
    return games.map(function (game, index) {
      var winner = game && (game.winner === "home" || game.winner === "away") ? game.winner : "";
      return {
        label: String((game && game.label) || ("Game " + (index + 1))),
        homePlayerId: String((game && game.homePlayerId) || ""),
        homePlayerName: String((game && game.homePlayerName) || ""),
        awayPlayerId: String((game && game.awayPlayerId) || ""),
        awayPlayerName: String((game && game.awayPlayerName) || ""),
        winner: winner
      };
    }).filter(function (game) { return game.winner === "home" || game.winner === "away"; });
  }

  function normalizeMatch(row) {
    var games = row.games;
    if (!Array.isArray(games) && row.gamesJson) {
      try {
        games = typeof row.gamesJson === "string" ? JSON.parse(row.gamesJson) : row.gamesJson;
      } catch (err) {
        games = [];
      }
    }
    games = normalizeGames(games);
    var totals = games.length ? gamesTally(games) : {
      homeGamesWon: nonNegInt(row.homeGamesWon),
      awayGamesWon: nonNegInt(row.awayGamesWon)
    };
    return {
      id: String(row.id || "").trim(),
      date: sheetDate(row.date),
      homeTeamId: String(row.homeTeamId || "").trim(),
      awayTeamId: String(row.awayTeamId || "").trim(),
      homeGamesWon: totals.homeGamesWon,
      awayGamesWon: totals.awayGamesWon,
      games: games,
      submittedAt: String(row.submittedAt || ""),
      updatedAt: String(row.updatedAt || ""),
      sample: asBool(row.sample, false)
    };
  }

  function normalizeStore(raw) {
    var source = raw || {};
    return {
      teams: (source.teams || []).map(normalizeTeam).filter(function (row) { return row.id; }),
      players: (source.players || []).map(normalizePlayer).filter(function (row) { return row.id; }),
      matches: (source.matches || []).map(normalizeMatch).filter(function (row) { return row.id; })
    };
  }

  function snapshot() {
    return {
      teams: clone(state.teams),
      players: clone(state.players),
      matches: clone(state.matches),
      standings: calculateStandings(state.teams, state.matches),
      mode: mode,
      loadError: loadError,
      pendingCount: pending.length,
      sheetConfigured: sheetConfigured(),
      scriptConfigured: scriptConfigured(),
      lastTouched: lastTouched.slice(),
      pointRule: POINT_RULE.summary
    };
  }

  function emit() {
    var snap = snapshot();
    listeners.forEach(function (fn) {
      try { fn(snap); } catch (err) { /* a bad listener should not block a save */ }
    });
    return snap;
  }

  function rememberLocal() {
    if (mode === "local") writeJson(LOCAL_KEY, state);
    else writeJson(CACHE_KEY, state);
    writeJson(PENDING_KEY, pending);
  }

  function applyQueue(remote, queue) {
    var next = normalizeStore(remote);
    (queue || []).forEach(function (op) {
      if (!op || !op.action) return;
      if (op.action === "importData") {
        next = normalizeStore(op.data);
        return;
      }
      if (op.action === "saveTeam") upsertList(next.teams, normalizeTeam(op.team));
      if (op.action === "deleteTeam") {
        next.teams = next.teams.filter(function (team) { return team.id !== op.id; });
        next.players = next.players.filter(function (player) { return player.teamId !== op.id; });
      }
      if (op.action === "savePlayer") upsertList(next.players, normalizePlayer(op.player));
      if (op.action === "deletePlayer") {
        next.players = next.players.filter(function (player) { return player.id !== op.id; });
      }
      if (op.action === "submitMatch" || op.action === "saveMatch") {
        upsertList(next.matches, normalizeMatch(op.match));
      }
      if (op.action === "deleteMatch") {
        next.matches = next.matches.filter(function (match) { return match.id !== op.id; });
      }
    });
    return next;
  }

  function sameIdSet(remoteRows, localRows) {
    var remoteIds = (remoteRows || []).map(function (row) { return row.id; }).sort();
    var localIds = (localRows || []).map(function (row) { return row.id; }).sort();
    if (remoteIds.length !== localIds.length) return false;
    for (var i = 0; i < remoteIds.length; i += 1) {
      if (remoteIds[i] !== localIds[i]) return false;
    }
    return true;
  }

  function opLanded(op, remote) {
    var row;
    if (!op) return false;
    if (op.action === "submitMatch" || op.action === "saveMatch") {
      row = findById(remote.matches, op.match && op.match.id);
      return !!(row && String(row.updatedAt || "") >= String(op.match.updatedAt || ""));
    }
    if (op.action === "deleteMatch") return !findById(remote.matches, op.id);
    if (op.action === "saveTeam") {
      row = findById(remote.teams, op.team && op.team.id);
      return !!(row && String(row.updatedAt || "") >= String(op.team.updatedAt || "") && row.name === op.team.name);
    }
    if (op.action === "deleteTeam") return !findById(remote.teams, op.id);
    if (op.action === "savePlayer") {
      row = findById(remote.players, op.player && op.player.id);
      return !!(row && String(row.updatedAt || "") >= String(op.player.updatedAt || "") && row.name === op.player.name);
    }
    if (op.action === "deletePlayer") return !findById(remote.players, op.id);
    if (op.action === "importData") {
      var data = normalizeStore(op.data);
      return sameIdSet(remote.teams, data.teams) && sameIdSet(remote.players, data.players) && sameIdSet(remote.matches, data.matches);
    }
    return false;
  }

  function prunePending(remote) {
    pending = pending.filter(function (op) { return !opLanded(op, remote); });
  }

  function parseGviz(text) {
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("The sheet did not return a table.");
    var payload = JSON.parse(text.slice(start, end + 1));
    if (!payload.table) {
      var reason = (payload.errors && payload.errors[0] && payload.errors[0].detailed_message) || payload.status || "no table";
      throw new Error("Google Sheet: " + reason);
    }
    var cols = (payload.table.cols || []).map(function (col, index) {
      return String((col && (col.label || col.id)) || ("col" + index)).trim();
    });
    return (payload.table.rows || []).map(function (row) {
      var obj = {};
      cols.forEach(function (label, index) {
        var cell = row.c && row.c[index];
        obj[label] = cell && cell.v != null ? cell.v : "";
      });
      return obj;
    }).filter(function (obj) {
      return String(obj.id || "").trim() !== "";
    });
  }

  function gvizUrl(tab) {
    return "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(CONFIG.sheetId) +
      "/gviz/tq?tqx=out:json&headers=1&sheet=" + encodeURIComponent(tab) +
      "&t=" + Date.now();
  }

  function fetchTab(tab) {
    return fetch(gvizUrl(tab), { method: "GET", cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Could not read the " + tab + " tab (" + response.status + ").");
      return response.text();
    }).then(parseGviz);
  }

  function fetchRemote() {
    return Promise.all([fetchTab("Teams"), fetchTab("Players"), fetchTab("Matches")]).then(function (parts) {
      return normalizeStore({ teams: parts[0], players: parts[1], matches: parts[2] });
    });
  }

  function postToScript(body) {
    if (!scriptConfigured()) {
      return Promise.resolve({ ok: false, skipped: true });
    }
    return fetch(CONFIG.scriptUrl, {
      method: "POST",
      mode: "no-cors",
      body: JSON.stringify(body),
      headers: { "Content-Type": "text/plain;charset=utf-8" }
    }).then(function () {
      return { ok: true, opaque: true };
    }).catch(function () {
      return { ok: false, error: "Could not reach the Apps Script web app." };
    });
  }

  function jsonp(params) {
    return new Promise(function (resolve, reject) {
      if (!scriptConfigured()) {
        reject(new Error("Apps Script URL is not configured."));
        return;
      }
      if (!root.document) {
        reject(new Error("JSONP needs a browser."));
        return;
      }
      var cb = "rad_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
      var script = root.document.createElement("script");
      var timer = root.setTimeout(function () {
        cleanup();
        reject(new Error("The Apps Script check timed out."));
      }, 12000);
      function cleanup() {
        root.clearTimeout(timer);
        try { delete root[cb]; } catch (err) { root[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      root[cb] = function (data) {
        cleanup();
        resolve(data);
      };
      var qs = Object.keys(params).map(function (key) {
        return encodeURIComponent(key) + "=" + encodeURIComponent(params[key] == null ? "" : params[key]);
      }).join("&");
      var join = CONFIG.scriptUrl.indexOf("?") >= 0 ? "&" : "?";
      script.src = CONFIG.scriptUrl + join + qs + "&callback=" + cb;
      script.onerror = function () {
        cleanup();
        reject(new Error("Could not reach the Apps Script web app."));
      };
      root.document.head.appendChild(script);
    });
  }

  function enqueue(op) {
    pending.push(op);
    rememberLocal();
    if (op.action !== "submitMatch" && !adminSecret) {
      return Promise.resolve({ ok: false, skipped: true });
    }
    var payload = clone(op);
    if (op.action !== "submitMatch") payload.secret = adminSecret;
    return postToScript(payload);
  }

  function commit(touched, op) {
    lastTouched = touched || [];
    var sync = mode === "local" ? (rememberLocal(), Promise.resolve({ ok: true, local: true })) : enqueue(op);
    var snap = emit();
    return sync.then(function (result) {
      return { snapshot: snap, sync: result || { ok: true } };
    });
  }

  function replayPending() {
    if (!scriptConfigured()) return;
    pending.forEach(function (op) {
      if (op.action === "submitMatch") {
        postToScript(op);
        return;
      }
      if (!adminSecret) return;
      var payload = clone(op);
      payload.secret = adminSecret;
      postToScript(payload);
    });
  }

  function setState(next, touched) {
    state = normalizeStore(next);
    lastTouched = touched || [];
    rememberLocal();
    return emit();
  }

  function load() {
    pending = readJson(PENDING_KEY);
    if (!Array.isArray(pending)) pending = [];
    loadError = "";

    if (!sheetConfigured()) {
      mode = "local";
      var local = readJson(LOCAL_KEY);
      if (!local || !Array.isArray(local.teams)) {
        state = buildSeed();
        writeJson(LOCAL_KEY, state);
      } else {
        state = normalizeStore(local);
      }
      return Promise.resolve(emit());
    }

    mode = "sheet";
    return fetchRemote().then(function (remote) {
      prunePending(remote);
      state = applyQueue(remote, pending);
      writeJson(CACHE_KEY, remote);
      rememberLocal();
      replayPending();
      return emit();
    }).catch(function (err) {
      loadError = err && err.message ? err.message : "Could not read the Google Sheet.";
      var cache = readJson(CACHE_KEY);
      if (cache && Array.isArray(cache.teams)) {
        mode = "cache";
        state = applyQueue(cache, pending);
      } else {
        mode = "sheet";
        state = applyQueue(emptyStore(), pending);
      }
      return emit();
    });
  }

  function requireTeams(homeTeamId, awayTeamId) {
    var home = findById(state.teams, homeTeamId);
    var away = findById(state.teams, awayTeamId);
    if (!home || !away) throw new Error("Pick teams that are already on the list.");
    if (home.id === away.id) throw new Error("Pick two different teams.");
    return { home: home, away: away };
  }

  function prepareMatch(input) {
    var source = input || {};
    var sides = requireTeams(source.homeTeamId, source.awayTeamId);
    if (!sheetDate(source.date)) throw new Error("Add the match date.");
    var rawGames = Array.isArray(source.games) ? source.games : [];
    var games = [];
    rawGames.forEach(function (game, index) {
      var row = game || {};
      var winner = row.winner === "home" || row.winner === "away" ? row.winner : "";
      var touched = winner || row.homePlayerId || row.awayPlayerId || row.homePlayerName || row.awayPlayerName;
      if (!touched) return;
      if (!winner) throw new Error("Game " + (index + 1) + " needs a winner.");
      games.push({
        label: row.label || ("Game " + (index + 1)),
        homePlayerId: String(row.homePlayerId || ""),
        homePlayerName: String(row.homePlayerName || ""),
        awayPlayerId: String(row.awayPlayerId || ""),
        awayPlayerName: String(row.awayPlayerName || ""),
        winner: winner
      });
    });
    var totals;
    if (games.length) {
      totals = gamesTally(games);
    } else if (source.allowTotals) {
      totals = {
        homeGamesWon: nonNegInt(source.homeGamesWon),
        awayGamesWon: nonNegInt(source.awayGamesWon)
      };
      if (totals.homeGamesWon + totals.awayGamesWon < 1) {
        throw new Error("Enter at least one game.");
      }
    } else {
      throw new Error("Add at least one game.");
    }
    if (totals.homeGamesWon + totals.awayGamesWon > 30) {
      throw new Error("A match is limited to 30 games on this sheet.");
    }
    games = games.map(function (game, index) {
      var homePlayer = findById(state.players, game.homePlayerId);
      var awayPlayer = findById(state.players, game.awayPlayerId);
      return {
        label: game.label || ("Game " + (index + 1)),
        homePlayerId: homePlayer ? homePlayer.id : "",
        homePlayerName: homePlayer ? homePlayer.name : game.homePlayerName,
        awayPlayerId: awayPlayer ? awayPlayer.id : "",
        awayPlayerName: awayPlayer ? awayPlayer.name : game.awayPlayerName,
        winner: game.winner
      };
    });
    var stamp = nowIso();
    var existing = source.id ? findById(state.matches, source.id) : null;
    return {
      id: source.id || uid("m_"),
      date: sheetDate(source.date),
      homeTeamId: sides.home.id,
      awayTeamId: sides.away.id,
      homeGamesWon: totals.homeGamesWon,
      awayGamesWon: totals.awayGamesWon,
      games: games,
      submittedAt: existing ? existing.submittedAt : stamp,
      updatedAt: stamp,
      sample: source.sample === true
    };
  }

  function rejectPrepare(fn) {
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function submitMatch(input) {
    return rejectPrepare(function () {
      var match = prepareMatch(input);
      match.sample = false;
      upsertList(state.matches, match);
      return commit([match.homeTeamId, match.awayTeamId], { action: "submitMatch", match: match }).then(function (result) {
        result.match = match;
        return result;
      });
    });
  }

  function saveMatch(input) {
    return rejectPrepare(function () {
      var match = prepareMatch(input);
      if (input && input.id) {
        var previous = findById(state.matches, input.id);
        if (previous) match.sample = previous.sample;
      }
      upsertList(state.matches, match);
      return commit([match.homeTeamId, match.awayTeamId], { action: "saveMatch", match: match });
    });
  }

  function deleteMatch(id) {
    return rejectPrepare(function () {
      var existing = findById(state.matches, id);
      if (!existing) throw new Error("That match is already gone.");
      state.matches = state.matches.filter(function (match) { return match.id !== id; });
      return commit([existing.homeTeamId, existing.awayTeamId], { action: "deleteMatch", id: id });
    });
  }

  function saveTeam(input) {
    return rejectPrepare(function () {
      var name = String((input && input.name) || "").trim();
      if (!name) throw new Error("The team needs a name.");
      var existing = input && input.id ? findById(state.teams, input.id) : null;
      var team = {
        id: existing ? existing.id : uid("t_"),
        name: name,
        active: !input || input.active !== false,
        sample: existing ? !!existing.sample : false,
        updatedAt: nowIso()
      };
      upsertList(state.teams, team);
      return commit([team.id], { action: "saveTeam", team: team });
    });
  }

  function deleteTeam(id) {
    return rejectPrepare(function () {
      var used = state.matches.some(function (match) {
        return match.homeTeamId === id || match.awayTeamId === id;
      });
      if (used) throw new Error("This team is on a match. Delete those matches first, or rename the team.");
      if (!findById(state.teams, id)) throw new Error("That team is already gone.");
      state.teams = state.teams.filter(function (team) { return team.id !== id; });
      state.players = state.players.filter(function (player) { return player.teamId !== id; });
      return commit([], { action: "deleteTeam", id: id });
    });
  }

  function savePlayer(input) {
    return rejectPrepare(function () {
      var name = String((input && input.name) || "").trim();
      if (!name) throw new Error("The player needs a name.");
      var team = findById(state.teams, input && input.teamId);
      if (!team) throw new Error("Pick a team for this player.");
      var existing = input && input.id ? findById(state.players, input.id) : null;
      var player = {
        id: existing ? existing.id : uid("p_"),
        teamId: team.id,
        name: name,
        active: !input || input.active !== false,
        sample: existing ? !!existing.sample : false,
        updatedAt: nowIso()
      };
      upsertList(state.players, player);
      return commit([team.id], { action: "savePlayer", player: player });
    });
  }

  function deletePlayer(id) {
    return rejectPrepare(function () {
      var existing = findById(state.players, id);
      if (!existing) throw new Error("That player is already gone.");
      state.players = state.players.filter(function (player) { return player.id !== id; });
      return commit([existing.teamId], { action: "deletePlayer", id: id });
    });
  }

  function exportJson() {
    return JSON.stringify({
      version: 1,
      exportedAt: nowIso(),
      teams: state.teams,
      players: state.players,
      matches: state.matches
    }, null, 2);
  }

  function importData(raw) {
    return rejectPrepare(function () {
    var parsed = raw;
    if (typeof raw === "string") parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.teams) || !Array.isArray(parsed.players) || !Array.isArray(parsed.matches)) {
      throw new Error("That file needs teams, players, and matches arrays.");
    }
    var next = normalizeStore(parsed);
    ["teams", "players", "matches"].forEach(function (key) {
      var seen = {};
      next[key].forEach(function (row) {
        if (seen[row.id]) throw new Error("The backup repeats " + key + " id " + row.id + ".");
        seen[row.id] = true;
      });
    });
    next.players.forEach(function (player) {
      if (!findById(next.teams, player.teamId)) {
        throw new Error("Player " + player.name + " points at a missing team.");
      }
    });
    next.matches.forEach(function (match) {
      if (!findById(next.teams, match.homeTeamId) || !findById(next.teams, match.awayTeamId)) {
        throw new Error("A match points at a missing team.");
      }
    });
    state = next;
    lastTouched = next.teams.map(function (team) { return team.id; });
    pending = [];
    if (mode === "local") {
      rememberLocal();
      return { snapshot: emit(), sync: { ok: true, local: true } };
    }
    var sync = enqueue({ action: "importData", data: clone(next) });
    var snap = emit();
    return sync.then(function (result) {
      return { snapshot: snap, sync: result || { ok: true } };
    });
    });
  }

  function verifyAdmin(secret) {
    var given = String(secret || "");
    if (!scriptConfigured()) {
      var expected = String(CONFIG.fallbackAdminPasscode || "");
      if (!expected) return Promise.resolve({ ok: false, error: "Set fallbackAdminPasscode in config.js." });
      if (given !== expected) return Promise.resolve({ ok: false, error: "That passcode does not match config.js." });
      adminSecret = given;
      try { root.sessionStorage.setItem(SECRET_KEY, given); } catch (err) { /* ignore */ }
      return Promise.resolve({ ok: true, mode: "local" });
    }
    return jsonp({ action: "verifyAdmin", secret: given }).then(function (result) {
      if (result && result.ok) {
        adminSecret = given;
        try { root.sessionStorage.setItem(SECRET_KEY, given); } catch (err) { /* ignore */ }
        replayPending();
      }
      return result || { ok: false, error: "No answer from Apps Script." };
    });
  }

  function restoreSecret() {
    try {
      adminSecret = root.sessionStorage.getItem(SECRET_KEY) || "";
    } catch (err) {
      adminSecret = "";
    }
    return adminSecret;
  }

  function clearSecret() {
    adminSecret = "";
    try { root.sessionStorage.removeItem(SECRET_KEY); } catch (err) { /* ignore */ }
  }

  function subscribe(fn) {
    listeners.push(fn);
    return function () {
      listeners = listeners.filter(function (item) { return item !== fn; });
    };
  }

  root.RAD = {
    POINT_RULE: POINT_RULE,
    load: load,
    snapshot: snapshot,
    subscribe: subscribe,
    calculateStandings: calculateStandings,
    previewMatchPoints: previewMatchPoints,
    applyQueue: applyQueue,
    prepareMatch: prepareMatch,
    submitMatch: submitMatch,
    saveMatch: saveMatch,
    deleteMatch: deleteMatch,
    saveTeam: saveTeam,
    deleteTeam: deleteTeam,
    savePlayer: savePlayer,
    deletePlayer: deletePlayer,
    exportJson: exportJson,
    importData: importData,
    verifyAdmin: verifyAdmin,
    restoreSecret: restoreSecret,
    clearSecret: clearSecret,
    sheetConfigured: sheetConfigured,
    scriptConfigured: scriptConfigured,
    buildSeed: buildSeed,
    isUnconfigured: isUnconfigured
  };
})(typeof window !== "undefined" ? window : globalThis);
