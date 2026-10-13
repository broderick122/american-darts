(function () {
  "use strict";

  var navButton = document.querySelector(".nav-button");
  var nav = document.getElementById("site-nav");
  var games = blankGames(4);
  var snap = null;

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

  function blankGames(count) {
    var rows = [];
    for (var i = 0; i < count; i += 1) {
      rows.push({ homePlayerId: "", awayPlayerId: "", winner: "" });
    }
    return rows;
  }

  function sampleTag(name, sample) {
    if (!sample || /sample/i.test(name || "")) return "";
    return '<span class="sample-tag">SAMPLE</span> ';
  }

  function teamName(id) {
    if (!snap) return "Team";
    var team = (snap.teams || []).filter(function (item) { return item.id === id; })[0];
    return team ? team.name : "Team";
  }

  function activeTeams() {
    return (snap.teams || []).filter(function (team) { return team.active !== false; })
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function playersFor(teamId) {
    return (snap.players || []).filter(function (player) {
      return player.teamId === teamId && player.active !== false;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  function syncGamesFromDom() {
    var rows = document.querySelectorAll("[data-game]");
    rows.forEach(function (row, index) {
      if (!games[index]) return;
      var winner = row.querySelector("input[type=radio]:checked");
      games[index].winner = winner ? winner.value : "";
      games[index].homePlayerId = row.querySelector("[data-home-player]").value;
      games[index].awayPlayerId = row.querySelector("[data-away-player]").value;
    });
  }

  function playerOptions(teamId, selected) {
    var html = '<option value="">Not listed</option>';
    playersFor(teamId).forEach(function (player) {
      html += '<option value="' + esc(player.id) + '"' + (player.id === selected ? " selected" : "") + ">" + esc(player.name) + "</option>";
    });
    return html;
  }

  function renderGames() {
    var homeId = document.getElementById("score-home").value;
    var awayId = document.getElementById("score-away").value;
    var list = document.getElementById("game-list");
    list.innerHTML = games.map(function (game, index) {
      var homeChecked = game.winner === "home" ? " checked" : "";
      var awayChecked = game.winner === "away" ? " checked" : "";
      return (
        '<div class="game-row" data-game>' +
          '<div class="game-row-top"><span>Game ' + (index + 1) + '</span>' +
          '<button class="text-btn" type="button" data-remove-game>Remove</button></div>' +
          '<label class="field">Home player<select data-home-player>' + playerOptions(homeId, game.homePlayerId) + "</select></label>" +
          '<label class="field">Away player<select data-away-player>' + playerOptions(awayId, game.awayPlayerId) + "</select></label>" +
          '<fieldset class="winner-picks"><legend>Winner of game ' + (index + 1) + "</legend>" +
          '<label><input type="radio" name="winner-' + index + '" value="home"' + homeChecked + "> <span>" + esc(teamName(homeId)) + "</span></label>" +
          '<label><input type="radio" name="winner-' + index + '" value="away"' + awayChecked + "> <span>" + esc(teamName(awayId)) + "</span></label>" +
          "</fieldset></div>"
      );
    }).join("");
    updateTally();
  }

  function updateTally() {
    syncGamesFromDom();
    var home = 0;
    var away = 0;
    games.forEach(function (game) {
      if (game.winner === "home") home += 1;
      if (game.winner === "away") away += 1;
    });
    var homeId = document.getElementById("score-home").value;
    var awayId = document.getElementById("score-away").value;
    var line = esc(teamName(homeId)) + " " + home + "  –  " + away + " " + esc(teamName(awayId));
    if (home + away === 0) line = "Mark a winner on each game you played.";
    else if (home === away) line += " · tied match so far";
    else line += home > away ? " · home leads the match" : " · away leads the match";
    document.getElementById("score-tally").textContent = line.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  }

  function fillTeamSelects() {
    ["score-home", "score-away"].forEach(function (id) {
      var select = document.getElementById(id);
      var current = select.value;
      var teams = activeTeams();
      select.innerHTML = '<option value="">Choose a team</option>' + teams.map(function (team) {
        return '<option value="' + esc(team.id) + '">' + esc(team.name) + "</option>";
      }).join("");
      if (current && teams.some(function (team) { return team.id === current; })) select.value = current;
    });
    var home = document.getElementById("score-home");
    var away = document.getElementById("score-away");
    if (!home.value && activeTeams().length > 1) {
      home.value = activeTeams()[0].id;
      away.value = activeTeams()[1].id;
    }
  }

  function readSheet() {
    syncGamesFromDom();
    return {
      date: document.getElementById("score-date").value,
      homeTeamId: document.getElementById("score-home").value,
      awayTeamId: document.getElementById("score-away").value,
      games: games.map(function (game, index) {
        return {
          label: "Game " + (index + 1),
          homePlayerId: game.homePlayerId,
          awayPlayerId: game.awayPlayerId,
          winner: game.winner
        };
      })
    };
  }

  function showError(message) {
    var el = document.getElementById("score-error");
    el.hidden = !message;
    el.textContent = message || "";
  }

  function standingsNote(data) {
    if (!data.matches.length) return "No confirmed matches yet. Submit a score sheet and this table fills in.";
    var sampleMatches = data.matches.every(function (match) { return match.sample; });
    if (sampleMatches) return "SAMPLE standings. Every match in this table shipped with the mock — the wins, losses, games won, points, and ranks are not a real season.";
    if (data.matches.some(function (match) { return match.sample; }) || data.teams.some(function (team) { return team.sample; })) {
      return "Live standings. Rows still marked SAMPLE are starter data, and their numbers are not a real season.";
    }
    return "Live standings from confirmed score sheets.";
  }

  function renderStandings(data) {
    var rows = data.standings || [];
    document.getElementById("standings-note").textContent = standingsNote(data);
    document.getElementById("standings-rule").textContent = data.pointRule || "";
    var host = document.getElementById("standings-table");
    if (!rows.length) {
      host.innerHTML = '<p class="empty">No teams yet. Add them on the <a href="admin.html">Admin page</a>.</p>';
    } else {
      host.innerHTML =
        '<div class="table-scroll"><table><caption>' + esc(standingsNote(data)) + "</caption><thead><tr>" +
        "<th scope=\"col\">Rank</th><th scope=\"col\">Team</th><th scope=\"col\">W</th><th scope=\"col\">L</th><th scope=\"col\">Ties</th><th scope=\"col\">Games won</th><th scope=\"col\">Points</th>" +
        "</tr></thead><tbody>" +
        rows.map(function (row) {
          var fresh = data.lastTouched && data.lastTouched.indexOf(row.teamId) >= 0 ? "is-fresh" : "";
          var tag = sampleTag(row.teamName, row.sample);
          var inactive = row.active === false ? " (inactive)" : "";
          return '<tr class="' + fresh + '" data-team="' + esc(row.teamId) + '">' +
            '<td class="num">' + row.rank + "</td>" +
            '<th scope="row">' + tag + esc(row.teamName) + esc(inactive) + "</th>" +
            '<td class="num">' + row.wins + "</td>" +
            '<td class="num">' + row.losses + "</td>" +
            '<td class="num">' + row.ties + "</td>" +
            '<td class="num">' + row.gamesWon + "</td>" +
            '<td class="num">' + row.points + "</td></tr>";
        }).join("") +
        "</tbody></table></div>";
    }

    var recent = data.matches.slice().sort(function (a, b) {
      if (a.date === b.date) return String(b.submittedAt).localeCompare(String(a.submittedAt));
      return String(b.date).localeCompare(String(a.date));
    }).slice(0, 8);
    var box = document.getElementById("recent-results");
    if (!recent.length) {
      box.innerHTML = '<p class="empty">No results yet.</p>';
      return;
    }
    box.innerHTML = '<ul class="recent-list">' + recent.map(function (match) {
      var tag = match.sample ? '<span class="sample-tag">SAMPLE</span> ' : "";
      return "<li>" + tag + esc(formatDate(match.date)) + " — " +
        esc(teamNameFrom(data, match.homeTeamId)) + " " + match.homeGamesWon +
        ", " + esc(teamNameFrom(data, match.awayTeamId)) + " " + match.awayGamesWon + "</li>";
    }).join("") + "</ul>";
  }

  function teamNameFrom(data, id) {
    var team = (data.teams || []).filter(function (item) { return item.id === id; })[0];
    return team ? team.name : id;
  }

  function renderTeams(data) {
    var teams = (data.teams || []).filter(function (team) { return team.active !== false; })
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); });
    var host = document.getElementById("team-list");
    if (!teams.length) {
      host.innerHTML = '<p class="placeholder-note"><strong>PLACEHOLDER.</strong> No teams yet. Add them on the <a href="admin.html">Admin page</a>.</p>';
      return;
    }
    host.innerHTML = teams.map(function (team) {
      var roster = (data.players || []).filter(function (player) {
        return player.teamId === team.id && player.active !== false;
      });
      var tag = sampleTag(team.name, team.sample);
      var people = roster.length
        ? roster.map(function (player) {
          var badge = sampleTag(player.name, player.sample);
          return "<li>" + badge + esc(player.name) + "</li>";
        }).join("")
        : "<li>No players listed yet.</li>";
      return '<article class="team-card"><h3>' + tag + esc(team.name) + "</h3><ul class=\"roster\">" + people + "</ul></article>";
    }).join("");
  }

  function modeLine(data) {
    if (data.loadError) return data.loadError + " Showing the last copy saved on this phone, if there is one.";
    if (data.mode === "local") {
      return "Saved in this browser only (localStorage). Connect the Google Sheet in config.js before you expect another phone to see the same standings.";
    }
    if (!data.scriptConfigured) {
      return "Reading the Google Sheet, but the Apps Script URL is still a placeholder, so new score sheets stay on this phone.";
    }
    if (data.pendingCount) {
      return data.pendingCount + " update" + (data.pendingCount === 1 ? " is" : "s are") + " waiting to show up in the shared sheet. This page already includes " + (data.pendingCount === 1 ? "it" : "them") + ".";
    }
    return "Reading teams, players, and matches from the shared Google Sheet.";
  }

  function render(data) {
    snap = data;
    document.getElementById("mock-banner").textContent = "Mock site for the owner to refine. SAMPLE marks invented names, dates, and results. PLACEHOLDER marks something still to come. " + modeLine(data);
    document.getElementById("standings-live").textContent = standingsNote(data);
    renderStandings(data);
    renderTeams(data);
  }

  function syncMessage(result) {
    var sync = (result && result.sync) || {};
    if (sync.local) return "Score sheet submitted. Standings above already include it. It is stored on this phone until Google Sheets is connected.";
    if (sync.skipped) return "Score sheet submitted and the standings above already include it. The Apps Script URL is not set, so the shared sheet did not get a copy.";
    if (sync.ok === false) return "Standings above already include this sheet. The shared sheet did not get it just now" + (sync.error ? " (" + sync.error + ")" : "") + ". It stays queued on this phone.";
    return "Score sheet submitted. Standings above already include it, and it was sent to the shared sheet.";
  }

  function openReview(match) {
    var preview = RAD.previewMatchPoints(match.homeGamesWon, match.awayGamesWon);
    var home = teamName(match.homeTeamId);
    var away = teamName(match.awayTeamId);
    var gamesHtml = match.games.map(function (game) {
      var winner = game.winner === "home" ? home : away;
      var players = "";
      if (game.homePlayerName || game.awayPlayerName) {
        players = " (" + (game.homePlayerName || "Home") + " vs " + (game.awayPlayerName || "Away") + ")";
      }
      return "<li>" + esc(game.label) + players + " — " + esc(winner) + "</li>";
    }).join("");
    document.getElementById("score-review").innerHTML =
      '<div class="sheet-top"><div><p class="eyebrow">Confirm</p><h3>Submit this score sheet?</h3></div></div>' +
      "<p><strong>" + esc(formatDate(match.date)) + "</strong><br>" +
      esc(home) + " " + match.homeGamesWon + ", " + esc(away) + " " + match.awayGamesWon + "</p>" +
      '<ol class="review-list">' + gamesHtml + "</ol>" +
      "<p>" + esc(home) + " gets " + preview.home.points + " points from this match (" +
      preview.home.gamesWon + " games won" + (preview.home.wins ? ", plus a match win" : "") +
      (preview.home.ties ? ", plus a tie" : "") + "). " +
      esc(away) + " gets " + preview.away.points + ".</p>" +
      '<div class="form-actions">' +
      '<button class="btn btn-ink" type="button" id="score-back">Back to edit</button>' +
      '<button class="btn btn-primary" type="button" id="score-submit">Confirm and submit</button></div>';
    document.getElementById("score-form").hidden = true;
    document.getElementById("score-review").hidden = false;
    document.getElementById("score-back").addEventListener("click", closeReview);
    document.getElementById("score-submit").addEventListener("click", submitSheet);
    document.getElementById("score-submit").focus();
  }

  function closeReview() {
    document.getElementById("score-review").hidden = true;
    document.getElementById("score-form").hidden = false;
  }

  function submitSheet() {
    var button = document.getElementById("score-submit");
    button.disabled = true;
    RAD.submitMatch(readSheet()).then(function (result) {
      games = blankGames(4);
      document.getElementById("score-form").reset();
      closeReview();
      showError("");
      fillTeamSelects();
      renderGames();
      document.getElementById("score-sync").textContent = syncMessage(result);
      document.getElementById("standings-live").textContent = "Standings updated from the score sheet you just confirmed. " + standingsNote(result.snapshot);
      var motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById("standings").scrollIntoView({ behavior: motion ? "auto" : "smooth", block: "start" });
    }).catch(function (err) {
      button.disabled = false;
      closeReview();
      showError(err.message || "Could not submit that score sheet.");
    });
  }

  navButton.addEventListener("click", function () {
    var open = nav.classList.toggle("is-open");
    navButton.setAttribute("aria-expanded", open ? "true" : "false");
    navButton.querySelector(".nav-label").textContent = open ? "Close" : "Menu";
    document.body.classList.toggle("nav-open", open);
  });
  nav.addEventListener("click", function (event) {
    if (event.target.closest("a")) {
      nav.classList.remove("is-open");
      navButton.setAttribute("aria-expanded", "false");
      navButton.querySelector(".nav-label").textContent = "Menu";
      document.body.classList.remove("nav-open");
    }
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && nav.classList.contains("is-open")) {
      nav.classList.remove("is-open");
      navButton.setAttribute("aria-expanded", "false");
      navButton.querySelector(".nav-label").textContent = "Menu";
      navButton.focus();
    }
  });

  document.getElementById("score-form").addEventListener("submit", function (event) {
    event.preventDefault();
    showError("");
    try {
      openReview(RAD.prepareMatch(readSheet()));
    } catch (err) {
      showError(err.message || "Check the score sheet and try again.");
    }
  });
  document.getElementById("add-game").addEventListener("click", function () {
    syncGamesFromDom();
    if (games.length >= 30) return;
    games.push({ homePlayerId: "", awayPlayerId: "", winner: "" });
    renderGames();
  });
  document.getElementById("game-list").addEventListener("click", function (event) {
    var button = event.target.closest("[data-remove-game]");
    if (!button) return;
    syncGamesFromDom();
    var rows = Array.prototype.slice.call(document.querySelectorAll("[data-game]"));
    var index = rows.indexOf(button.closest("[data-game]"));
    if (index >= 0) games.splice(index, 1);
    if (!games.length) games = blankGames(1);
    renderGames();
  });
  document.getElementById("score-form").addEventListener("change", function (event) {
    if (event.target.id === "score-home" || event.target.id === "score-away") {
      syncGamesFromDom();
      renderGames();
      return;
    }
    updateTally();
  });

  var dialog = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightbox-img");
  var lightboxCaption = document.getElementById("lightbox-caption");
  document.querySelectorAll(".shot-open").forEach(function (button) {
    button.addEventListener("click", function () {
      var img = button.querySelector("img");
      lightboxImg.src = img.getAttribute("src");
      lightboxImg.alt = img.getAttribute("alt") || "";
      lightboxCaption.textContent = button.getAttribute("data-caption") || "";
      dialog.showModal();
    });
  });
  dialog.addEventListener("click", function (event) {
    var rect = dialog.getBoundingClientRect();
    var inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) dialog.close();
  });

  RAD.subscribe(render);
  RAD.load().then(function (data) {
    render(data);
    fillTeamSelects();
    renderGames();
  }).catch(function (err) {
    document.getElementById("standings-live").textContent = err.message || "Could not load standings.";
  });
})();
