(function () {
  "use strict";

  var snap = null;
  var matchGames = [{ homePlayerId: "", awayPlayerId: "", winner: "" }];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatDate(iso) {
    var parts = String(iso || "").split("-");
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    if (parts.length < 3 || !months[Number(parts[1]) - 1]) return iso || "";
    return months[Number(parts[1]) - 1] + " " + Number(parts[2]) + ", " + parts[0];
  }

  function message(text, isError) {
    var el = document.getElementById("admin-message");
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function syncNote(result) {
    var sync = (result && result.sync) || {};
    if (sync.local) return "Saved on this phone. Google Sheets is not connected, so other visitors will not see it yet. Standings above are already recalculated.";
    if (sync.skipped) return "Saved on this phone only. The Apps Script URL is still a placeholder. Standings above are already recalculated.";
    if (sync.ok === false) return "Shown here and queued on this phone. The sheet did not take it just now. Standings above are already recalculated.";
    return "Saved. Standings above are already recalculated, and the change was sent to the sheet.";
  }

  function run(promise) {
    Promise.resolve(promise).then(function (result) {
      message(syncNote(result), result && result.sync && result.sync.ok === false && !result.sync.local);
    }).catch(function (err) {
      message(err.message || "That change did not save.", true);
    });
  }

  function teamOptions(selected) {
    return (snap.teams || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (team) {
      return '<option value="' + esc(team.id) + '"' + (team.id === selected ? " selected" : "") + ">" + esc(team.name) + "</option>";
    }).join("");
  }

  function fillSelect(id, selected) {
    var select = document.getElementById(id);
    var current = selected == null ? select.value : selected;
    select.innerHTML = teamOptions(current);
    if (current) select.value = current;
  }

  function playersFor(teamId) {
    return (snap.players || []).filter(function (player) { return player.teamId === teamId; });
  }

  function playerOptions(teamId, selected) {
    var html = '<option value="">Not listed</option>';
    playersFor(teamId).forEach(function (player) {
      html += '<option value="' + esc(player.id) + '"' + (player.id === selected ? " selected" : "") + ">" + esc(player.name) + "</option>";
    });
    return html;
  }

  function sampleTag(name, sample) {
    if (!sample || /sample/i.test(name || "")) return "";
    return '<span class="sample-tag">SAMPLE</span> ';
  }

  function teamName(id) {
    var team = (snap.teams || []).filter(function (item) { return item.id === id; })[0];
    return team ? team.name : "Team";
  }

  function syncMatchGames() {
    document.querySelectorAll("#match-games [data-game]").forEach(function (row, index) {
      if (!matchGames[index]) return;
      var winner = row.querySelector("input[type=radio]:checked");
      matchGames[index].winner = winner ? winner.value : "";
      matchGames[index].homePlayerId = row.querySelector("[data-home-player]").value;
      matchGames[index].awayPlayerId = row.querySelector("[data-away-player]").value;
    });
  }

  function renderMatchGames() {
    var homeId = document.getElementById("match-home").value;
    var awayId = document.getElementById("match-away").value;
    document.getElementById("match-games").innerHTML = matchGames.map(function (game, index) {
      return (
        '<div class="game-row" data-game>' +
        '<div class="game-row-top"><span>Game ' + (index + 1) + '</span><button class="text-btn" type="button" data-remove-game>Remove</button></div>' +
        '<label class="field">Home player<select data-home-player>' + playerOptions(homeId, game.homePlayerId) + "</select></label>" +
        '<label class="field">Away player<select data-away-player>' + playerOptions(awayId, game.awayPlayerId) + "</select></label>" +
        '<fieldset class="winner-picks"><legend>Winner of game ' + (index + 1) + "</legend>" +
        '<label><input type="radio" name="mg-' + index + '" value="home"' + (game.winner === "home" ? " checked" : "") + "> <span>Home</span></label>" +
        '<label><input type="radio" name="mg-' + index + '" value="away"' + (game.winner === "away" ? " checked" : "") + "> <span>Away</span></label>" +
        "</fieldset></div>"
      );
    }).join("");
    var home = matchGames.filter(function (game) { return game.winner === "home"; }).length;
    var away = matchGames.filter(function (game) { return game.winner === "away"; }).length;
    document.getElementById("match-tally").textContent = teamName(homeId) + " " + home + " – " + away + " " + teamName(awayId);
  }

  function renderStandings() {
    var rows = snap.standings || [];
    document.getElementById("admin-rule").textContent = snap.pointRule || "";
    var host = document.getElementById("admin-standings-table");
    if (!rows.length) {
      host.innerHTML = '<p class="empty">No teams yet.</p>';
      return;
    }
    host.innerHTML =
      '<div class="table-scroll standings-fit"><table><thead><tr>' +
      "<th>Rank</th><th>Team</th><th>W</th><th>L</th><th>Ties</th><th>Games won</th><th>Points</th>" +
      "</tr></thead><tbody>" + rows.map(function (row) {
        var fresh = snap.lastTouched && snap.lastTouched.indexOf(row.teamId) >= 0 ? "is-fresh" : "";
        var tag = sampleTag(row.teamName, row.sample);
        return '<tr class="' + fresh + '" data-team="' + esc(row.teamId) + '"><td class="num" data-label="Rank">' + row.rank +
          '</td><th scope="row">' + tag + esc(row.teamName) + '</th><td class="num" data-label="Wins">' + row.wins +
          '</td><td class="num" data-label="Losses">' + row.losses + '</td><td class="num" data-label="Ties">' + row.ties +
          '</td><td class="num" data-label="Games won">' + row.gamesWon + '</td><td class="num" data-label="Points">' + row.points + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function renderTeams() {
    document.getElementById("team-list").innerHTML = (snap.teams || []).slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    }).map(function (team) {
      var tag = sampleTag(team.name, team.sample);
      return '<article class="admin-card"><h3>' + tag + esc(team.name) + "</h3><p class=\"muted\">" +
        (team.active === false ? "Inactive" : "Active") + "</p><div class=\"row-actions\">" +
        '<button class="btn btn-ink btn-small" type="button" data-edit-team="' + esc(team.id) + '">Edit</button>' +
        '<button class="btn btn-ink btn-small" type="button" data-delete-team="' + esc(team.id) + '">Delete</button></div></article>';
    }).join("") || '<p class="empty">No teams yet.</p>';
  }

  function renderPlayers() {
    document.getElementById("player-list").innerHTML = (snap.players || []).slice().sort(function (a, b) {
      return (teamName(a.teamId) + a.name).localeCompare(teamName(b.teamId) + b.name);
    }).map(function (player) {
      var tag = sampleTag(player.name, player.sample);
      return '<article class="admin-card"><h3>' + tag + esc(player.name) + "</h3><p class=\"muted\">" +
        esc(teamName(player.teamId)) + (player.active === false ? " · inactive" : "") + "</p><div class=\"row-actions\">" +
        '<button class="btn btn-ink btn-small" type="button" data-edit-player="' + esc(player.id) + '">Edit</button>' +
        '<button class="btn btn-ink btn-small" type="button" data-delete-player="' + esc(player.id) + '">Delete</button></div></article>';
    }).join("") || '<p class="empty">No players yet.</p>';
  }

  function renderMatches() {
    var matches = (snap.matches || []).slice().sort(function (a, b) {
      if (a.date === b.date) return String(b.submittedAt).localeCompare(String(a.submittedAt));
      return String(b.date).localeCompare(String(a.date));
    });
    document.getElementById("match-list").innerHTML = matches.map(function (match) {
      var tag = match.sample ? '<span class="sample-tag">SAMPLE</span> ' : "";
      return '<article class="admin-card"><h3>' + tag + esc(formatDate(match.date)) + "</h3><p>" +
        esc(teamName(match.homeTeamId)) + " " + match.homeGamesWon + ", " +
        esc(teamName(match.awayTeamId)) + " " + match.awayGamesWon + "</p><div class=\"row-actions\">" +
        '<button class="btn btn-ink btn-small" type="button" data-edit-match="' + esc(match.id) + '">Edit</button>' +
        '<button class="btn btn-ink btn-small" type="button" data-delete-match="' + esc(match.id) + '">Delete</button></div></article>';
    }).join("") || '<p class="empty">No matches yet.</p>';
  }

  function render(data) {
    snap = data;
    var where = data.mode === "local"
      ? "Using localStorage on this browser. The sheet in config.js is not connected."
      : (data.scriptConfigured
        ? "Connected to the Google Sheet for reads and the Apps Script web app for writes."
        : "Reading the Google Sheet, but writes stay on this phone until scriptUrl is set.");
    if (data.loadError) where = data.loadError + " " + where;
    if (data.pendingCount) where += " " + data.pendingCount + " change(s) still syncing.";
    document.getElementById("admin-mode").textContent = where;
    fillSelect("player-team");
    fillSelect("match-home");
    fillSelect("match-away");
    renderStandings();
    renderTeams();
    renderPlayers();
    renderMatches();
  }

  function resetTeamForm() {
    document.getElementById("team-form").reset();
    document.getElementById("team-id").value = "";
    document.getElementById("team-active").checked = true;
    document.getElementById("team-cancel").hidden = true;
  }

  function resetPlayerForm() {
    document.getElementById("player-form").reset();
    document.getElementById("player-id").value = "";
    document.getElementById("player-active").checked = true;
    document.getElementById("player-cancel").hidden = true;
  }

  function resetMatchForm() {
    document.getElementById("match-id").value = "";
    document.getElementById("match-date").value = "";
    matchGames = [{ homePlayerId: "", awayPlayerId: "", winner: "" }];
    document.getElementById("match-cancel").hidden = true;
    document.getElementById("match-save").textContent = "Save match";
    renderMatchGames();
  }

  function unlock() {
    document.getElementById("lock-screen").hidden = true;
    document.getElementById("admin-app").hidden = false;
    RAD.subscribe(function (data) { render(data); });
    RAD.load().then(function (data) {
      render(data);
      renderMatchGames();
    });
  }

  if (!RAD.scriptConfigured()) {
    document.getElementById("lock-detail").innerHTML =
      "<strong>This lock is light, not real security.</strong> Google Sheets is not connected, so the passcode is checked in this page’s JavaScript. " +
      "It is <code>fallbackAdminPasscode</code> in config.js, currently <strong>" + esc(window.RAD_CONFIG.fallbackAdminPasscode || "") +
      "</strong>. Anyone can read that file. Don’t store anything sensitive here.";
  }

  var saved = RAD.restoreSecret();
  if (saved) {
    document.getElementById("lock-status").textContent = "Checking the saved passcode…";
    RAD.verifyAdmin(saved).then(function (result) {
      if (result && result.ok) unlock();
      else {
        RAD.clearSecret();
        document.getElementById("lock-status").textContent = (result && result.error) || "Enter the passcode.";
      }
    }).catch(function (err) {
      document.getElementById("lock-status").textContent = err.message || "Could not check the passcode.";
    });
  }

  document.getElementById("lock-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var status = document.getElementById("lock-status");
    status.textContent = "Checking…";
    RAD.verifyAdmin(document.getElementById("passcode").value).then(function (result) {
      if (result && result.ok) unlock();
      else status.textContent = (result && result.error) || "That passcode was rejected.";
    }).catch(function (err) {
      status.textContent = err.message || "Could not check the passcode.";
    });
  });

  document.getElementById("lock-again").addEventListener("click", function () {
    RAD.clearSecret();
    window.location.reload();
  });

  document.getElementById("team-form").addEventListener("submit", function (event) {
    event.preventDefault();
    RAD.saveTeam({
      id: document.getElementById("team-id").value,
      name: document.getElementById("team-name").value,
      active: document.getElementById("team-active").checked
    }).then(function (result) {
      resetTeamForm();
      message(syncNote(result), result && result.sync && result.sync.ok === false && !result.sync.local);
    }).catch(function (err) {
      message(err.message || "That team did not save.", true);
    });
  });
  document.getElementById("team-cancel").addEventListener("click", resetTeamForm);
  document.getElementById("team-list").addEventListener("click", function (event) {
    var edit = event.target.closest("[data-edit-team]");
    var del = event.target.closest("[data-delete-team]");
    if (edit) {
      var team = snap.teams.filter(function (item) { return item.id === edit.getAttribute("data-edit-team"); })[0];
      if (!team) return;
      document.getElementById("team-id").value = team.id;
      document.getElementById("team-name").value = team.name;
      document.getElementById("team-active").checked = team.active !== false;
      document.getElementById("team-cancel").hidden = false;
      document.getElementById("team-name").focus();
    }
    if (del) {
      var id = del.getAttribute("data-delete-team");
      var named = teamName(id);
      if (window.confirm("Delete " + named + "? Players on that team are removed too. Matches block the delete.")) {
        run(RAD.deleteTeam(id));
      }
    }
  });

  document.getElementById("player-form").addEventListener("submit", function (event) {
    event.preventDefault();
    RAD.savePlayer({
      id: document.getElementById("player-id").value,
      name: document.getElementById("player-name").value,
      teamId: document.getElementById("player-team").value,
      active: document.getElementById("player-active").checked
    }).then(function (result) {
      resetPlayerForm();
      message(syncNote(result), result && result.sync && result.sync.ok === false && !result.sync.local);
    }).catch(function (err) {
      message(err.message || "That player did not save.", true);
    });
  });
  document.getElementById("player-cancel").addEventListener("click", resetPlayerForm);
  document.getElementById("player-list").addEventListener("click", function (event) {
    var edit = event.target.closest("[data-edit-player]");
    var del = event.target.closest("[data-delete-player]");
    if (edit) {
      var player = snap.players.filter(function (item) { return item.id === edit.getAttribute("data-edit-player"); })[0];
      if (!player) return;
      document.getElementById("player-id").value = player.id;
      document.getElementById("player-name").value = player.name;
      document.getElementById("player-team").value = player.teamId;
      document.getElementById("player-active").checked = player.active !== false;
      document.getElementById("player-cancel").hidden = false;
      document.getElementById("player-name").focus();
    }
    if (del && window.confirm("Delete this player? Old score sheets keep the name that was saved on them.")) {
      run(RAD.deletePlayer(del.getAttribute("data-delete-player")));
    }
  });

  document.getElementById("match-form").addEventListener("submit", function (event) {
    event.preventDefault();
    syncMatchGames();
    RAD.saveMatch({
      id: document.getElementById("match-id").value,
      date: document.getElementById("match-date").value,
      homeTeamId: document.getElementById("match-home").value,
      awayTeamId: document.getElementById("match-away").value,
      games: matchGames.map(function (game, index) {
        return {
          label: "Game " + (index + 1),
          homePlayerId: game.homePlayerId,
          awayPlayerId: game.awayPlayerId,
          winner: game.winner
        };
      })
    }).then(function (result) {
      resetMatchForm();
      message(syncNote(result), result && result.sync && result.sync.ok === false && !result.sync.local);
    }).catch(function (err) {
      message(err.message || "That match did not save.", true);
    });
  });
  document.getElementById("match-add-game").addEventListener("click", function () {
    syncMatchGames();
    if (matchGames.length >= 30) return;
    matchGames.push({ homePlayerId: "", awayPlayerId: "", winner: "" });
    renderMatchGames();
  });
  document.getElementById("match-games").addEventListener("click", function (event) {
    var button = event.target.closest("[data-remove-game]");
    if (!button) return;
    syncMatchGames();
    var rows = Array.prototype.slice.call(document.querySelectorAll("#match-games [data-game]"));
    var index = rows.indexOf(button.closest("[data-game]"));
    if (index >= 0) matchGames.splice(index, 1);
    if (!matchGames.length) matchGames = [{ homePlayerId: "", awayPlayerId: "", winner: "" }];
    renderMatchGames();
  });
  document.getElementById("match-games").addEventListener("change", function () {
    syncMatchGames();
    renderMatchGames();
  });
  document.getElementById("match-home").addEventListener("change", function () {
    syncMatchGames();
    renderMatchGames();
  });
  document.getElementById("match-away").addEventListener("change", function () {
    syncMatchGames();
    renderMatchGames();
  });
  document.getElementById("match-cancel").addEventListener("click", resetMatchForm);
  document.getElementById("match-list").addEventListener("click", function (event) {
    var edit = event.target.closest("[data-edit-match]");
    var del = event.target.closest("[data-delete-match]");
    if (edit) {
      var match = snap.matches.filter(function (item) { return item.id === edit.getAttribute("data-edit-match"); })[0];
      if (!match) return;
      document.getElementById("match-id").value = match.id;
      document.getElementById("match-date").value = match.date;
      document.getElementById("match-home").value = match.homeTeamId;
      document.getElementById("match-away").value = match.awayTeamId;
      matchGames = (match.games && match.games.length ? match.games : []).map(function (game) {
        return {
          homePlayerId: game.homePlayerId || "",
          awayPlayerId: game.awayPlayerId || "",
          winner: game.winner
        };
      });
      if (!matchGames.length) {
        var i;
        matchGames = [];
        for (i = 0; i < match.homeGamesWon; i += 1) matchGames.push({ homePlayerId: "", awayPlayerId: "", winner: "home" });
        for (i = 0; i < match.awayGamesWon; i += 1) matchGames.push({ homePlayerId: "", awayPlayerId: "", winner: "away" });
      }
      document.getElementById("match-cancel").hidden = false;
      document.getElementById("match-save").textContent = "Save changes";
      renderMatchGames();
      document.getElementById("match-form").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (del && window.confirm("Delete this match? Standings will recalculate.")) {
      run(RAD.deleteMatch(del.getAttribute("data-delete-match")));
    }
  });

  document.getElementById("export-json").addEventListener("click", function () {
    var blob = new Blob([RAD.exportJson()], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "roslyn-american-darts-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    message("Backup downloaded.");
  });

  document.getElementById("import-json").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      if (!window.confirm("Replace every team, player, and match with this file?")) return;
      run(RAD.importData(String(reader.result || "")));
    };
    reader.readAsText(file);
  });

  document.getElementById("restore-sample").addEventListener("click", function () {
    if (!window.confirm("Replace the current lists with the SAMPLE starter teams, players, and matches?")) return;
    run(RAD.importData(RAD.buildSeed()));
  });
})();
