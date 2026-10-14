import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
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
    const child = spawn("python3", ["test/make_fixture.py"], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("fixture generator failed"))));
  });
}

function okScore(value) {
  return { value: value, status: "ok" };
}

function assertReading(actual, expected, label) {
  const problems = [];
  function check(path, got, want) {
    if (got !== want) problems.push(label + " " + path + ": got " + JSON.stringify(got) + ", want " + JSON.stringify(want));
  }
  if (actual.mode !== "fiducial") {
    problems.push(label + " mode " + actual.mode + " warnings " + JSON.stringify(actual.warnings));
    return problems;
  }
  ["home", "away"].forEach((side) => {
    expected[side].games.forEach((game, gameIndex) => {
      game.shooters.forEach((shooter, shooterIndex) => {
        const got = actual.teams[side].games[gameIndex].shooters[shooterIndex];
        check(side + " g" + (gameIndex + 1) + " s" + (shooterIndex + 1) + " value", got.value, shooter.value);
        check(side + " g" + (gameIndex + 1) + " s" + (shooterIndex + 1) + " status", got.status, shooter.status);
      });
      const team = actual.teams[side].games[gameIndex].team;
      check(side + " g" + (gameIndex + 1) + " team", team.value, game.team.value);
      check(side + " g" + (gameIndex + 1) + " team status", team.status, game.team.status);
      check(side + " g" + (gameIndex + 1) + " mismatch", actual.teams[side].games[gameIndex].sumMismatch, game.sumMismatch);
    });
  });
  Object.keys(expected.winners).forEach((key) => {
    check("winner " + key + " value", actual.winners[key].value, expected.winners[key].value);
    check("winner " + key + " status", actual.winners[key].status, expected.winners[key].status);
  });
  check("home games", actual.homeGamesWon, expected.homeGamesWon);
  check("away games", actual.awayGamesWon, expected.awayGamesWon);
  const beerWarning = (actual.warnings || []).some((item) => /beer frame/i.test(item));
  if (beerWarning) problems.push(label + " warned about a blank beer frame");
  return problems;
}

async function main() {
  if (!chrome) throw new Error("Chrome was not found.");
  await runPython();
  const expected = JSON.parse(readFileSync(join(root, "test/fixtures/expected.json"), "utf8"));
  const server = await serve(root);
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--allow-file-access-from-files"]
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    await page.goto("http://127.0.0.1:" + port + "/test/harness.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const text = document.getElementById("result").textContent;
      return text && text !== "reading";
    });
    const payload = JSON.parse(await page.$eval("#result", (el) => el.textContent));
    if (payload.error) throw new Error(payload.error);
    const problems = []
      .concat(assertReading(payload.upright, expected, "upright"))
      .concat(assertReading(payload.turned, expected, "turned-180"));
    if (!payload.upright.notch) problems.push("upright: notch was not found");
    if (!payload.turned.upsideDown) problems.push("turned-180: reader did not see the sheet as upside down");
    if (!payload.turned.notch) problems.push("turned-180: notch was not found");
    if (problems.length) {
      console.error(problems.join("\n"));
      console.error("calibration", JSON.stringify(payload.upright.calibration));
      console.error("trace", JSON.stringify(payload.upright.trace));
      console.error("warnings", (payload.upright.warnings || []).slice(0, 12).join(" | "));
      throw new Error(problems.length + " reader checks failed");
    }
    console.log("reader recovered the distorted sheet and the 180° photo");

    const upload = await browser.newPage();
    await upload.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 1 });
    await upload.goto("http://127.0.0.1:" + port + "/upload.html", { waitUntil: "networkidle0" });
    const input = await upload.$("#sheet-file");
    await input.uploadFile(join(root, "test/fixtures/filled-v7.jpg"));
    await upload.waitForFunction(() => {
      const section = document.getElementById("confirm-section");
      const box = document.getElementById("home-g1-s1");
      return section && !section.hidden && box && box.value === "27";
    });
    const form = await upload.evaluate(() => {
      function val(id) { return document.getElementById(id).value; }
      return {
        homeG1: [val("home-g1-s1"), val("home-g1-s2"), val("home-g1-s3"), val("home-g1-s4"), val("home-g1-team")],
        homeG2S4: val("home-g2-s4"),
        homeG2S4Blank: document.getElementById("home-g2-s4").classList.contains("is-blank"),
        awayG1Team: val("away-g1-team"),
        awayG2S2: val("away-g2-s2"),
        awayG2Ambiguous: document.getElementById("away-g2-s2").classList.contains("is-ambiguous"),
        homeG3Check: document.getElementById("home-g3-check").textContent,
        homeG3Bad: document.getElementById("home-g3-check").classList.contains("is-bad"),
        winners: [val("win-g1"), val("win-g2"), val("win-g3"), val("win-beer"), val("win-points")],
        score: [val("home-won"), val("away-won")],
        beerFlag: document.getElementById("win-beer-flag").textContent,
        summary: document.getElementById("ocr-summary").textContent
      };
    });
    const formProblems = [];
    if (form.homeG1.join(",") !== "27,15,8,40,90") formProblems.push("home game 1 form " + form.homeG1.join(","));
    if (form.homeG2S4 !== "" || !form.homeG2S4Blank) formProblems.push("blank shooter was not left empty");
    if (form.awayG1Team !== "116") formProblems.push("100+ team total " + form.awayG1Team);
    if (form.awayG2S2 !== "" || !form.awayG2Ambiguous) formProblems.push("ambiguous shooter was not flagged");
    if (!form.homeG3Bad || !/96/.test(form.homeG3Check) || !/90/.test(form.homeG3Check)) {
      formProblems.push("missing sum warning: " + form.homeG3Check);
    }
    if (form.winners.join(",") !== "away,home,home,,away") formProblems.push("winners " + form.winners.join(","));
    if (form.score.join("-") !== "2-1") formProblems.push("games won " + form.score.join("-"));
    if (form.beerFlag) formProblems.push("beer frame flag: " + form.beerFlag);
    if (formProblems.length) {
      console.error(form);
      throw new Error(formProblems.join("\n"));
    }
    console.log("upload review form shows the reading");
    await upload.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
    });
    const section = await upload.$("#confirm-section");
    await section.screenshot({ path: "/opt/cursor/artifacts/upload_review_checked.png" });
    await upload.evaluate(() => {
      document.getElementById("align-figure").scrollIntoView({ block: "start" });
    });
    await upload.screenshot({ path: "/opt/cursor/artifacts/upload_sheet_and_review.png" });
    console.log("wrote screenshots");

    const phonePage = await browser.newPage();
    phonePage.setDefaultTimeout(120000);
    await phonePage.goto("http://127.0.0.1:" + port + "/test/harness.html?photo=1", { waitUntil: "domcontentloaded" });
    await phonePage.waitForFunction(() => {
      const text = document.getElementById("result").textContent;
      return text && text !== "reading";
    });
    const phonePayload = JSON.parse(await phonePage.$eval("#result", (el) => el.textContent));
    if (phonePayload.error) throw new Error(phonePayload.error);
    const phoneExpected = {
      home: {
        games: [
          { shooters: [19, 22, 24, 31].map(okScore), team: { value: 96, status: "ok" }, sumMismatch: false },
          { shooters: [20, 23, 25, 32].map(okScore), team: { value: 100, status: "ok" }, sumMismatch: false },
          { shooters: [21, 24, 26, 33].map(okScore), team: { value: 104, status: "ok" }, sumMismatch: false }
        ]
      },
      away: {
        games: [
          { shooters: [11, 22, 14, 25].map(okScore), team: { value: 72, status: "ok" }, sumMismatch: false },
          { shooters: [12, 23, 15, 26].map(okScore), team: { value: 76, status: "ok" }, sumMismatch: false },
          { shooters: [13, 24, 16, 27].map(okScore), team: { value: 80, status: "ok" }, sumMismatch: false }
        ]
      },
      winners: {
        game1: { value: "home", status: "ok" },
        game2: { value: "home", status: "ok" },
        game3: { value: "home", status: "ok" },
        beer: { value: "", status: "blank" },
        points: { value: "home", status: "ok" }
      },
      homeGamesWon: 3,
      awayGamesWon: 0
    };
    const phoneProblems = [];
    const expectRotation = [90, 180, 270, 0];
    (phonePayload.phone || []).forEach((reading, index) => {
      phoneProblems.push.apply(phoneProblems, assertReading(reading, phoneExpected, "phone rot " + index));
      if (reading.rotation !== expectRotation[index]) {
        phoneProblems.push("phone rot " + index + " reported " + reading.rotation + ", want " + expectRotation[index]);
      }
      if (!reading.notch) phoneProblems.push("phone rot " + index + " missed the notch");
      if (index === 1 && !reading.upsideDown) phoneProblems.push("phone 180 was not marked upside down");
    });
    if (!phonePayload.phone || phonePayload.phone.length !== 4) phoneProblems.push("phone readings " + (phonePayload.phone && phonePayload.phone.length));
    if (phoneProblems.length) {
      console.error(phoneProblems.join("\n"));
      throw new Error(phoneProblems.length + " phone-photo checks failed");
    }
    console.log("phone photo recovered at 0/90/180/270");

    const live = await browser.newPage();
    await live.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 1 });
    await live.goto("http://127.0.0.1:" + port + "/upload.html", { waitUntil: "networkidle0" });
    await (await live.$("#sheet-file")).uploadFile(join(root, "test/fixtures/phone-sheet.jpg"));
    await live.waitForFunction(() => {
      const box = document.getElementById("home-g1-s1");
      const err = document.getElementById("ocr-error");
      return box && box.value === "19" && err && err.hidden;
    });
    const phoneForm = await live.evaluate(() => ({
      home: [1, 2, 3, 4].map((n) => document.getElementById("home-g1-s" + n).value).concat([document.getElementById("home-g1-team").value]),
      awayTeam: document.getElementById("away-g3-team").value,
      winners: ["win-g1", "win-g2", "win-g3", "win-beer", "win-points"].map((id) => document.getElementById(id).value),
      summary: document.getElementById("ocr-summary").textContent
    }));
    if (phoneForm.home.join(",") !== "19,22,24,31,96") throw new Error("phone form home g1 " + phoneForm.home.join(","));
    if (phoneForm.awayTeam !== "80") throw new Error("phone form away g3 team " + phoneForm.awayTeam);
    if (phoneForm.winners.join(",") !== "home,home,home,,home") throw new Error("phone form winners " + phoneForm.winners.join(","));
    if (!/sideways/i.test(phoneForm.summary)) throw new Error("phone summary did not mention sideways: " + phoneForm.summary);
    await live.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      document.getElementById("confirm-section").scrollIntoView({ block: "start" });
    });
    const phoneSection = await live.$("#confirm-section");
    await phoneSection.screenshot({ path: "/opt/cursor/artifacts/upload_phone_review.png" });
    console.log("upload page read the phone photo");

    const { spawnSync } = await import("node:child_process");
    const blank = spawnSync("python3", ["-c", "from PIL import Image; Image.new('RGB',(900,700),(206,196,176)).save('/tmp/blank-sheet.jpg','JPEG',quality=80)"]);
    if (blank.status !== 0) throw new Error("could not write a blank photo");
    const missed = await browser.newPage();
    await missed.goto("http://127.0.0.1:" + port + "/upload.html", { waitUntil: "networkidle0" });
    await (await missed.$("#sheet-file")).uploadFile("/tmp/blank-sheet.jpg");
    await missed.waitForFunction(() => {
      const err = document.getElementById("ocr-error");
      return err && !err.hidden && /corner/i.test(err.textContent);
    });
    console.log("missing corners show an error");
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
