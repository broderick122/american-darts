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
  var sheetPointsEl = document.getElementById("sheet-points");
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

  function buildReview() {
    document.getElementById("roster-block").innerHTML =
      '<div class="table-scroll"><table class="bubble-table roster-table"><caption>Roster ids A through H. An empty id was not read as zero.</caption><thead><tr>' +
      SLOTS.map(function (slot) { return "<th scope=\"col\">" + slot + "</th>"; }).join("") +
      "</tr></thead><tbody><tr>" +
      SLOTS.map(function (slot) {
        return '<td><input id="roster-' + slot + '" type="number" min="0" max="99" inputmode="numeric" placeholder="—" aria-label="Roster ' + slot + ' id"><span id="roster-' + slot + '-flag" class="bubble-flag"></span></td>';
      }).join("") +
      "</tr></tbody></table></div>";

    document.getElementById("games-block").innerHTML = GAMES.map(function (game) {
      var rows = SHOOTERS.map(function (n) {
        return "<tr><th scope=\"row\">" + n + "</th><td><select id=\"g" + game + "-s" + n + "-who\" aria-label=\"Game " + game + " shooter " + n + " who\">" +
          slotOptions("") + "</select><span id=\"g" + game + "-s" + n + "-who-flag\" class=\"bubble-flag\"></span></td>" +
          "<td><input id=\"g" + game + "-s" + n + "-score\" type=\"number\" min=\"0\" max=\"49\" inputmode=\"numeric\" placeholder=\"—\" aria-label=\"Game " + game + " shooter " + n + " score\">" +
          "<span id=\"g" + game + "-s" + n + "-score-flag\" class=\"bubble-flag\"></span></td></tr>";
      }).join("");
      return '<section class="game-card"><h3>Game ' + game + "</h3>" +
        '<div class="table-scroll"><table class="bubble-table"><caption>Who threw, and the score. Tens is a column of 1 through 4. A score under 10 leaves tens blank.</caption><thead><tr><th scope="col"></th><th scope="col">Who</th><th scope="col">Score</th></tr></thead><tbody>' +
        rows + "</tbody></table></div>" +
        '<div class="form-grid cols-3"><label class="field">Team total<input id="g' + game + '-team" type="number" min="0" max="199" inputmode="numeric" placeholder="—"><span id="g' + game + '-team-flag" class="bubble-flag"></span></label>' +
        '<label class="field">Result<select id="g' + game + '-result"><option value="">Not marked</option><option value="won">Won</option><option value="lost">Lost</option></select><span id="g' + game + '-result-flag" class="bubble-flag"></span></label></div>' +
        '<p id="g' + game + '-check" class="cross-check"></p></section>';
    }).join("") +
      '<div class="form-grid cols-2"><label class="field">Beer frame<select id="beer-result"><option value="">Not marked</option><option value="won">Won</option><option value="lost">Lost</option></select><span id="beer-result-flag" class="bubble-flag"></span></label>' +
      '<label class="field">Total points<select id="points-result"><option value="">Not marked</option><option value="won">Won</option><option value="lost">Lost</option></select><span id="points-result-flag" class="bubble-flag"></span></label></div>';
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

  function refreshChecks() {
    GAMES.forEach(function (game) {
      var scores = SHOOTERS.map(function (n) { return numberOrNull(document.getElementById("g" + game + "-s" + n + "-score")); });
      var team = numberOrNull(document.getElementById("g" + game + "-team"));
      var el = document.getElementById("g" + game + "-check");
      el.classList.remove("is-bad");
      if (scores.every(function (value) { return value == null; }) && team == null) {
        el.textContent = "";
        return;
      }
      if (scores.some(function (value) { return value == null; }) || team == null) {
        el.textContent = "Game " + game + ": fill every shooter and the team total to check the sum.";
        return;
      }
      var sum = scores.reduce(function (total, value) { return total + value; }, 0);
      if (sum !== team) {
        el.textContent = "Game " + game + ": shooters add up to " + sum + ", team total is " + team + ".";
        el.classList.add("is-bad");
      } else {
        el.textContent = "Game " + game + ": shooters add up to the team total (" + sum + ").";
      }
    });
    var totals = GAMES.map(function (game) {
      var value = numberOrNull(document.getElementById("g" + game + "-team"));
      return value == null ? "—" : value;
    });
    sheetPointsEl.textContent = "Team totals on this sheet: " + totals.join(" + ") + ". Standings use WON and LOST, not these point totals.";
    updateFinalScore();
  }

  function clearSheet() {
    setChoice("sheet-side", "", "blank");
    SLOTS.forEach(function (slot) { setNumber("roster-" + slot, { status: "blank" }); });
    GAMES.forEach(function (game) {
      SHOOTERS.forEach(function (n) {
        setChoice("g" + game + "-s" + n + "-who", "", "blank");
        setNumber("g" + game + "-s" + n + "-score", { status: "blank" });
      });
      setNumber("g" + game + "-team", { status: "blank" });
      setChoice("g" + game + "-result", "", "blank");
    });
    setChoice("beer-result", "", "blank", "Blank is allowed");
    setChoice("points-result", "", "blank");
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
        setNumber("g" + n + "-team", game.team);
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
    setStatus(result.mode === "rejected"
      ? "Retake the photo so all four black corner squares are in the frame. You can still type the score below."
      : "Check the roster, the scores, and the date, then save.");
  }

  function loadSpec() {
    return fetch("scoresheet/scansheet_v16_layout_spec.json").then(function (response) {
      if (!response.ok) throw new Error("The scan sheet layout could not be loaded.");
      return response.json();
    });
  }

  function readCanvas(canvas) {
    if (canvas.width < 500 || canvas.height < 360) {
      return Promise.reject(new Error("That photo is too small to read. Move closer and include all four corner squares."));
    }
    setStatus("Opening the sheet…");
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
          team: numberOrNull(document.getElementById("g" + game + "-team")),
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

  function onSubmit(event) {
    event.preventDefault();
    showError(confirmError, "");
    var date = document.getElementById("confirm-date").value;
    var side = document.getElementById("sheet-side").value;
    if (!date) {
      showError(confirmError, "Add the match date.");
      return;
    }
    if (side !== "home" && side !== "away") {
      showError(confirmError, "Mark this sheet as Home or Away.");
      return;
    }
    var teamSelect = document.getElementById("team-select").value;
    var opponentSelect = document.getElementById("opponent-select").value;
    var teamTyped = document.getElementById("team-name").value.trim();
    var opponentTyped = document.getElementById("opponent-name").value.trim();
    if (teamSelect !== "new" && opponentSelect !== "new" && teamSelect === opponentSelect) {
      showError(confirmError, "This team and the opponent need to be two different teams.");
      return;
    }
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
      '<div class="table-scroll"><table><caption>SAMPLE marks starter teams. A paired upload changes this table immediately.</caption><thead><tr>' +
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

  function drawBrackets(ctx, width, height) {
    var inset = Math.round(Math.min(width, height) * 0.12);
    var arm = Math.round(Math.min(width, height) * 0.12);
    var corners = [
      [inset, inset, 1, 1],
      [width - inset, inset, -1, 1],
      [width - inset, height - inset, -1, -1],
      [inset, height - inset, 1, -1]
    ];
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 8;
    ctx.lineCap = "square";
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
    if (!hit || !hit.found || !hit.corners) {
      drawBrackets(ctx, width, height);
      return;
    }
    var sx = width / hit.width;
    var sy = height / hit.height;
    var order = ["TL", "TR", "BR", "BL"];
    ctx.strokeStyle = "#ffe14a";
    ctx.lineWidth = 6;
    ctx.beginPath();
    order.forEach(function (name, index) {
      var point = hit.corners[name];
      var x = point.x * sx;
      var y = point.y * sy;
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
    if (camera.capturing || reading) return;
    var width = cameraVideo.videoWidth;
    var height = cameraVideo.videoHeight;
    if (!width || !height) {
      setCameraStatus("The camera has no picture yet.");
      return;
    }
    camera.capturing = true;
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d").drawImage(cameraVideo, 0, 0, width, height);
    stopCamera();
    cameraPanel.hidden = true;
    scanButton.hidden = false;
    setStatus("Photo captured. Reading the sheet…");
    reading = true;
    readButton.disabled = true;
    readCanvas(canvas).catch(function (err) {
      showError(errorEl, err && err.message ? err.message : "The photo could not be read.");
      setStatus("");
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
    var scale = Math.min(1, 640 / Math.max(width, height));
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
    cameraPanel.hidden = false;
    scanButton.hidden = true;
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
  });
  confirmForm.addEventListener("submit", onSubmit);
  confirmForm.addEventListener("input", function (event) {
    formDirty = true;
    var target = event.target;
    if (target && target.classList && target.type === "number") {
      target.classList.remove("is-blank", "is-ambiguous");
      var flag = document.getElementById(target.id + "-flag");
      if (flag) flag.textContent = target.value === "" ? "Blank — not zero" : "";
    }
    refreshChecks();
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
