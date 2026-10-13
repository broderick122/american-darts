/* Experimental reader for the v2 Roslyn score sheet.
   Finds the four corner marks, straightens the photo, then crops fields
   from scoresheet/layout_spec.json. Bubbles are counted as ink.
   Digits and names go through Tesseract.js. Blank boxes are not read as 0. */
(function (root) {
  "use strict";

  var SPAN_X = 742;
  var SPAN_Y = 562;
  var SCALE = 2.4;
  var PAD = 40;
  var GAME_INNINGS = {
    game1: ["01", "02", "03", "04", "05", "06"],
    game2: ["07", "08", "09", "10", "11", "12"],
    game3: ["13", "14", "15", "16", "17", "18"]
  };
  var EXTRA_INNINGS = ["19", "20"];

  function say(onProgress, message) {
    if (typeof onProgress === "function") onProgress(message);
  }

  function nextFrame() {
    return new Promise(function (resolve) {
      if (root.requestAnimationFrame) root.requestAnimationFrame(function () { resolve(); });
      else root.setTimeout(resolve, 0);
    });
  }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function solveLinear(matrix, vector) {
    var n = vector.length;
    var m = matrix.map(function (row, index) { return row.concat([vector[index]]); });
    var col, row, pivot, best, factor, c;
    for (col = 0; col < n; col += 1) {
      pivot = col;
      best = Math.abs(m[col][col]);
      for (row = col + 1; row < n; row += 1) {
        if (Math.abs(m[row][col]) > best) {
          best = Math.abs(m[row][col]);
          pivot = row;
        }
      }
      if (best < 1e-9) return null;
      if (pivot !== col) {
        var swap = m[col];
        m[col] = m[pivot];
        m[pivot] = swap;
      }
      factor = m[col][col];
      for (c = col; c <= n; c += 1) m[col][c] /= factor;
      for (row = 0; row < n; row += 1) {
        if (row === col) continue;
        factor = m[row][col];
        if (!factor) continue;
        for (c = col; c <= n; c += 1) m[row][c] -= factor * m[col][c];
      }
    }
    return m.map(function (line) { return line[n]; });
  }

  function homography(destPts, srcPts) {
    var rows = [];
    var vals = [];
    destPts.forEach(function (dest, index) {
      var src = srcPts[index];
      var x = dest.x;
      var y = dest.y;
      rows.push([x, y, 1, 0, 0, 0, -src.x * x, -src.x * y]);
      vals.push(src.x);
      rows.push([0, 0, 0, x, y, 1, -src.y * x, -src.y * y]);
      vals.push(src.y);
    });
    return solveLinear(rows, vals);
  }

  function luminance(data, index) {
    return data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }

  function regionLuminance(data, width, height, x, y, radius) {
    var x0 = Math.max(0, Math.floor(x - radius));
    var y0 = Math.max(0, Math.floor(y - radius));
    var x1 = Math.min(width - 1, Math.ceil(x + radius));
    var y1 = Math.min(height - 1, Math.ceil(y + radius));
    var sum = 0;
    var count = 0;
    var yy, xx, i;
    for (yy = y0; yy <= y1; yy += 1) {
      for (xx = x0; xx <= x1; xx += 1) {
        i = (yy * width + xx) * 4;
        sum += luminance(data, i);
        count += 1;
      }
    }
    return count ? sum / count : 255;
  }

  function findComponents(mask, width, height) {
    var seen = new Uint8Array(width * height);
    var comps = [];
    var stack = [];
    var minSide = Math.min(width, height);
    var minArea = Math.pow(minSide * 0.012, 2);
    var maxArea = Math.pow(minSide * 0.09, 2);
    var i, p, x, y, count, minX, minY, maxX, maxY, bw, bh, area, fill, aspect;
    for (i = 0; i < mask.length; i += 1) {
      if (!mask[i] || seen[i]) continue;
      stack.push(i);
      seen[i] = 1;
      count = 0;
      minX = width;
      minY = height;
      maxX = 0;
      maxY = 0;
      while (stack.length) {
        p = stack.pop();
        x = p % width;
        y = (p / width) | 0;
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
        if (x + 1 < width && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
        if (y > 0 && mask[p - width] && !seen[p - width]) { seen[p - width] = 1; stack.push(p - width); }
        if (y + 1 < height && mask[p + width] && !seen[p + width]) { seen[p + width] = 1; stack.push(p + width); }
      }
      bw = maxX - minX + 1;
      bh = maxY - minY + 1;
      area = bw * bh;
      if (count < minArea || count > maxArea || area < 1) continue;
      fill = count / area;
      aspect = bw / bh;
      if (fill < 0.58 || aspect < 0.72 || aspect > 1.4) continue;
      comps.push({
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        count: count,
        area: area,
        fill: fill
      });
    }
    return comps;
  }

  function orderByAngle(pts) {
    var cx = 0;
    var cy = 0;
    pts.forEach(function (pt) { cx += pt.x; cy += pt.y; });
    cx /= pts.length;
    cy /= pts.length;
    var sorted = pts.slice().sort(function (a, b) {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
    return { TL: sorted[0], TR: sorted[1], BR: sorted[2], BL: sorted[3] };
  }

  function labelFromTL(tl, others) {
    var far = others[0];
    var i;
    for (i = 1; i < others.length; i += 1) {
      if (dist(others[i], tl) > dist(far, tl)) far = others[i];
    }
    var rest = others.filter(function (pt) { return pt !== far; });
    var a = rest[0];
    var b = rest[1];
    var cross = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x);
    if (cross > 0) return { TL: tl, TR: a, BL: b, BR: far };
    return { TL: tl, TR: b, BL: a, BR: far };
  }

  function scoreCorners(ordered) {
    var top = dist(ordered.TL, ordered.TR);
    var bottom = dist(ordered.BL, ordered.BR);
    var left = dist(ordered.TL, ordered.BL);
    var right = dist(ordered.TR, ordered.BR);
    if (top < 30 || left < 30) return -1;
    var sideMismatch = Math.abs(top - bottom) / Math.max(top, bottom) + Math.abs(left - right) / Math.max(left, right);
    if (sideMismatch > 0.4) return -1;
    var aspect = ((top + bottom) / 2) / ((left + right) / 2);
    var aspectErr = Math.abs(aspect - SPAN_X / SPAN_Y);
    if (aspectErr > 0.5) return -1;
    function perp(a, b, c) {
      var v1x = a.x - b.x;
      var v1y = a.y - b.y;
      var v2x = c.x - b.x;
      var v2y = c.y - b.y;
      var denom = Math.sqrt((v1x * v1x + v1y * v1y) * (v2x * v2x + v2y * v2y));
      return denom ? (v1x * v2x + v1y * v2y) / denom : 1;
    }
    if (Math.abs(perp(ordered.TR, ordered.TL, ordered.BL)) > 0.5) return -1;
    return (top * left) / (1 + sideMismatch * 2 + aspectErr * 2);
  }

  function eachCombo(list, fn) {
    var n = list.length;
    var idx = [0, 1, 2, 3];
    var t, j;
    if (n < 4) return;
    fn(idx.map(function (at) { return list[at]; }));
    while (true) {
      t = 3;
      while (t >= 0 && idx[t] === n - 4 + t) t -= 1;
      if (t < 0) break;
      idx[t] += 1;
      for (j = t + 1; j < 4; j += 1) idx[j] = idx[j - 1] + 1;
      fn(idx.map(function (at) { return list[at]; }));
    }
  }

  function locateMarks(canvas) {
    var maxDim = 900;
    var scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    var sw = Math.max(1, Math.round(canvas.width * scale));
    var sh = Math.max(1, Math.round(canvas.height * scale));
    var small = root.document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    var sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(canvas, 0, 0, sw, sh);
    var smallData = sctx.getImageData(0, 0, sw, sh).data;
    var mask = new Uint8Array(sw * sh);
    var i;
    for (i = 0; i < sw * sh; i += 1) mask[i] = luminance(smallData, i * 4) < 80 ? 1 : 0;
    var full = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    var backX = canvas.width / sw;
    var backY = canvas.height / sh;
    var comps = findComponents(mask, sw, sh).map(function (comp) {
      var cx = ((comp.minX + comp.maxX) / 2) * backX;
      var cy = ((comp.minY + comp.maxY) / 2) * backY;
      var side = Math.max((comp.maxX - comp.minX) * backX, (comp.maxY - comp.minY) * backY);
      var inner = regionLuminance(full.data, full.width, full.height, cx, cy, Math.max(2, side * 0.13));
      return { x: cx, y: cy, area: comp.area, fill: comp.fill, notch: inner > 155, side: side };
    });
    comps.sort(function (a, b) { return b.area - a.area; });
    if (comps.length > 12) comps = comps.slice(0, 12);

    var best = null;
    eachCombo(comps, function (group) {
      var notched = group.filter(function (pt) { return pt.notch; });
      var ordered = notched.length === 1
        ? labelFromTL(notched[0], group.filter(function (pt) { return pt !== notched[0]; }))
        : orderByAngle(group);
      var score = scoreCorners(ordered);
      if (score < 0) return;
      if (notched.length === 1) score *= 1.2;
      if (!best || score > best.score) best = { ordered: ordered, score: score, notch: notched.length === 1 };
    });

    var page = {
      mode: "page",
      notch: false,
      warning: "The four black corner marks were not found, so the boxes are only roughly placed. Check every value.",
      src: {
        TL: { x: 0, y: 0 },
        TR: { x: canvas.width - 1, y: 0 },
        BL: { x: 0, y: canvas.height - 1 },
        BR: { x: canvas.width - 1, y: canvas.height - 1 }
      },
      dest: {
        TL: { x: 0, y: 0 },
        TR: { x: 792 * SCALE, y: 0 },
        BL: { x: 0, y: 612 * SCALE },
        BR: { x: 792 * SCALE, y: 612 * SCALE }
      },
      outW: 792 * SCALE,
      outH: 612 * SCALE
    };

    if (!best) return page;
    var span = dist(best.ordered.TL, best.ordered.TR);
    if (span < canvas.width * 0.28) return page;
    var destTL = { x: PAD, y: PAD };
    var destTR = { x: PAD + SPAN_X * SCALE, y: PAD };
    var destBL = { x: PAD, y: PAD + SPAN_Y * SCALE };
    var destBR = { x: PAD + SPAN_X * SCALE, y: PAD + SPAN_Y * SCALE };
    return {
      mode: "fiducial",
      notch: best.notch,
      warning: best.notch ? "" : "The white notch in the top-left mark was hard to see. This assumes the photo is roughly upright.",
      src: best.ordered,
      dest: { TL: destTL, TR: destTR, BL: destBL, BR: destBR },
      outW: PAD * 2 + SPAN_X * SCALE,
      outH: PAD * 2 + SPAN_Y * SCALE
    };
  }

  function warp(source, located) {
    var srcPts = [located.src.TL, located.src.TR, located.src.BL, located.src.BR];
    var destPts = [located.dest.TL, located.dest.TR, located.dest.BL, located.dest.BR];
    var H = homography(destPts, srcPts);
    var dw = Math.max(1, Math.round(located.outW));
    var dh = Math.max(1, Math.round(located.outH));
    var dest = root.document.createElement("canvas");
    dest.width = dw;
    dest.height = dh;
    var dctx = dest.getContext("2d");
    if (!H) {
      dctx.fillStyle = "#fff";
      dctx.fillRect(0, 0, dw, dh);
      dctx.drawImage(source, 0, 0, dw, dh);
      located.warning = "The photo could not be straightened. Check every value.";
      return Promise.resolve(dest);
    }
    var sw = source.width;
    var sh = source.height;
    var srcData = source.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
    var out = dctx.createImageData(dw, dh);
    var pixels = out.data;
    return new Promise(function (resolve) {
      var y = 0;
      function chunk() {
        var end = Math.min(dh, y + 48);
        var x, den, sx, sy, x0, y0, dx, dy, pi, i00, i10, i01, i11, c, top, bot;
        for (; y < end; y += 1) {
          for (x = 0; x < dw; x += 1) {
            den = H[6] * x + H[7] * y + 1;
            sx = (H[0] * x + H[1] * y + H[2]) / den;
            sy = (H[3] * x + H[4] * y + H[5]) / den;
            pi = (y * dw + x) * 4;
            if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
              pixels[pi] = pixels[pi + 1] = pixels[pi + 2] = 255;
              pixels[pi + 3] = 255;
              continue;
            }
            x0 = sx | 0;
            y0 = sy | 0;
            dx = sx - x0;
            dy = sy - y0;
            i00 = (y0 * sw + x0) * 4;
            i10 = i00 + 4;
            i01 = i00 + sw * 4;
            i11 = i01 + 4;
            for (c = 0; c < 3; c += 1) {
              top = srcData[i00 + c] * (1 - dx) + srcData[i10 + c] * dx;
              bot = srcData[i01 + c] * (1 - dx) + srcData[i11 + c] * dx;
              pixels[pi + c] = top * (1 - dy) + bot * dy;
            }
            pixels[pi + 3] = 255;
          }
        }
        if (y < dh) root.setTimeout(chunk, 0);
        else {
          dctx.putImageData(out, 0, 0);
          resolve(dest);
        }
      }
      chunk();
    });
  }

  function fieldRect(field, mode) {
    if (mode === "fiducial") {
      var n = field.bbox_norm;
      return {
        x: PAD + n[0] * SPAN_X * SCALE,
        y: PAD + n[1] * SPAN_Y * SCALE,
        w: n[2] * SPAN_X * SCALE,
        h: n[3] * SPAN_Y * SCALE
      };
    }
    var box = field.bbox_pt;
    return { x: box[0] * SCALE, y: box[1] * SCALE, w: box[2] * SCALE, h: box[3] * SCALE };
  }

  function expandText(rect) {
    var up = rect.h * 0.35;
    return {
      x: rect.x + rect.w * 0.02,
      y: rect.y - up,
      w: rect.w * 0.96,
      h: rect.h + up - rect.h * 0.12
    };
  }

  function inkRatio(data, width, height, rect, inset, threshold) {
    var x0 = Math.max(0, Math.floor(rect.x + rect.w * inset));
    var y0 = Math.max(0, Math.floor(rect.y + rect.h * inset));
    var x1 = Math.min(width, Math.ceil(rect.x + rect.w * (1 - inset)));
    var y1 = Math.min(height, Math.ceil(rect.y + rect.h * (1 - inset)));
    var dark = 0;
    var total = 0;
    var y, x, i;
    for (y = y0; y < y1; y += 1) {
      for (x = x0; x < x1; x += 1) {
        i = (y * width + x) * 4;
        total += 1;
        if (luminance(data, i) < threshold) dark += 1;
      }
    }
    return { ratio: total ? dark / total : 0, dark: dark };
  }

  function bubbleRatio(data, width, height, rect) {
    var cx = rect.x + rect.w / 2;
    var cy = rect.y + rect.h / 2;
    var rad = Math.min(rect.w, rect.h) * 0.34;
    var r2 = rad * rad;
    var x0 = Math.max(0, Math.floor(cx - rad));
    var y0 = Math.max(0, Math.floor(cy - rad));
    var x1 = Math.min(width - 1, Math.ceil(cx + rad));
    var y1 = Math.min(height - 1, Math.ceil(cy + rad));
    var dark = 0;
    var total = 0;
    var y, x, dx, dy;
    for (y = y0; y <= y1; y += 1) {
      for (x = x0; x <= x1; x += 1) {
        dx = x - cx;
        dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        total += 1;
        if (luminance(data, (y * width + x) * 4) < 70) dark += 1;
      }
    }
    return total ? dark / total : 0;
  }

  function clipForOcr(source, rect, kind) {
    var r = {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      w: rect.w,
      h: rect.h
    };
    if (kind === "digit") {
      r.x += r.w * 0.12;
      r.y += r.h * 0.1;
      r.w *= 0.76;
      r.h *= 0.8;
    }
    r.w = Math.max(1, Math.min(source.width - r.x, r.w));
    r.h = Math.max(1, Math.min(source.height - r.y, r.h));
    var canvas = root.document.createElement("canvas");
    var target = kind === "digit" ? 128 : 72;
    canvas.width = kind === "digit" ? 160 : Math.min(720, Math.max(120, Math.round(target * (r.w / r.h)) + 28));
    canvas.height = kind === "digit" ? 160 : target + 28;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    var dw = canvas.width - 36;
    var dh = canvas.height - 36;
    ctx.drawImage(source, r.x, r.y, r.w, r.h, 18, 18, dw, dh);
    var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var pixels = image.data;
    var i, lum, v;
    for (i = 0; i < pixels.length; i += 4) {
      lum = luminance(pixels, i);
      v = lum < 135 ? 0 : 255;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  var workerPromise = null;
  var progressFn = function () {};

  function getWorker() {
    if (!root.Tesseract) return Promise.reject(new Error("Tesseract.js did not load. You can still type the score."));
    if (!workerPromise) {
      workerPromise = root.Tesseract.createWorker("eng", 1, {
        logger: function (message) {
          if (!message || !message.status) return;
          var pct = typeof message.progress === "number" ? " " + Math.round(message.progress * 100) + "%" : "";
          progressFn(message.status + pct);
        }
      }).catch(function (err) {
        workerPromise = null;
        throw err;
      });
    }
    return workerPromise;
  }

  function readJob(worker, job, psm) {
    return worker.setParameters({
      tessedit_char_whitelist: job.whitelist,
      tessedit_pageseg_mode: psm,
      user_defined_dpi: "300"
    }).then(function () {
      return worker.recognize(job.canvas);
    }).then(function (out) {
      var data = out && out.data ? out.data : {};
      return {
        text: String(data.text || "").replace(/\s+/g, " ").trim(),
        confidence: typeof data.confidence === "number" ? data.confidence : 0
      };
    });
  }

  function recognizeJobs(jobs, onProgress) {
    if (!jobs.length) return Promise.resolve({});
    progressFn = function (message) { say(onProgress, message); };
    return getWorker().then(function (worker) {
      var values = {};
      var index = 0;
      function step() {
        if (index >= jobs.length) return Promise.resolve(values);
        var job = jobs[index];
        index += 1;
        say(onProgress, "Reading " + job.label + " (" + index + " of " + jobs.length + ")…");
        return readJob(worker, job, job.psm).then(function (first) {
          var follow = Promise.resolve(first);
          if (job.kind === "digit" && !/[0-9]/.test(first.text)) {
            follow = readJob(worker, job, "8").then(function (second) {
              if (/[0-9]/.test(second.text)) return second;
              return readJob(worker, job, "7");
            });
          }
          return follow;
        }).then(function (read) {
          values[job.name] = read;
          return step();
        }).catch(function () {
          values[job.name] = { text: "", confidence: 0, failed: true };
          return step();
        });
      }
      return step();
    });
  }

  function sumInnings(side, innings, cells) {
    var sum = 0;
    var any = false;
    var low = 0;
    var p, n, cell;
    for (p = 1; p <= 4; p += 1) {
      for (n = 0; n < innings.length; n += 1) {
        cell = cells[side + "_p" + p + "_inn" + innings[n]];
        if (!cell || cell.value == null) continue;
        sum += cell.value;
        any = true;
        if (cell.confidence < 60) low += 1;
      }
    }
    return { sum: any ? sum : null, low: low };
  }

  function bubbleWinner(homeRatio, awayRatio) {
    var homeOn = homeRatio >= 0.4;
    var awayOn = awayRatio >= 0.4;
    if (homeOn && !awayOn) return "home";
    if (awayOn && !homeOn) return "away";
    if (homeOn && awayOn) {
      if (homeRatio > awayRatio * 1.45) return "home";
      if (awayRatio > homeRatio * 1.45) return "away";
    }
    return "";
  }

  function decideWinner(homeRatio, awayRatio, homeSum, awaySum) {
    var bubble = bubbleWinner(homeRatio, awayRatio);
    var byPoints = "";
    if (homeSum != null && awaySum != null && homeSum !== awaySum) {
      byPoints = homeSum > awaySum ? "home" : "away";
    }
    if (bubble && byPoints && bubble !== byPoints) {
      return {
        winner: byPoints,
        bubble: bubble,
        warning: "The filled bubble and the inning totals disagree. The totals were kept. Change the winner if the bubble is the one you trust."
      };
    }
    return { winner: bubble || byPoints || "", bubble: bubble, warning: "" };
  }

  function digitValue(raw) {
    var text = String(raw && raw.text || "");
    var match = text.match(/[0-9]/);
    if (!match) return { value: null, confidence: raw ? raw.confidence : 0 };
    return { value: Number(match[0]), confidence: raw.confidence || 0, text: text };
  }

  function cornersAreMarks(image) {
    var spots = [
      [PAD, PAD],
      [PAD + SPAN_X * SCALE, PAD],
      [PAD, PAD + SPAN_Y * SCALE],
      [PAD + SPAN_X * SCALE, PAD + SPAN_Y * SCALE]
    ];
    var step = 8 * SCALE;
    var good = 0;
    spots.forEach(function (spot) {
      var dark = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dir) {
        var x = Math.round(spot[0] + dir[0] * step);
        var y = Math.round(spot[1] + dir[1] * step);
        if (x < 1 || y < 1 || x >= image.width - 1 || y >= image.height - 1) return;
        if (luminance(image.data, (y * image.width + x) * 4) < 75) dark += 1;
      });
      if (dark >= 3) good += 1;
    });
    return good === 4;
  }

  function countWon(games) {
    var home = 0;
    var away = 0;
    games.forEach(function (game) {
      if (game.winner === "home") home += 1;
      else if (game.winner === "away") away += 1;
    });
    return { home: home, away: away };
  }

  function readSheet(sourceCanvas, spec, onProgress) {
    var warnings = [];
    say(onProgress, "Looking for the corner marks…");
    return nextFrame().then(function () {
      var located = locateMarks(sourceCanvas);
      if (located.warning) warnings.push(located.warning);
      say(onProgress, located.mode === "fiducial" ? "Straightening the photo…" : "Placing the boxes without the corner marks…");
      return warp(sourceCanvas, located).then(function (aligned) {
        if (located.warning && warnings.indexOf(located.warning) < 0) warnings.push(located.warning);
        var image = aligned.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, aligned.width, aligned.height);
        if (located.mode === "fiducial" && !cornersAreMarks(image)) {
          located.mode = "rejected";
          located.warning = "";
          return shapeResult(spec, [], {}, aligned, located, [
            "Those dark shapes are not the score sheet's corner marks. Type the score below, or retake the photo with all four black squares in the frame."
          ], 0, 0);
        }
        var fields = (spec && spec.fields) || [];
        var jobs = [];
        var blanks = 0;
        var inked = 0;
        fields.forEach(function (field) {
          var rect = fieldRect(field, located.mode);
          if (field.type === "bubble") {
            field._ratio = bubbleRatio(image.data, image.width, image.height, rect);
            return;
          }
          if (field.type === "digit") {
            var ink = inkRatio(image.data, image.width, image.height, rect, 0.14, 100);
            field._blank = ink.ratio < 0.04;
            if (field._blank) {
              blanks += 1;
              return;
            }
            inked += 1;
            jobs.push({
              name: field.name,
              label: field.name.replace(/_/g, " "),
              kind: "digit",
              psm: "10",
              whitelist: "0123456789",
              canvas: clipForOcr(aligned, rect, "digit")
            });
            return;
          }
          if (field.name === "date" || field.name === "home_team_name" || field.name === "away_team_name") {
            var textRect = expandText(rect);
            var textInk = inkRatio(image.data, image.width, image.height, textRect, 0.02, 110);
            if (textInk.ratio < 0.008) {
              field._blank = true;
              return;
            }
            jobs.push({
              name: field.name,
              label: field.name === "date" ? "the date" : field.name.replace(/_/g, " "),
              kind: "text",
              psm: "7",
              whitelist: field.name === "date" ? "0123456789/.- " : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-.",
              canvas: clipForOcr(aligned, textRect, "text")
            });
          }
        });
        say(onProgress, inked ? "Reading " + inked + " written boxes…" : "No handwriting found in the number boxes.");
        return recognizeJobs(jobs, onProgress).then(function (raw) {
          return shapeResult(spec, fields, raw, aligned, located, warnings, blanks, inked);
        }).catch(function (err) {
          warnings.push(err && err.message ? err.message : "Handwriting recognition failed. Type the score instead.");
          return shapeResult(spec, fields, {}, aligned, located, warnings, blanks, inked);
        });
      });
    });
  }

  function shapeResult(spec, fields, raw, aligned, located, warnings, blanks, inked) {
    var byName = {};
    fields.forEach(function (field) { byName[field.name] = field; });
    var cells = {};
    Object.keys(raw).forEach(function (name) {
      var field = byName[name];
      if (!field || field.type !== "digit") return;
      var parsed = digitValue(raw[name]);
      cells[name] = {
        value: parsed.value,
        confidence: Math.round(parsed.confidence || 0),
        text: raw[name].text || ""
      };
      if (parsed.value == null) warnings.push(name.replace(/_/g, " ") + " looked written but was not read as a digit.");
    });
    var games = [];
    ["game1", "game2", "game3"].forEach(function (key, index) {
      var home = sumInnings("home", GAME_INNINGS[key], cells);
      var away = sumInnings("away", GAME_INNINGS[key], cells);
      var decision = decideWinner(
        byName[key + "_winner_home"] ? byName[key + "_winner_home"]._ratio || 0 : 0,
        byName[key + "_winner_away"] ? byName[key + "_winner_away"]._ratio || 0 : 0,
        home.sum,
        away.sum
      );
      if (decision.warning) warnings.push("Game " + (index + 1) + ": " + decision.warning);
      if (home.low || away.low) warnings.push("Game " + (index + 1) + " has a low-confidence digit. Look at it closely.");
      var row = {
        label: "Game " + (index + 1),
        homePoints: home.sum,
        awayPoints: away.sum,
        winner: decision.winner,
        bubble: decision.bubble
      };
      games.push(row);
    });
    var won = countWon(games);
    var homeExtra = sumInnings("home", EXTRA_INNINGS, cells);
    var awayExtra = sumInnings("away", EXTRA_INNINGS, cells);
    function addParts(parts) {
      var any = false;
      var sum = 0;
      parts.forEach(function (part) {
        if (part == null) return;
        any = true;
        sum += part;
      });
      return any ? sum : null;
    }
    var beer = decideWinner(
      byName.beer_frame_winner_home ? byName.beer_frame_winner_home._ratio || 0 : 0,
      byName.beer_frame_winner_away ? byName.beer_frame_winner_away._ratio || 0 : 0,
      null,
      null
    );
    var pointsBubble = decideWinner(
      byName.total_points_winner_home ? byName.total_points_winner_home._ratio || 0 : 0,
      byName.total_points_winner_away ? byName.total_points_winner_away._ratio || 0 : 0,
      null,
      null
    );
    var missed = [];
    var kept = [];
    warnings.forEach(function (item) {
      if (/not read as a digit/.test(item)) missed.push(item);
      else if (item) kept.push(item);
    });
    if (missed.length > 2) kept.push(missed.length + " boxes looked written but were not read as digits. Check the game totals.");
    else kept = kept.concat(missed);
    warnings = kept;
    var preview = root.document.createElement("canvas");
    var previewW = Math.min(960, aligned.width);
    var previewScale = previewW / aligned.width;
    preview.width = previewW;
    preview.height = Math.max(1, Math.round(aligned.height * previewScale));
    var pctx = preview.getContext("2d");
    pctx.drawImage(aligned, 0, 0, preview.width, preview.height);
    return {
      version: spec && spec.version || "",
      mode: located.mode,
      notch: !!located.notch,
      warnings: warnings.filter(function (item, index) { return item && warnings.indexOf(item) === index; }),
      previewUrl: preview.toDataURL("image/jpeg", 0.72),
      dateText: raw.date ? raw.date.text : "",
      homeName: raw.home_team_name ? raw.home_team_name.text : "",
      awayName: raw.away_team_name ? raw.away_team_name.text : "",
      nameConfidence: {
        date: raw.date ? Math.round(raw.date.confidence || 0) : 0,
        home: raw.home_team_name ? Math.round(raw.home_team_name.confidence || 0) : 0,
        away: raw.away_team_name ? Math.round(raw.away_team_name.confidence || 0) : 0
      },
      games: games,
      beerWinner: beer.winner,
      pointsBubble: pointsBubble.winner,
      homeGamesWon: won.home,
      awayGamesWon: won.away,
      homeSheetPoints: addParts([games[0].homePoints, games[1].homePoints, games[2].homePoints, homeExtra.sum]),
      awaySheetPoints: addParts([games[0].awayPoints, games[1].awayPoints, games[2].awayPoints, awayExtra.sum]),
      cells: cells,
      blanksSkipped: blanks,
      boxesRead: inked
    };
  }

  function loadImageFile(file) {
    function toCanvas(bitmap) {
      var maxDim = 2400;
      var scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
      var canvas = root.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return canvas;
    }
    var attempt;
    try {
      attempt = root.createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (err) {
      attempt = root.createImageBitmap(file);
    }
    return Promise.resolve(attempt).catch(function () {
      return root.createImageBitmap(file);
    }).then(toCanvas);
  }

  root.RAD_OCR = {
    readSheet: readSheet,
    loadImageFile: loadImageFile
  };
})(typeof window !== "undefined" ? window : globalThis);
