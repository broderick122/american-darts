import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((path) => existsSync(path));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf"
};

function serve(base) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const file = join(base, decodeURIComponent(url.pathname));
    if (!file.startsWith(base)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      res.writeHead(404);
      res.end(String(err.message || err));
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function runPython() {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["test/make_v16_fixture.py"], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("fixture generator failed"))));
  });
}

function compareReading(actual, expected, label) {
  const problems = [];
  let fields = 0;
  let ok = 0;
  function field(path, got, want) {
    fields += 1;
    if (got === want) ok += 1;
    else problems.push(label + " " + path + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  }
  if (actual.mode !== "fiducial") {
    problems.push(label + " mode " + actual.mode + " warnings " + JSON.stringify((actual.warnings || []).slice(0, 4)));
    return { problems, fields: 39, ok: 0 };
  }
  field("side", (actual.side && actual.side.value) + "/" + (actual.side && actual.side.status), expected.side.value + "/" + expected.side.status);
  Object.keys(expected.roster).forEach((slot) => {
    const got = actual.roster && actual.roster[slot];
    field("roster " + slot, (got && got.value) + "/" + (got && got.status), expected.roster[slot].value + "/" + expected.roster[slot].status);
  });
  expected.games.forEach((game, gameIndex) => {
    const gotGame = (actual.games || [])[gameIndex] || {};
    game.shooters.forEach((row, shooterIndex) => {
      const got = (gotGame.shooters || [])[shooterIndex] || {};
      field(
        "g" + (gameIndex + 1) + " s" + (shooterIndex + 1) + " who",
        (got.who && got.who.value) + "/" + (got.who && got.who.status),
        row.who.value + "/" + row.who.status
      );
      field(
        "g" + (gameIndex + 1) + " s" + (shooterIndex + 1) + " score",
        (got.score && got.score.value) + "/" + (got.score && got.score.status),
        row.score.value + "/" + row.score.status
      );
    });
    field("g" + (gameIndex + 1) + " team", (gotGame.team && gotGame.team.value) + "/" + (gotGame.team && gotGame.team.status), game.team.value + "/" + game.team.status);
    field("g" + (gameIndex + 1) + " result", (gotGame.result && gotGame.result.value) + "/" + (gotGame.result && gotGame.result.status), game.result.value + "/" + game.result.status);
    field("g" + (gameIndex + 1) + " mismatch", !!gotGame.sumMismatch, !!game.sumMismatch);
  });
  field("beer", (actual.beer && actual.beer.value) + "/" + (actual.beer && actual.beer.status), expected.beer.value + "/" + expected.beer.status);
  field("points", (actual.points && actual.points.value) + "/" + (actual.points && actual.points.status), expected.points.value + "/" + expected.points.status);
  return { problems, fields, ok };
}

function installCamera(page, mode, imageUrl) {
  return page.evaluateOnNewDocument((cameraMode, src) => {
    window.__camTracks = [];
    const fail = cameraMode === "denied";
    navigator.mediaDevices.getUserMedia = function () {
      if (fail) {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        return Promise.reject(err);
      }
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const stream = canvas.captureStream(8);
          const paint = () => {
            ctx.drawImage(img, 0, 0);
            requestAnimationFrame(paint);
          };
          paint();
          stream.getTracks().forEach((track) => window.__camTracks.push(track));
          resolve(stream);
        };
        img.onerror = () => reject(new Error("camera fixture missing"));
        img.src = src;
      });
    };
  }, mode, imageUrl);
}

async function main() {
  if (!chrome) throw new Error("Chrome was not found.");
  const pdfHash = createHash("md5").update(readFileSync(join(root, "scoresheet/roslyn_scansheet_v16.pdf"))).digest("hex");
  if (pdfHash !== "bf40f030043374d0427aba93955ff230") {
    throw new Error("v16 PDF md5 " + pdfHash);
  }
  await runPython();
  const expected = JSON.parse(readFileSync(join(root, "test/fixtures/expected-v16.json"), "utf8"));
  const server = await serve(root);
  const port = server.address().port;
  const origin = "http://127.0.0.1:" + port;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });
  const accuracy = [];
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(origin + "/test/harness.html?sheet=v16", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const text = document.getElementById("result").textContent;
      return text && text !== "reading";
    });
    const payload = JSON.parse(await page.$eval("#result", (el) => el.textContent));
    if (payload.error) throw new Error(payload.error);
    const turns = [0, 90, 180, 270];
    payload.v16.forEach((reading, index) => {
      const label = "turn-" + turns[index];
      const compared = compareReading(reading, expected, label);
      accuracy.push(label + " " + compared.ok + "/" + compared.fields);
      if (reading.rotation !== turns[index]) {
        compared.problems.push(label + " rotation " + reading.rotation + " expected " + turns[index]);
      }
      if (!reading.notch) compared.problems.push(label + " notch was not found");
      if (turns[index] === 180 && !reading.upsideDown) compared.problems.push(label + " was not marked upside down");
      if (compared.problems.length) {
        console.error(compared.problems.join("\n"));
        console.error("calibration", JSON.stringify(reading.calibration));
        console.error("warnings", (reading.warnings || []).slice(0, 16).join(" | "));
        throw new Error(compared.problems.length + " reader checks failed on " + label);
      }
    });
    console.log("v16 reader " + accuracy.join(", "));

    const upload = await browser.newPage();
    await upload.setViewport({ width: 1100, height: 1600, deviceScaleFactor: 1 });
    await upload.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    const sheetLinks = await upload.$$eval("a[href*='scansheet']", (els) => els.map((el) => el.getAttribute("href")));
    if (!sheetLinks.length || sheetLinks.some((href) => !/v16\.pdf$/.test(href))) {
      throw new Error("upload download links: " + sheetLinks.join(", "));
    }
    const home = await browser.newPage();
    await home.goto(origin + "/index.html", { waitUntil: "domcontentloaded" });
    const homeLinks = await home.$$eval("a[href*='scansheet']", (els) => els.map((el) => el.getAttribute("href")));
    if (!homeLinks.length || homeLinks.some((href) => !/v16\.pdf$/.test(href))) {
      throw new Error("home download links: " + homeLinks.join(", "));
    }
    await home.close();

    const input = await upload.$("#sheet-file");
    await input.uploadFile(join(root, "test/fixtures/filled-v16.jpg"));
    await upload.waitForFunction(() => {
      const section = document.getElementById("confirm-section");
      const box = document.getElementById("roster-A");
      return section && !section.hidden && box && box.value === "12";
    });
    const form = await upload.evaluate(() => {
      function val(id) { return document.getElementById(id).value; }
      function flag(id) { return document.getElementById(id + "-flag").textContent; }
      return {
        side: val("sheet-side"),
        roster: ["A", "B", "C", "D", "E", "F", "G", "H"].map((slot) => val("roster-" + slot)),
        rosterEBlank: document.getElementById("roster-E").classList.contains("is-blank"),
        g1: [val("g1-s1-who"), val("g1-s1-score"), val("g1-s2-who"), val("g1-s2-score"), val("g1-s3-score"), val("g1-s4-score"), val("g1-team"), val("g1-result")],
        g1Check: document.getElementById("g1-check").textContent,
        g1Bad: document.getElementById("g1-check").classList.contains("is-bad"),
        g2Who: val("g2-s2-who"),
        g2Flag: flag("g2-s2-who"),
        g2Check: document.getElementById("g2-check").textContent,
        g2Bad: document.getElementById("g2-check").classList.contains("is-bad"),
        g3Team: val("g3-team"),
        g3Check: document.getElementById("g3-check").textContent,
        g3Bad: document.getElementById("g3-check").classList.contains("is-bad"),
        results: [val("g1-result"), val("g2-result"), val("g3-result")],
        beer: val("beer-result"),
        points: val("points-result"),
        finalScore: document.getElementById("final-score").textContent,
        finalSize: getComputedStyle(document.getElementById("final-score")).fontSize,
        totals: ["save-total-1", "save-total-2", "save-total-3", "save-total-sum"].map((id) => document.getElementById(id).textContent),
        summary: document.getElementById("ocr-summary").textContent
      };
    });
    const formProblems = [];
    if (form.side !== "home") formProblems.push("side " + form.side);
    if (form.roster.join(",") !== "12,7,23,4,,15,31,8") formProblems.push("roster " + form.roster.join(","));
    if (!form.rosterEBlank) formProblems.push("blank roster E was stored as a number");
    if (form.g1.join(",") !== "A,21,B,15,8,19,63,won") formProblems.push("game 1 " + form.g1.join(","));
    if (form.g1Bad || !/63/.test(form.g1Check)) formProblems.push("game 1 sum " + form.g1Check);
    if (form.g2Who !== "" || !/two marks/i.test(form.g2Flag)) formProblems.push("ambiguous who " + form.g2Who + " " + form.g2Flag);
    if (!form.g2Bad || !/54/.test(form.g2Check) || !/50/.test(form.g2Check)) formProblems.push("game 2 sum " + form.g2Check);
    if (form.g3Team !== "149" || !form.g3Bad || !/58/.test(form.g3Check) || !/149/.test(form.g3Check)) {
      formProblems.push("game 3 total " + form.g3Team + " " + form.g3Check);
    }
    if (form.results.join(",") !== "won,lost,won") formProblems.push("results " + form.results.join(","));
    if (form.beer !== "") formProblems.push("beer " + form.beer);
    if (form.points !== "won") formProblems.push("points " + form.points);
    if (!/2 games won/.test(form.finalScore)) formProblems.push("final " + form.finalScore);
    if (parseFloat(form.finalSize) > 22) formProblems.push("final size " + form.finalSize);
    if (form.totals.join(",") !== "63,50,149,262") formProblems.push("sticky totals " + form.totals.join(","));
    if (!/home/i.test(form.summary) || !/2 games won/.test(form.summary)) formProblems.push("summary " + form.summary);
    if (formProblems.length) {
      console.error(form);
      throw new Error(formProblems.join("\n"));
    }
    await upload.$eval("#roster-A", (el) => {
      el.value = "99";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const edited = await upload.$eval("#roster-A", (el) => el.value);
    if (edited !== "99") throw new Error("roster edit did not stick");
    await upload.$eval("#roster-A", (el) => {
      el.value = "12";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await upload.$eval("#g1-team", (el) => {
      el.value = "80";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const liveTotals = await upload.evaluate(() => ["save-total-1", "save-total-2", "save-total-3", "save-total-sum"].map((id) => document.getElementById(id).textContent).join(","));
    if (liveTotals !== "80,50,149,279") throw new Error("live totals " + liveTotals);
    await upload.$eval("#g1-team", (el) => {
      el.value = "63";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await upload.$eval("#g1-s1-score", (el) => {
      el.value = "30";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const followed = await upload.evaluate(() => ({
      totals: ["save-total-1", "save-total-2", "save-total-3", "save-total-sum"].map((id) => document.getElementById(id).textContent).join(","),
      team: document.getElementById("g1-team").value,
      check: document.getElementById("g1-check").textContent,
      bad: document.getElementById("g1-check").classList.contains("is-bad"),
      won: document.getElementById("final-score").textContent
    }));
    if (followed.totals !== "72,50,149,271") throw new Error("shooter follow " + followed.totals);
    if (followed.team !== "72" || followed.bad || !/72/.test(followed.check)) throw new Error("followed team " + JSON.stringify(followed));
    if (followed.won !== "2 games won") throw new Error("won while editing score " + followed.won);
    await upload.$eval("#g2-s1-score", (el) => {
      el.value = "10";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const mismatch = await upload.evaluate(() => ({
      game: document.getElementById("save-total-2").textContent,
      team: document.getElementById("g2-team").value,
      check: document.getElementById("g2-check").textContent,
      bad: document.getElementById("g2-check").classList.contains("is-bad"),
      total: document.getElementById("save-total-sum").textContent
    }));
    if (mismatch.game !== "50" || mismatch.team !== "50" || !mismatch.bad) throw new Error("mismatch panel " + JSON.stringify(mismatch));
    if (!/52/.test(mismatch.check) || !/50/.test(mismatch.check)) throw new Error("mismatch text " + mismatch.check);
    if (mismatch.total !== "271") throw new Error("mismatch total " + mismatch.total);
    await upload.$eval("#g2-result", (el) => {
      el.value = "won";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const wonNow = await upload.$eval("#final-score", (el) => el.textContent);
    if (wonNow !== "3 games won") throw new Error("won line " + wonNow);
    await upload.$eval("#g2-result", (el) => {
      el.value = "lost";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await upload.$eval("#g1-s1-score", (el) => {
      el.value = "21";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await upload.$eval("#g2-s1-score", (el) => {
      el.value = "12";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const restoredScores = await upload.evaluate(() => ({
      totals: ["save-total-1", "save-total-2", "save-total-3", "save-total-sum"].map((id) => document.getElementById(id).textContent).join(","),
      team: document.getElementById("g1-team").value,
      won: document.getElementById("final-score").textContent
    }));
    if (restoredScores.totals !== "63,50,149,262" || restoredScores.team !== "63") throw new Error("restored totals " + JSON.stringify(restoredScores));
    if (restoredScores.won !== "2 games won") throw new Error("restored won " + restoredScores.won);
    console.log("upload review shows the v16 reading and accepts edits");
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    const section = await upload.$("#confirm-section");
    await section.screenshot({ path: "/opt/cursor/artifacts/v16_upload_review.png" });

    await upload.select("#team-select", "t_red");
    await upload.select("#opponent-select", "t_green");
    await upload.select("#g2-s2-who", "F");
    await upload.$eval("#roster-E", (el) => {
      el.value = "5";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await upload.$eval("#confirm-date", (el) => {
      el.value = "2026-11-04";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const readyButton = await upload.$eval("#confirm-submit", (el) => ({
      text: el.textContent,
      primary: el.classList.contains("btn-primary"),
      fix: el.classList.contains("btn-fix")
    }));
    if (readyButton.text !== "Save" || !readyButton.primary || readyButton.fix) {
      throw new Error("ready button " + JSON.stringify(readyButton));
    }
    await upload.click("#confirm-submit");
    await upload.waitForFunction(() => /opponent's sheet/i.test(document.getElementById("saved-note").textContent || ""));
    await upload.select("#sheet-side", "away");
    await upload.select("#team-select", "t_green");
    await upload.select("#opponent-select", "t_red");
    await upload.$eval("#g1-result", (el) => { el.value = "lost"; });
    await upload.$eval("#g2-result", (el) => { el.value = "won"; });
    await upload.$eval("#g3-result", (el) => { el.value = "lost"; });
    await upload.click("#confirm-submit");
    await upload.waitForFunction(() => /Paired the two sheets/.test(document.getElementById("saved-note").textContent || ""));
    const paired = await upload.$eval("#saved-note", (el) => el.textContent);
    if (!/2–1/.test(paired) && !/2-1/.test(paired)) throw new Error("pair score " + paired);
    const stored = await upload.evaluate(() => JSON.parse(localStorage.getItem("rad.sheets.v1") || "[]"));
    if (stored.length !== 2) throw new Error("stored sheets " + stored.length);
    console.log("paired two team sheets: " + paired.trim());

    await upload.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await upload.evaluate(() => {
      document.getElementById("confirm-date").value = "";
      document.getElementById("g2-s3-who").value = "";
      var card = document.querySelector('[data-game="2"]');
      card.classList.add("is-collapsed");
      card.querySelector(".game-toggle").setAttribute("aria-expanded", "false");
      card.querySelector(".game-toggle-state").textContent = "Show";
      document.getElementById("confirm-date").dispatchEvent(new Event("input", { bubbles: true }));
      document.getElementById("g2-s3-who").dispatchEvent(new Event("change", { bubbles: true }));
    });
    const fixTwo = await upload.$eval("#confirm-submit", (el) => ({
      text: el.textContent,
      fix: el.classList.contains("btn-fix"),
      primary: el.classList.contains("btn-primary")
    }));
    if (fixTwo.text !== "Fix 2 items" || !fixTwo.fix || fixTwo.primary) {
      throw new Error("fix button " + JSON.stringify(fixTwo));
    }
    const noteBeforeJump = await upload.$eval("#saved-note", (el) => el.textContent);
    await upload.click("#confirm-submit");
    await upload.waitForFunction(() => {
      const date = document.getElementById("confirm-date");
      if (document.activeElement !== date) return false;
      const field = date.closest(".field").getBoundingClientRect();
      const save = document.querySelector(".save-bar").getBoundingClientRect();
      const header = document.querySelector(".site-header").getBoundingClientRect();
      const nav = document.querySelector(".thumb-nav").getBoundingClientRect();
      const limit = Math.min(save.top, nav.top);
      return field.top >= header.bottom - 4 && field.bottom <= limit + 4;
    }, { timeout: 5000 });
    const missing = await upload.evaluate(() => {
      const who = document.getElementById("g2-s3-who");
      const card = who.closest(".game-card");
      return {
        count: document.getElementById("missing-count").textContent,
        dateMsg: document.getElementById("confirm-date").closest(".field").querySelector(".missing-note").textContent,
        whoMsg: who.closest(".field").querySelector(".missing-note").textContent,
        expanded: !card.classList.contains("is-collapsed"),
        labels: Array.from(document.querySelectorAll("#missing-list button")).map((button) => button.textContent)
      };
    });
    if (missing.count !== "2 items missing") throw new Error("missing count " + missing.count);
    if (missing.dateMsg !== "Add the match date.") throw new Error("date message " + missing.dateMsg);
    if (missing.whoMsg !== "Pick who shot Game 2, S3.") throw new Error("who message " + missing.whoMsg);
    if (!missing.expanded) throw new Error("game 2 stayed collapsed");
    if (!missing.labels.some((text) => text.indexOf("Match date") === 0) || !missing.labels.some((text) => text.indexOf("Game 2, shooter 3, who") === 0)) {
      throw new Error("summary labels " + missing.labels.join(" | "));
    }
    const stillFixing = await upload.$eval("#confirm-submit", (el) => el.textContent);
    const noteAfterJump = await upload.$eval("#saved-note", (el) => el.textContent);
    if (stillFixing !== "Fix 2 items") throw new Error("button after jump " + stillFixing);
    if (noteAfterJump !== noteBeforeJump) throw new Error("fix button saved the sheet");
    await upload.evaluate(() => document.querySelector('#missing-list button[data-goto="g2-s3-who"]').click());
    await upload.waitForFunction(() => {
      const who = document.getElementById("g2-s3-who");
      if (document.activeElement !== who) return false;
      const field = who.closest(".field").getBoundingClientRect();
      const save = document.querySelector(".save-bar").getBoundingClientRect();
      const header = document.querySelector(".site-header").getBoundingClientRect();
      return field.top >= header.bottom - 4 && field.bottom <= save.top + 4;
    }, { timeout: 5000 });
    await upload.select("#g2-s3-who", "A");
    await upload.waitForFunction(() => {
      const who = document.getElementById("g2-s3-who");
      const button = document.getElementById("confirm-submit");
      return !who.closest(".field").classList.contains("is-missing") &&
        document.getElementById("missing-count").textContent === "1 item missing" &&
        button.textContent === "Fix 1 item" &&
        button.classList.contains("btn-fix") &&
        !button.classList.contains("btn-primary");
    });
    await upload.$eval("#confirm-date", (el) => {
      el.value = "2026-11-04";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const savedAgain = await upload.$eval("#confirm-submit", (el) => ({
      text: el.textContent,
      primary: el.classList.contains("btn-primary"),
      fix: el.classList.contains("btn-fix"),
      summaryHidden: document.getElementById("missing-summary").hidden
    }));
    if (savedAgain.text !== "Save" || !savedAgain.primary || savedAgain.fix || !savedAgain.summaryHidden) {
      throw new Error("save button " + JSON.stringify(savedAgain));
    }
    console.log("save scrolls to the first missing field and clears a fix");

    await upload.evaluate(() => {
      document.getElementById("confirm-date").value = "2026-11-04";
      function markAmbiguous(id) {
        var el = document.getElementById(id);
        el.value = "";
        if (el.classList) el.classList.add("is-ambiguous");
        document.getElementById(id + "-flag").textContent = "Check — two marks";
      }
      markAmbiguous("roster-A");
      markAmbiguous("roster-F");
      markAmbiguous("g1-s2-score");
      markAmbiguous("g1-team");
      var beer = document.getElementById("beer-result");
      beer.value = "";
      document.getElementById("beer-result-flag").textContent = "Check — two marks";
      var rosterB = document.getElementById("roster-B");
      rosterB.value = "";
      rosterB.classList.remove("is-ambiguous");
      document.getElementById("roster-B-flag").textContent = "Blank — not zero";
      var rosterG = document.getElementById("roster-G");
      rosterG.value = "";
      rosterG.classList.remove("is-ambiguous");
      document.getElementById("roster-G-flag").textContent = "Blank — not zero";
      document.getElementById("confirm-date").dispatchEvent(new Event("input", { bubbles: true }));
    });
    const fixSix = await upload.$eval("#confirm-submit", (el) => el.textContent);
    if (fixSix !== "Fix 6 items") throw new Error("flagged button " + fixSix);
    await upload.click("#confirm-submit");
    await upload.waitForFunction(() => document.activeElement && document.activeElement.id === "roster-A", { timeout: 5000 });
    await upload.waitForFunction(() => {
      const field = document.getElementById("roster-A").closest(".field").getBoundingClientRect();
      const save = document.querySelector(".save-bar").getBoundingClientRect();
      const header = document.querySelector(".site-header").getBoundingClientRect();
      return field.top >= header.bottom - 4 && field.bottom <= save.top + 4;
    }, { timeout: 5000 });
    const rosterMissing = await upload.evaluate(() => {
      function note(id) {
        const field = document.getElementById(id).closest(".field");
        return field.classList.contains("is-missing") ? field.querySelector(".missing-note").textContent : "";
      }
      return {
        count: document.getElementById("missing-count").textContent,
        a: note("roster-A"),
        f: note("roster-F"),
        b: note("roster-B"),
        g: note("roster-G"),
        score: note("g1-s2-score"),
        total: note("g1-team"),
        beer: note("beer-result"),
        labels: Array.from(document.querySelectorAll("#missing-list button")).map((button) => button.textContent)
      };
    });
    if (rosterMissing.a !== "Fix player A ID (two marks).") throw new Error("roster A " + rosterMissing.a);
    if (rosterMissing.f !== "Fix player F ID (two marks).") throw new Error("roster F " + rosterMissing.f);
    if (rosterMissing.b !== "Enter player B ID. A game uses shooter B.") throw new Error("roster B " + rosterMissing.b);
    if (rosterMissing.g) throw new Error("unused roster G was required: " + rosterMissing.g);
    if (rosterMissing.score !== "Fix the score for Game 1, S2 (two marks).") throw new Error("score " + rosterMissing.score);
    if (rosterMissing.total !== "Fix the team total for Game 1 (two marks).") throw new Error("total " + rosterMissing.total);
    if (rosterMissing.beer !== "Fix the beer frame (two marks).") throw new Error("beer " + rosterMissing.beer);
    if (!rosterMissing.labels.some((text) => text.indexOf("Player A ID") === 0)) throw new Error("summary " + rosterMissing.labels.join(" | "));
    console.log("flagged roster ids and other two-mark fields block save: " + rosterMissing.count);

    const denied = await browser.newPage();
    await installCamera(denied, "denied", origin + "/test/fixtures/filled-v16.jpg");
    await denied.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    await denied.click("#scan-camera");
    await denied.waitForFunction(() => /camera is blocked/i.test(document.getElementById("ocr-error").textContent || ""));
    const fileStillThere = await denied.$eval("#sheet-file", (el) => el.type === "file" && !el.disabled);
    const panelHidden = await denied.$eval("#camera-panel", (el) => el.hidden);
    if (!fileStillThere || !panelHidden) throw new Error("permission fallback did not leave photo upload available");
    console.log("camera permission denied falls back to photo upload");
    await denied.close();

    const cancelPage = await browser.newPage();
    await installCamera(cancelPage, "live", origin + "/test/fixtures/filled-v16.jpg");
    await cancelPage.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
    await cancelPage.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    await cancelPage.click("#scan-camera");
    await cancelPage.waitForFunction(() => {
      const video = document.getElementById("camera-video");
      return video && video.videoWidth > 0 && !document.getElementById("camera-panel").hidden;
    });
    await cancelPage.click("#camera-cancel");
    await cancelPage.waitForFunction(() => document.getElementById("camera-panel").hidden);
    const stopped = await cancelPage.evaluate(() => (window.__camTracks || []).every((track) => track.readyState === "ended"));
    if (!stopped) throw new Error("cancel left the camera running");
    const fileInput = await cancelPage.$("#sheet-file");
    await fileInput.uploadFile(join(root, "test/fixtures/filled-v16.jpg"));
    await cancelPage.waitForFunction(() => document.getElementById("roster-A") && document.getElementById("roster-A").value === "12");
    console.log("cancel stops the camera and photo upload still reads");
    await cancelPage.close();

    const scan = await browser.newPage();
    await installCamera(scan, "live", origin + "/test/fixtures/filled-v16.jpg");
    await scan.setViewport({ width: 900, height: 1400, deviceScaleFactor: 1 });
    await scan.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    await scan.click("#scan-camera");
    await scan.waitForFunction(() => {
      const section = document.getElementById("confirm-section");
      const box = document.getElementById("roster-A");
      return section && !section.hidden && box && box.value === "12" && document.getElementById("camera-panel").hidden;
    }, { timeout: 20000 });
    const tracksEnded = await scan.evaluate(() => (window.__camTracks || []).every((track) => track.readyState === "ended"));
    if (!tracksEnded) throw new Error("auto-capture left the camera running");
    const scannedSide = await scan.$eval("#sheet-side", (el) => el.value);
    const scannedTeam = await scan.$eval("#g3-team", (el) => el.value);
    if (scannedSide !== "home" || scannedTeam !== "149") {
      throw new Error("camera reading side " + scannedSide + " team " + scannedTeam);
    }
    console.log("camera auto-capture read the same v16 sheet");
    await scan.screenshot({ path: "/opt/cursor/artifacts/v16_camera_review.png" });
  } finally {
    await browser.close();
    server.close();
  }
  console.log("accuracy " + accuracy.join("; "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
