/* Reader for the v7 Roslyn results scan sheet.
   Finds the four corner squares, uses the white notch in the top-left
   square to turn a rotated photo upright, then samples each bubble
   against the others in its row. One clearly darker bubble is the mark.
   A row with none is blank (missing, not zero). A row with two is flagged.
   The 100+ flag is the exception: blank means 0, filled means +100.
   Names, captain, and the date are handwritten and are not read. */
(function (root) {
  "use strict";

  var PAD = 48;
  var SIDES = ["home", "away"];
  var SHOOTERS = [1, 2, 3, 4];

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

  function median(values) {
    if (!values.length) return null;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.floor((sorted.length - 1) / 2)];
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

  /* Maps destination pixels back to the photo. */
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
    var yy, xx;
    for (yy = y0; yy <= y1; yy += 1) {
      for (xx = x0; xx <= x1; xx += 1) {
        sum += luminance(data, (yy * width + xx) * 4);
        count += 1;
      }
    }
    return count ? sum / count : 255;
  }

  /* Mean luminance of the ring inside the printed circle, outside the digit. */
  function sampleAnnulus(data, width, height, cx, cy, radius) {
    var inner = Math.max(1, radius * 0.46);
    var outer = Math.max(inner + 1, radius * 0.74);
    var inner2 = inner * inner;
    var outer2 = outer * outer;
    var x0 = Math.max(0, Math.floor(cx - outer));
    var y0 = Math.max(0, Math.floor(cy - outer));
    var x1 = Math.min(width - 1, Math.ceil(cx + outer));
    var y1 = Math.min(height - 1, Math.ceil(cy + outer));
    var sum = 0;
    var count = 0;
    var y, x, dx, dy, d2;
    for (y = y0; y <= y1; y += 1) {
      for (x = x0; x <= x1; x += 1) {
        dx = x + 0.5 - cx;
        dy = y + 0.5 - cy;
        d2 = dx * dx + dy * dy;
        if (d2 < inner2 || d2 > outer2) continue;
        sum += luminance(data, (y * width + x) * 4);
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
    var maxArea = Math.pow(minSide * 0.11, 2);
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
      if (fill < 0.55 || aspect < 0.72 || aspect > 1.4) continue;
      comps.push({
        minX: minX,
        minY: minY,
        maxX: maxX,
        maxY: maxY,
        count: count,
        area: area
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

  function scoreCorners(ordered, spanX, spanY) {
    var top = dist(ordered.TL, ordered.TR);
    var bottom = dist(ordered.BL, ordered.BR);
    var left = dist(ordered.TL, ordered.BL);
    var right = dist(ordered.TR, ordered.BR);
    if (top < 40 || left < 40) return -1;
    var sideMismatch = Math.abs(top - bottom) / Math.max(top, bottom) + Math.abs(left - right) / Math.max(left, right);
    if (sideMismatch > 0.45) return -1;
    var aspect = ((top + bottom) / 2) / ((left + right) / 2);
    var aspectErr = Math.abs(aspect - spanX / spanY);
    if (aspectErr > 0.45) return -1;
    var areas = [ordered.TL, ordered.TR, ordered.BL, ordered.BR].map(function (pt) { return pt.area; });
    var maxA = Math.max.apply(null, areas);
    var minA = Math.min.apply(null, areas);
    if (maxA > 0 && minA < maxA * 0.28) return -1;
    function perp(a, b, c) {
      var v1x = a.x - b.x;
      var v1y = a.y - b.y;
      var v2x = c.x - b.x;
      var v2y = c.y - b.y;
      var denom = Math.sqrt((v1x * v1x + v1y * v1y) * (v2x * v2x + v2y * v2y));
      return denom ? (v1x * v2x + v1y * v2y) / denom : 1;
    }
    if (Math.abs(perp(ordered.TR, ordered.TL, ordered.BL)) > 0.55) return -1;
    if (Math.abs(perp(ordered.BR, ordered.TR, ordered.TL)) > 0.55) return -1;
    return (top * left) / (1 + sideMismatch * 3 + aspectErr * 3);
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

  function markerSpan(spec) {
    var tl = spec.fiducials.TL.center_pt_topleft;
    var tr = spec.fiducials.TR.center_pt_topleft;
    var bl = spec.fiducials.BL.center_pt_topleft;
    return { x: tr[0] - tl[0], y: bl[1] - tl[1] };
  }

  function locateMarks(canvas, spec) {
    var span = markerSpan(spec);
    var maxDim = 960;
    var scaleDown = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    var sw = Math.max(1, Math.round(canvas.width * scaleDown));
    var sh = Math.max(1, Math.round(canvas.height * scaleDown));
    var small = root.document.createElement("canvas");
    small.width = sw;
    small.height = sh;
    var sctx = small.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(canvas, 0, 0, sw, sh);
    var smallData = sctx.getImageData(0, 0, sw, sh).data;
    var mask = new Uint8Array(sw * sh);
    var i;
    for (i = 0; i < sw * sh; i += 1) mask[i] = luminance(smallData, i * 4) < 90 ? 1 : 0;
    var full = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
    var backX = canvas.width / sw;
    var backY = canvas.height / sh;
    var comps = findComponents(mask, sw, sh).map(function (comp) {
      var cx = ((comp.minX + comp.maxX) / 2) * backX;
      var cy = ((comp.minY + comp.maxY) / 2) * backY;
      var side = Math.max((comp.maxX - comp.minX) * backX, (comp.maxY - comp.minY) * backY);
      var inner = regionLuminance(full.data, full.width, full.height, cx, cy, Math.max(2, side * 0.12));
      var edge = regionLuminance(
        full.data,
        full.width,
        full.height,
        cx - side * 0.28,
        cy - side * 0.28,
        Math.max(1.5, side * 0.07)
      );
      return {
        x: cx,
        y: cy,
        area: comp.count,
        notch: inner > 140 && inner > edge + 50,
        side: side
      };
    });
    comps.sort(function (a, b) { return b.area - a.area; });
    if (comps.length > 14) comps = comps.slice(0, 14);

    var best = null;
    eachCombo(comps, function (group) {
      var notched = group.filter(function (pt) { return pt.notch; });
      var ordered = notched.length === 1
        ? labelFromTL(notched[0], group.filter(function (pt) { return pt !== notched[0]; }))
        : orderByAngle(group);
      var score = scoreCorners(ordered, span.x, span.y);
      if (score < 0) return;
      if (notched.length === 1) score *= 1.25;
      if (!best || score > best.score) best = { ordered: ordered, score: score, notch: notched.length === 1 };
    });

    if (!best) {
      return {
        mode: "rejected",
        notch: false,
        upsideDown: false,
        squares: comps.length,
        warning: "The four black corner squares were not found. Retake the photo so all four are in the frame, on a flat page."
      };
    }
    var topSpan = dist(best.ordered.TL, best.ordered.TR);
    if (topSpan < Math.min(canvas.width, canvas.height) * 0.22) {
      return {
        mode: "rejected",
        notch: best.notch,
        upsideDown: false,
        squares: comps.length,
        warning: "The corner squares are too small in the frame. Move closer, and keep all four in the photo."
      };
    }
    var fit = Math.max(1.15, Math.min(2.35, topSpan / span.x));
    return {
      mode: "fiducial",
      notch: best.notch,
      upsideDown: best.ordered.TL.y > canvas.height * 0.55 && best.ordered.TL.y > best.ordered.BL.y,
      squares: comps.length,
      warning: best.notch ? "" : "The white notch in the top-left square was hard to see. This read assumes the photo is upright.",
      scale: fit,
      span: span,
      src: best.ordered,
      dest: {
        TL: { x: PAD, y: PAD },
        TR: { x: PAD + span.x * fit, y: PAD },
        BL: { x: PAD, y: PAD + span.y * fit },
        BR: { x: PAD + span.x * fit, y: PAD + span.y * fit }
      },
      outW: PAD * 2 + span.x * fit,
      outH: PAD * 2 + span.y * fit
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
      located.warning = "The photo could not be straightened.";
      located.mode = "rejected";
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
        var end = Math.min(dh, y + 56);
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

  function cornersAreMarks(image, located) {
    var spots = [located.dest.TL, located.dest.TR, located.dest.BL, located.dest.BR];
    var step = Math.max(6, 7 * located.scale);
    var good = 0;
    spots.forEach(function (spot) {
      var dark = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dir) {
        var x = Math.round(spot.x + dir[0] * step);
        var y = Math.round(spot.y + dir[1] * step);
        if (x < 1 || y < 1 || x >= image.width - 1 || y >= image.height - 1) return;
        if (luminance(image.data, (y * image.width + x) * 4) < 80) dark += 1;
      });
      if (dark >= 3) good += 1;
    });
    return good >= 3;
  }

  function mapPoint(located, nx, ny) {
    return {
      x: PAD + nx * located.span.x * located.scale,
      y: PAD + ny * located.span.y * located.scale
    };
  }

  function samplePlace(place, image, located, radius) {
    return place.bubbles.map(function (bubble) {
      var p = mapPoint(located, bubble.center_norm[0], bubble.center_norm[1]);
      return {
        value: bubble.value,
        lum: sampleAnnulus(image.data, image.width, image.height, p.x, p.y, radius)
      };
    });
  }

  /* Pick the one bubble that is clearly darker than the others in the row. */
  function judgeRow(samples, emptyLevel) {
    var ranked = samples.slice().sort(function (a, b) { return a.lum - b.lum; });
    var darkest = ranked[0];
    var neighbors = ranked.slice(1);
    var neighborLevel = median(neighbors.map(function (sample) { return sample.lum; }));
    var gapToNext = neighbors.length ? neighbors[0].lum - darkest.lum : 999;
    var gapToRow = neighborLevel == null ? 999 : neighborLevel - darkest.lum;
    var rivals = neighbors.filter(function (sample) {
      return neighborLevel - sample.lum >= 36 && sample.lum - darkest.lum < 26;
    });
    if (gapToRow >= 38 && gapToNext >= 24 && darkest.lum <= emptyLevel - 32 && rivals.length === 0) {
      return { status: "filled", value: darkest.value, lum: darkest.lum };
    }
    if (gapToRow < 22 && gapToNext < 20) {
      if (neighborLevel != null && neighborLevel < emptyLevel - 36) {
        return { status: "ambiguous", value: null, lum: darkest.lum };
      }
      return { status: "blank", value: null, lum: darkest.lum };
    }
    return { status: "ambiguous", value: null, lum: darkest.lum };
  }

  function judgeFlag(sample, emptyLevel) {
    if (sample.lum <= emptyLevel - 48) return { status: "filled", value: 100, lum: sample.lum };
    if (sample.lum >= emptyLevel - 22) return { status: "blank", value: 0, lum: sample.lum };
    return { status: "ambiguous", value: null, lum: sample.lum };
  }

  function lighterHalf(samples) {
    var lums = samples.map(function (sample) { return sample.lum; }).sort(function (a, b) { return a - b; });
    return median(lums.slice(Math.floor(lums.length / 2)));
  }

  function slimPlace(place) {
    return { status: place.status, value: place.value };
  }

  function composeDigits(digits, isTeam) {
    var tens = digits.tens;
    var ones = digits.ones;
    var hundreds = digits.hundreds;
    var base = {
      tens: slimPlace(tens),
      ones: slimPlace(ones)
    };
    if (isTeam) base.hundreds = slimPlace(hundreds);
    var bad = [tens, ones].concat(isTeam ? [hundreds] : []).filter(function (place) {
      return place.status !== "filled" && !(isTeam && place === hundreds && place.status === "blank");
    });
    if (bad.length) {
      var ambiguous = bad.some(function (place) { return place.status === "ambiguous"; });
      base.value = null;
      base.status = ambiguous ? "ambiguous" : "blank";
      return base;
    }
    var hundredsValue = isTeam ? (hundreds.status === "filled" ? 100 : 0) : 0;
    base.value = hundredsValue + tens.value * 10 + ones.value;
    base.status = "ok";
    return base;
  }

  function emptyTeams() {
    var teams = {};
    SIDES.forEach(function (side) {
      teams[side] = { games: [1, 2, 3].map(function () {
        return {
          shooters: SHOOTERS.map(function () { return { value: null, status: "blank" }; }),
          team: { value: null, status: "blank" },
          shooterSum: null,
          sumMismatch: false
        };
      }) };
    });
    return teams;
  }

  function emptyWinners() {
    return {
      game1: { value: "", status: "blank" },
      game2: { value: "", status: "blank" },
      game3: { value: "", status: "blank" },
      beer: { value: "", status: "blank" },
      points: { value: "", status: "blank" }
    };
  }

  function countWon(winners) {
    var home = 0;
    var away = 0;
    ["game1", "game2", "game3"].forEach(function (key) {
      if (winners[key].value === "home") home += 1;
      else if (winners[key].value === "away") away += 1;
    });
    return { home: home, away: away };
  }

  function previewUrl(canvas) {
    var preview = root.document.createElement("canvas");
    var previewW = Math.min(1000, canvas.width);
    var previewScale = previewW / canvas.width;
    preview.width = previewW;
    preview.height = Math.max(1, Math.round(canvas.height * previewScale));
    var ctx = preview.getContext("2d");
    ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
    return preview.toDataURL("image/jpeg", 0.72);
  }

  function rejected(spec, canvas, located, warnings) {
    return {
      version: (spec && spec.version) || "v7",
      mode: "rejected",
      notch: !!(located && located.notch),
      upsideDown: false,
      warnings: warnings.filter(Boolean),
      previewUrl: canvas ? previewUrl(canvas) : "",
      teams: emptyTeams(),
      winners: emptyWinners(),
      homeGamesWon: 0,
      awayGamesWon: 0,
      counts: { filled: 0, blank: 0, ambiguous: 0 }
    };
  }

  function placeLabel(side, game, who, place) {
    var whoLabel = who === "team" ? "team total" : who.toUpperCase();
    var placeLabel = place === "tens" ? "tens" : place === "ones" ? "ones" : "100+";
    return side.charAt(0).toUpperCase() + side.slice(1) + " Game " + game + " " + whoLabel + " " + placeLabel;
  }

  function readAligned(image, spec, located) {
    var warnings = [];
    if (located.warning) warnings.push(located.warning);
    var radius = spec.bubble_radius.pt * located.scale;
    var winnerRadius = (spec.winner_bubble_radius || spec.bubble_radius).pt * located.scale;
    var sampled = {};
    var emptyRefs = [];
    SIDES.forEach(function (side) {
      [1, 2, 3].forEach(function (game) {
        SHOOTERS.forEach(function (shooter) {
          var key = side + "_g" + game + "_s" + shooter;
          var field = spec.number_fields[key];
          sampled[key] = {};
          field.digits.forEach(function (place) {
            var samples = samplePlace(place, image, located, radius);
            sampled[key][place.place] = samples;
            if (samples.length >= 8) emptyRefs.push(lighterHalf(samples));
          });
        });
        var teamKey = side + "_g" + game + "_team";
        sampled[teamKey] = {};
        spec.number_fields[teamKey].digits.forEach(function (place) {
          var samples = samplePlace(place, image, located, radius);
          sampled[teamKey][place.place] = samples;
          if (samples.length >= 8) emptyRefs.push(lighterHalf(samples));
        });
      });
    });
    var winnerSamples = {};
    Object.keys(spec.winner_fields).forEach(function (key) {
      winnerSamples[key] = spec.winner_fields[key].map(function (bubble) {
        var p = mapPoint(located, bubble.center_norm[0], bubble.center_norm[1]);
        return {
          value: bubble.value,
          lum: sampleAnnulus(image.data, image.width, image.height, p.x, p.y, winnerRadius)
        };
      });
    });
    var emptyLevel = median(emptyRefs);
    if (emptyLevel == null) emptyLevel = 210;

    var counts = { filled: 0, blank: 0, ambiguous: 0 };
    function track(row) {
      if (row.status === "filled" || row.status === "ok") counts.filled += 1;
      else if (row.status === "ambiguous") counts.ambiguous += 1;
      else counts.blank += 1;
    }
    function judged(samples) {
      var row = samples.length === 1 ? judgeFlag(samples[0], emptyLevel) : judgeRow(samples, emptyLevel);
      if (samples.length === 1 && row.status === "blank") {
        /* A blank 100+ flag is a real zero, not a missing digit. */
        counts.filled += 1;
      } else {
        track(row);
      }
      return row;
    }

    var teams = emptyTeams();
    SIDES.forEach(function (side) {
      [1, 2, 3].forEach(function (game, gameIndex) {
        var shooters = SHOOTERS.map(function (shooter) {
          var key = side + "_g" + game + "_s" + shooter;
          var digits = {
            tens: judged(sampled[key].tens),
            ones: judged(sampled[key].ones)
          };
          ["tens", "ones"].forEach(function (place) {
            if (digits[place].status === "filled") return;
            var label = placeLabel(side, game, "s" + shooter, place);
            if (digits[place].status === "blank") {
              warnings.push(label + ": no bubble filled. Left blank, not read as 0.");
            } else {
              warnings.push(label + ": more than one bubble looks filled, or the mark is too light to call.");
            }
          });
          return composeDigits(digits, false);
        });
        var teamKey = side + "_g" + game + "_team";
        var teamDigits = {
          hundreds: judged(sampled[teamKey].hundreds),
          tens: judged(sampled[teamKey].tens),
          ones: judged(sampled[teamKey].ones)
        };
        if (teamDigits.hundreds.status === "ambiguous") {
          warnings.push(placeLabel(side, game, "team", "hundreds") + ": the 100+ bubble is too light to call.");
        }
        ["tens", "ones"].forEach(function (place) {
          if (teamDigits[place].status === "filled") return;
          var label = placeLabel(side, game, "team", place);
          if (teamDigits[place].status === "blank") {
            warnings.push(label + ": no bubble filled. Left blank, not read as 0.");
          } else {
            warnings.push(label + ": more than one bubble looks filled, or the mark is too light to call.");
          }
        });
        var team = composeDigits(teamDigits, true);
        var known = shooters.every(function (shooter) { return shooter.value != null; });
        var shooterSum = known ? shooters.reduce(function (sum, shooter) { return sum + shooter.value; }, 0) : null;
        var sumMismatch = shooterSum != null && team.value != null && shooterSum !== team.value;
        if (sumMismatch) {
          warnings.push(
            side.charAt(0).toUpperCase() + side.slice(1) + " Game " + game +
            ": shooters add up to " + shooterSum + ", the team total reads " + team.value + "."
          );
        }
        teams[side].games[gameIndex] = {
          shooters: shooters,
          team: team,
          shooterSum: shooterSum,
          sumMismatch: sumMismatch
        };
      });
    });

    var winnerMap = {
      game1_winner: "game1",
      game2_winner: "game2",
      game3_winner: "game3",
      beer_frame_winner: "beer",
      total_points_winner: "points"
    };
    var winnerNames = {
      game1: "Game 1 winner",
      game2: "Game 2 winner",
      game3: "Game 3 winner",
      beer: "Beer frame",
      points: "Total points winner"
    };
    var winners = emptyWinners();
    Object.keys(winnerMap).forEach(function (key) {
      var id = winnerMap[key];
      var row = judgeRow(winnerSamples[key], emptyLevel);
      var value = row.status === "filled" ? row.value : "";
      var status = row.status === "filled" ? "ok" : row.status;
      winners[id] = { value: value, status: status };
      if (id === "beer") return;
      if (status === "blank") warnings.push(winnerNames[id] + ": no bubble filled.");
      else if (status === "ambiguous") warnings.push(winnerNames[id] + ": both Home and Away look filled, or the mark is too light to call.");
    });

    var won = countWon(winners);
    var trace = null;
    if (spec.debug) {
      function roundSamples(samples) {
        return (samples || []).map(function (sample) {
          return { value: sample.value, lum: Math.round(sample.lum) };
        });
      }
      trace = {
        emptyLevel: Math.round(emptyLevel),
        homeG1S1: {
          tens: roundSamples(sampled.home_g1_s1.tens),
          ones: roundSamples(sampled.home_g1_s1.ones)
        },
        homeG1TeamHundreds: roundSamples(sampled.home_g1_team.hundreds),
        beer: roundSamples(winnerSamples.beer_frame_winner)
      };
    }
    var unique = [];
    warnings.forEach(function (item) {
      if (item && unique.indexOf(item) < 0) unique.push(item);
    });
    var result = {
      version: spec.version || "v7",
      mode: "fiducial",
      notch: !!located.notch,
      upsideDown: !!located.upsideDown,
      warnings: unique,
      teams: teams,
      winners: winners,
      homeGamesWon: won.home,
      awayGamesWon: won.away,
      counts: counts,
      calibration: { emptyLevel: Math.round(emptyLevel) }
    };
    if (trace) result.trace = trace;
    return result;
  }

  function readSheet(sourceCanvas, spec, onProgress) {
    if (!spec || !spec.number_fields || !spec.fiducials) {
      return Promise.reject(new Error("The v7 scan sheet layout is missing."));
    }
    say(onProgress, "Looking for the corner squares…");
    return nextFrame().then(function () {
      var located = locateMarks(sourceCanvas, spec);
      if (located.mode !== "fiducial") {
        var note = located.warning || "The corner squares were not found.";
        if (located.squares != null) note += " (" + located.squares + " dark squares seen.)";
        return rejected(spec, sourceCanvas, located, [note]);
      }
      say(onProgress, located.upsideDown ? "Turning the upside-down photo upright…" : "Straightening the photo…");
      return warp(sourceCanvas, located).then(function (aligned) {
        var image = aligned.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, aligned.width, aligned.height);
        if (!cornersAreMarks(image, located)) {
          return rejected(spec, sourceCanvas, located, [
            "Those dark shapes are not the scan sheet's corner squares. Retake the photo with all four black squares in the frame."
          ]);
        }
        say(onProgress, "Reading the bubbles…");
        return nextFrame().then(function () {
          var result = readAligned(image, spec, located);
          result.previewUrl = previewUrl(aligned);
          return result;
        });
      });
    });
  }

  function loadImageFile(file) {
    function toCanvas(bitmap) {
      var maxDim = 2200;
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
