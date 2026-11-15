/* THE BRASS VESSEL — sigils.js
 * Procedural, deterministic seals "in the manner of" 17th-century grimoire
 * engraving. These are ORIGINAL generative emblems; they are not copies of
 * the historical Goetic seals.
 *
 * Plain script, no dependencies. Defines window.Sigil:
 *   Sigil.spirit(n, name, rank, opts)  -> SVG string
 *   Sigil.personal(text, opts)         -> SVG string
 *   Sigil.circle(opts)                 -> SVG string (wide: 800x620 viewBox)
 *   Sigil.rankGlyph(rank, opts)        -> SVG string (24px)
 *   Sigil.draw(el, svgString, {duration, glow}) -> Promise
 *   Sigil.reduce(text)                 -> letters used by Sigil.personal
 */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  var MONO = "ui-monospace,'SF Mono',Menlo,monospace";
  var TITLE = 'THE BRASS VESSEL · LEMEGETON · CLAVICULA SALOMONIS REGIS · ';
  var RANKS = ['king', 'duke', 'prince', 'marquis', 'president', 'earl', 'knight'];
  var uid = 0;

  /* ---------- small utilities ---------- */

  function hash(str) { // xmur3
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function prng(seed) { // mulberry32
    var a = hash(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function f(x) { var r = Math.round(x * 100) / 100; return (r === 0 ? 0 : r) + ''; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function pol(r, a) { return [r * Math.cos(a), r * Math.sin(a)]; }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }
  function norm(x, y) { var d = Math.sqrt(x * x + y * y) || 1; return [x / d, y / d]; }

  function options(o, defSize) {
    o = o || {};
    var size = +o.size > 0 ? +o.size : defSize;
    return {
      size: size,
      stroke: esc(o.stroke == null ? 'currentColor' : o.stroke),
      accent: esc(o.accent == null ? '#c9a45c' : o.accent),
      weight: +o.weight > 0 ? +o.weight : 1.4,
      label: o.label !== false
    };
  }
  function letters(s) { // -> array of 0..25
    var out = [];
    s = String(s == null ? '' : s);
    try { s = s.normalize('NFD'); } catch (e) { /* old engines */ }
    s = s.toUpperCase();
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i) - 65;
      if (c >= 0 && c < 26) out.push(c);
    }
    return out;
  }
  function rankList(rank) {
    var arr = rank == null ? [] : (Array.isArray(rank) ? rank : [rank]);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var r = String(arr[i]).toLowerCase().replace(/[^a-z]/g, '');
      if (r === 'count') r = 'earl';
      if (r === 'marquess') r = 'marquis';
      if (RANKS.indexOf(r) >= 0 && out.indexOf(r) < 0) out.push(r);
    }
    return out;
  }
  function roman(n) {
    var v = [100, 90, 50, 40, 10, 9, 5, 4, 1], s = ['C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'], o = '';
    n = Math.max(1, Math.floor(n) || 1);
    for (var i = 0; i < v.length; i++) while (n >= v[i]) { o += s[i]; n -= v[i]; }
    return o;
  }

  /* element builders (all strokes inherit from the wrapping <g>) */
  function P(d, attr) { return '<path d="' + d + '"' + (attr || '') + '/>'; }
  function C(x, y, r, attr) { return '<circle cx="' + f(x) + '" cy="' + f(y) + '" r="' + f(r) + '"' + (attr || '') + '/>'; }
  function L(x1, y1, x2, y2) { return 'M' + f(x1) + ' ' + f(y1) + 'L' + f(x2) + ' ' + f(y2); }
  function poly(pts, close) {
    var d = '';
    for (var i = 0; i < pts.length; i++) d += (i ? 'L' : 'M') + f(pts[i][0]) + ' ' + f(pts[i][1]);
    return d + (close ? 'Z' : '');
  }
  function ngon(n, r, rot, cx, cy) {
    var pts = [];
    for (var i = 0; i < n; i++) { var p = pol(r, rot + i * TAU / n); pts.push([p[0] + (cx || 0), p[1] + (cy || 0)]); }
    return pts;
  }
  function svgOpen(w, h, vbw, vbh, o, cls, title) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="sigil ' + cls + '" width="' + f(w) + '" height="' + f(h) +
      '" viewBox="0 0 ' + vbw + ' ' + vbh + '" role="img" aria-label="' + esc(title) + '">' +
      '<title>' + esc(title) + '</title>';
  }
  function gOpen(o, sw, extra) {
    return '<g fill="none" stroke="' + o.stroke + '" stroke-width="' + f(sw) +
      '" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>';
  }

  /* ---------- the hidden letter wheel ---------- */

  var WHEEL = (function () { // fixed family permutation of the alphabet
    var r = prng('brass-vessel-wheel'), a = [], i, j, t;
    for (i = 0; i < 26; i++) a.push(i);
    for (i = 25; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  })();
  var RINGS = [1, 0.66, 0.38];

  function wheelPoint(letter, k, shift, rot, R) {
    var a = (WHEEL[letter] + 0.5) / 26 * TAU + rot;
    return pol(R * RINGS[(letter + k + shift) % 3], a);
  }
  function gridPoint(letter, k, shift, R) {
    var cell = (WHEEL[letter] * 7 + shift * 5 + k * 13) % 36;
    var h = R * 0.72, col = cell % 6, row = Math.floor(cell / 6);
    return [-h + col * 2 * h / 5, -h + row * 2 * h / 5];
  }
  // centre (optionally) and scale a point set so it fills the radius R
  function fit(pts, R, centre) {
    var i, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, m = 0;
    for (i = 0; i < pts.length; i++) {
      x0 = Math.min(x0, pts[i][0]); x1 = Math.max(x1, pts[i][0]);
      y0 = Math.min(y0, pts[i][1]); y1 = Math.max(y1, pts[i][1]);
    }
    var ox = centre ? (x0 + x1) / 2 : 0, oy = (y0 + y1) / 2;
    for (i = 0; i < pts.length; i++) {
      var dx = pts[i][0] - ox, dy = pts[i][1] - oy;
      m = Math.max(m, Math.sqrt(dx * dx + dy * dy));
    }
    var k = Math.min(1.7, R / (m || 1));
    for (i = 0; i < pts.length; i++) pts[i] = [(pts[i][0] - ox) * k, (pts[i][1] - oy) * k];
    return pts;
  }
  function dedupe(pts, min) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var ok = true;
      if (out.length) {
        var q = out[out.length - 1];
        if (Math.abs(q[0] - pts[i][0]) + Math.abs(q[1] - pts[i][1]) < min) ok = false;
      }
      if (ok) out.push(pts[i]);
    }
    return out;
  }

  /* ---------- decoration vocabulary ---------- */

  var TERMS = ['ring', 'cross', 'fork', 'trident', 'crescent', 'bar', 'hook', 'arrow', 'ringcross'];

  // p = end point, d = unit direction pointing away from the line
  function terminal(type, p, d, acc) {
    var x = p[0], y = p[1], dx = d[0], dy = d[1], nx = -dy, ny = dx, s = '';
    switch (type) {
      case 'ring':
        return C(x + dx * 3.4, y + dy * 3.4, 3.4);
      case 'ringcross':
        return C(x + dx * 3, y + dy * 3, 3) +
          P(L(x + dx * 6, y + dy * 6, x + dx * 12, y + dy * 12) +
            L(x + dx * 9 + nx * 2.6, y + dy * 9 + ny * 2.6, x + dx * 9 - nx * 2.6, y + dy * 9 - ny * 2.6));
      case 'cross':
        return P(L(x, y, x + dx * 8, y + dy * 8) +
          L(x + dx * 4 + nx * 3.6, y + dy * 4 + ny * 3.6, x + dx * 4 - nx * 3.6, y + dy * 4 - ny * 3.6));
      case 'fork':
      case 'trident':
        s = L(x, y, x + dx * 6.5 + nx * 4.2, y + dy * 6.5 + ny * 4.2) +
          L(x, y, x + dx * 6.5 - nx * 4.2, y + dy * 6.5 - ny * 4.2);
        if (type === 'trident') s += L(x, y, x + dx * 8.5, y + dy * 8.5);
        return P(s);
      case 'crescent': {
        var cx = x + dx * 4.6, cy = y + dy * 4.6, r = 4.6;
        var a = [cx + nx * r * 0.94 + dx * r * 0.34, cy + ny * r * 0.94 + dy * r * 0.34];
        var b = [cx - nx * r * 0.94 + dx * r * 0.34, cy - ny * r * 0.94 + dy * r * 0.34];
        // sweep chosen so the arc passes through p (the cup opens outward)
        var cr = (a[0] - cx) * (y - cy) - (a[1] - cy) * (x - cx);
        return P('M' + f(a[0]) + ' ' + f(a[1]) + 'A' + r + ' ' + r + ' 0 1 ' + (cr > 0 ? 1 : 0) + ' ' + f(b[0]) + ' ' + f(b[1]));
      }
      case 'bar':
        return P(L(x + nx * 5, y + ny * 5, x - nx * 5, y - ny * 5));
      case 'hook':
        return P('M' + f(x) + ' ' + f(y) + 'Q' + f(x + dx * 7 + nx * 0.5) + ' ' + f(y + dy * 7 + ny * 0.5) + ' ' +
          f(x + dx * 5.5 + nx * 6) + ' ' + f(y + dy * 5.5 + ny * 6)) +
          C(x + dx * 4.4 + nx * 7.4, y + dy * 4.4 + ny * 7.4, 1.5);
      case 'arrow':
        return P(poly([[x + nx * 3.4, y + ny * 3.4], [x + dx * 7.5, y + dy * 7.5], [x - nx * 3.4, y - ny * 3.4]], true));
    }
    return '';
  }

  function vertexMark(type, p, d, acc) {
    var x = p[0], y = p[1], nx = -d[1], ny = d[0];
    switch (type) {
      case 'ring': return C(x, y, 3);
      case 'dot': return C(x, y, 1.7, ' fill="' + acc + '" stroke="none"');
      case 'bar': return P(L(x + nx * 4.6, y + ny * 4.6, x - nx * 4.6, y - ny * 4.6));
      case 'tri': return P(poly(ngon(3, 3.8, Math.atan2(d[1], d[0]), x, y), true));
      case 'ringdot': return C(x, y, 3.6) + C(x, y, 1.1, ' fill="' + acc + '" stroke="none"');
    }
    return '';
  }

  function freeGlyph(type, x, y, rot, acc) {
    var a = ' stroke="' + acc + '"', c = Math.cos(rot), s = Math.sin(rot);
    switch (type) {
      case 'cross':
        return P(L(x, y - 4.5, x, y + 4.5) + L(x - 3.2, y - 1.2, x + 3.2, y - 1.2), a);
      case 'saltire':
        return P(L(x - 3.2, y - 3.2, x + 3.2, y + 3.2) + L(x - 3.2, y + 3.2, x + 3.2, y - 3.2), a);
      case 'sun':
        return C(x, y, 3.6, a) + C(x, y, 1, ' fill="' + acc + '" stroke="none"');
      case 'moon':
        return P('M' + f(x + c * 1.5 - s * 4) + ' ' + f(y + s * 1.5 + c * 4) + 'A4.2 4.2 0 1 1 ' +
          f(x + c * 1.5 + s * 4) + ' ' + f(y + s * 1.5 - c * 4), a);
      case 'tri':
        return P(poly(ngon(3, 4.2, rot, x, y), true), a);
      case 'dots':
        return C(x, y - 2.8, 1.1, ' fill="' + acc + '" stroke="none"') +
          C(x - 2.6, y + 1.8, 1.1, ' fill="' + acc + '" stroke="none"') +
          C(x + 2.6, y + 1.8, 1.1, ' fill="' + acc + '" stroke="none"');
    }
    return '';
  }

  /* ---------- tracing a polyline as engraved strokes ---------- */

  // returns {svg, obst:[[x,y]...]}
  function trace(pts, rng, R, acc, termStart, termEnd) {
    var out = '', obst = [], segs = [], i, t;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / d, ny = dx / d;
      var curved = d > 26 && rng() < 0.3;
      var bend = curved ? (rng() < 0.5 ? -1 : 1) * d * (0.2 + rng() * 0.22) : (rng() - 0.5) * 2.6;
      var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      var far = function (bn) { var qx = mx + nx * bn / 2, qy = my + ny * bn / 2; return Math.sqrt(qx * qx + qy * qy) > R + 3; };
      if (curved && far(bend)) { bend = -bend; if (far(bend)) bend *= 0.25; }
      var c = [mx + nx * bend, my + ny * bend];
      out += P('M' + f(a[0]) + ' ' + f(a[1]) + 'Q' + f(c[0]) + ' ' + f(c[1]) + ' ' + f(b[0]) + ' ' + f(b[1]));
      segs.push({ a: a, b: b, c: c });
      for (t = 0; t <= 8; t++) {
        var u = t / 8, v = 1 - u;
        obst.push([v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]]);
      }
      // mid-stroke marks
      if (d > 32 && rng() < 0.34) {
        var m = [(a[0] + 2 * c[0] + b[0]) / 4, (a[1] + 2 * c[1] + b[1]) / 4], ux = dx / d, uy = dy / d;
        if (rng() < 0.6) {
          out += P(L(m[0] - ux * 1.7 + nx * 3.6, m[1] - uy * 1.7 + ny * 3.6, m[0] - ux * 1.7 - nx * 3.6, m[1] - uy * 1.7 - ny * 3.6) +
            L(m[0] + ux * 1.7 + nx * 3.6, m[1] + uy * 1.7 + ny * 3.6, m[0] + ux * 1.7 - nx * 3.6, m[1] + uy * 1.7 - ny * 3.6));
        } else {
          out += C(m[0], m[1], 2.6);
        }
      }
    }
    var marks = ['none', 'none', 'none', 'ring', 'ring', 'dot', 'bar', 'bar', 'tri', 'ringdot'];
    for (i = 1; i < pts.length - 1; i++) {
      var sg = segs[i - 1];
      out += vertexMark(pick(rng, marks), pts[i], norm(sg.b[0] - sg.c[0], sg.b[1] - sg.c[1]), acc);
    }
    if (segs.length) {
      var t1 = pick(rng, TERMS), t2 = pick(rng, TERMS);
      if (t2 === t1) t2 = TERMS[(TERMS.indexOf(t1) + 1 + Math.floor(rng() * 7)) % TERMS.length];
      var s0 = segs[0], s1 = segs[segs.length - 1];
      if (termStart) out += terminal(t1, s0.a, norm(s0.a[0] - s0.c[0], s0.a[1] - s0.c[1]), acc);
      if (termEnd) out += terminal(t2, s1.b, norm(s1.b[0] - s1.c[0], s1.b[1] - s1.c[1]), acc);
    }
    return { svg: out, obst: obst };
  }

  function clearance(x, y, obst) {
    var best = 1e9;
    for (var i = 0; i < obst.length; i++) {
      var dx = obst[i][0] - x, dy = obst[i][1] - y, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // Build the inner figure. mode: 0 kamea grid, 1 wheel, 2 mirrored wheel (3 = 2).
  function figure(ls, seed, mode, shift, R, acc, maxPts) {
    var rng = prng(seed), rot = (shift * 137.508 % 360) * Math.PI / 180;
    var pts = [], i, out = '', obst, res;
    var glyphs = ['cross', 'saltire', 'sun', 'moon', 'tri', 'dots'];

    if (mode >= 2) {
      var half = [];
      for (i = 0; i < ls.length && half.length < 5; i++) {
        var w = wheelPoint(ls[i], i, shift, rot, R);
        w[0] = Math.abs(w[0]); if (w[0] < 9) w[0] = 9 + rng() * 14;
        half.push(w);
      }
      half = dedupe(half, 16);
      while (half.length < 3) half.push(pol(R * (0.35 + rng() * 0.6), -Math.PI / 2 + 0.3 + rng() * 2.5));
      var y0 = pick(rng, [-R * 0.86, R * 0.86, -R * 0.4, R * 0.4, 0]);
      if (Math.abs(half[0][1] - y0) < 8 && half[0][0] < 16) half[0][0] += 14;
      pts = fit([[0, y0]].concat(half), R, false);
      y0 = pts[0][1];
      res = trace(pts, rng, R, acc, false, true);
      out = res.svg + '<g transform="scale(-1 1)">' + res.svg + '</g>';
      obst = res.obst.slice();
      for (i = 0; i < res.obst.length; i++) obst.push([-res.obst[i][0], res.obst[i][1]]);
      // the axis vertex, drawn once
      var top = y0 <= 0 ? -1 : 1;
      var ax = pick(rng, ['ring', 'cross', 'ringcross', 'arrow', 'ring']);
      out += ax === 'ring' ? C(0, y0, 3.2) : terminal(ax, [0, y0], [0, top], acc);
      // an occasional tie-bar between a mirrored pair
      if (rng() < 0.55) {
        var j = 1 + Math.floor(rng() * (pts.length - 1)), q = pts[j];
        if (q[0] > 10) {
          out += P(L(-q[0], q[1], q[0], q[1]));
          for (i = -4; i <= 4; i++) obst.push([q[0] * i / 4, q[1]]);
        }
      }
      // free glyphs live on the axis
      for (var g = 0; g < 2; g++) {
        var best = null, bs = 0;
        for (i = 0; i <= 24; i++) {
          var yy = -R * 0.9 + i * R * 1.8 / 24, sc = clearance(0, yy, obst);
          if (sc > bs) { bs = sc; best = yy; }
        }
        if (best !== null && bs > 9.5) {
          out += freeGlyph(pick(rng, glyphs), 0, best, -Math.PI / 2, acc);
          for (i = 0; i < 6; i++) { var e = pol(5, i * TAU / 6); obst.push([e[0], best + e[1]]); }
        }
      }
      return out;
    }

    for (i = 0; i < ls.length && pts.length < maxPts; i++) {
      pts.push(mode === 0 ? gridPoint(ls[i], i, shift, R) : wheelPoint(ls[i], i, shift, rot, R));
    }
    pts = dedupe(pts, 16);
    var guard = 0;
    while (pts.length < 4 && guard++ < 20) {
      pts.push(pol(R * (0.3 + rng() * 0.7), rng() * TAU));
      pts = dedupe(pts, 16);
    }
    pts = fit(pts, R, true);
    res = trace(pts, rng, R, acc, true, true);
    out = res.svg; obst = res.obst;
    for (var k = 0; k < 2; k++) {
      var bp = null, bsc = 0;
      for (i = 0; i < 70; i++) {
        var cand = pol(R * 0.92 * Math.sqrt(rng()), rng() * TAU), s2 = clearance(cand[0], cand[1], obst);
        if (s2 > bsc) { bsc = s2; bp = cand; }
      }
      if (bp && bsc > 10.5) {
        out += freeGlyph(pick(rng, glyphs), bp[0], bp[1], rng() * TAU, acc);
        for (i = 0; i < 6; i++) { var e2 = pol(5, i * TAU / 6); obst.push([bp[0] + e2[0], bp[1] + e2[1]]); }
      }
    }
    return out;
  }

  /* ---------- rank glyphs (24-unit box) ---------- */

  var GLYPH = {
    king: function () {
      return P('M4 18.5H20M4.6 18.5L3.4 8.2L8 13L12 5.6L16 13L20.6 8.2L19.4 18.5') +
        C(3.4, 6.6, 1.2) + C(12, 4, 1.2) + C(20.6, 6.6, 1.2);
    },
    duke: function () {
      return P('M4 18.5H20M4 18.5V12M20 18.5V12M4 12Q8 16 12 12Q16 16 20 12') +
        C(4, 9.8, 1.6) + C(12, 9.8, 1.6) + C(20, 9.8, 1.6);
    },
    prince: function () {
      return P('M5 18.5H19M5 18.5Q5 11 12 11Q19 11 19 18.5M12 11V4M9.2 6.8H14.8');
    },
    marquis: function () {
      return P('M16.5 4.2A8.4 8.4 0 1 0 16.5 19.8A6.6 6.6 0 1 1 16.5 4.2Z') + C(17.2, 12, 1.1);
    },
    president: function () {
      return P('M5 5H19V19H5Z') + C(12, 12, 3.4) + P('M12 5V8.6M12 15.4V19');
    },
    earl: function () {
      return P('M4 18.5H20M6 18.5V10.4M12 18.5V8M18 18.5V10.4') +
        C(6, 8.6, 1.7) + C(12, 6.2, 1.7) + C(18, 8.6, 1.7);
    },
    knight: function () {
      return P('M12 3V21M8 16H16M12 3L9.8 6.6M12 3L14.2 6.6') + C(12, 21, 0.2);
    },
    none: function () { return C(12, 12, 6) + P('M12 6V18M6 12H18'); }
  };

  function rankGlyph(rank, opts) {
    var o = options(opts, 24), r = rankList(rank)[0] || 'none';
    return svgOpen(o.size, o.size, 24, 24, o, 'sigil-rank sigil-rank-' + r, r === 'none' ? 'Spirit' : r.charAt(0).toUpperCase() + r.slice(1)) +
      gOpen(o, o.weight * 24 / o.size) + GLYPH[r]() + '</g></svg>';
  }

  /* ---------- outer structures per rank ---------- */

  function rankFrame(r, acc) {
    var d = '', i, a, p, q;
    var A = ' stroke="' + acc + '"';
    switch (r) {
      case 'king': // crown of notches
        for (i = 0; i < 16; i++) {
          a = -Math.PI / 2 + i * TAU / 16;
          var b0 = pol(90.4, a - 0.075), tp = pol(i % 2 ? 95 : 98, a), b1 = pol(90.4, a + 0.075);
          d += 'M' + f(b0[0]) + ' ' + f(b0[1]) + 'L' + f(tp[0]) + ' ' + f(tp[1]) + 'L' + f(b1[0]) + ' ' + f(b1[1]);
        }
        return C(0, 0, 90.4) + P(d, A);
      case 'duke': // a second inner circle
        return C(0, 0, 67.5) + C(0, 0, 65.4, A + ' stroke-opacity="0.75"');
      case 'prince': // beads on the rim
        for (i = 0; i < 8; i++) { p = pol(92.4, Math.PI / 8 + i * TAU / 8); d += C(p[0], p[1], 3.2, A); }
        return d;
      case 'marquis': // graduated ticks
        for (i = 0; i < 48; i++) {
          a = i * TAU / 48; p = pol(89.6, a); q = pol(i % 4 ? 92.6 : 96.4, a);
          d += L(p[0], p[1], q[0], q[1]);
        }
        return P(d, A);
      case 'president': // octagon set inside the ring
        return P(poly(ngon(8, 72, Math.PI / 8), true)) ;
      case 'earl': // scalloped rim
        for (i = 0; i < 32; i++) {
          p = pol(88, i * TAU / 32); q = pol(88, (i + 1) * TAU / 32);
          d += (i ? '' : 'M' + f(p[0]) + ' ' + f(p[1])) + 'A10 10 0 0 1 ' + f(q[0]) + ' ' + f(q[1]);
        }
        return P(d, A);
      case 'knight': // spear point and three studs
        return P('M-5 -88.6L0 -98.4L5 -88.6', A) + C(0, 93.4, 2.4, A) + C(-80.9, 46.7, 2.4, A) + C(80.9, 46.7, 2.4, A);
    }
    return '';
  }

  /* ---------- Sigil.spirit ---------- */

  function spirit(n, name, rank, opts) {
    var o = options(opts, 240);
    n = Math.max(1, Math.floor(+n) || 1);
    name = String(name == null || name === '' ? 'Spirit ' + n : name);
    var ranks = rankList(rank), r1 = ranks[0] || 'none', r2 = ranks[1];
    var sw = o.weight * 200 / o.size;
    var id = 'sgl' + (++uid) + '-' + n;
    var ls = letters(name).slice(0, 5);
    ls.push((n * 7 + 3) % 26, (n * 11 + 5) % 26); // the number signs the figure
    var R = r1 === 'duke' ? 50 : 56;

    var s = svgOpen(o.size, o.size, 200, 200, o, 'sigil-spirit sigil-' + r1, 'Seal of ' + name);
    var up = name.toUpperCase();
    if (o.label) {
      s += '<defs><path id="' + id + 't" d="M23.5 100A76.5 76.5 0 0 1 176.5 100"/>' +
        '<path id="' + id + 'b" d="M16.2 100A83.8 83.8 0 0 0 183.8 100"/></defs>';
    }
    s += gOpen(o, sw, ' transform="translate(100 100)"');
    s += C(0, 0, 88) + C(0, 0, 72);
    s += rankFrame(r1, o.accent);
    // band marks at the two sides
    if (r2) {
      var gs = 0.4, gw = ' stroke="' + o.accent + '" stroke-width="' + f(sw / gs * 0.85) + '"';
      s += '<g transform="translate(' + f(-80 - 12 * gs) + ' ' + f(-12 * gs) + ') scale(' + gs + ')"' + gw + '>' + GLYPH[r2]() + '</g>';
      s += '<g transform="translate(' + f(80 - 12 * gs) + ' ' + f(-12 * gs) + ') scale(' + gs + ')"' + gw + '>' + GLYPH[r2]() + '</g>';
    } else {
      s += P(L(-83.4, 0, -76.6, 0) + L(-80, -3.4, -80, 3.4) + L(76.6, 0, 83.4, 0) + L(80, -3.4, 80, 3.4));
    }
    s += figure(ls, 'spirit|' + n + '|' + up, [0, 2, 1, 3][n % 4], n, R, o.accent, 7);
    s += '</g>';
    if (o.label) {
      var len = up.length, sp = Math.max(1, Math.min(7, (196 - len * 5.4) / Math.max(1, len)));
      var T = '<text font-family="' + MONO + '" fill="' + o.stroke + '" stroke="none" text-anchor="middle" letter-spacing="';
      s += T + f(sp) + '" font-size="9"><textPath href="#' + id + 't" startOffset="50%">' + esc(up) + '</textPath></text>';
      s += T + '3" font-size="7.5" fill-opacity="0.8"><textPath href="#' + id + 'b" startOffset="50%">' +
        '· ' + roman(n) + ' ·</textPath></text>';
    }
    return s + '</svg>';
  }

  /* ---------- Sigil.personal ---------- */

  function reduce(text) {
    var ls = letters(text), out = [], seen = {};
    for (var i = 0; i < ls.length; i++) {
      var c = ls[i];
      if (c === 0 || c === 4 || c === 8 || c === 14 || c === 20) continue; // vowels
      if (seen[c]) continue;
      seen[c] = 1; out.push(c);
    }
    return out;
  }
  function reduceStr(text) {
    return reduce(text).map(function (c) { return String.fromCharCode(65 + c); }).join('');
  }

  function personal(text, opts) {
    var o = options(opts, 240);
    text = String(text == null ? '' : text);
    var red = reduce(text).slice(0, 10), ls = red.slice();
    var h = hash('personal|' + text.trim().toUpperCase()), rng = prng('pad|' + h);
    while (ls.length < 4) ls.push(Math.floor(rng() * 26));
    var sw = o.weight * 200 / o.size, i, p;
    var s = svgOpen(o.size, o.size, 200, 200, o, 'sigil-personal', 'Personal seal');
    s += gOpen(o, sw, ' transform="translate(100 100)"');
    // a seven-sided border: no spirit seal has one
    var outer = ngon(7, 93, -Math.PI / 2), inner = ngon(7, 84.5, -Math.PI / 2);
    s += P(poly(outer, true)) + P(poly(inner, true), ' stroke="' + o.accent + '"');
    for (i = 0; i < 7; i++) {
      p = pol(88.8, -Math.PI / 2 + i * TAU / 7);
      s += C(p[0], p[1], 1.5, ' fill="' + o.accent + '" stroke="none"');
    }
    s += C(0, 0, 73.4, ' stroke-opacity="0.55"');
    s += figure(ls, 'personal|' + h, h % 3 ? 2 : 1, h % 97, 50, o.accent, 8);
    s += '</g>';
    if (o.label && red.length) {
      for (i = 0; i < red.length; i++) {
        var a = -Math.PI / 2 + i * TAU / red.length;
        p = pol(66, a);
        s += '<text font-family="' + MONO + '" font-size="6.5" fill="' + o.stroke + '" fill-opacity="0.85" text-anchor="middle" ' +
          'transform="translate(' + f(100 + p[0]) + ' ' + f(100 + p[1]) + ') rotate(' + f(a * 180 / Math.PI + 90) + ')" dy="2.2">' +
          String.fromCharCode(65 + red[i]) + '</text>';
      }
    }
    return s + '</svg>';
  }

  /* ---------- Sigil.circle ---------- */

  function hexagram(cx, cy, r, rot) {
    return P(poly(ngon(3, r, rot, cx, cy), true)) + P(poly(ngon(3, r, rot + Math.PI, cx, cy), true));
  }
  function pentagram(cx, cy, r, rot) {
    var v = ngon(5, r, rot, cx, cy);
    return poly([v[0], v[2], v[4], v[1], v[3]], true);
  }

  function circle(opts) {
    var o = options(opts, 600);
    var W = 800, H = 620, cx = 310, cy = 310;
    var sw = o.weight * W / o.size;
    var id = 'sgc' + (++uid);
    var A = ' stroke="' + o.accent + '"', AF = ' fill="' + o.accent + '" stroke="none"';
    var i, a, p, d, t;

    // spirals: clockwise from the north, coiling inward
    function spiral(r0, turns, step) {
      var s = '', nseg = Math.round(turns * 360 / step);
      for (var k = 0; k <= nseg; k++) {
        var th = k * step * Math.PI / 180, q = pol(r0 - 20 * th / TAU, -Math.PI / 2 + th);
        s += (k ? 'L' : 'M') + f(cx + q[0]) + ' ' + f(cy + q[1]);
      }
      return s;
    }

    var s = svgOpen(o.size, o.size * H / W, W, H, o, 'sigil-circle', 'The circle and the triangle');
    var tri = [[628, 232], [763, 310], [628, 388]]; // clockwise; apex to the east
    function offsetEdge(a0, b0, off) {
      var u = norm(b0[0] - a0[0], b0[1] - a0[1]), nx = u[1], ny = -u[0];
      return 'M' + f(a0[0] + nx * off) + ' ' + f(a0[1] + ny * off) + 'L' + f(b0[0] + nx * off) + ' ' + f(b0[1] + ny * off);
    }
    if (o.label) {
      s += '<defs><path id="' + id + 's" d="' + spiral(270, 3, 4) + '"/>';
      for (i = 0; i < 3; i++) s += '<path id="' + id + 'e' + i + '" d="' + offsetEdge(tri[i], tri[(i + 1) % 3], 6) + '"/>';
      s += '</defs>';
    }
    s += gOpen(o, sw);

    // outer rings and the coil
    s += C(cx, cy, 291) + C(cx, cy, 284.6);
    for (t = 0; t < 4; t++) { // the coil, one turn per stroke so it draws in gracefully
      d = '';
      for (i = 0; i <= 90; i++) {
        var th = (t * 360 + i * 4) * Math.PI / 180;
        p = pol(284 - 20 * th / TAU, -Math.PI / 2 + th);
        d += (i ? 'L' : 'M') + f(cx + p[0]) + ' ' + f(cy + p[1]);
      }
      s += P(d);
    }
    s += C(cx, cy - 284, 2.6, AF) + C(cx, cy - 204, 2.6, AF);
    s += C(cx, cy, 203.4) + C(cx, cy, 197.6);

    // 72 fine ticks inside the inner ring: one for every spirit
    d = '';
    for (i = 0; i < 72; i++) {
      a = i * TAU / 72; p = pol(197.6, a); var q2 = pol(i % 6 ? 193.6 : 190, a);
      d += L(cx + p[0], cy + p[1], cx + q2[0], cy + q2[1]);
    }
    s += P(d, A);

    // four hexagrams at the quarters, pentagrams between
    for (i = 0; i < 4; i++) {
      a = -Math.PI / 2 + i * TAU / 4; p = pol(150, a);
      s += hexagram(cx + p[0], cy + p[1], 34, a);
      s += C(cx + p[0], cy + p[1], 9.5, A);
      s += P(L(cx + p[0] - 4.2, cy + p[1], cx + p[0] + 4.2, cy + p[1]) + L(cx + p[0], cy + p[1] - 4.2, cx + p[0], cy + p[1] + 4.2), A);
      p = pol(152, a + Math.PI / 4);
      s += P(pentagram(cx + p[0], cy + p[1], 17, a + Math.PI / 4 + Math.PI), A);
      s += C(cx + p[0], cy + p[1], 22, ' stroke-opacity="0.6"');
    }

    // the square in the centre
    s += C(cx, cy, 104, ' stroke-opacity="0.6"');
    s += P('M' + (cx - 66) + ' ' + (cy - 66) + 'h132v132h-132Z');
    s += P('M' + (cx - 58) + ' ' + (cy - 58) + 'h116v116h-116Z', A);
    s += P(L(cx - 66, cy - 66, cx - 58, cy - 58) + L(cx + 66, cy - 66, cx + 58, cy - 58) +
      L(cx + 66, cy + 66, cx + 58, cy + 58) + L(cx - 66, cy + 66, cx - 58, cy + 58));
    s += C(cx, cy, 46);
    for (i = 0; i < 4; i++) { // corner crosses
      p = pol(71, Math.PI / 4 + i * TAU / 4);
      s += P(L(cx + p[0] - 3.4, cy + p[1], cx + p[0] + 3.4, cy + p[1]) + L(cx + p[0], cy + p[1] - 3.4, cx + p[0], cy + p[1] + 3.4), A);
    }
    // the vessel itself, sealed
    s += P('M' + (cx - 9) + ' ' + (cy - 20) + 'h18M' + (cx - 6) + ' ' + (cy - 20) + 'v7' +
      'C' + (cx - 26) + ' ' + (cy - 6) + ' ' + (cx - 24) + ' ' + (cy + 22) + ' ' + (cx - 9) + ' ' + (cy + 26) +
      'h18C' + (cx + 24) + ' ' + (cy + 22) + ' ' + (cx + 26) + ' ' + (cy - 6) + ' ' + (cx + 6) + ' ' + (cy - 13) + 'v-7' +
      'M' + (cx - 12) + ' ' + (cy + 26) + 'h24', A);
    s += P('M' + (cx - 5) + ' ' + (cy - 20) + 'q5 -9 10 0', A);
    s += C(cx, cy + 6, 6.5, A) + P(L(cx - 3, cy + 6, cx + 3, cy + 6) + L(cx, cy + 3, cx, cy + 9), A);

    // the triangle, outside, to the east (screen right)
    s += P(poly(tri, true));
    s += P(poly([[636, 247.6], [749, 310], [636, 372.4]], true), ' stroke-opacity="0.6"');
    s += C(673, 310, 33, A) + C(673, 310, 27) + C(673, 310, 2.2, AF);
    s += P(L(600.6, 310, 622, 310), ' stroke-opacity="0.6"') + C(611, 310, 2.4, A);
    s += '</g>';

    if (o.label) {
      var rep = '';
      for (i = 0; i < 11; i++) rep += TITLE;
      var T = '<text font-family="' + MONO + '" fill="' + o.stroke + '" stroke="none" ';
      s += T + 'font-size="11" letter-spacing="2.2" fill-opacity="0.92"><textPath href="#' + id + 's">' + esc(rep) + '</textPath></text>';
      var words = ['THE', 'BRASS', 'VESSEL'];
      for (i = 0; i < 3; i++) {
        s += T + 'font-size="8.5" letter-spacing="3" text-anchor="middle" fill-opacity="0.8"><textPath href="#' + id + 'e' + i +
          '" startOffset="50%">' + words[(i + 1) % 3] + '</textPath></text>';
      }
    }
    return s + '</svg>';
  }

  /* ---------- Sigil.draw ---------- */

  function draw(el, svg, opts) {
    var done = (typeof Promise !== 'undefined') ? function (v) { return Promise.resolve(v); } : function (v) { return v; };
    if (!el || typeof el !== 'object') return done(false);
    opts = opts || {};
    var duration = +opts.duration > 0 ? +opts.duration : 2600;
    var glow = opts.glow || '#c9a45c';
    try {
      if (el.__sigilTimer) clearTimeout(el.__sigilTimer);
      el.__sigilTimer = 0;
      var token = el.__sigilToken = (el.__sigilToken || 0) + 1;
      el.innerHTML = String(svg == null ? '' : svg);
      var svgEl = el.querySelector && el.querySelector('svg');
      if (!svgEl) return done(false);
      var w = typeof window !== 'undefined' ? window : null;
      if (w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return done(true);

      var shapes = svgEl.querySelectorAll('path,circle,line,polyline,polygon,rect,ellipse');
      var texts = svgEl.querySelectorAll('text');
      var list = [], i, n = 0;
      for (i = 0; i < shapes.length; i++) {
        var sh = shapes[i];
        if (sh.closest && sh.closest('defs')) continue;
        var fill = sh.getAttribute('fill');
        if (fill && fill !== 'none') { sh.style.opacity = '0'; list.push({ el: sh, fade: true }); }
        else {
          var len = 0;
          try { len = sh.getTotalLength(); } catch (e) { len = 0; }
          if (!(len > 0)) continue;
          len = Math.ceil(len) + 1;
          sh.style.strokeDasharray = len + ' ' + len;
          sh.style.strokeDashoffset = len;
          list.push({ el: sh, fade: false });
        }
        n++;
      }
      for (i = 0; i < texts.length; i++) texts[i].style.opacity = '0';
      svgEl.getBoundingClientRect(); // commit the hidden state

      var each = Math.max(240, duration * 0.36), span = Math.max(0, duration - each);
      for (i = 0; i < list.length; i++) {
        var it = list[i], delay = n > 1 ? span * i / (n - 1) : 0;
        it.el.style.transition = (it.fade ? 'opacity ' : 'stroke-dashoffset ') + Math.round(each) + 'ms ease-in-out ' + Math.round(delay) + 'ms';
        if (it.fade) it.el.style.opacity = '1'; else it.el.style.strokeDashoffset = '0';
      }
      for (i = 0; i < texts.length; i++) {
        texts[i].style.transition = 'opacity ' + Math.round(duration * 0.45) + 'ms ease-in ' + Math.round(duration * 0.5) + 'ms';
        texts[i].style.opacity = '1';
      }

      var finish = function (resolve) {
        el.__sigilTimer = setTimeout(function () {
          if (el.__sigilToken !== token) { resolve(false); return; }
          try {
            for (var k = 0; k < list.length; k++) {
              var st = list[k].el.style;
              st.transition = ''; st.strokeDasharray = ''; st.strokeDashoffset = ''; st.opacity = '';
            }
            for (k = 0; k < texts.length; k++) { texts[k].style.transition = ''; texts[k].style.opacity = ''; }
            if (svgEl.animate) {
              svgEl.animate([
                { filter: 'drop-shadow(0 0 0px ' + glow + ')' },
                { filter: 'drop-shadow(0 0 7px ' + glow + ')' },
                { filter: 'drop-shadow(0 0 0px ' + glow + ')' }
              ], { duration: 1500, easing: 'ease-in-out' });
            }
          } catch (e) { /* cosmetic only */ }
          resolve(true);
        }, duration + 80);
      };
      if (typeof Promise !== 'undefined') return new Promise(finish);
      finish(function () {});
      return true;
    } catch (err) {
      try { el.innerHTML = String(svg == null ? '' : svg); } catch (e2) { /* nothing to do */ }
      return done(false);
    }
  }

  root.Sigil = {
    spirit: spirit,
    personal: personal,
    circle: circle,
    rankGlyph: rankGlyph,
    draw: draw,
    reduce: reduceStr,
    RANKS: ['King', 'Duke', 'Prince', 'Marquis', 'President', 'Earl', 'Knight']
  };
})(typeof window !== 'undefined' ? window : globalThis);
