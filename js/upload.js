(function () {
  "use strict";

  var UPLOAD_KEY = "rad.uploads.v1";
  var SHEET_KEY = "rad.sheets.v1";
  var SLOTS = ["A", "B", "C", "D", "E", "F", "G", "H"];
  var GAMES = [1, 2, 3];
  var SHOOTERS = [1, 2, 3, 4];
  var STEADY_MS = 750;
  var SHARP_MIN = 8;
  var snap = null;
  var formDirty = false;
  var reading = false;
  var camera = { stream: null, timer: 0, spec: null, steadySince: 0, lastCorners: null, capturing: false };

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
  var scanButton = document.getElementById("scan-camera");
  var cameraPanel = document.getElementById("camera-panel");
  var cameraVideo = document.getElementById("camera-video");
  var cameraGuide = document.getElementById("camera-guide");
  var cameraStatus = document.getElementById("camera-status");
  var snapButton = document.getElementById("camera-snap");
  var cancelButton = document.getElementById("camera-cancel");

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

  function setStep(n, message) {
    var list = document.getElementById("scan-steps");
    if (list) {
      list.querySelectorAll("[data-step]").forEach(function (li) {
        var step = Number(li.getAttribute("data-step"));
        li.classList.toggle("is-current", step === n);
        li.classList.toggle("is-done", step < n);
      });
    }
    var stepEl = document.getElementById("step-status");
    if (stepEl && message) stepEl.textContent = message;
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

  function slotOptions(selected) {
    var html = '<option value="">—</option>';
    SLOTS.forEach(function (slot) {
      html += '<option value="' + slot + '"' + (selected === slot ? " selected" : "") + ">" + slot + "</option>";
    });
    return html;
  }

  function fieldBox(label, control) {
    return '<label class="field">' + label + control + '<span class="missing-note"></span></label>';
  }

  function gameSection(id, title, body) {
    return '<section class="game-card" data-game="' + id + '">' +
      '<h3><button type="button" class="game-toggle" aria-expanded="true" aria-controls="game-body-' + id + '">' +
      "<span>" + title + '</span><span class="game-toggle-state">Hide</span></button></h3>' +
      '<div class="game-body" id="game-body-' + id + '">' + body + "</div></section>";
  }

  function buildReview() {
    document.getElementById("roster-block").innerHTML =
      '<p class="roster-note">Roster ids A through H. An empty id was not read as zero.</p>' +
      '<div class="roster-grid">' +
      SLOTS.map(function (slot) {
        return fieldBox(slot,
          numericControl("roster-" + slot, 2, "Roster " + slot + " id") +
          '<span id="roster-' + slot + '-flag" class="bubble-flag"></span>');
      }).join("") +
      "</div>";

    document.getElementById("games-block").innerHTML = GAMES.map(function (game) {
      var rows = SHOOTERS.map(function (n) {
        return '<div class="shooter"><p class="shooter-label">Shooter ' + n + "</p>" +
          fieldBox("Who",
            '<select id="g' + game + "-s" + n + '-who" aria-label="Game ' + game + " shooter " + n + ' who">' +
            slotOptions("") + '</select><span id="g' + game + "-s" + n + '-who-flag" class="bubble-flag"></span>') +
          fieldBox("Score",
            numericControl("g" + game + "-s" + n + "-score", 2, "Game " + game + " shooter " + n + " score") +
            '<span id="g' + game + "-s" + n + '-score-flag" class="bubble-flag"></span>') +
          "</div>";
      }).join("");
      var totals =
        '<div class="game-totals">' +
        fieldBox("Team total",
          '<output id="g' + game + '-team" class="team-total-display" aria-live="polite">—</output>') +
        fieldBox("Result",
          '<select id="g' + game + '-result"><option value="">Not marked</option><option value="won">Won</option><option value="lost">Lost</option></select><span id="g' + game + '-result-flag" class="bubble-flag"></span>') +
        "</div>" +
        '<p id="g' + game + '-check" class="cross-check"></p>';
      return gameSection(String(game), "Game " + game, rows + totals);
    }).join("") +
      gameSection("frames", "Frames",
        '<div class="game-totals">' +
        fieldBox("Beer frame",
          '<select id="beer-result"><option value="">Not marked</option><option value="won">Won</option><option value="lost">Lost</option></select><span id="beer-result-flag" class="bubble-flag"></span>') +
        fieldBox("Total points",
          '<select id="points-result"><option value="">Not marked</option><option value="won">Won</option><option value="lost">Lost</option></select><span id="points-result-flag" class="bubble-flag"></span>') +
        "</div>");
  }

  function numericControl(id, maxLength, label) {
    return '<input id="' + id + '" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="' + maxLength +
      '" data-numeric="true" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="—" aria-label="' +
      label + '">';
  }

  buildReview();

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

  function numberOrNull(input) {
    if (!input || String(input.value).trim() === "") return null;
    var value = Number(input.value);
    if (!isFinite(value)) return null;
    return value;
  }

  function setNumber(id, cell, blankNote) {
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

  function setChoice(id, value, status, blankNote) {
    var select = document.getElementById(id);
    var flag = document.getElementById(id + "-flag");
    select.value = value && select.querySelector('option[value="' + value + '"]') ? value : "";
    if (status === "ambiguous") flag.textContent = "Check — two marks";
    else if (!select.value) flag.textContent = blankNote || "Not marked";
    else flag.textContent = "";
  }

  function wonCount() {
    var won = 0;
    GAMES.forEach(function (game) {
      if (document.getElementById("g" + game + "-result").value === "won") won += 1;
    });
    return won;
  }

  function updateFinalScore() {
    var won = wonCount();
    finalScoreEl.textContent = won + (won === 1 ? " game won" : " games won");
  }

  var scannedTeam = { 1: null, 2: null, 3: null };

  function shooterScores(game) {
    return SHOOTERS.map(function (n) {
      return numberOrNull(document.getElementById("g" + game + "-s" + n + "-score"));
    });
  }

  function sumScores(scores) {
    var any = false;
    var sum = 0;
    scores.forEach(function (value) {
      if (value == null) return;
      any = true;
      sum += value;
    });
    return any ? sum : null;
  }

  function rememberScannedTeam(game, cell) {
    var value = cell && cell.value != null && cell.status !== "blank" && cell.status !== "ambiguous" ? Number(cell.value) : null;
    scannedTeam[game] = value != null && isFinite(value) ? value : null;
  }

  function refreshChecks() {
    var shown = [];
    GAMES.forEach(function (game) {
      var scores = shooterScores(game);
      var complete = scores.every(function (value) { return value != null; });
      var sum = sumScores(scores);
      var scanned = scannedTeam[game];
      var display = document.getElementById("g" + game + "-team");
      display.value = sum == null ? "—" : String(sum);
      var el = document.getElementById("g" + game + "-check");
      el.classList.remove("is-bad");
      if (complete && scanned != null && sum !== scanned) {
        el.textContent = "Sheet total says " + scanned + ", scores add to " + sum + ", check the scores.";
        el.classList.add("is-bad");
      } else {
        el.textContent = "";
      }
      document.getElementById("save-total-" + game).textContent = sum == null ? "—" : String(sum);
      shown.push(sum);
    });
    var allShown = shown.every(function (value) { return value != null; });
    document.getElementById("save-total-sum").textContent = allShown ? String(shown.reduce(function (total, value) { return total + value; }, 0)) : "—";
    updateFinalScore();
  }

  function clearSheet() {
    clearMissing();
    setChoice("sheet-side", "", "blank");
    SLOTS.forEach(function (slot) { setNumber("roster-" + slot, { status: "blank" }); });
    GAMES.forEach(function (game) {
      SHOOTERS.forEach(function (n) {
        setChoice("g" + game + "-s" + n + "-who", "", "blank");
        setNumber("g" + game + "-s" + n + "-score", { status: "blank" });
      });
      scannedTeam[game] = null;
      setChoice("g" + game + "-result", "", "blank");
    });
    setChoice("beer-result", "", "blank", "Blank is allowed");
    setChoice("points-result", "", "blank");
    refreshChecks();
    syncSaveButton();
  }

  function turnNote(result) {
    if (result.rotation === 90 || result.rotation === 270) return " The photo was sideways, so it was turned upright.";
    if (result.rotation === 180 || result.upsideDown) return " The photo was upside down, so it was turned upright.";
    return "";
  }

  function describeReading(result) {
    if (result.mode === "rejected") {
      return (result.warnings && result.warnings[0]) ||
        "Retake the photo so all four black corner squares are in the frame.";
    }
    var side = result.side && result.side.value ? result.side.value : "unmarked";
    var won = (result.games || []).filter(function (game) { return game.result && game.result.value === "won"; }).length;
    return "Read the v16 sheet as " + side + ". This team marked " + won + " games won." + turnNote(result);
  }

  function showConfirm() {
    confirmSection.hidden = false;
  }

  function applyReading(result) {
    clearMissing();
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
        ? ("Straightened with the corner squares." + turnNote(result))
        : "This photo was not lined up with the scan sheet.";
    }
    if (result.mode === "rejected") {
      showError(errorEl, (result.warnings && result.warnings[0]) || "The corner squares were not found, so this photo was not lined up.");
    } else {
      showError(errorEl, "");
    }
    if (!confirmSection.hidden && formDirty) {
      setStatus("The photo was read, and your edits were left as they are.");
      setStep(2, "Step 2 of 3. The photo was read. Your edits were left as they are.");
      syncSaveButton();
      return;
    }
    if (result.mode !== "rejected" && result.games) {
      setChoice("sheet-side", result.side && result.side.value, result.side && result.side.status, "Not marked");
      SLOTS.forEach(function (slot) {
        setNumber("roster-" + slot, result.roster && result.roster[slot]);
      });
      result.games.forEach(function (game, index) {
        var n = index + 1;
        game.shooters.forEach(function (row, shooterIndex) {
          setChoice("g" + n + "-s" + (shooterIndex + 1) + "-who", row.who && row.who.value, row.who && row.who.status);
          setNumber("g" + n + "-s" + (shooterIndex + 1) + "-score", row.score);
        });
        rememberScannedTeam(n, game.team);
        setChoice("g" + n + "-result", game.result && game.result.value, game.result && game.result.status);
      });
      setChoice("beer-result", result.beer && result.beer.value, result.beer && result.beer.status, "Blank is allowed");
      setChoice("points-result", result.points && result.points.value, result.points && result.points.status);
    } else {
      clearSheet();
    }
    formDirty = false;
    refreshChecks();
    showConfirm();
    if (result.mode === "rejected") {
      setStatus("Retake the photo so all four black corner squares are in the frame. You can still type the score below.");
      setStep(1, "Step 1 of 3. The corners were not found. Retake the photo, or type the score.");
    } else {
      setStatus("Check the roster, the scores, and the date, then save.");
      setStep(2, "Step 2 of 3. Check each game. Fix anything that is wrong, then save.");
      confirmSection.scrollIntoView({ block: "start" });
    }
    syncSaveButton();
  }

  function loadSpec() {
    var version = window.RAD_ASSET_VERSION || "20261015j";
    return fetch("scoresheet/scansheet_v16_layout_spec.json?v=" + encodeURIComponent(version), { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("The scan sheet layout could not be loaded (" + response.status + "). Reload the page and try again.");
      return response.json();
    }).then(function (spec) {
      var problem = RAD_OCR.specProblem(spec);
      if (problem) throw new Error(problem);
      return spec;
    });
  }

  function readCanvas(canvas) {
    if (canvas.width < 500 || canvas.height < 360) {
      return Promise.reject(new Error("That photo is too small to read. Move closer and include all four corner squares."));
    }
    setStatus("Opening the sheet…");
    setStep(2, "Step 2 of 3. Reading the sheet…");
    return loadSpec().then(function (spec) {
      return RAD_OCR.readSheet(canvas, spec, setStatus);
    }).then(function (result) {
      applyReading(result);
    });
  }

  function finishRead() {
    reading = false;
    readButton.disabled = false;
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
      return readCanvas(canvas);
    }).catch(function (err) {
      showError(errorEl, err && err.message ? err.message : "The photo could not be read.");
      setStatus("");
      syncSaveButton();
      showConfirm();
    }).then(finishRead);
  }

  function sheetRecord() {
    return {
      side: document.getElementById("sheet-side").value,
      roster: SLOTS.map(function (slot) {
        return { slot: slot, id: numberOrNull(document.getElementById("roster-" + slot)) };
      }),
      games: GAMES.map(function (game) {
        return {
          who: SHOOTERS.map(function (n) { return document.getElementById("g" + game + "-s" + n + "-who").value; }),
          scores: SHOOTERS.map(function (n) { return numberOrNull(document.getElementById("g" + game + "-s" + n + "-score")); }),
          team: sumScores(shooterScores(game)),
          result: document.getElementById("g" + game + "-result").value
        };
      }),
      beer: document.getElementById("beer-result").value,
      points: document.getElementById("points-result").value
    };
  }

  function norm(value) {
    return String(value || "").trim().toLowerCase();
  }

  function loadStoredSheets() {
    try {
      var list = JSON.parse(localStorage.getItem(SHEET_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return [];
    }
  }

  function sheetsPair(a, b) {
    if (!a || !b || !a.date || a.date !== b.date) return false;
    if (!a.teamId || !b.teamId || a.teamId === b.teamId) return false;
    if (a.opponentTeamId && b.opponentTeamId && a.opponentTeamId === b.teamId && b.opponentTeamId === a.teamId) return true;
    return norm(a.opponentName) && norm(a.teamName) &&
      norm(a.opponentName) === norm(b.teamName) &&
      norm(b.opponentName) === norm(a.teamName);
  }

  function orderSides(a, b) {
    if (a.side === "home" && b.side !== "home") return { home: a, away: b };
    if (b.side === "home" && a.side !== "home") return { home: b, away: a };
    if (a.side === "away" && b.side !== "away") return { home: b, away: a };
    return { home: a, away: b };
  }

  function matchGames(home, away) {
    var count = Math.max((home.games || []).length, (away.games || []).length);
    var games = [];
    var i;
    for (i = 0; i < count; i += 1) {
      var h = (home.games || [])[i] || {};
      var a = (away.games || [])[i] || {};
      var winner = "";
      if (h.result === "won") winner = "home";
      else if (h.result === "lost") winner = "away";
      else if (a.result === "won") winner = "away";
      else if (a.result === "lost") winner = "home";
      if (!winner) continue;
      games.push({ label: "Game " + (i + 1), winner: winner });
    }
    return games;
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

  var reviewInvalid = false;

  function blankValue(input) {
    return !input || String(input.value).trim() === "";
  }

  function inRange(input, min, max) {
    var raw = String(input.value).trim();
    if (raw === "") return false;
    var value = Number(raw);
    return isFinite(value) && value >= min && value <= max;
  }

  function flagReason(input) {
    if (!input) return "";
    var flag = document.getElementById(input.id + "-flag");
    var text = flag ? String(flag.textContent || "").trim() : "";
    var ambiguous = input.classList.contains("is-ambiguous") || /two marks/i.test(text);
    if (ambiguous) return "two marks";
    if (text && !/blank|not marked|allowed/i.test(text)) return text;
    return "";
  }

  function slotsInUse() {
    var used = {};
    GAMES.forEach(function (game) {
      SHOOTERS.forEach(function (n) {
        var who = document.getElementById("g" + game + "-s" + n + "-who").value;
        if (who) used[who] = true;
      });
    });
    return used;
  }

  function collectMissing() {
    var items = [];
    function add(id, label, message) {
      items.push({ id: id, label: label, message: message });
    }
    var date = document.getElementById("confirm-date");
    if (blankValue(date)) add("confirm-date", "Match date", "Add the match date.");
    var side = document.getElementById("sheet-side");
    var sideReason = flagReason(side);
    if (sideReason) add("sheet-side", "This sheet is", "Fix Home or Away (" + sideReason + ").");
    else if (side.value !== "home" && side.value !== "away") add("sheet-side", "This sheet is", "Mark this sheet Home or Away.");
    var teamSelect = document.getElementById("team-select");
    var teamName = document.getElementById("team-name");
    var opponentSelect = document.getElementById("opponent-select");
    var opponentName = document.getElementById("opponent-name");
    if (!teamSelect.value) add("team-select", "This team on the list", "Pick this team.");
    else if (teamSelect.value === "new" && blankValue(teamName)) add("team-name", "This team, as written", "Type this team's name.");
    if (!opponentSelect.value) add("opponent-select", "Opponent on the list", "Pick the opponent.");
    else if (opponentSelect.value === "new" && blankValue(opponentName)) add("opponent-name", "Opponent, as written", "Type the opponent's name.");
    if (teamSelect.value && opponentSelect.value && teamSelect.value === opponentSelect.value && teamSelect.value !== "new") {
      add("opponent-select", "Opponent on the list", "Pick a different opponent.");
    }
    if (teamSelect.value === "new" && opponentSelect.value === "new" && !blankValue(teamName) && !blankValue(opponentName) && norm(teamName.value) === norm(opponentName.value)) {
      add("opponent-name", "Opponent, as written", "Type a different opponent.");
    }
    var used = slotsInUse();
    SLOTS.forEach(function (slot) {
      var input = document.getElementById("roster-" + slot);
      var reason = flagReason(input);
      var label = "Player " + slot + " ID";
      if (reason) add(input.id, label, "Fix player " + slot + " ID (" + reason + ").");
      else if ((blankValue(input) || !inRange(input, 0, 99)) && used[slot]) {
        add(input.id, label, "Enter player " + slot + " ID. A game uses shooter " + slot + ".");
      }
    });
    GAMES.forEach(function (game) {
      SHOOTERS.forEach(function (n) {
        var who = document.getElementById("g" + game + "-s" + n + "-who");
        var score = document.getElementById("g" + game + "-s" + n + "-score");
        var whoLabel = "Game " + game + ", shooter " + n + ", who";
        var scoreLabel = "Game " + game + ", shooter " + n + ", score";
        var whoReason = flagReason(who);
        var scoreReason = flagReason(score);
        if (whoReason) add(who.id, whoLabel, "Fix who shot Game " + game + ", S" + n + " (" + whoReason + ").");
        else if (blankValue(who)) add(who.id, whoLabel, "Pick who shot Game " + game + ", S" + n + ".");
        if (scoreReason) add(score.id, scoreLabel, "Fix the score for Game " + game + ", S" + n + " (" + scoreReason + ").");
        else if (!inRange(score, 0, 49)) add(score.id, scoreLabel, "Enter the score for Game " + game + ", S" + n + ".");
      });
      var result = document.getElementById("g" + game + "-result");
      var resultReason = flagReason(result);
      if (resultReason) add(result.id, "Game " + game + " result", "Fix Game " + game + " won or lost (" + resultReason + ").");
      else if (result.value !== "won" && result.value !== "lost") add(result.id, "Game " + game + " result", "Mark Game " + game + " won or lost.");
    });
    var beer = document.getElementById("beer-result");
    var beerReason = flagReason(beer);
    if (beerReason) add(beer.id, "Beer frame", "Fix the beer frame (" + beerReason + ").");
    var points = document.getElementById("points-result");
    var pointsReason = flagReason(points);
    if (pointsReason) add(points.id, "Total points", "Fix total points (" + pointsReason + ").");
    else if (points.value !== "won" && points.value !== "lost") add(points.id, "Total points", "Mark total points won or lost.");
    return items;
  }

  function missingNote(field) {
    var note = field.querySelector(".missing-note");
    if (!note) {
      note = document.createElement("span");
      note.className = "missing-note";
      field.appendChild(note);
    }
    return note;
  }

  function paintMissing(items) {
    var byId = {};
    items.forEach(function (item) { byId[item.id] = item; });
    confirmForm.querySelectorAll(".field").forEach(function (field) {
      var input = field.querySelector("input, select, textarea");
      if (!input || !input.id) return;
      var item = byId[input.id];
      var note = missingNote(field);
      if (item) {
        field.classList.add("is-missing");
        input.setAttribute("aria-invalid", "true");
        note.textContent = item.message;
      } else {
        field.classList.remove("is-missing");
        input.removeAttribute("aria-invalid");
        note.textContent = "";
      }
    });
    var summary = document.getElementById("missing-summary");
    var countEl = document.getElementById("missing-count");
    var list = document.getElementById("missing-list");
    if (!items.length) {
      summary.hidden = true;
      countEl.textContent = "";
      list.innerHTML = "";
      showError(confirmError, "");
      reviewInvalid = false;
    } else {
      reviewInvalid = true;
      var heading = items.length === 1 ? "1 item missing" : items.length + " items missing";
      summary.hidden = false;
      countEl.textContent = heading;
      list.innerHTML = items.map(function (item) {
        return '<li><button type="button" data-goto="' + esc(item.id) + '">' + esc(item.label) + ". " + esc(item.message) + "</button></li>";
      }).join("");
      showError(confirmError, heading + ".");
    }
    syncSaveButton();
  }

  function syncSaveButton() {
    var button = document.getElementById("confirm-submit");
    if (!button) return;
    var count = collectMissing().length;
    if (count) {
      button.textContent = count === 1 ? "Fix 1 item" : "Fix " + count + " items";
      button.classList.add("btn-fix");
      button.classList.remove("btn-primary");
    } else {
      button.textContent = "Save";
      button.classList.remove("btn-fix");
      button.classList.add("btn-primary");
    }
  }

  function clearMissing() {
    paintMissing([]);
  }

  function expandCard(card) {
    if (!card) return;
    card.classList.remove("is-collapsed");
    var button = card.querySelector(".game-toggle");
    if (!button) return;
    button.setAttribute("aria-expanded", "true");
    var state = button.querySelector(".game-toggle-state");
    if (state) state.textContent = "Hide";
  }

  function obstruction() {
    var header = document.querySelector(".site-header");
    var save = document.querySelector(".save-bar");
    var thumb = document.querySelector(".thumb-nav");
    var top = 0;
    var bottom = 0;
    if (header) top = Math.max(top, header.getBoundingClientRect().bottom);
    if (save && getComputedStyle(save).display !== "none") {
      bottom = Math.max(bottom, window.innerHeight - save.getBoundingClientRect().top);
    }
    if (thumb && getComputedStyle(thumb).display !== "none" && getComputedStyle(thumb).position === "fixed") {
      bottom = Math.max(bottom, window.innerHeight - thumb.getBoundingClientRect().top);
    }
    return { top: top, bottom: bottom };
  }

  function fieldDelta(el) {
    var field = el.closest(".field") || el;
    var bars = obstruction();
    var margin = 16;
    var rect = field.getBoundingClientRect();
    var visibleTop = bars.top + margin;
    var visibleBottom = window.innerHeight - bars.bottom - margin;
    var delta = 0;
    if (rect.bottom > visibleBottom) delta = rect.bottom - visibleBottom;
    if (rect.top - delta < visibleTop) delta = rect.top - visibleTop;
    return delta;
  }

  function scrollFieldIntoView(el) {
    return new Promise(function (resolve) {
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var started = Date.now();
      function step() {
        var delta = fieldDelta(el);
        if (Math.abs(delta) < 2 || Date.now() - started > 1800) {
          resolve();
          return;
        }
        window.scrollBy({ top: delta, left: 0, behavior: reduce ? "auto" : "smooth" });
        setTimeout(step, reduce ? 40 : 280);
      }
      step();
    });
  }

  function focusField(el) {
    var tag = el.tagName;
    var type = String(el.type || "").toLowerCase();
    var numeric = el.getAttribute("data-numeric") === "true";
    var textLike = !numeric && tag === "INPUT" && (type === "text" || type === "search" || type === "email" || type === "tel" || type === "url" || type === "password");
    function focusNow() {
      try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    }
    if (textLike) {
      focusNow();
      if (window.visualViewport) {
        var nudged = false;
        function nudge() {
          if (nudged) return;
          nudged = true;
          window.visualViewport.removeEventListener("resize", nudge);
          scrollFieldIntoView(el);
        }
        window.visualViewport.addEventListener("resize", nudge);
        setTimeout(function () { window.visualViewport.removeEventListener("resize", nudge); }, 900);
      }
      return;
    }
    if (tag === "INPUT") {
      var previousMode = el.getAttribute("inputmode");
      var previousReadOnly = el.readOnly;
      el.readOnly = true;
      el.setAttribute("inputmode", "none");
      focusNow();
      setTimeout(function () {
        el.readOnly = previousReadOnly;
        if (previousMode == null) el.removeAttribute("inputmode");
        else el.setAttribute("inputmode", previousMode);
      }, 120);
      return;
    }
    focusNow();
  }

  function goToField(el) {
    if (!el) return;
    expandCard(el.closest(".game-card"));
    scrollFieldIntoView(el).then(function () { focusField(el); });
  }

  function onSubmit(event) {
    event.preventDefault();
    var items = collectMissing();
    if (items.length) {
      items.forEach(function (item) {
        var input = document.getElementById(item.id);
        if (input) expandCard(input.closest(".game-card"));
      });
      paintMissing(items);
      goToField(document.getElementById(items[0].id));
      return;
    }
    clearMissing();
    var date = document.getElementById("confirm-date").value;
    var side = document.getElementById("sheet-side").value;
    var teamSelect = document.getElementById("team-select").value;
    var opponentSelect = document.getElementById("opponent-select").value;
    var teamTyped = document.getElementById("team-name").value.trim();
    var opponentTyped = document.getElementById("opponent-name").value.trim();
    var submitButton = document.getElementById("confirm-submit");
    submitButton.disabled = true;
    var record = sheetRecord();
    ensureTeam(teamSelect, teamTyped).then(function (teamId) {
      return ensureTeam(opponentSelect, opponentTyped).then(function (opponentId) {
        if (teamId === opponentId) throw new Error("This team and the opponent need to be two different teams.");
        var stored = loadStoredSheets().filter(function (row) {
          return !(row.date === date && row.teamId === teamId);
        });
        var entry = {
          id: "sheet_" + date + "_" + teamId,
          at: new Date().toISOString(),
          date: date,
          teamId: teamId,
          opponentTeamId: opponentId,
          teamName: teamTyped,
          opponentName: opponentTyped,
          side: side,
          games: record.games,
          roster: record.roster,
          photoStored: false
        };
        var pair = null;
        stored.forEach(function (other) {
          if (sheetsPair(entry, other)) pair = other;
        });
        stored.push(entry);
        if (!pair) {
          localStorage.setItem(SHEET_KEY, JSON.stringify(stored));
          rememberUpload(entry);
          savedNote.hidden = false;
          savedNote.textContent = "Saved this team's sheet for " + date + ". Standings update when the opponent's sheet for the same date is saved on this phone. The photo was not stored.";
          setStep(3, "Step 3 of 3. Saved. Standings update when the other team’s sheet for the same date is saved too.");
          return null;
        }
        var sides = orderSides(entry, pair);
        var matchId = entry.matchId || pair.matchId || ("m_" + date + "_" + sides.home.teamId + "_" + sides.away.teamId);
        entry.matchId = matchId;
        pair.matchId = matchId;
        return RAD.submitMatch({
          id: matchId,
          date: date,
          homeTeamId: sides.home.teamId,
          awayTeamId: sides.away.teamId,
          games: matchGames(sides.home, sides.away)
        }).then(function (result) {
          localStorage.setItem(SHEET_KEY, JSON.stringify(stored));
          rememberUpload(entry);
          var match = result.match;
          savedNote.hidden = false;
          savedNote.textContent = "Paired the two sheets. Match score " + match.homeGamesWon + "–" + match.awayGamesWon +
            ". The photos were not stored. Standings below include this match.";
          setStep(3, "Step 3 of 3. Saved. The standings below include this match.");
          renderStandings(result.snapshot);
          document.getElementById("live-standings").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }).catch(function (err) {
      showError(confirmError, err && err.message ? err.message : "The score could not be saved.");
    }).then(function () {
      submitButton.disabled = false;
    });
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
      '<div class="table-scroll standings-fit"><table><caption>SAMPLE marks starter teams. A paired upload changes this table immediately.</caption><thead><tr>' +
      '<th scope="col">Rank</th><th scope="col">Team</th><th scope="col">W</th><th scope="col">L</th><th scope="col">Ties</th><th scope="col">Games won</th><th scope="col">Points</th>' +
      "</tr></thead><tbody>" +
      rows.map(function (row) {
        var fresh = data.lastTouched && data.lastTouched.indexOf(row.teamId) >= 0 ? "is-fresh" : "";
        return '<tr class="' + fresh + '"><td class="num" data-label="Rank">' + row.rank + "</td><th scope=\"row\">" +
          sampleTag(row.teamName, row.sample) + esc(row.teamName) + "</th>" +
          '<td class="num" data-label="Wins">' + row.wins + '</td><td class="num" data-label="Losses">' + row.losses + '</td><td class="num" data-label="Ties">' + row.ties +
          '</td><td class="num" data-label="Games won">' + row.gamesWon + '</td><td class="num" data-label="Points">' + row.points + "</td></tr>";
      }).join("") +
      "</tbody></table></div>";
  }

  function setCameraStatus(message) {
    cameraStatus.textContent = message || "";
  }

  function stopCamera() {
    if (camera.timer) clearTimeout(camera.timer);
    camera.timer = 0;
    camera.steadySince = 0;
    camera.lastCorners = null;
    camera.capturing = false;
    if (camera.stream) {
      camera.stream.getTracks().forEach(function (track) { track.stop(); });
      camera.stream = null;
    }
    if (cameraVideo) cameraVideo.srcObject = null;
  }

  function containedRect(boxW, boxH, mediaW, mediaH) {
    if (!boxW || !boxH || !mediaW || !mediaH) return { x: 0, y: 0, width: boxW || 0, height: boxH || 0 };
    var scale = Math.min(boxW / mediaW, boxH / mediaH);
    var width = mediaW * scale;
    var height = mediaH * scale;
    return { x: (boxW - width) / 2, y: (boxH - height) / 2, width: width, height: height };
  }

  function sheetAspect() {
    var size = camera.spec && camera.spec.page && camera.spec.page.size_pt;
    if (size && size[0] && size[1]) return size[0] / size[1];
    return 612 / 792;
  }

  function drawPortraitGuide(ctx, rect) {
    var aspect = sheetAspect();
    var maxW = rect.width * 0.9;
    var maxH = rect.height * 0.9;
    var w = maxW;
    var h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    var x = rect.x + (rect.width - w) / 2;
    var y = rect.y + (rect.height - h) / 2;
    var arm = Math.max(16, Math.round(Math.min(w, h) * 0.08));
    var corners = [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x + w, y + h, -1, -1],
      [x, y + h, 1, -1]
    ];
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 6;
    ctx.lineCap = "square";
    ctx.strokeRect(x, y, w, h);
    corners.forEach(function (corner) {
      ctx.beginPath();
      ctx.moveTo(corner[0], corner[1] + corner[3] * arm);
      ctx.lineTo(corner[0], corner[1]);
      ctx.lineTo(corner[0] + corner[2] * arm, corner[1]);
      ctx.stroke();
    });
  }

  function drawGuide(hit) {
    var width = cameraVideo.clientWidth || 0;
    var height = cameraVideo.clientHeight || 0;
    if (!width || !height) return;
    cameraGuide.width = width;
    cameraGuide.height = height;
    var ctx = cameraGuide.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    var rect = containedRect(width, height, cameraVideo.videoWidth || width, cameraVideo.videoHeight || height);
    if (!hit || !hit.found || !hit.corners) {
      drawPortraitGuide(ctx, rect);
      return;
    }
    var sx = rect.width / hit.width;
    var sy = rect.height / hit.height;
    var order = ["TL", "TR", "BR", "BL"];
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    order.forEach(function (name, index) {
      var point = hit.corners[name];
      var x = rect.x + point.x * sx;
      var y = rect.y + point.y * sy;
      if (index) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  function cornerDrift(previous, next, width, height) {
    var names = ["TL", "TR", "BL", "BR"];
    var diag = Math.hypot(width, height) || 1;
    var sum = 0;
    names.forEach(function (name) {
      sum += Math.hypot(previous[name].x - next[name].x, previous[name].y - next[name].y);
    });
    return (sum / names.length) / diag;
  }

  function captureFrame() {
    if (camera.capturing) return;
    var width = cameraVideo.videoWidth;
    var height = cameraVideo.videoHeight;
    if (!width || !height) {
      var waiting = "The camera has no picture yet. Wait until you see the sheet, then tap Snap.";
      setCameraStatus(waiting);
      showError(errorEl, waiting);
      return;
    }
    if (reading) {
      setCameraStatus("Still reading the last photo…");
      return;
    }
    camera.capturing = true;
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
      canvas.getContext("2d").drawImage(cameraVideo, 0, 0, width, height);
    } catch (err) {
      camera.capturing = false;
      showError(errorEl, "The camera picture could not be captured. Tap Snap again.");
      setCameraStatus("Tap Snap again.");
      return;
    }
    stopCamera();
    cameraPanel.hidden = true;
    scanButton.hidden = false;
    setStatus("Photo captured. Reading the sheet…");
    reading = true;
    readButton.disabled = true;
    readCanvas(canvas).catch(function (err) {
      var message = err && err.message ? err.message : "The photo could not be read. Reload the page and try again.";
      showError(errorEl, message);
      setStatus(message);
      showConfirm();
    }).then(finishRead);
  }

  function cameraTick() {
    if (!camera.stream || camera.capturing) return;
    var width = cameraVideo.videoWidth;
    var height = cameraVideo.videoHeight;
    if (!width || !height || !camera.spec) {
      camera.timer = setTimeout(cameraTick, 200);
      return;
    }
    var canvas = document.createElement("canvas");
    var scale = Math.min(1, 1100 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext("2d").drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
    var hit = RAD_OCR.previewCorners(canvas, camera.spec);
    drawGuide(hit);
    if (!hit.found) {
      camera.steadySince = 0;
      camera.lastCorners = null;
      setCameraStatus("Fit all 4 corners");
    } else if (hit.sharpness < SHARP_MIN) {
      camera.steadySince = 0;
      camera.lastCorners = hit.corners;
      setCameraStatus("Hold still — the picture is blurry");
    } else if (camera.lastCorners && cornerDrift(camera.lastCorners, hit.corners, hit.width, hit.height) > 0.02) {
      camera.steadySince = 0;
      camera.lastCorners = hit.corners;
      setCameraStatus("Hold steady");
    } else {
      camera.lastCorners = hit.corners;
      var now = Date.now();
      if (!camera.steadySince) camera.steadySince = now;
      if (now - camera.steadySince >= STEADY_MS) {
        setCameraStatus("Got it");
        captureFrame();
        return;
      }
      setCameraStatus("Hold steady");
    }
    camera.timer = setTimeout(cameraTick, 280);
  }

  function openCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showError(errorEl, "This browser has no camera. Choose a photo instead.");
      return;
    }
    showError(errorEl, "");
    setCameraStatus("Starting the camera…");
    setStep(1, "Step 1 of 3. Fit all four black corners in the frame. Hold still, or tap Snap.");
    cameraPanel.hidden = false;
    scanButton.hidden = true;
    cameraPanel.scrollIntoView({ block: "start" });
    cameraVideo.setAttribute("playsinline", "true");
    cameraVideo.setAttribute("webkit-playsinline", "true");
    cameraVideo.muted = true;
    cameraVideo.playsInline = true;
    var attempts = [
      { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
      { audio: false, video: { facingMode: "environment" } },
      { audio: false, video: true }
    ];
    function ask(index) {
      return navigator.mediaDevices.getUserMedia(attempts[index]).catch(function (err) {
        if (index < attempts.length - 1 && err && err.name === "OverconstrainedError") return ask(index + 1);
        throw err;
      });
    }
    loadSpec().then(function (spec) {
      camera.spec = spec;
      return ask(0);
    }).then(function (stream) {
      camera.stream = stream;
      cameraVideo.srcObject = stream;
      return cameraVideo.play();
    }).then(function () {
      setCameraStatus("Fit all 4 corners");
      cameraTick();
    }).catch(function (err) {
      stopCamera();
      cameraPanel.hidden = true;
      scanButton.hidden = false;
      var name = err && err.name;
      var message = (name === "NotAllowedError" || name === "PermissionDeniedError")
        ? "The camera is blocked. Choose a photo instead."
        : (name === "NotFoundError" || name === "DevicesNotFoundError")
          ? "No camera was found. Choose a photo instead."
          : "The camera could not start. Choose a photo instead.";
      showError(errorEl, message);
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
    setStatus("Type the date, the two teams, the roster ids, and each game.");
    setStep(2, "Step 2 of 3. Type the date, the teams, the roster ids, and each game. Then save.");
    clearSheet();
    formDirty = false;
    showConfirm();
  });
  scanButton.addEventListener("click", openCamera);
  snapButton.addEventListener("click", function () {
    setCameraStatus("Snap");
    captureFrame();
  });
  cancelButton.addEventListener("click", function () {
    stopCamera();
    cameraPanel.hidden = true;
    scanButton.hidden = false;
    setCameraStatus("Fit all 4 corners");
    setStatus("Camera off. You can still choose a photo.");
    setStep(1, "Step 1 of 3. Camera off. Scan again, or upload a photo.");
  });
  confirmForm.addEventListener("submit", onSubmit);
  function numericInput(target) {
    return !!(target && target.tagName === "INPUT" && (target.type === "number" || target.getAttribute("data-numeric") === "true"));
  }

  function onReviewEdit(event) {
    formDirty = true;
    var target = event.target;
    if (target && target.id && (numericInput(target) || target.tagName === "SELECT")) {
      if (numericInput(target)) target.classList.remove("is-blank", "is-ambiguous");
      var flag = document.getElementById(target.id + "-flag");
      if (flag) {
        if (numericInput(target)) flag.textContent = String(target.value).trim() === "" ? "Blank — not zero" : "";
        else if (target.id === "beer-result") flag.textContent = target.value ? "" : "Blank is allowed";
        else flag.textContent = target.value ? "" : "Not marked";
      }
    }
    refreshChecks();
    if (reviewInvalid) paintMissing(collectMissing());
    else syncSaveButton();
  }
  function bindLiveFields() {
    confirmForm.querySelectorAll("input, select, textarea").forEach(function (el) {
      el.addEventListener("input", onReviewEdit);
      el.addEventListener("change", onReviewEdit);
    });
  }
  confirmForm.addEventListener("input", onReviewEdit, true);
  confirmForm.addEventListener("change", onReviewEdit, true);
  bindLiveFields();
  document.getElementById("games-block").addEventListener("click", function (event) {
    var button = event.target.closest(".game-toggle");
    if (!button) return;
    var card = button.closest(".game-card");
    var collapsed = !card.classList.contains("is-collapsed");
    card.classList.toggle("is-collapsed", collapsed);
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    var state = button.querySelector(".game-toggle-state");
    if (state) state.textContent = collapsed ? "Show" : "Hide";
  });
  document.getElementById("missing-list").addEventListener("click", function (event) {
    var button = event.target.closest("button[data-goto]");
    if (!button) return;
    goToField(document.getElementById(button.getAttribute("data-goto")));
  });

  fillTeamSelect(document.getElementById("team-select"), "");
  fillTeamSelect(document.getElementById("opponent-select"), "");
  refreshChecks();

  RAD.load().then(function (data) {
    snap = data;
    fillTeamSelect(document.getElementById("team-select"), document.getElementById("team-name").value);
    fillTeamSelect(document.getElementById("opponent-select"), document.getElementById("opponent-name").value);
    renderStandings(data);
  });
  RAD.subscribe(function (data) {
    snap = data;
    renderStandings(data);
  });
})();
