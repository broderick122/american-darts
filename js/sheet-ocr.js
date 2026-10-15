/* Reader for the Roslyn results scan sheets.
   v16 is the letter portrait one-team sheet: keypads, a WHO picker, no QR.
   Older specs still read if one is passed in.
   Pass one spec, or both, and the corner-marker aspect picks the version.
   Finds the black corner squares, turns a 0/90/180/270 photo upright
   from those squares plus the header and QR pattern, and samples each
   bubble against the others in its row. On the keypad sheet, a key is
   the mark when its ink coverage is clearly above the other keys in
   that pad. A row with none is blank (missing, not zero). A row with
   two is flagged. The 100 flag is the exception: blank means 0,
   filled means +100. Handwritten score boxes are not read. Names,
   captain, and the date are handwritten and are not read. */
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

  /* Local contrast mask. A fixed cutoff misses a corner square in warm light
     or glare, and it paints a whole shadow as ink. */
  function adaptiveMask(lum, width, height) {
    var integ = new Float64Array((width + 1) * (height + 1));
    var stride = width + 1;
    var y, x, row, idx;
    for (y = 0; y < height; y += 1) {
      row = 0;
      for (x = 0; x < width; x += 1) {
        row += lum[y * width + x];
        idx = (y + 1) * stride + (x + 1);
        integ[idx] = integ[y * stride + (x + 1)] + row;
      }
    }
    var radius = Math.max(12, Math.round(Math.min(width, height) * 0.045));
    var mask = new Uint8Array(width * height);
    for (y = 0; y < height; y += 1) {
      var y0 = Math.max(0, y - radius);
      var y1 = Math.min(height - 1, y + radius);
      for (x = 0; x < width; x += 1) {
        var x0 = Math.max(0, x - radius);
        var x1 = Math.min(width - 1, x + radius);
        var sum = integ[(y1 + 1) * stride + (x1 + 1)] - integ[y0 * stride + (x1 + 1)] - integ[(y1 + 1) * stride + x0] + integ[y0 * stride + x0];
        var area = (x1 - x0 + 1) * (y1 - y0 + 1);
        var mean = sum / area;
        var value = lum[y * width + x];
        if (value < mean - 28 && value < mean * 0.72 && value < 165) mask[y * width + x] = 1;
      }
    }
    return mask;
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

  /* Share of the inner disk that is darker than the paper beside the bubble.
     A pen scribble counts even when it does not fill the ring. The printed
     gray digit stays above the cutoff. */
  function inkFraction(data, width, height, cx, cy, radius) {
    var spots = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    var papers = [];
    var i;
    for (i = 0; i < spots.length; i += 1) {
      papers.push(regionLuminance(
        data,
        width,
        height,
        cx + spots[i][0] * radius * 1.55,
        cy + spots[i][1] * radius * 1.55,
        Math.max(1.5, radius * 0.18)
      ));
    }
    var paper = median(papers);
    if (paper == null) paper = 210;
    var cutoff = Math.min(paper - 42, paper * 0.58);
    var inner = Math.max(1.5, radius * 0.66);
    var inner2 = inner * inner;
    var x0 = Math.max(0, Math.floor(cx - inner));
    var y0 = Math.max(0, Math.floor(cy - inner));
    var x1 = Math.min(width - 1, Math.ceil(cx + inner));
    var y1 = Math.min(height - 1, Math.ceil(cy + inner));
    var dark = 0;
    var count = 0;
    var y, x, dx, dy;
    for (y = y0; y <= y1; y += 1) {
      for (x = x0; x <= x1; x += 1) {
        dx = x + 0.5 - cx;
        dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > inner2) continue;
        count += 1;
        if (luminance(data, (y * width + x) * 4) < cutoff) dark += 1;
      }
    }
    return count ? dark / count : 0;
  }

  function bubbleLum(data, width, height, cx, cy, radius) {
    var annulus = sampleAnnulus(data, width, height, cx, cy, radius);
    var fromInk = 255 * (1 - inkFraction(data, width, height, cx, cy, radius));
    return Math.min(annulus, fromInk);
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

  function quadAspect(ordered) {
    var top = dist(ordered.TL, ordered.TR);
    var bottom = dist(ordered.BL, ordered.BR);
    var left = dist(ordered.TL, ordered.BL);
    var right = dist(ordered.TR, ordered.BR);
    var width = (top + bottom) / 2;
    var height = (left + right) / 2;
    return height ? width / height : 0;
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

  /* 0 when the sheet's top edge points right, 90 when it points down. */
  function rotationOf(ordered) {
    var ang = Math.atan2(ordered.TR.y - ordered.TL.y, ordered.TR.x - ordered.TL.x);
    var deg = Math.round(ang / (Math.PI / 2)) * 90;
    deg %= 360;
    if (deg < 0) deg += 360;
    return deg;
  }

  function markerSpan(spec) {
    var tl = spec.fiducials.TL.center_pt_topleft;
    var tr = spec.fiducials.TR.center_pt_topleft;
    var bl = spec.fiducials.BL.center_pt_topleft;
    return { x: tr[0] - tl[0], y: bl[1] - tl[1] };
  }

  function limitCanvas(canvas, maxDim) {
    var longest = Math.max(canvas.width, canvas.height);
    if (longest <= maxDim) return canvas;
    var scale = maxDim / longest;
    var next = root.document.createElement("canvas");
    next.width = Math.max(1, Math.round(canvas.width * scale));
    next.height = Math.max(1, Math.round(canvas.height * scale));
    var ctx = next.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, 0, 0, next.width, next.height);
    return next;
  }

  function ringOf(pts) {
    var cx = 0;
    var cy = 0;
    pts.forEach(function (pt) { cx += pt.x; cy += pt.y; });
    cx /= pts.length;
    cy /= pts.length;
    return pts.slice().sort(function (a, b) {
      return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx);
    });
  }

  function rotateRing(ring, turns) {
    return {
      TL: ring[turns % 4],
      TR: ring[(turns + 1) % 4],
      BR: ring[(turns + 2) % 4],
      BL: ring[(turns + 3) % 4]
    };
  }

  /* The missing corner of a near-rectangle is opposite the right angle. */
  function completeParallelogram(pts) {
    var pairs = [[0, 1], [0, 2], [1, 2]];
    var diagonal = pairs[0];
    var longest = 0;
    pairs.forEach(function (pair) {
      var length = dist(pts[pair[0]], pts[pair[1]]);
      if (length > longest) {
        longest = length;
        diagonal = pair;
      }
    });
    var vertexIndex = [0, 1, 2].filter(function (index) {
      return index !== diagonal[0] && index !== diagonal[1];
    })[0];
    var vertex = pts[vertexIndex];
    var endA = pts[diagonal[0]];
    var endB = pts[diagonal[1]];
    var v1x = endA.x - vertex.x;
    var v1y = endA.y - vertex.y;
    var v2x = endB.x - vertex.x;
    var v2y = endB.y - vertex.y;
    var denom = Math.sqrt((v1x * v1x + v1y * v1y) * (v2x * v2x + v2y * v2y));
    var cos = denom ? (v1x * v2x + v1y * v2y) / denom : 1;
    if (Math.abs(cos) > 0.5) return null;
    var legA = Math.hypot(v1x, v1y);
    var legB = Math.hypot(v2x, v2y);
    var ratio = Math.max(legA, legB) / Math.min(legA, legB);
    if (ratio < 1.05 || ratio > 1.8) return null;
    var area = 0;
    pts.forEach(function (pt) { area += pt.area || 0; });
    return {
      x: endA.x + endB.x - vertex.x,
      y: endA.y + endB.y - vertex.y,
      area: area / pts.length,
      side: vertex.side,
      notch: false,
      estimated: true
    };
  }

  function normHomography(ordered) {
    return homography(
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
      [ordered.TL, ordered.TR, ordered.BL, ordered.BR]
    );
  }

  function applyNorm(H, nx, ny) {
    var den = H[6] * nx + H[7] * ny + 1;
    return {
      x: (H[0] * nx + H[1] * ny + H[2]) / den,
      y: (H[3] * nx + H[4] * ny + H[5]) / den
    };
  }

  function qrScore(data, width, height, H, box) {
    if (!H || !box) return 0;
    var lums = [];
    var outside = 0;
    var iy, ix, point, xi, yi;
    for (iy = 0; iy < 7; iy += 1) {
      for (ix = 0; ix < 7; ix += 1) {
        point = applyNorm(H, box[0] + box[2] * (ix + 0.5) / 7, box[1] + box[3] * (iy + 0.5) / 7);
        xi = Math.round(point.x);
        yi = Math.round(point.y);
        if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) {
          outside += 1;
          continue;
        }
        lums.push(luminance(data, (yi * width + xi) * 4));
      }
    }
    if (lums.length < 24) return -1;
    var sum = 0;
    var dark = 0;
    lums.forEach(function (value) {
      sum += value;
      if (value < 110) dark += 1;
    });
    var mean = sum / lums.length;
    var variance = 0;
    lums.forEach(function (value) { variance += (value - mean) * (value - mean); });
    var std = Math.sqrt(variance / lums.length);
    var ratio = dark / lums.length;
    var score = 0;
    if (ratio > 0.15 && ratio < 0.78) score += 2;
    if (std > 32) score += 2;
    if (mean > 45 && mean < 200) score += 1;
    if (outside > 8) score -= 2;
    return score;
  }

  function headerScore(data, width, height, H) {
    if (!H) return 0;
    var dark = 0;
    var total = 0;
    var ix, point, xi, yi;
    for (ix = 0; ix < 12; ix += 1) {
      point = applyNorm(H, 0.08 + ix * 0.04, 0.012);
      xi = Math.round(point.x);
      yi = Math.round(point.y);
      if (xi < 1 || yi < 1 || xi >= width - 1 || yi >= height - 1) continue;
      total += 1;
      if (luminance(data, (yi * width + xi) * 4) < 120) dark += 1;
    }
    if (!total) return -1;
    var ratio = dark / total;
    if (ratio > 0.08 && ratio < 0.7) return 1;
    return 0;
  }

  function eachTrio(list, fn) {
    var i, j, k;
    for (i = 0; i < list.length; i += 1) {
      for (j = i + 1; j < list.length; j += 1) {
        for (k = j + 1; k < list.length; k += 1) fn([list[i], list[j], list[k]]);
      }
    }
  }

  function placementScore(ordered, data, width, height, spec, span) {
    var geom = scoreCorners(ordered, span.x, span.y);
    if (geom < 0) return -1;
    var H = normHomography(ordered);
    if (!H) return -1;
    var qr = qrScore(data, width, height, H, spec.qr && spec.qr.bbox_norm);
    var header = headerScore(data, width, height, H);
    if (qr < 2 && !ordered.TL.notch) return -1;
    var estimated = ordered.TL.estimated || ordered.TR.estimated || ordered.BL.estimated || ordered.BR.estimated;
    return geom / 100000 + qr * 4 + header + (ordered.TL.notch ? 6 : 0) + (estimated ? -1 : 2);
  }

  function pickSeparated(comps, canvas) {
    var minSep = 0.12 * Math.min(canvas.width, canvas.height);
    var largest = comps.length ? comps[0].area : 0;
    var picked = [];
    comps.forEach(function (comp) {
      if (!largest || comp.area < largest * 0.25) return;
      var close = picked.some(function (pt) { return dist(pt, comp) <= minSep; });
      if (!close) picked.push(comp);
    });
    return picked.slice(0, 6);
  }

  function rotationOf(ordered) {
    var angle = Math.atan2(ordered.TR.y - ordered.TL.y, ordered.TR.x - ordered.TL.x);
    var snapped = Math.round((angle * 180 / Math.PI) / 90) * 90;
    return ((snapped % 360) + 360) % 360;
  }

  function isConvexQuad(ordered) {
    var pts = [ordered.TL, ordered.TR, ordered.BR, ordered.BL];
    var sign = 0;
    var i, a, b, c, cross;
    for (i = 0; i < 4; i += 1) {
      a = pts[i];
      b = pts[(i + 1) % 4];
      c = pts[(i + 2) % 4];
      cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cross) < 1) continue;
      if (!sign) sign = cross > 0 ? 1 : -1;
      else if ((cross > 0 ? 1 : -1) !== sign) return false;
    }
    return sign !== 0;
  }

  function placeDigits(field, placeName) {
    if (!field || !field.digits) return null;
    var found = null;
    field.digits.forEach(function (place) {
      if (place.place === placeName) found = place;
    });
    return found;
  }

  function rowContrast(data, width, height, H, place, radius) {
    if (!H || !place || !place.bubbles) return 0;
    var lums = place.bubbles.map(function (bubble) {
      var p = applyNorm(H, bubble.center_norm[0], bubble.center_norm[1]);
      return sampleAnnulus(data, width, height, p.x, p.y, radius);
    });
    if (lums.length < 2) return 0;
    lums.sort(function (a, b) { return a - b; });
    if (lums[0] >= 150) return 0;
    return lums[1] - lums[0];
  }

  function alignmentScore(ordered, data, width, height, spec) {
    if (!isConvexQuad(ordered)) return -1;
    var H = normHomography(ordered);
    if (!H) return -1;
    var spanPx = dist(ordered.TL, ordered.TR);
    if (spec.version === "v16" && spec.roster_fields) {
      var scoreW = (spec.bubble_size_pt && spec.bubble_size_pt.score && spec.bubble_size_pt.score.width) || 20;
      var radius16 = Math.max(2.5, (scoreW / 2) * spanPx / markerSpan(spec).x);
      var places16 = [];
      var slotA = spec.roster_fields.team_A;
      var shooter = spec.number_fields && spec.number_fields.team_g1_s1;
      var whoRow = spec.who_fields && spec.who_fields.team_g1_s1;
      if (slotA && slotA.digits) places16 = places16.concat(slotA.digits);
      if (shooter && shooter.digits) places16 = places16.concat(shooter.digits);
      if (whoRow) places16.push(whoRow);
      var total16 = 0;
      places16.forEach(function (place) {
        total16 += rowContrast(data, width, height, H, place, radius16);
      });
      return total16;
    }
    var radius = Math.max(2.5, spec.bubble_radius.pt * spanPx / markerSpan(spec).x);
    var rows = [
      ["home_g1_s1", "tens"],
      ["home_g1_s1", "ones"],
      ["home_g1_s4", "tens"],
      ["home_g1_s4", "ones"],
      ["away_g3_s1", "tens"],
      ["away_g3_s1", "ones"],
      ["away_g1_team", "tens"],
      ["away_g1_team", "ones"]
    ];
    var total = 0;
    rows.forEach(function (row) {
      total += rowContrast(data, width, height, H, placeDigits(spec.number_fields[row[0]], row[1]), radius);
    });
    return total;
  }

  /* Nudge a cut-off corner so filled bubbles land on the darker mark. */
  function refineEstimated(ordered, data, width, height, spec) {
    var key = null;
    ["TL", "TR", "BL", "BR"].forEach(function (name) {
      if (ordered[name].estimated) key = name;
    });
    if (!key) return { ordered: ordered, align: alignmentScore(ordered, data, width, height, spec) };

    function moved(x, y) {
      var next = { TL: ordered.TL, TR: ordered.TR, BL: ordered.BL, BR: ordered.BR };
      next[key] = {
        x: x,
        y: y,
        area: ordered[key].area,
        side: ordered[key].side,
        notch: false,
        estimated: true
      };
      return next;
    }

    var bestOrdered = ordered;
    var bestScore = alignmentScore(ordered, data, width, height, spec);
    var step = Math.max(6, Math.round(Math.min(width, height) * 0.014));
    var range = step * 7;
    var originX = ordered[key].x;
    var originY = ordered[key].y;
    var dx, dy, candidate, score;
    for (dy = -range; dy <= range; dy += step) {
      for (dx = -range; dx <= range; dx += step) {
        candidate = moved(originX + dx, originY + dy);
        score = alignmentScore(candidate, data, width, height, spec);
        if (score > bestScore) {
          bestScore = score;
          bestOrdered = candidate;
        }
      }
    }
    var fineX = bestOrdered[key].x;
    var fineY = bestOrdered[key].y;
    var fine = Math.max(2, Math.round(step / 3));
    for (dy = -step; dy <= step; dy += fine) {
      for (dx = -step; dx <= step; dx += fine) {
        candidate = moved(fineX + dx, fineY + dy);
        score = alignmentScore(candidate, data, width, height, spec);
        if (score > bestScore) {
          bestScore = score;
          bestOrdered = candidate;
        }
      }
    }
    return { ordered: bestOrdered, align: bestScore };
  }

  function locateMarks(canvas, specOrSpecs) {
    var specs = Array.isArray(specOrSpecs) ? specOrSpecs : [specOrSpecs];
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
    var lum = new Float32Array(sw * sh);
    var i;
    for (i = 0; i < sw * sh; i += 1) lum[i] = luminance(smallData, i * 4);
    var mask = adaptiveMask(lum, sw, sh);
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
        inner: inner,
        edge: edge,
        notch: inner > edge + 40 && inner > edge * 1.45 && inner > 80,
        side: side
      };
    });
    comps.sort(function (a, b) { return b.area - a.area; });
    if (comps.length > 16) comps = comps.slice(0, 16);
    var pool = pickSeparated(comps, canvas);
    if (pool.length < 3) pool = comps.slice(0, 8);

    var best = null;
    function consider(ordered) {
      var aspect = quadAspect(ordered);
      specs.forEach(function (candidate) {
        var candidateSpan = markerSpan(candidate);
        var score = placementScore(ordered, full.data, full.width, full.height, candidate, candidateSpan);
        if (score < 0) return;
        var aspectErr = Math.abs(aspect - candidateSpan.x / candidateSpan.y);
        /* Legal v8 is about 1.71; letter v7 is about 1.32. Prefer the closer sheet. */
        if (specs.length > 1) score += (0.55 - aspectErr) * 30;
        var contrast = (ordered.TL.inner || 0) - (ordered.TL.edge || 0);
        if (ordered.TL.notch) score += 2;
        score += Math.max(0, contrast) / 80;
        var estimated = !!(ordered.TL.estimated || ordered.TR.estimated || ordered.BL.estimated || ordered.BR.estimated);
        if (!best || score > best.score) {
          best = {
            ordered: ordered,
            score: score,
            notch: !!ordered.TL.notch,
            rotation: rotationOf(ordered),
            estimated: estimated,
            spec: candidate,
            span: candidateSpan
          };
        }
      });
    }
    eachCombo(pool, function (group) {
      var ring = ringOf(group);
      var turn;
      for (turn = 0; turn < 4; turn += 1) consider(rotateRing(ring, turn));
    });
    if (pool.length >= 3) {
      eachTrio(pool, function (trio) {
        var missing = completeParallelogram(trio);
        if (!missing) return;
        var ring = ringOf(trio.concat([missing]));
        var turn;
        for (turn = 0; turn < 4; turn += 1) consider(rotateRing(ring, turn));
      });
    }

    if (!best) {
      return {
        mode: "rejected",
        notch: false,
        upsideDown: false,
        rotation: 0,
        estimatedCorner: false,
        spec: specs[0],
        squares: comps.length,
        warning: comps.length < 4
          ? "The four black corner squares were not found, so this photo was not lined up. Keep all four in the frame, including the notched square at the sheet's top-left. Sideways and upside-down photos are fine."
          : "Dark squares were found, but they do not form this scan sheet. Retake the photo so all four corner squares are fully in the frame."
      };
    }
    if (best.estimated) {
      var refined = refineEstimated(best.ordered, full.data, full.width, full.height, best.spec);
      if (refined && refined.ordered) {
        best.ordered = refined.ordered;
        best.rotation = rotationOf(best.ordered);
      }
    }
    var topSpan = dist(best.ordered.TL, best.ordered.TR);
    if (topSpan < Math.min(canvas.width, canvas.height) * 0.22) {
      return {
        mode: "rejected",
        notch: best.notch,
        upsideDown: false,
        rotation: 0,
        estimatedCorner: false,
        spec: best.spec,
        squares: comps.length,
        warning: "The corner squares are too small in the frame. Move closer, and keep all four in the photo."
      };
    }
    var span = best.span;
    var fit = Math.max(1.15, Math.min(2.35, topSpan / span.x));
    var warning = best.estimated
      ? "One corner square was cut off. That corner was estimated from the other three. Check the bubbles near the edge of the sheet."
      : best.notch
        ? ""
        : "The white notch was faint. The lightest corner square was used as the sheet's top-left.";
    return {
      mode: "fiducial",
      notch: best.notch,
      upsideDown: best.rotation === 180,
      rotation: best.rotation,
      estimatedCorner: best.estimated,
      spec: best.spec,
      version: best.spec.version || "",
      squares: comps.length,
      warning: warning,
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
        if (luminance(image.data, (y * image.width + x) * 4) < 120) dark += 1;
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

  /* Share of the inner key that is darker than the paper. The printed digit
     covers a similar fraction on every key; a fill covers most of the disk.
     Pixels inside a handwritten score box are skipped so its outline cannot
     count as ink on a neighboring 0. */
  function keyCoverage(data, width, height, cx, cy, radius, located, boxes) {
    var inner = Math.max(1.5, radius * 0.7);
    var inner2 = inner * inner;
    var spanX = located.span.x * located.scale;
    var spanY = located.span.y * located.scale;
    var x0 = Math.max(0, Math.floor(cx - inner));
    var y0 = Math.max(0, Math.floor(cy - inner));
    var x1 = Math.min(width - 1, Math.ceil(cx + inner));
    var y1 = Math.min(height - 1, Math.ceil(cy + inner));
    var dark = 0;
    var count = 0;
    var y, x, dx, dy, nx, ny, b, box;
    for (y = y0; y <= y1; y += 1) {
      for (x = x0; x <= x1; x += 1) {
        dx = x + 0.5 - cx;
        dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > inner2) continue;
        if (boxes && boxes.length && spanX && spanY) {
          nx = (x + 0.5 - PAD) / spanX;
          ny = (y + 0.5 - PAD) / spanY;
          for (b = 0; b < boxes.length; b += 1) {
            box = boxes[b].bbox_norm;
            if (nx >= box[0] && ny >= box[1] && nx <= box[0] + box[2] && ny <= box[1] + box[3]) break;
          }
          if (b < boxes.length) continue;
        }
        count += 1;
        if (luminance(data, (y * width + x) * 4) < 150) dark += 1;
      }
    }
    return count ? dark / count : 0;
  }

  function sampleBubble(bubble, image, located, radius, boxes) {
    var p = mapPoint(located, bubble.center_norm[0], bubble.center_norm[1]);
    var sample = {
      value: bubble.value,
      lum: bubbleLum(image.data, image.width, image.height, p.x, p.y, radius)
    };
    if (boxes) sample.cover = keyCoverage(image.data, image.width, image.height, p.x, p.y, radius, located, boxes);
    return sample;
  }

  function samplePlace(place, image, located, radius, boxes) {
    return place.bubbles.map(function (bubble) {
      return sampleBubble(bubble, image, located, radius, boxes);
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

  /* Keypad digits are printed dark gray, so absolute darkness cannot separate
     a fill from the printed key. Compare coverage inside one pad. */
  function judgeCoverage(samples) {
    var ranked = samples.slice().sort(function (a, b) { return b.cover - a.cover; });
    var best = ranked[0];
    var neighbors = ranked.slice(1);
    var neighborLevel = median(neighbors.map(function (sample) { return sample.cover; }));
    var gapNext = neighbors.length ? best.cover - neighbors[0].cover : 1;
    var gapRow = neighborLevel == null ? 1 : best.cover - neighborLevel;
    var rivals = neighbors.filter(function (sample) {
      return sample.cover >= (neighborLevel || 0) + 0.22 && best.cover - sample.cover < 0.16;
    });
    if (gapRow >= 0.28 && gapNext >= 0.18 && best.cover >= 0.55 && rivals.length === 0) {
      return { status: "filled", value: best.value, lum: best.lum, cover: best.cover };
    }
    if (best.cover >= 0.55 && neighbors.some(function (sample) { return sample.cover >= 0.45; })) {
      return { status: "ambiguous", value: null, lum: best.lum, cover: best.cover };
    }
    if (gapRow < 0.18 && best.cover < 0.48) {
      return { status: "blank", value: null, lum: best.lum, cover: best.cover };
    }
    return { status: "ambiguous", value: null, lum: best.lum, cover: best.cover };
  }

  function judgeFlagCoverage(sample, baseline) {
    var base = baseline == null ? 0.24 : baseline;
    if (sample.cover >= Math.max(0.55, base + 0.28)) {
      return { status: "filled", value: 100, lum: sample.lum, cover: sample.cover };
    }
    if (sample.cover <= base + 0.14) return { status: "blank", value: 0, lum: sample.lum, cover: sample.cover };
    return { status: "ambiguous", value: null, lum: sample.lum, cover: sample.cover };
  }

  function lighterHalf(samples) {
    var lums = samples.map(function (sample) { return sample.lum; }).sort(function (a, b) { return a - b; });
    return median(lums.slice(Math.floor(lums.length / 2)));
  }

  function lighterHalfOf(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return median(sorted.slice(Math.floor(sorted.length / 2)));
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
      rotation: 0,
      estimatedCorner: false,
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

  function sharpnessOf(canvas) {
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var w = canvas.width;
    var h = canvas.height;
    if (w < 8 || h < 8) return 0;
    var data = ctx.getImageData(0, 0, w, h).data;
    function lumAt(x, y) {
      var i = (y * w + x) * 4;
      return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    }
    var step = Math.max(2, Math.round(Math.min(w, h) / 90));
    var sum = 0;
    var sum2 = 0;
    var n = 0;
    var y, x, lap;
    for (y = step; y < h - step; y += step) {
      for (x = step; x < w - step; x += step) {
        lap = lumAt(x - step, y) + lumAt(x + step, y) + lumAt(x, y - step) + lumAt(x, y + step) - 4 * lumAt(x, y);
        sum += lap;
        sum2 += lap * lap;
        n += 1;
      }
    }
    if (!n) return 0;
    var mean = sum / n;
    return sum2 / n - mean * mean;
  }

  /* Downscaled corner check for the live camera. Does not read bubbles. */
  function previewCorners(canvas, spec) {
    var specs = specsOf(spec);
    var small = limitCanvas(canvas, 640);
    var sharp = sharpnessOf(small);
    if (!specs) return { found: false, count: 0, sharpness: sharp, corners: null, width: small.width, height: small.height };
    var located = locateMarks(small, specs);
    if (located.mode !== "fiducial") {
      return {
        found: false,
        count: located.squares || 0,
        sharpness: sharp,
        corners: null,
        width: small.width,
        height: small.height
      };
    }
    return {
      found: true,
      count: 4,
      sharpness: sharp,
      corners: located.src,
      width: small.width,
      height: small.height,
      rotation: located.rotation || 0,
      notch: !!located.notch
    };
  }

  function grabBubbles(bubbles, image, located, radius, boxes) {
    return (bubbles || []).map(function (bubble) {
      return sampleBubble(bubble, image, located, radius, boxes);
    });
  }

  function judgeMark(samples, coverBaseline) {
    if (!samples.length) return { status: "blank", value: null, lum: 255, cover: 0 };
    if (samples.length === 1) return judgeFlagCoverage(samples[0], coverBaseline);
    return judgeCoverage(samples);
  }

  function shooterScore(tens, ones) {
    if (tens.status === "ambiguous" || ones.status === "ambiguous") {
      return { value: null, status: "ambiguous" };
    }
    if (ones.status !== "filled") return { value: null, status: "blank" };
    var tensValue = tens.status === "filled" ? tens.value : 0;
    return { value: tensValue * 10 + ones.value, status: "ok" };
  }

  function rosterId(tens, ones) {
    if (tens.status === "blank" && ones.status === "blank") return { value: null, status: "blank" };
    if (tens.status === "filled" && ones.status === "filled") {
      return { value: tens.value * 10 + ones.value, status: "ok" };
    }
    return { value: null, status: "ambiguous" };
  }

  function choiceOf(row) {
    if (!row || row.status !== "filled") {
      return { value: "", status: row && row.status === "ambiguous" ? "ambiguous" : "blank" };
    }
    return { value: row.value, status: "ok" };
  }

  function ellipseCoverage(data, width, height, cx, cy, rx, ry, located, boxes) {
    var irx = Math.max(1.2, rx * 0.62);
    var iry = Math.max(1.2, ry * 0.62);
    var spanX = located.span.x * located.scale;
    var spanY = located.span.y * located.scale;
    var x0 = Math.max(0, Math.floor(cx - irx));
    var y0 = Math.max(0, Math.floor(cy - iry));
    var x1 = Math.min(width - 1, Math.ceil(cx + irx));
    var y1 = Math.min(height - 1, Math.ceil(cy + iry));
    var dark = 0;
    var count = 0;
    var y, x, dx, dy, nx, ny, b, box;
    for (y = y0; y <= y1; y += 1) {
      for (x = x0; x <= x1; x += 1) {
        dx = (x + 0.5 - cx) / irx;
        dy = (y + 0.5 - cy) / iry;
        if (dx * dx + dy * dy > 1) continue;
        if (boxes && boxes.length && spanX && spanY) {
          nx = (x + 0.5 - PAD) / spanX;
          ny = (y + 0.5 - PAD) / spanY;
          for (b = 0; b < boxes.length; b += 1) {
            box = boxes[b].bbox_norm;
            if (nx >= box[0] && ny >= box[1] && nx <= box[0] + box[2] && ny <= box[1] + box[3]) break;
          }
          if (b < boxes.length) continue;
        }
        count += 1;
        if (luminance(data, (y * width + x) * 4) < 150) dark += 1;
      }
    }
    return count ? dark / count : 0;
  }

  /* Radii in the aligned photo. Side keys are the 40 by 21 pt HOME/AWAY
     ellipses from the generator; the spec stores their centers only. */
  function v16Radii(spec, located, kind) {
    var span = markerSpan(spec);
    var rxPt;
    var ryPt;
    if (kind === "side") {
      rxPt = 20;
      ryPt = 10.5;
    } else {
      var size = spec.bubble_size_pt[kind];
      rxPt = size.width / 2;
      ryPt = size.height / 2;
    }
    return {
      rx: rxPt * located.span.x * located.scale / span.x,
      ry: ryPt * located.span.y * located.scale / span.y
    };
  }

  function sampleGroup(bubbles, image, located, radii, boxes) {
    return (bubbles || []).map(function (bubble) {
      var p = mapPoint(located, bubble.center_norm[0], bubble.center_norm[1]);
      return {
        value: bubble.value,
        lum: bubbleLum(image.data, image.width, image.height, p.x, p.y, Math.min(radii.rx, radii.ry)),
        cover: ellipseCoverage(image.data, image.width, image.height, p.x, p.y, radii.rx, radii.ry, located, boxes)
      };
    });
  }

  function readV16(image, spec, located) {
    var warnings = [];
    if (located.warning) warnings.push(located.warning);
    var boxes = (spec.human_only && (spec.human_only.write_in_boxes || spec.human_only.score_boxes)) || [];
    var slots = ["A", "B", "C", "D", "E", "F", "G", "H"];
    var scoreR = v16Radii(spec, located, "score");
    var whoR = v16Radii(spec, located, "who");
    var idR = v16Radii(spec, located, "roster_id");
    var resultR = v16Radii(spec, located, "result");
    var sideR = v16Radii(spec, located, "side");
    var stored = { roster: {}, games: {} };
    var coverRefs = [];

    function take(bubbles, radii) {
      var samples = sampleGroup(bubbles, image, located, radii, boxes);
      if (samples.length >= 4) {
        coverRefs.push(lighterHalfOf(samples.map(function (sample) { return sample.cover; })));
      }
      return samples;
    }

    function place(field, name) {
      var found = null;
      (field.digits || []).forEach(function (digit) {
        if (digit.place === name) found = digit;
      });
      return found;
    }

    stored.side = take(spec.side_field.bubbles, sideR);
    slots.forEach(function (slot) {
      var field = spec.roster_fields["team_" + slot];
      stored.roster[slot] = {
        tens: take(place(field, "tens").bubbles, idR),
        ones: take(place(field, "ones").bubbles, idR)
      };
    });
    [1, 2, 3].forEach(function (num) {
      var shooters = [1, 2, 3, 4].map(function (shooter) {
        var key = "team_g" + num + "_s" + shooter;
        var numbers = spec.number_fields[key];
        return {
          who: take(spec.who_fields[key].bubbles, whoR),
          tens: take(place(numbers, "tens").bubbles, scoreR),
          ones: take(place(numbers, "ones").bubbles, scoreR)
        };
      });
      var team = spec.number_fields["team_g" + num + "_team"];
      stored.games[num] = {
        shooters: shooters,
        hundreds: take(place(team, "hundreds").bubbles, scoreR),
        tens: take(place(team, "tens").bubbles, scoreR),
        ones: take(place(team, "ones").bubbles, scoreR),
        result: take(spec.result_fields["game" + num + "_result"], resultR)
      };
    });
    stored.beer = take(spec.result_fields.beer_frame_result, resultR);
    stored.points = take(spec.result_fields.total_points_result, resultR);

    var coverBaseline = median(coverRefs);
    if (coverBaseline == null) coverBaseline = 0.24;
    var counts = { filled: 0, blank: 0, ambiguous: 0 };

    function marked(samples) {
      var row = judgeMark(samples, coverBaseline);
      if (row.status === "filled" || row.status === "ok") counts.filled += 1;
      else if (row.status === "ambiguous") counts.ambiguous += 1;
      else counts.blank += 1;
      return row;
    }

    var side = choiceOf(marked(stored.side));
    if (side.status === "blank") warnings.push("HOME / AWAY: no bubble filled.");
    else if (side.status === "ambiguous") warnings.push("HOME / AWAY: both bubbles look filled.");

    var roster = {};
    slots.forEach(function (slot) {
      var tens = marked(stored.roster[slot].tens);
      var ones = marked(stored.roster[slot].ones);
      roster[slot] = rosterId(tens, ones);
      if (roster[slot].status === "ambiguous") warnings.push("Roster " + slot + ": the id needs both digits, or neither.");
    });

    var games = [1, 2, 3].map(function (num, index) {
      var pack = stored.games[num];
      var shooters = pack.shooters.map(function (row, shooterIndex) {
        var who = choiceOf(marked(row.who));
        var score = shooterScore(marked(row.tens), marked(row.ones));
        var label = "Game " + num + " shooter " + (shooterIndex + 1);
        if (who.status === "blank") warnings.push(label + ": no roster letter filled.");
        else if (who.status === "ambiguous") warnings.push(label + ": more than one roster letter looks filled.");
        if (score.status === "blank") warnings.push(label + ": no score filled. Left blank, not read as 0.");
        else if (score.status === "ambiguous") warnings.push(label + ": the score is too close to call.");
        return { who: who, score: score };
      });
      var hundreds = judgeMark(pack.hundreds, coverBaseline);
      if (hundreds.status === "ambiguous") counts.ambiguous += 1;
      else counts.filled += 1;
      var team = (function () {
        var tens = marked(pack.tens);
        var ones = marked(pack.ones);
        if (hundreds.status === "ambiguous" || tens.status === "ambiguous" || ones.status === "ambiguous") {
          return { value: null, status: "ambiguous" };
        }
        if (tens.status !== "filled" || ones.status !== "filled") return { value: null, status: "blank" };
        return { value: (hundreds.status === "filled" ? 100 : 0) + tens.value * 10 + ones.value, status: "ok" };
      }());
      if (team.status === "blank") warnings.push("Game " + num + " team total: no total filled. Left blank, not read as 0.");
      else if (team.status === "ambiguous") warnings.push("Game " + num + " team total: the total is too close to call.");
      var result = choiceOf(marked(pack.result));
      if (result.status === "blank") warnings.push("Game " + num + ": WON / LOST is not marked.");
      else if (result.status === "ambiguous") warnings.push("Game " + num + ": both WON and LOST look filled.");
      var known = shooters.every(function (row) { return row.score.value != null; });
      var shooterSum = known ? shooters.reduce(function (sum, row) { return sum + row.score.value; }, 0) : null;
      var sumMismatch = shooterSum != null && team.value != null && shooterSum !== team.value;
      if (sumMismatch) {
        warnings.push("Game " + num + ": shooters add up to " + shooterSum + ", the team total reads " + team.value + ".");
      }
      return {
        label: "Game " + (index + 1),
        shooters: shooters,
        team: team,
        result: result,
        shooterSum: shooterSum,
        sumMismatch: sumMismatch
      };
    });

    var beer = choiceOf(marked(stored.beer));
    var points = choiceOf(marked(stored.points));
    if (points.status === "blank") warnings.push("Total points: WON / LOST is not marked.");
    else if (points.status === "ambiguous") warnings.push("Total points: both WON and LOST look filled.");
    if (beer.status === "ambiguous") warnings.push("Beer frame: both WON and LOST look filled.");

    var unique = [];
    warnings.forEach(function (item) {
      if (item && unique.indexOf(item) < 0) unique.push(item);
    });
    return {
      version: "v16",
      mode: "fiducial",
      notch: !!located.notch,
      upsideDown: (located.rotation || 0) === 180,
      rotation: located.rotation || 0,
      estimatedCorner: !!located.estimatedCorner,
      warnings: unique,
      side: side,
      roster: roster,
      games: games,
      beer: beer,
      points: points,
      counts: counts,
      calibration: { coverBaseline: Math.round(coverBaseline * 1000) / 1000 }
    };
  }

  function sheetUsesCoverage(spec) {
    return spec.version === "v8" || (spec.digit_layout && String(spec.digit_layout).indexOf("keypad") === 0);
  }

  function readAligned(image, spec, located) {
    if (spec.version === "v16") return readV16(image, spec, located);
    var warnings = [];
    if (located.warning) warnings.push(located.warning);
    var radius = spec.bubble_radius.pt * located.scale;
    var winnerRadius = (spec.winner_bubble_radius || spec.bubble_radius).pt * located.scale;
    var keypad = sheetUsesCoverage(spec);
    var boxes = keypad ? ((spec.human_only && spec.human_only.score_boxes) || []) : null;
    var sampled = {};
    var emptyRefs = [];
    var coverRefs = [];
    SIDES.forEach(function (side) {
      [1, 2, 3].forEach(function (game) {
        SHOOTERS.forEach(function (shooter) {
          var key = side + "_g" + game + "_s" + shooter;
          var field = spec.number_fields[key];
          sampled[key] = {};
          field.digits.forEach(function (place) {
            var samples = samplePlace(place, image, located, radius, boxes);
            sampled[key][place.place] = samples;
            if (samples.length >= 8) {
              emptyRefs.push(lighterHalf(samples));
              if (keypad) coverRefs.push(lighterHalfOf(samples.map(function (sample) { return sample.cover; })));
            }
          });
        });
        var teamKey = side + "_g" + game + "_team";
        sampled[teamKey] = {};
        spec.number_fields[teamKey].digits.forEach(function (place) {
          var samples = samplePlace(place, image, located, radius, boxes);
          sampled[teamKey][place.place] = samples;
          if (samples.length >= 8) {
            emptyRefs.push(lighterHalf(samples));
            if (keypad) coverRefs.push(lighterHalfOf(samples.map(function (sample) { return sample.cover; })));
          }
        });
      });
    });
    var winnerSamples = {};
    Object.keys(spec.winner_fields).forEach(function (key) {
      winnerSamples[key] = spec.winner_fields[key].map(function (bubble) {
        return sampleBubble(bubble, image, located, winnerRadius, boxes);
      });
    });
    var emptyLevel = median(emptyRefs);
    if (emptyLevel == null) emptyLevel = 210;
    var coverBaseline = median(coverRefs);
    if (coverBaseline == null) coverBaseline = 0.24;

    var counts = { filled: 0, blank: 0, ambiguous: 0 };
    function track(row) {
      if (row.status === "filled" || row.status === "ok") counts.filled += 1;
      else if (row.status === "ambiguous") counts.ambiguous += 1;
      else counts.blank += 1;
    }
    function judged(samples) {
      var row;
      if (samples.length && samples[0].cover != null) {
        row = samples.length === 1 ? judgeFlagCoverage(samples[0], coverBaseline) : judgeCoverage(samples);
      } else {
        row = samples.length === 1 ? judgeFlag(samples[0], emptyLevel) : judgeRow(samples, emptyLevel);
      }
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
              warnings.push(label + ": no " + (keypad ? "key" : "bubble") + " filled. Left blank, not read as 0.");
            } else {
              warnings.push(label + ": more than one " + (keypad ? "key" : "bubble") + " looks filled, or the mark is too light to call.");
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
          warnings.push(placeLabel(side, game, "team", "hundreds") + ": the 100 mark is too light to call.");
        }
        ["tens", "ones"].forEach(function (place) {
          if (teamDigits[place].status === "filled") return;
          var label = placeLabel(side, game, "team", place);
          if (teamDigits[place].status === "blank") {
            warnings.push(label + ": no " + (keypad ? "key" : "bubble") + " filled. Left blank, not read as 0.");
          } else {
            warnings.push(label + ": more than one " + (keypad ? "key" : "bubble") + " looks filled, or the mark is too light to call.");
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
      var row = winnerSamples[key][0] && winnerSamples[key][0].cover != null
        ? judgeCoverage(winnerSamples[key])
        : judgeRow(winnerSamples[key], emptyLevel);
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
      upsideDown: (located.rotation || 0) === 180,
      rotation: located.rotation || 0,
      estimatedCorner: !!located.estimatedCorner,
      warnings: unique,
      teams: teams,
      winners: winners,
      homeGamesWon: won.home,
      awayGamesWon: won.away,
      counts: counts,
      calibration: {
        emptyLevel: Math.round(emptyLevel),
        coverBaseline: keypad ? Math.round(coverBaseline * 1000) / 1000 : null
      }
    };
    if (trace) result.trace = trace;
    return result;
  }

  function specsOf(spec) {
    var list = Array.isArray(spec) ? spec : [spec];
    var i;
    if (!list.length) return null;
    for (i = 0; i < list.length; i += 1) {
      if (!list[i] || !list[i].fiducials) return null;
      if (list[i].version === "v16") {
        if (!list[i].number_fields || !list[i].roster_fields || !list[i].who_fields || !list[i].side_field || !list[i].result_fields) return null;
      } else if (!list[i].number_fields) return null;
    }
    return list;
  }

  function readSheet(sourceCanvas, spec, onProgress) {
    var specs = specsOf(spec);
    if (!specs) {
      return Promise.reject(new Error("The scan sheet layout is missing."));
    }
    say(onProgress, "Looking for the corner squares…");
    var canvas = limitCanvas(sourceCanvas, 1700);
    return nextFrame().then(function () {
      var located = locateMarks(canvas, specs);
      var chosen = located.spec || specs[0];
      if (located.mode !== "fiducial") {
        var note = located.warning || "Retake the photo so all four black corner squares are in the frame. Lay the sheet flat, and keep every corner visible.";
        return rejected(chosen, canvas, located, [note]);
      }
      var turning = located.rotation === 180
        ? "Turning the upside-down photo upright…"
        : (located.rotation === 90 || located.rotation === 270)
          ? "Turning the sideways photo upright…"
          : "Straightening the photo…";
      say(onProgress, turning);
      return warp(canvas, located).then(function (aligned) {
        var image = aligned.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, aligned.width, aligned.height);
        if (!cornersAreMarks(image, located)) {
          return rejected(chosen, canvas, located, [
            "Retake the photo so all four black corner squares are in the frame. Lay the sheet flat, and keep every corner visible."
          ]);
        }
        say(onProgress, "Reading the bubbles…");
        return nextFrame().then(function () {
          var result = readAligned(image, chosen, located);
          result.previewUrl = previewUrl(aligned);
          return result;
        });
      });
    });
  }

  function jpegOrientation(buffer) {
    var view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return 1;
    var offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      var marker = view.getUint8(offset + 1);
      var size = view.getUint16(offset + 2);
      if (marker === 0xE1 && size >= 14) {
        var start = offset + 4;
        if (view.getUint32(start) === 0x45786966) {
          var tiff = start + 6;
          var little = view.getUint16(tiff) === 0x4949;
          var get16 = function (at) { return view.getUint16(at, little); };
          var get32 = function (at) { return view.getUint32(at, little); };
          if (get16(tiff + 2) === 42) {
            var ifd = tiff + get32(tiff + 4);
            if (ifd + 2 < view.byteLength) {
              var count = get16(ifd);
              var entry, i;
              for (i = 0; i < count; i += 1) {
                entry = ifd + 2 + i * 12;
                if (entry + 10 > view.byteLength) break;
                if (get16(entry) === 0x0112) return get16(entry + 8);
              }
            }
          }
        }
      }
      if (marker === 0xDA || marker === 0xD9) break;
      if (!size) break;
      offset += 2 + size;
    }
    return 1;
  }

  function drawBitmap(bitmap, orientation, maxDim) {
    var swap = orientation > 4 && orientation < 9;
    var rawW = swap ? bitmap.height : bitmap.width;
    var rawH = swap ? bitmap.width : bitmap.height;
    var scale = Math.min(1, maxDim / Math.max(rawW, rawH));
    var canvas = root.document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rawW * scale));
    canvas.height = Math.max(1, Math.round(rawH * scale));
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.save();
    ctx.scale(scale, scale);
    if (orientation === 2) ctx.transform(-1, 0, 0, 1, rawW, 0);
    else if (orientation === 3) ctx.transform(-1, 0, 0, -1, rawW, rawH);
    else if (orientation === 4) ctx.transform(1, 0, 0, -1, 0, rawH);
    else if (orientation === 5) ctx.transform(0, 1, 1, 0, 0, 0);
    else if (orientation === 6) ctx.transform(0, 1, -1, 0, rawW, 0);
    else if (orientation === 7) ctx.transform(0, -1, -1, 0, rawW, rawH);
    else if (orientation === 8) ctx.transform(0, -1, 1, 0, 0, rawH);
    ctx.drawImage(bitmap, 0, 0);
    ctx.restore();
    if (bitmap.close) bitmap.close();
    return canvas;
  }

  function jpegSize(buffer) {
    var view = new DataView(buffer);
    if (view.byteLength < 10 || view.getUint16(0) !== 0xFFD8) return null;
    var offset = 2;
    var marker, size;
    while (offset + 9 < view.byteLength) {
      if (view.getUint8(offset) !== 0xFF) break;
      marker = view.getUint8(offset + 1);
      size = view.getUint16(offset + 2);
      if (marker >= 0xC0 && marker <= 0xC2) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (marker === 0xDA || marker === 0xD9) break;
      if (!size) break;
      offset += 2 + size;
    }
    return null;
  }

  function loadImageFile(file) {
    /* Phone JPEGs are often 12 megapixels. Draw them through an Image element
       onto a canvas whose long side is at most 1600, so a 4096px bitmap limit
       never has to hold the full photo. EXIF orientation is applied here when
       the browser has not already turned the pixels. */
    var maxDim = 1600;
    var bytes = file && file.arrayBuffer ? file.arrayBuffer() : Promise.resolve(null);
    return bytes.then(function (buffer) {
      var orientation = buffer ? jpegOrientation(buffer) : 1;
      var stored = buffer ? jpegSize(buffer) : null;
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            if (!w || !h) throw new Error("This photo could not be opened. Use a JPEG that shows the whole sheet.");
            var needsSwap = orientation > 4 && orientation < 9;
            var alreadyTurned = !!(stored && needsSwap && w === stored.height && h === stored.width);
            URL.revokeObjectURL(url);
            resolve(drawBitmap(img, alreadyTurned ? 1 : orientation, maxDim));
          } catch (err) {
            URL.revokeObjectURL(url);
            reject(err instanceof Error ? err : new Error("This photo could not be opened."));
          }
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          reject(new Error("This photo could not be opened. Use a JPEG that shows the whole sheet."));
        };
        img.src = url;
      });
    });
  }

  root.RAD_OCR = {
    readSheet: readSheet,
    loadImageFile: loadImageFile,
    previewCorners: previewCorners
  };
})(typeof window !== "undefined" ? window : globalThis);
