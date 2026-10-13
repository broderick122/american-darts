/**
 * Roslyn American Darts — Google Apps Script web app.
 *
 * Reads on the website come from the published sheet (gviz). Writes from the
 * score sheet and the admin page come here, through doPost.
 *
 * Setup (full steps are in the repo README):
 * 1. Paste this file into Extensions → Apps Script on the league spreadsheet.
 * 2. Run setupSheets once and authorize.
 * 3. Project Settings → Script properties → ADMIN_SECRET = a passcode you choose.
 * 4. Deploy → Web app → Execute as: Me → Who has access: Anyone.
 *
 * Admin actions require that shared secret. Score-sheet submits do not, so a
 * visitor can record a match. The secret still lives in the browser when an
 * admin unlocks the page — it is a light check, not real security.
 *
 * Standings math must match js/data.js calculateStandings:
 *   points = games won + 2 for a match win + 1 for a tie
 *   rank by points, then wins, then games won; a three-way tie shares a rank.
 */

var TABS = {
  teams: "Teams",
  players: "Players",
  matches: "Matches",
  standings: "Standings"
};

var HEADERS = {
  Teams: ["id", "name", "active", "sample", "updatedAt"],
  Players: ["id", "teamId", "name", "active", "sample", "updatedAt"],
  Matches: ["id", "date", "homeTeamId", "awayTeamId", "homeGamesWon", "awayGamesWon", "gamesJson", "submittedAt", "updatedAt", "sample"],
  Standings: ["rank", "teamId", "teamName", "wins", "losses", "ties", "gamesWon", "points", "updatedAt"]
};

var ADMIN_ACTIONS = {
  verifyAdmin: true,
  saveTeam: true,
  deleteTeam: true,
  savePlayer: true,
  deletePlayer: true,
  saveMatch: true,
  deleteMatch: true,
  importData: true
};

function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    var headers = HEADERS[name];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.getRange("A:Z").setNumberFormat("@");
  });
  var defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }
  rebuildStandings_();
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = params.action || "ping";
  var result;
  if (action === "verifyAdmin") {
    result = verifyAdmin_(params.secret);
  } else if (action === "ping") {
    result = {
      ok: true,
      service: "roslyn-american-darts",
      adminSecretSet: !!secretExpected_()
    };
  } else {
    result = { ok: false, error: "Unknown action." };
  }
  return respond_(result, params.callback);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    lock.waitLock(20000);
    locked = true;
    var body = {};
    try {
      body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
    } catch (err) {
      return respond_({ ok: false, error: "Expected a JSON body." });
    }
    var action = body.action;
    if (ADMIN_ACTIONS[action] && !secretOk_(body.secret)) {
      return respond_({ ok: false, error: secretExpected_() ? "Admin secret rejected." : "Set ADMIN_SECRET in the script properties first." });
    }
    if (action === "submitMatch") submitMatch_(body.match, false);
    else if (action === "saveMatch") submitMatch_(body.match, true);
    else if (action === "deleteMatch") deleteById_(TABS.matches, body.id);
    else if (action === "saveTeam") saveTeam_(body.team);
    else if (action === "deleteTeam") deleteTeam_(body.id);
    else if (action === "savePlayer") savePlayer_(body.player);
    else if (action === "deletePlayer") deleteById_(TABS.players, body.id);
    else if (action === "importData") importAll_(body.data);
    else return respond_({ ok: false, error: "Unknown action." });
    var standings = rebuildStandings_();
    return respond_({ ok: true, action: action, standings: standings });
  } catch (err) {
    return respond_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function verifyAdmin_(secret) {
  if (!secretExpected_()) {
    return { ok: false, error: "Set ADMIN_SECRET in the script properties first." };
  }
  if (!secretOk_(secret)) return { ok: false, error: "Admin secret rejected." };
  return { ok: true };
}

function secretExpected_() {
  return PropertiesService.getScriptProperties().getProperty("ADMIN_SECRET") || "";
}

function secretOk_(given) {
  var expected = secretExpected_();
  if (!expected) return false;
  return String(given || "") === String(expected);
}

function submitMatch_(match, allowUpdate) {
  if (!match || !match.id) throw new Error("The match needs an id.");
  var teams = indexById_(readObjects_(TABS.teams));
  if (!teams[match.homeTeamId] || !teams[match.awayTeamId]) throw new Error("Both teams must already be on the Teams tab.");
  if (match.homeTeamId === match.awayTeamId) throw new Error("Pick two different teams.");
  if (!match.date) throw new Error("The match needs a date.");
  var row = matchToRow_(match);
  var total = Number(row.homeGamesWon) + Number(row.awayGamesWon);
  if (total < 1) throw new Error("Add at least one game.");
  if (total > 30) throw new Error("A match is limited to 30 games.");
  var existing = findRow_(TABS.matches, row.id);
  if (existing && !allowUpdate) return;
  writeRow_(TABS.matches, row, existing);
}

function saveTeam_(team) {
  if (!team || !team.id) throw new Error("The team needs an id.");
  if (!String(team.name || "").trim()) throw new Error("The team needs a name.");
  writeRow_(TABS.teams, {
    id: String(team.id),
    name: String(team.name).trim(),
    active: team.active === false ? "false" : "true",
    sample: team.sample ? "true" : "false",
    updatedAt: String(team.updatedAt || new Date().toISOString())
  }, findRow_(TABS.teams, team.id));
}

function deleteTeam_(id) {
  if (!id) throw new Error("Missing team id.");
  var matches = readObjects_(TABS.matches);
  var used = matches.some(function (match) {
    return match.homeTeamId === id || match.awayTeamId === id;
  });
  if (used) throw new Error("This team is on a match. Delete those matches first.");
  deleteById_(TABS.teams, id);
  var players = readObjects_(TABS.players).filter(function (player) {
    return player.teamId === id;
  });
  players.forEach(function (player) {
    deleteById_(TABS.players, player.id);
  });
}

function savePlayer_(player) {
  if (!player || !player.id) throw new Error("The player needs an id.");
  if (!String(player.name || "").trim()) throw new Error("The player needs a name.");
  var teams = indexById_(readObjects_(TABS.teams));
  if (!teams[player.teamId]) throw new Error("Pick a team that is already on the Teams tab.");
  writeRow_(TABS.players, {
    id: String(player.id),
    teamId: String(player.teamId),
    name: String(player.name).trim(),
    active: player.active === false ? "false" : "true",
    sample: player.sample ? "true" : "false",
    updatedAt: String(player.updatedAt || new Date().toISOString())
  }, findRow_(TABS.players, player.id));
}

function importAll_(data) {
  if (!data || !Array.isArray(data.teams) || !Array.isArray(data.players) || !Array.isArray(data.matches)) {
    throw new Error("Import needs teams, players, and matches arrays.");
  }
  var teams = data.teams.map(function (team) {
    return {
      id: String(team.id || ""),
      name: String(team.name || "").trim(),
      active: team.active === false ? "false" : "true",
      sample: team.sample ? "true" : "false",
      updatedAt: String(team.updatedAt || "")
    };
  }).filter(function (team) { return team.id && team.name; });
  var teamIds = indexById_(teams);
  var players = data.players.map(function (player) {
    return {
      id: String(player.id || ""),
      teamId: String(player.teamId || ""),
      name: String(player.name || "").trim(),
      active: player.active === false ? "false" : "true",
      sample: player.sample ? "true" : "false",
      updatedAt: String(player.updatedAt || "")
    };
  }).filter(function (player) { return player.id && player.name && teamIds[player.teamId]; });
  var matches = data.matches.map(matchToRow_).filter(function (match) {
    return match.id && teamIds[match.homeTeamId] && teamIds[match.awayTeamId];
  });
  replaceTab_(TABS.teams, teams);
  replaceTab_(TABS.players, players);
  replaceTab_(TABS.matches, matches);
}

function matchToRow_(match) {
  var games = [];
  if (Array.isArray(match.games)) games = match.games;
  else if (match.gamesJson) {
    try { games = JSON.parse(match.gamesJson); } catch (err) { games = []; }
  }
  var home = 0;
  var away = 0;
  var clean = [];
  (games || []).forEach(function (game, index) {
    if (!game || (game.winner !== "home" && game.winner !== "away")) return;
    if (game.winner === "home") home += 1;
    else away += 1;
    clean.push({
      label: String(game.label || ("Game " + (index + 1))),
      homePlayerId: String(game.homePlayerId || ""),
      homePlayerName: String(game.homePlayerName || ""),
      awayPlayerId: String(game.awayPlayerId || ""),
      awayPlayerName: String(game.awayPlayerName || ""),
      winner: game.winner
    });
  });
  if (!clean.length) {
    home = nonNegInt_(match.homeGamesWon);
    away = nonNegInt_(match.awayGamesWon);
  }
  return {
    id: String(match.id || ""),
    date: String(match.date || "").slice(0, 10),
    homeTeamId: String(match.homeTeamId || ""),
    awayTeamId: String(match.awayTeamId || ""),
    homeGamesWon: String(home),
    awayGamesWon: String(away),
    gamesJson: JSON.stringify(clean),
    submittedAt: String(match.submittedAt || ""),
    updatedAt: String(match.updatedAt || new Date().toISOString()),
    sample: match.sample === true || match.sample === "true" ? "true" : "false"
  };
}

function rebuildStandings_() {
  var teams = readObjects_(TABS.teams);
  var matches = readObjects_(TABS.matches);
  var table = {};
  teams.forEach(function (team) {
    if (!team.id) return;
    table[team.id] = {
      teamId: team.id,
      teamName: team.name || "Unnamed team",
      active: String(team.active).toLowerCase() !== "false",
      wins: 0,
      losses: 0,
      ties: 0,
      gamesWon: 0,
      points: 0
    };
  });
  matches.forEach(function (match) {
    var homeGames = nonNegInt_(match.homeGamesWon);
    var awayGames = nonNegInt_(match.awayGamesWon);
    [
      { id: match.homeTeamId, games: homeGames, other: awayGames },
      { id: match.awayTeamId, games: awayGames, other: homeGames }
    ].forEach(function (side) {
      if (!side.id) return;
      if (!table[side.id]) {
        table[side.id] = {
          teamId: side.id,
          teamName: "Missing team (" + side.id + ")",
          active: true,
          wins: 0,
          losses: 0,
          ties: 0,
          gamesWon: 0,
          points: 0
        };
      }
      var row = table[side.id];
      row.gamesWon += side.games;
      row.points += side.games;
      if (side.games > side.other) {
        row.wins += 1;
        row.points += 2;
      } else if (side.games < side.other) {
        row.losses += 1;
      } else {
        row.ties += 1;
        row.points += 1;
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
  var stamp = new Date().toISOString();
  var lines = rows.map(function (row) {
    return {
      rank: String(row.rank),
      teamId: row.teamId,
      teamName: row.teamName,
      wins: String(row.wins),
      losses: String(row.losses),
      ties: String(row.ties),
      gamesWon: String(row.gamesWon),
      points: String(row.points),
      updatedAt: stamp
    };
  });
  replaceTab_(TABS.standings, lines);
  return lines;
}

function readObjects_(tabName) {
  var sheet = sheet_(tabName);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  var headers = values[0].map(function (cell) { return String(cell || "").trim(); });
  var out = [];
  for (var r = 1; r < values.length; r += 1) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < headers.length; c += 1) {
      if (!headers[c]) continue;
      obj[headers[c]] = values[r][c] == null ? "" : String(values[r][c]);
      if (obj[headers[c]] !== "") empty = false;
    }
    if (!empty && obj.id) out.push(obj);
  }
  return out;
}

function writeRow_(tabName, record, sheetRow) {
  var sheet = sheet_(tabName);
  var headers = HEADERS[tabName];
  var line = headers.map(function (header) {
    return record[header] == null ? "" : String(record[header]);
  });
  if (!sheetRow) sheet.appendRow(line);
  else sheet.getRange(sheetRow, 1, 1, headers.length).setValues([line]);
}

function findRow_(tabName, id) {
  var values = sheet_(tabName).getDataRange().getValues();
  if (!values.length) return 0;
  var idCol = values[0].map(String).indexOf("id");
  if (idCol < 0) idCol = 0;
  for (var r = 1; r < values.length; r += 1) {
    if (String(values[r][idCol]) === String(id)) return r + 1;
  }
  return 0;
}

function deleteById_(tabName, id) {
  var sheetRow = findRow_(tabName, id);
  if (!sheetRow) return;
  sheet_(tabName).deleteRow(sheetRow);
}

function replaceTab_(tabName, records) {
  var sheet = sheet_(tabName);
  var headers = HEADERS[tabName];
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, headers.length).clearContent();
  if (!records.length) return;
  var lines = records.map(function (record) {
    return headers.map(function (header) {
      return record[header] == null ? "" : String(record[header]);
    });
  });
  sheet.getRange(2, 1, lines.length, headers.length).setValues(lines);
}

function sheet_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("Missing the " + name + " tab. Run setupSheets from the script editor.");
  return sheet;
}

function indexById_(rows) {
  var out = {};
  rows.forEach(function (row) { if (row.id) out[row.id] = row; });
  return out;
}

function nonNegInt_(value) {
  var n = Number(value);
  if (!isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function respond_(payload, callback) {
  var text = JSON.stringify(payload);
  if (callback && /^[A-Za-z0-9_]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + text + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}
