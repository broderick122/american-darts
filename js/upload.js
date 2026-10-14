(function () {
  "use strict";

  var UPLOAD_KEY = "rad.uploads.v1";
  var SIDES = [
    { id: "home", label: "Home" },
    { id: "away", label: "Away" }
  ];
  var snap = null;
  var scoresTouched = false;
  var formDirty = false;
  var reading = false;

  var fileInput = document.getElementById("sheet-file");
  var readButton = document.getElementById("read-photo");
  var typeButton = document.getElementById("type-instead");
  var statusEl = document.getElementById("ocr-status");
  var errorEl = document.getElementById("ocr-error");
  var summaryEl = document.getElementById("ocr-summary");
  var warningEl = document.getElementById("ocr-warnings");
  var previewFigure = document.getElementById("align-figure");
  var previewImg = document.getElementById("align-preview");
  var previewNote = document.getElementById("align-note");
  var confirmSection = document.getElementById("confirm-section");
  var confirmForm = document.getElementById("confirm-form");
  var confirmError = document.getElementById("confirm-error");
  var savedNote = document.getElementById("saved-note");
  var finalScoreEl = document.getElementById("final-score");
  var sheetPointsEl = document.getElementById("sheet-points");

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(message, isError) {
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", !!isError);
  }

  function showError(el, message) {
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function winnerOptions(optionalBlank) {
    return '<option value="">' + (optionalBlank ? "Not marked" : "Not marked") + "</option>" +
      '<option value="home">Home</option><option value="away">Away</option>';
  }

  function buildSide(side) {
    var rows = ["S1", "S2", "S3", "S4", "Team"].map(function (label, index) {
      var cells = [1, 2, 3].map(function (game) {
        var who = index < 4 ? "s" + (index + 1) : "team";
        var id = side.id + "-g" + game + "-" + who;
        var max = who === "team" ? 199 : 99;
        return '<td><input id="' + id + '" type="number" min="0" max="' + max + '" inputmode="numeric" placeholder="—" aria-label="' +
          esc(side.label + " game " + game + " " + label) + '"><span id="' + id + '-flag" class="bubble-flag"></span></td>';
      }).join("");
      return "<tr><th scope=\"row\">" + label + "</th>" + cells + "</tr>";
    }).join("");
    var checks = [1, 2, 3].map(function (game) {
      return '<p id="' + side.id + "-g" + game + '-check" class="cross-check"></p>';
    }).join("");
    document.getElementById(side.id + "-block").innerHTML =
      '<h3>' + side.label + "</h3>" +
      '<div class="table-scroll"><table class="bubble-table"><caption>' + side.label +
      " shooter totals and the team total for each game. An empty box was not read as zero.</caption><thead><tr><th scope=\"col\"></th>" +
      "<th scope=\"col\">Game 1</th><th scope=\"col\">Game 2</th><th scope=\"col\">Game 3</th></tr></thead><tbody>" +
      rows + "</tbody></table></div><div class=\"cross-checks\">" + checks + "</div>";
  }

  SIDES.forEach(buildSide);
  ["win-g1", "win-g2", "win-g3", "win-points"].forEach(function (id) {
    document.getElementById(id).innerHTML = winnerOptions(false);
  });
  document.getElementById("win-beer").innerHTML = winnerOptions(true);

  function activeTeams() {
    return ((snap && snap.teams) || []).filter(function (team) { return team.active !== false; })
      .slice()
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  function normalizeName(value) {
    return String(value || "").toLowerCase().replace(/sample/g, "").replace(/[^a-z0-9]/g, "");
  }

  function matchTeam(name) {
    var needle = normalizeName(name);
    if (needle.length < 3) return null;
    var exact = null;
    var contained = null;
    activeTeams().forEach(function (team) {
      var hay = normalizeName(team.name);
      if (!hay) return;
      if (hay === needle) exact = team;
      else if (!contained && (hay.indexOf(needle) >= 0 || (needle.indexOf(hay) >= 0 && hay.length >= 3))) contained = team;
    });
    return exact || contained;
  }

  function fillTeamSelect(select, typedName) {
    var matched = matchTeam(typedName);
    var html = '<option value="new">Use the typed name as a new team</option>';
    activeTeams().forEach(function (team) {
      html += '<option value="' + esc(team.id) + '">' + esc(team.name) + "</option>";
    });
    select.innerHTML = html;
    select.value = matched ? matched.id : "new";
  }

  function winnerCount() {
    var home = 0;
    var away = 0;
    [1, 2, 3].forEach(function (n) {
      var value = document.getElementById("win-g" + n).value;
      if (value === "home") home += 1;
      else if (value === "away") away += 1;
    });
    return { home: home, away: away };
  }

  function updateFinalScore() {
    var home = Number(document.getElementById("home-won").value);
    var away = Number(document.getElementById("away-won").value);
    if (!isFinite(home) || home < 0) home = 0;
    if (!isFinite(away) || away < 0) away = 0;
    finalScoreEl.textContent = home + "–" + away;
  }

  function applyWinnerCounts() {
    if (scoresTouched) return;
    var counts = winnerCount();
    document.getElementById("home-won").value = String(counts.home);
    document.getElementById("away-won").value = String(counts.away);
    updateFinalScore();
  }

  function showConfirm() {
    confirmSection.hidden = false;
    confirmSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function numberOrNull(input) {
    if (String(input.value).trim() === "") return null;
    var value = Number(input.value);
    if (!isFinite(value)) return null;
    return value;
  }

  function scoreInput(side, game, who) {
    return document.getElementById(side + "-g" + game + "-" + who);
  }

  function setBubble(id, cell, blankNote) {
    var input = document.getElementById(id);
    var flag = document.getElementById(id + "-flag");
    input.classList.remove("is-blank", "is-ambiguous");
    if (!cell || cell.value == null || cell.status === "blank" || cell.status === "ambiguous") {
      input.value = "";
      if (cell && cell.status === "ambiguous") {
        input.classList.add("is-ambiguous");
        flag.textContent = "Check — two marks";
      } else {
        input.classList.add("is-blank");
        flag.textContent = blankNote || "Blank — not zero";
      }
      return;
    }
    input.value = String(cell.value);
    flag.textContent = "";
  }

  function setWinner(id, cell) {
    var select = document.getElementById(id);
    var flag = document.getElementById(id + "-flag");
    select.value = cell && (cell.value === "home" || cell.value === "away") ? cell.value : "";
    if (cell && cell.status === "ambiguous") flag.textContent = "Check — both bubbles";
    else if (!select.value && id !== "win-beer") flag.textContent = "Not marked";
    else flag.textContent = "";
  }

  function refreshChecks() {
    var notes = [];
    SIDES.forEach(function (side) {
      [1, 2, 3].forEach(function (game) {
        var shooters = [1, 2, 3, 4].map(function (n) { return numberOrNull(scoreInput(side.id, game, "s" + n)); });
        var team = numberOrNull(scoreInput(side.id, game, "team"));
        var el = document.getElementById(side.id + "-g" + game + "-check");
        var filled = shooters.filter(function (value) { return value != null; }).length + (team != null ? 1 : 0);
        el.classList.remove("is-bad");
        if (!filled) {
          el.textContent = "";
          return;
        }
        if (shooters.some(function (value) { return value == null; }) || team == null) {
          el.textContent = side.label + " Game " + game + ": fill every shooter and the team total to check the sum.";
          return;
        }
        var sum = shooters.reduce(function (total, value) { return total + value; }, 0);
        if (sum !== team) {
          el.textContent = side.label + " Game " + game + ": shooters add up to " + sum + ", team total is " + team + ".";
          el.classList.add("is-bad");
          notes.push(el.textContent);
        } else {
          el.textContent = side.label + " Game " + game + ": shooters add up to the team total (" + sum + ").";
        }
      });
    });
    var homePoints = [1, 2, 3].map(function (game) { return numberOrNull(scoreInput("home", game, "team")); });
    var awayPoints = [1, 2, 3].map(function (game) { return numberOrNull(scoreInput("away", game, "team")); });
    function show(values) {
      return values.map(function (value) { return value == null ? "—" : value; }).join(" + ");
    }
    sheetPointsEl.textContent = "Team totals on the sheet: home " + show(homePoints) + ", away " + show(awayPoints) +
      ". Standings use the game winners, not these point totals.";
    return notes;
  }

  function clearSheet() {
    SIDES.forEach(function (side) {
      [1, 2, 3].forEach(function (game) {
        [1, 2, 3, 4].forEach(function (n) { setBubble(side.id + "-g" + game + "-s" + n, null, ""); });
        setBubble(side.id + "-g" + game + "-team", null, "");
        document.getElementById(side.id + "-g" + game + "-s1").classList.remove("is-blank");
      });
    });
    document.querySelectorAll(".bubble-table input").forEach(function (input) {
      input.value = "";
      input.classList.remove("is-blank", "is-ambiguous");
    });
    document.querySelectorAll(".bubble-flag").forEach(function (flag) { flag.textContent = ""; });
    ["win-g1", "win-g2", "win-g3", "win-beer", "win-points"].forEach(function (id) {
      document.getElementById(id).value = "";
    });
    refreshChecks();
  }

  function turnNote(result) {
    if (result.rotation === 90 || result.rotation === 270) return " The photo was sideways, so it was turned upright.";
    if (result.rotation === 180 || result.upsideDown) return " The photo was upside down, so it was turned upright.";
    return "";
  }

  function describeReading(result) {
    if (result.mode === "rejected") {
      return (result.warnings && result.warnings[0]) ||
        "Retake the photo so all four black corner squares are in the frame. Lay the sheet flat, and keep every corner visible.";
    }
    var counts = result.counts || { blank: 0, ambiguous: 0 };
    var estimated = result.estimatedCorner
      ? " One corner was cut off and estimated from the other three."
      : "";
    var notch = result.notch ? "" : " The top-left notch was faint.";
    var sheet = result.version === "v8"
      ? " Read as the v8 legal sheet."
      : result.version === "v7"
        ? " Read as the v7 letter sheet."
        : "";
    return "Read the bubbles. " + result.homeGamesWon + "–" + result.awayGamesWon +
      " from the game-winner marks. " + counts.blank + " digit rows were blank and left empty. " +
      counts.ambiguous + " rows need a look." + turnNote(result) + estimated + notch + sheet;
  }

  function applyReading(result) {
    window.RAD_UPLOAD_LAST = result;
    summaryEl.textContent = describeReading(result);
    var shown = (result.warnings || []).slice(0, 8);
    var extra = (result.warnings || []).length - shown.length;
    warningEl.innerHTML = shown.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") +
      (extra ? "<li>And " + extra + " more notes. Check the boxes before saving.</li>" : "");
    if (result.previewUrl) {
      previewImg.src = result.previewUrl;
      previewFigure.hidden = false;
      previewNote.textContent = result.mode === "fiducial"
        ? ("Straightened with the corner squares." + turnNote(result) +
          (result.estimatedCorner ? " One corner was estimated." : ""))
        : "This photo was not lined up with the scan sheet.";
    }
    if (result.mode === "rejected") {
      var reason = (result.warnings && result.warnings[0]) ||
        "The corner squares were not found, so this photo was not lined up.";
      showError(errorEl, reason);
    } else {
      showError(errorEl, "");
    }
    if (!confirmSection.hidden && formDirty) {
      setStatus("The photo was read, and your edits were left as they are.");
      return;
    }
    if (result.mode !== "rejected" && result.teams) {
      SIDES.forEach(function (side) {
        result.teams[side.id].games.forEach(function (game, index) {
          game.shooters.forEach(function (shooter, shooterIndex) {
            setBubble(side.id + "-g" + (index + 1) + "-s" + (shooterIndex + 1), shooter);
          });
          setBubble(side.id + "-g" + (index + 1) + "-team", game.team);
        });
      });
      setWinner("win-g1", result.winners.game1);
      setWinner("win-g2", result.winners.game2);
      setWinner("win-g3", result.winners.game3);
      setWinner("win-beer", result.winners.beer);
      setWinner("win-points", result.winners.points);
    } else {
      clearSheet();
    }
    scoresTouched = false;
    formDirty = false;
    applyWinnerCounts();
    refreshChecks();
    showConfirm();
    setStatus(result.mode === "rejected"
      ? "Retake the photo so all four black corner squares are in the frame. You can still type the score below."
      : "Check the bubbles, the names, and the date, then save.");
  }

  function readPhoto() {
    var file = fileInput.files && fileInput.files[0];
    if (!file) {
      showError(errorEl, "Choose a photo of the filled scan sheet first.");
      return;
    }
    if (reading) return;
    reading = true;
    readButton.disabled = true;
    showError(errorEl, "");
    setStatus("Opening the photo…");
    RAD_OCR.loadImageFile(file).then(function (canvas) {
      if (canvas.width < 500 || canvas.height < 360) {
        throw new Error("That photo is too small to read. Move closer and include all four corner squares.");
      }
      function loadSpec(path) {
        return fetch(path).then(function (response) {
          if (!response.ok) throw new Error("The scan sheet layout could not be loaded.");
          return response.json();
        });
      }
      return Promise.all([
        loadSpec("scoresheet/scansheet_v8_layout_spec.json"),
        loadSpec("scoresheet/scansheet_v7_layout_spec.json")
      ]).then(function (specs) {
        return RAD_OCR.readSheet(canvas, specs, setStatus);
      });
    }).then(function (result) {
      applyReading(result);
    }).catch(function (err) {
      showError(errorEl, err && err.message ? err.message : "The photo could not be read.");
      setStatus("");
      showConfirm();
    }).then(function () {
      reading = false;
      readButton.disabled = false;
    });
  }

  function gamesForSubmit(homeWon, awayWon) {
    var fromSelect = winnerCount();
    if (!scoresTouched && fromSelect.home === homeWon && fromSelect.away === awayWon) {
      var labeled = [];
      [1, 2, 3].forEach(function (n) {
        var winner = document.getElementById("win-g" + n).value;
        if (winner !== "home" && winner !== "away") return;
        labeled.push({ label: "Game " + n, winner: winner });
      });
      if (labeled.length) return labeled;
    }
    var games = [];
    var i;
    for (i = 0; i < homeWon; i += 1) games.push({ label: "Game " + (games.length + 1), winner: "home" });
    for (i = 0; i < awayWon; i += 1) games.push({ label: "Game " + (games.length + 1), winner: "away" });
    return games;
  }

  function sheetSnapshot() {
    function side(id) {
      return [1, 2, 3].map(function (game) {
        return {
          shooters: [1, 2, 3, 4].map(function (n) { return numberOrNull(scoreInput(id, game, "s" + n)); }),
          team: numberOrNull(scoreInput(id, game, "team"))
        };
      });
    }
    return {
      home: side("home"),
      away: side("away"),
      winners: {
        game1: document.getElementById("win-g1").value,
        game2: document.getElementById("win-g2").value,
        game3: document.getElementById("win-g3").value,
        beer: document.getElementById("win-beer").value,
        points: document.getElementById("win-points").value
      }
    };
  }

  function ensureTeam(selectValue, typedName) {
    if (selectValue && selectValue !== "new") return Promise.resolve(selectValue);
    var name = String(typedName || "").trim();
    if (!name) return Promise.reject(new Error("Type a team name, or pick a team that is already on the list."));
    return RAD.saveTeam({ name: name, active: true }).then(function (result) {
      var teams = result.snapshot.teams || [];
      for (var i = teams.length - 1; i >= 0; i -= 1) {
        if (teams[i].name === name) return teams[i].id;
      }
      throw new Error("The new team did not save.");
    });
  }

  function rememberUpload(entry) {
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem(UPLOAD_KEY) || "[]");
    } catch (err) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    list.push(entry);
    localStorage.setItem(UPLOAD_KEY, JSON.stringify(list));
  }

  function sampleTag(name, sample) {
    if (!sample || /sample/i.test(name || "")) return "";
    return '<span class="sample-tag">SAMPLE</span> ';
  }

  function renderStandings(data) {
    var host = document.getElementById("upload-standings");
    var rows = (data && data.standings) || [];
    document.getElementById("upload-mode").textContent = data && data.mode === "local"
      ? "These standings are stored in this browser (localStorage). Another phone will not see them until a shared sheet is connected."
      : "Standings recalculate from the saved matches.";
    if (!rows.length) {
      host.innerHTML = '<p class="empty">No teams yet.</p>';
      return;
    }
    host.innerHTML =
      '<div class="table-scroll"><table><caption>SAMPLE marks starter teams. A saved upload changes this table immediately.</caption><thead><tr>' +
      '<th scope="col">Rank</th><th scope="col">Team</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Ties</th><th scope="col">Games won</th><th scope="col">Points</th>' +
      "</tr></thead><tbody>" +
      rows.map(function (row) {
        var fresh = data.lastTouched && data.lastTouched.indexOf(row.teamId) >= 0 ? "is-fresh" : "";
        return '<tr class="' + fresh + '"><td class="num">' + row.rank + "</td><th scope=\"row\">" +
          sampleTag(row.teamName, row.sample) + esc(row.teamName) + "</th>" +
          '<td class="num">' + row.wins + "</td><td class=\"num\">" + row.losses + "</td><td class=\"num\">" + row.ties +
          "</td><td class=\"num\">" + row.gamesWon + "</td><td class=\"num\">" + row.points + "</td></tr>";
      }).join("") +
      "</tbody></table></div>";
  }

  function onSubmit(event) {
    event.preventDefault();
    showError(confirmError, "");
    var date = document.getElementById("confirm-date").value;
    var homeWon = Math.round(Number(document.getElementById("home-won").value));
    var awayWon = Math.round(Number(document.getElementById("away-won").value));
    if (!date) {
      showError(confirmError, "Add the match date.");
      return;
    }
    if (!isFinite(homeWon) || !isFinite(awayWon) || homeWon < 0 || awayWon < 0 || homeWon + awayWon < 1) {
      showError(confirmError, "Mark a winner for at least one of games 1–3.");
      return;
    }
    refreshChecks();
    var homeSelect = document.getElementById("home-team").value;
    var awaySelect = document.getElementById("away-team").value;
    var homeTyped = document.getElementById("home-name").value.trim();
    var awayTyped = document.getElementById("away-name").value.trim();
    if (homeSelect === "new" && awaySelect === "new" && homeTyped && homeTyped.toLowerCase() === awayTyped.toLowerCase()) {
      showError(confirmError, "Home and away need to be two different teams.");
      return;
    }
    var sheet = sheetSnapshot();
    var submitButton = document.getElementById("confirm-submit");
    submitButton.disabled = true;
    ensureTeam(homeSelect, homeTyped).then(function (homeId) {
      return ensureTeam(awaySelect, awayTyped).then(function (awayId) {
        return RAD.submitMatch({
          date: date,
          homeTeamId: homeId,
          awayTeamId: awayId,
          games: gamesForSubmit(homeWon, awayWon)
        });
      });
    }).then(function (result) {
      var match = result.match;
      rememberUpload({
        at: new Date().toISOString(),
        date: match.date,
        homeTeamId: match.homeTeamId,
        awayTeamId: match.awayTeamId,
        homeGamesWon: match.homeGamesWon,
        awayGamesWon: match.awayGamesWon,
        homeName: homeTyped,
        awayName: awayTyped,
        photoStored: false,
        sheet: sheet
      });
      savedNote.hidden = false;
      savedNote.textContent = "Saved in this browser. Final score " + match.homeGamesWon + "–" + match.awayGamesWon +
        ". The photo itself was not stored. Standings below, and on the home page, include this match.";
      renderStandings(result.snapshot);
      document.getElementById("live-standings").scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (err) {
      showError(confirmError, err && err.message ? err.message : "The score could not be saved.");
    }).then(function () {
      submitButton.disabled = false;
    });
  }

  var navButton = document.querySelector(".nav-button");
  var nav = document.getElementById("site-nav");
  if (navButton && nav) {
    navButton.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      navButton.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        nav.classList.remove("is-open");
        navButton.setAttribute("aria-expanded", "false");
      }
    });
  }

  document.getElementById("pick-form").addEventListener("submit", function (event) {
    event.preventDefault();
    readPhoto();
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) readPhoto();
  });
  typeButton.addEventListener("click", function () {
    showError(errorEl, "");
    setStatus("Type the date, the two teams, the shooter totals, and the game winners.");
    clearSheet();
    scoresTouched = false;
    formDirty = false;
    applyWinnerCounts();
    showConfirm();
  });
  confirmForm.addEventListener("submit", onSubmit);
  confirmForm.addEventListener("input", function (event) {
    formDirty = true;
    var target = event.target;
    if (target && target.classList) {
      target.classList.remove("is-blank", "is-ambiguous");
      var flag = document.getElementById(target.id + "-flag");
      if (flag && target.type === "number") flag.textContent = target.value === "" ? "Blank — not zero" : "";
    }
    refreshChecks();
  });
  [1, 2, 3].forEach(function (n) {
    document.getElementById("win-g" + n).addEventListener("change", function () {
      var flag = document.getElementById("win-g" + n + "-flag");
      if (flag) flag.textContent = "";
      applyWinnerCounts();
    });
  });
  document.getElementById("home-won").addEventListener("input", function () {
    scoresTouched = true;
    updateFinalScore();
  });
  document.getElementById("away-won").addEventListener("input", function () {
    scoresTouched = true;
    updateFinalScore();
  });

  fillTeamSelect(document.getElementById("home-team"), "");
  fillTeamSelect(document.getElementById("away-team"), "");
  updateFinalScore();
  refreshChecks();

  RAD.load().then(function (data) {
    snap = data;
    fillTeamSelect(document.getElementById("home-team"), document.getElementById("home-name").value);
    fillTeamSelect(document.getElementById("away-team"), document.getElementById("away-name").value);
    renderStandings(data);
  });
  RAD.subscribe(function (data) {
    snap = data;
    renderStandings(data);
  });
})();
