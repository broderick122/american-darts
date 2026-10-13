(function () {
  "use strict";

  var UPLOAD_KEY = "rad.uploads.v1";
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

  function parseUsDate(raw) {
    var text = String(raw || "");
    var match = text.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{2,4})/);
    var month;
    var day;
    var year;
    if (match) {
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
    } else {
      var digits = text.replace(/\D/g, "");
      if (digits.length !== 6 && digits.length !== 8) return "";
      month = Number(digits.slice(0, 2));
      day = Number(digits.slice(2, 4));
      year = Number(digits.slice(4));
    }
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1970) return "";
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return year + "-" + pad(month) + "-" + pad(day);
  }

  function winnerCount() {
    var home = 0;
    var away = 0;
    [1, 2, 3].forEach(function (n) {
      var value = document.getElementById("g" + n + "-winner").value;
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
    var counts = winnerCount();
    document.getElementById("home-won").value = String(counts.home);
    document.getElementById("away-won").value = String(counts.away);
    scoresTouched = false;
    updateFinalScore();
  }

  function showConfirm() {
    confirmSection.hidden = false;
    confirmSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pointsText(value) {
    return value == null ? "" : String(value);
  }

  function describeReading(result) {
    if (result.mode === "rejected") {
      return "This photo does not look like the v2 score sheet. The form below is empty so you can type the result.";
    }
    var games = (result.games || []).map(function (game, index) {
      var home = game.homePoints == null ? "—" : game.homePoints;
      var away = game.awayPoints == null ? "—" : game.awayPoints;
      var who = game.winner === "home" ? "home" : game.winner === "away" ? "away" : "no winner";
      return "Game " + (index + 1) + " " + home + "–" + away + " (" + who + ")";
    }).join("; ");
    var sheet = "Sheet points " +
      (result.homeSheetPoints == null ? "—" : result.homeSheetPoints) + "–" +
      (result.awaySheetPoints == null ? "—" : result.awaySheetPoints) + ".";
    return "Read " + result.boxesRead + " written number boxes and skipped " + result.blanksSkipped +
      " blank ones. " + games + ". " + sheet + " Games won " + result.homeGamesWon + "–" + result.awayGamesWon +
      ". Corner marks: " + (result.mode === "fiducial" ? "found" : "not found") +
      (result.notch ? ", notch seen." : ".");
  }

  function applyReading(result) {
    window.RAD_UPLOAD_LAST = result;
    summaryEl.textContent = describeReading(result);
    var shown = result.warnings.slice(0, 6);
    var extra = result.warnings.length - shown.length;
    warningEl.innerHTML = shown.map(function (item) { return "<li>" + esc(item) + "</li>"; }).join("") +
      (extra ? "<li>And " + extra + " more notes. Check the totals before saving.</li>" : "");
    if (result.previewUrl) {
      previewImg.src = result.previewUrl;
      previewFigure.hidden = false;
      previewNote.textContent = result.mode === "fiducial"
        ? "Straightened with the four corner marks."
        : result.mode === "rejected"
          ? "This photo did not line up with the printed sheet."
          : "Corner marks were missed, so this is the whole photo. The numbers below need a careful look.";
    }
    if (!confirmSection.hidden && formDirty) {
      setStatus("The photo was read, and your edits were left as they are.");
      return;
    }
    document.getElementById("confirm-date").value = parseUsDate(result.dateText);
    document.getElementById("home-name").value = result.homeName || "";
    document.getElementById("away-name").value = result.awayName || "";
    fillTeamSelect(document.getElementById("home-team"), result.homeName);
    fillTeamSelect(document.getElementById("away-team"), result.awayName);
    (result.games || []).forEach(function (game, index) {
      var n = index + 1;
      document.getElementById("g" + n + "-home-pts").value = pointsText(game.homePoints);
      document.getElementById("g" + n + "-away-pts").value = pointsText(game.awayPoints);
      document.getElementById("g" + n + "-winner").value = game.winner || "";
    });
    document.getElementById("beer-winner").value = result.beerWinner || "";
    document.getElementById("sheet-points").textContent =
      "Inning totals on the sheet (not the match score): home " +
      (result.homeSheetPoints == null ? "—" : result.homeSheetPoints) +
      ", away " + (result.awaySheetPoints == null ? "—" : result.awaySheetPoints) + ".";
    document.getElementById("home-won").value = String(result.homeGamesWon || 0);
    document.getElementById("away-won").value = String(result.awayGamesWon || 0);
    scoresTouched = false;
    formDirty = false;
    updateFinalScore();
    showConfirm();
    setStatus("Check the names and the score. Handwriting recognition misses digits.");
  }

  function readPhoto() {
    var file = fileInput.files && fileInput.files[0];
    if (!file) {
      showError(errorEl, "Choose a photo of the filled-in score sheet first.");
      return;
    }
    if (reading) return;
    reading = true;
    readButton.disabled = true;
    showError(errorEl, "");
    setStatus("Opening the photo…");
    RAD_OCR.loadImageFile(file).then(function (canvas) {
      if (canvas.width < 400 || canvas.height < 300) {
        throw new Error("That photo is too small to read. Move closer and include all four corner marks.");
      }
      return fetch("scoresheet/layout_spec.json").then(function (response) {
        if (!response.ok) throw new Error("The score sheet layout could not be loaded.");
        return response.json();
      }).then(function (spec) {
        return RAD_OCR.readSheet(canvas, spec, setStatus);
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
        var winner = document.getElementById("g" + n + "-winner").value;
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
      showError(confirmError, "Enter the games won. A match needs at least one game.");
      return;
    }
    var homeSelect = document.getElementById("home-team").value;
    var awaySelect = document.getElementById("away-team").value;
    var homeTyped = document.getElementById("home-name").value.trim();
    var awayTyped = document.getElementById("away-name").value.trim();
    if (homeSelect === "new" && awaySelect === "new" && homeTyped && homeTyped.toLowerCase() === awayTyped.toLowerCase()) {
      showError(confirmError, "Home and away need to be two different teams.");
      return;
    }
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
        photoStored: false
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
    setStatus("Type the date, the two teams, and the games won. The photo reader is optional.");
    showConfirm();
  });
  confirmForm.addEventListener("submit", onSubmit);
  confirmForm.addEventListener("input", function () { formDirty = true; });
  [1, 2, 3].forEach(function (n) {
    document.getElementById("g" + n + "-winner").addEventListener("change", applyWinnerCounts);
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
