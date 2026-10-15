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
  ".css": "text/css",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf"
};

function serve(base) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/favicon.ico") {
      res.writeHead(404);
      res.end();
      return;
    }
    const file = join(base, decodeURIComponent(url.pathname));
    if (!file.startsWith(base) || !existsSync(file)) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function runPython() {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["test/make_phone_v16.py"], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("phone fixture failed"))));
  });
}

function installCamera(page, imageUrl) {
  return page.evaluateOnNewDocument((src) => {
    window.__camTracks = [];
    navigator.mediaDevices.getUserMedia = function () {
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
  }, imageUrl);
}

async function readPhone(page, origin) {
  await page.goto(origin + "/test/harness.html", { waitUntil: "domcontentloaded" });
  return page.evaluate(async () => {
    function load(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(src));
        img.src = src;
      });
    }
    function canvasOf(img, maxLong) {
      const scale = Math.min(1, maxLong / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    }
    const spec = await fetch("../scoresheet/scansheet_v16_layout_spec.json", { cache: "no-store" }).then((response) => response.json());
    const broken = Object.assign({}, spec, { roster_fields: null });
    const out = {
      problem: RAD_OCR.specProblem(spec),
      broken: RAD_OCR.specProblem(broken)
    };
    for (const name of ["phone-land.jpg", "phone-port.jpg"]) {
      const img = await load("fixtures/" + name);
      const live = canvasOf(img, 1100);
      const full = canvasOf(img, 1700);
      const prev = RAD_OCR.previewCorners(live, spec);
      const read = await RAD_OCR.readSheet(full, spec);
      out[name] = {
        found: prev.found,
        count: prev.count,
        notch: !!prev.notch,
        readMode: read.mode,
        readNotch: !!read.notch
      };
    }
    return out;
  });
}

async function main() {
  if (!chrome) throw new Error("Chrome was not found.");
  await runPython();
  const server = await serve(root);
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--autoplay-policy=no-user-gesture-required"]
  });
  try {
    const harness = await browser.newPage();
    harness.setDefaultTimeout(120000);
    const detected = await readPhone(harness, origin);
    if (detected.problem) throw new Error("live spec rejected: " + detected.problem);
    if (!/roster_fields/.test(detected.broken)) throw new Error("missing-field message: " + detected.broken);
    ["phone-land.jpg", "phone-port.jpg"].forEach((name) => {
      const row = detected[name];
      if (!row.found || row.readMode !== "fiducial") {
        throw new Error(name + " " + JSON.stringify(row));
      }
    });
    console.log("live spec passes; phone frames found corners", JSON.stringify({
      land: detected["phone-land.jpg"],
      port: detected["phone-port.jpg"]
    }));
    await harness.close();

    const land = await browser.newPage();
    await installCamera(land, origin + "/test/fixtures/phone-land.jpg");
    await land.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await land.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    const scriptSrc = await land.$$eval("script[src]", (els) => els.map((el) => el.getAttribute("src")));
    if (!scriptSrc.some((src) => src && src.indexOf("sheet-ocr.js?v=") >= 0)) {
      throw new Error("sheet script is not cache-busted: " + scriptSrc.join(", "));
    }
    await land.click("#scan-camera");
    await land.waitForFunction(() => {
      const video = document.getElementById("camera-video");
      return video && video.videoWidth === 1920 && video.videoHeight === 1080;
    });
    const fit = await land.evaluate(() => {
      const video = document.getElementById("camera-video");
      const style = getComputedStyle(video);
      const box = video.getBoundingClientRect();
      return {
        objectFit: style.objectFit,
        maxHeight: style.maxHeight,
        height: box.height,
        limit: window.innerHeight * 0.7 + 2,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      };
    });
    if (fit.objectFit !== "contain") throw new Error("object-fit " + fit.objectFit);
    if (fit.height > fit.limit) throw new Error("preview taller than 70vh " + JSON.stringify(fit));
    if (fit.scrollWidth > fit.innerWidth + 1) throw new Error("page wider than the phone " + JSON.stringify(fit));
    console.log("landscape preview fits a phone viewport", JSON.stringify(fit));
    await land.click("#camera-snap");
    await land.waitForFunction(() => {
      const summary = document.getElementById("ocr-summary").textContent || "";
      const error = document.getElementById("ocr-error").textContent || "";
      return /v16/.test(summary) && !/layout/i.test(error);
    });
    const snapped = await land.evaluate(() => ({
      summary: document.getElementById("ocr-summary").textContent,
      error: document.getElementById("ocr-error").textContent,
      hidden: document.getElementById("camera-panel").hidden,
      tracks: (window.__camTracks || []).every((track) => track.readyState === "ended")
    }));
    if (!snapped.hidden || !snapped.tracks) throw new Error("snap did not finish " + JSON.stringify(snapped));
    console.log("landscape Snap read the sheet:", snapped.summary);
    await land.close();

    const port = await browser.newPage();
    await installCamera(port, origin + "/test/fixtures/phone-port.jpg");
    await port.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await port.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    await port.click("#scan-camera");
    await port.waitForFunction(() => /v16/.test(document.getElementById("ocr-summary").textContent || ""), { timeout: 20000 });
    const auto = await port.evaluate(() => ({
      summary: document.getElementById("ocr-summary").textContent,
      panel: document.getElementById("camera-panel").hidden,
      tracks: (window.__camTracks || []).every((track) => track.readyState === "ended")
    }));
    if (!auto.panel || !auto.tracks) throw new Error("portrait auto-capture did not finish " + JSON.stringify(auto));
    console.log("portrait auto-capture read the sheet:", auto.summary);
    await port.close();

    const guide = await browser.newPage();
    await guide.evaluateOnNewDocument(() => {
      navigator.mediaDevices.getUserMedia = function () {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#8a7968";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const stream = canvas.captureStream(8);
        const paint = () => {
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          requestAnimationFrame(paint);
        };
        paint();
        return Promise.resolve(stream);
      };
    });
    await guide.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await guide.goto(origin + "/upload.html", { waitUntil: "networkidle0" });
    await guide.click("#scan-camera");
    await guide.waitForFunction(() => {
      const canvas = document.getElementById("camera-guide");
      if (!canvas || !canvas.width) return false;
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] > 200 && data[i + 1] > 180 && data[i + 2] < 120) n += 1;
      }
      return n > 5 && /Fit all 4 corners/.test(document.getElementById("camera-status").textContent || "");
    });
    const shape = await guide.evaluate(() => {
      const canvas = document.getElementById("camera-guide");
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = 0;
      let maxY = 0;
      let n = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          if (data[i] > 200 && data[i + 1] > 180 && data[i + 2] < 120) {
            n += 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      const w = maxX - minX;
      const h = maxY - minY;
      return { n: n, w: w, h: h, aspect: w / h };
    });
    if (shape.n < 20 || !(shape.aspect > 0.7 && shape.aspect < 0.9) || !(shape.h > shape.w)) {
      throw new Error("guide is not a portrait sheet " + JSON.stringify(shape));
    }
    console.log("guide is a portrait sheet outline", JSON.stringify(shape));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
