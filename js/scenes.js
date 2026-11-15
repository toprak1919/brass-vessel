/* THE BRASS VESSEL — generative backdrops (Canvas 2D, no dependencies).
 *
 *   Scenes.init(canvas)             start (idempotent). Canvas is sized from its CSS box.
 *   Scenes.set(name, {fade: 3})     crossfade to crypt|library|court|storm|sea|fire|void|dawn
 *   Scenes.pulse(level)             voice loudness 0..1 (cheap: stores a target only)
 *   Scenes.flare()                  one-shot brass ring from the centre
 *   Scenes.current                  current scene name (null until first set)
 *   Scenes.names                    the eight names
 *   Scenes.stats                    {fps, ms} smoothed frame rate and draw cost per frame
 */
(function () {
  'use strict';

  var BG = '#07060a';
  var C = {
    bg: [7, 6, 10], bone: [239, 230, 214], dim: [139, 132, 150], brass: [201, 164, 92],
    ember: [217, 84, 43], blood: [142, 27, 46], uv: [143, 107, 255]
  };
  var NAMES = ['crypt', 'library', 'court', 'storm', 'sea', 'fire', 'void', 'dawn'];
  var TAU = Math.PI * 2;

  var canvas = null, ctx = null, W = 0, H = 0, U = 0, dpr = 1;
  var VH = 0, insetB = 0, avoidEl = null;   // full canvas height; strip at the bottom hidden by an opaque bar
  var raf = 0, running = false, lastNow = 0, lastDraw = 0, time = 0;
  var reduced = false;
  var live = {};            // built scene instances by name
  var cur = null, prev = null, curName = null;
  var fadeT = 0, fadeDur = 0;
  var buffer = null, bufCtx = null;
  var overlay = null, grain = null, grainPat = null, grainX = 0, grainY = 0, grainClock = 0;
  var sprites = {};
  var pulseTarget = 0, pulse = 0;
  var flares = [];
  var resizeTimer = 0;
  var stats = { fps: 0, ms: 0 };

  /* ---------- helpers ---------- */

  function col(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function mix(a, b, k) {
    return [Math.round(a[0] + (b[0] - a[0]) * k), Math.round(a[1] + (b[1] - a[1]) * k), Math.round(a[2] + (b[2] - a[2]) * k)];
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(k) { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); }
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
    return c;
  }
  /* an offscreen layer in CSS-pixel coordinates at device resolution */
  function layer(w, h) {
    var c = mk((w || W) * dpr, (h || H) * dpr), g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    return { c: c, g: g, w: w || W, h: h || H };
  }
  function free(c) { if (c) { c.width = 1; c.height = 1; } }
  function blit(g, L, x, y) { g.drawImage(L.c, x || 0, y || 0, L.w, L.h); }
  function base() {
    var L = layer();
    L.g.fillStyle = BG; L.g.fillRect(0, 0, W, H);
    return L;
  }
  function sprite(key) {
    if (sprites[key]) return sprites[key];
    var s = mk(128, 128), g = s.getContext('2d'), c = C[key];
    var gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, col(c, 1)); gr.addColorStop(0.12, col(c, 0.62));
    gr.addColorStop(0.35, col(c, 0.22)); gr.addColorStop(0.68, col(c, 0.05)); gr.addColorStop(1, col(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return (sprites[key] = s);
  }
  /* additive soft glow from a cached sprite */
  function glow(g, key, x, y, r, a) {
    if (a <= 0.003) return;
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = a > 1 ? 1 : a;
    g.drawImage(sprite(key), x - r, y - r, r * 2, r * 2);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  function line(g, x0, y0, x1, y1) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  function flamePath(g, x, y, h, w, lean) {
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - w, y - h * 0.22, x - w * 0.7 + lean * 0.4, y - h * 0.66, x + lean, y - h);
    g.bezierCurveTo(x + w * 0.7 + lean * 0.4, y - h * 0.66, x + w, y - h * 0.22, x, y);
  }
  /* a small candle flame with halo; fl = flicker 0..1-ish */
  function candleFlame(g, x, y, h, t, ph) {
    var fl = 0.84 + 0.09 * Math.sin(t * 7.3 + ph) + 0.07 * Math.sin(t * 17.9 + ph * 2.3);
    var lean = (Math.sin(t * 2.1 + ph) + 0.5 * Math.sin(t * 5.7 + ph * 1.7)) * h * 0.09;
    var p = 0.75 + 0.6 * pulse;
    glow(g, 'ember', x, y - h * 0.5, h * 13, 0.075 * fl * p);
    glow(g, 'brass', x, y - h * 0.6, h * 5.5, 0.26 * fl * p);
    var hh = h * (0.86 + 0.2 * fl);
    g.fillStyle = col(C.brass, 0.9); flamePath(g, x, y, hh, h * 0.26, lean); g.fill();
    g.fillStyle = col(C.bone, 0.85); flamePath(g, x, y - h * 0.04, hh * 0.52, h * 0.12, lean * 0.5); g.fill();
    return fl;
  }
  function candleBody(g, x, y, w, h, R) {
    g.fillStyle = col(C.bone, 0.13); g.fillRect(x - w / 2, y - h, w, h);
    g.strokeStyle = col(C.bone, 0.32); g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(x - w / 2, y); g.lineTo(x - w / 2, y - h); g.lineTo(x + w / 2, y - h); g.lineTo(x + w / 2, y); g.stroke();
    g.strokeStyle = col(C.bone, 0.2);
    for (var i = 0; i < 3; i++) { var dx = (R() - 0.5) * w * 0.8; line(g, x + dx, y - h, x + dx, y - h + 4 + R() * h * 0.4); }
    g.strokeStyle = col(C.dim, 0.5); line(g, x, y - h, x, y - h - 3);
  }

  function Motes(n, R, key) {
    this.key = key; this.m = [];
    for (var i = 0; i < n; i++) {
      this.m.push({ x: R() * W, y: R() * H, vx: (R() - 0.5) * 5, vy: -(0.8 + R() * 4), s: 0.7 + R() * 1.3, p: R() * TAU, a: 0.35 + R() * 0.65 });
    }
  }
  Motes.prototype.draw = function (g, t, dt, af) {
    var m, i, a, list = this.m;
    g.fillStyle = col(C[this.key], 1);
    for (i = 0; i < list.length; i++) {
      m = list[i];
      m.x += (m.vx + Math.sin(t * 0.31 + m.p) * 3) * dt; m.y += m.vy * dt;
      if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; }
      if (m.x < -4) m.x = W + 4; else if (m.x > W + 4) m.x = -4;
      a = m.a * (af ? af(m) : 0.22) * (0.65 + 0.35 * Math.sin(t * 0.9 + m.p));
      if (a < 0.01) continue;
      g.globalAlpha = a; g.fillRect(m.x, m.y, m.s, m.s);
    }
    g.globalAlpha = 1;
  };

  /* ---------- scenes ---------- */
  var defs = {};

  /* CRYPT — receding vault, a shaft of light, candles at the edges */
  defs.crypt = function () {
    var R = rng(11), L = base(), g = L.g, cx = W / 2, vy = H * 0.52, i, k, s;
    var gr = g.createLinearGradient(0, 0, 0, H * 0.7);
    gr.addColorStop(0, col(C.uv, 0.13)); gr.addColorStop(1, col(C.uv, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);

    function arch(hw, ys, rise) {
      g.beginPath(); g.moveTo(cx - hw, ys);
      g.quadraticCurveTo(cx - hw, ys - rise * 0.9, cx, ys - rise);
      g.quadraticCurveTo(cx + hw, ys - rise * 0.9, cx + hw, ys); g.stroke();
    }
    var bays = [];
    for (i = 0; i < 6; i++) {
      s = 1 / (1 + i * 0.52);
      bays.push({ s: s, hw: W * 0.455 * s, ys: vy - H * 0.13 * s, rise: H * 0.36 * s, fy: vy + H * 0.47 * s, pw: W * 0.034 * s });
    }
    for (i = 0; i < bays.length; i++) {
      var b = bays[i], a = 0.55 * Math.pow(b.s, 0.8) + 0.07;
      g.lineWidth = 0.7 + 0.7 * b.s;
      g.strokeStyle = col(C.dim, a);
      arch(b.hw, b.ys, b.rise);
      g.strokeStyle = col(C.dim, a * 0.6);
      arch(b.hw - b.pw * 0.5, b.ys, b.rise - b.pw * 0.55);
      arch(b.hw + b.pw * 0.5, b.ys, b.rise + b.pw * 0.5);
      for (k = -1; k <= 1; k += 2) {
        var px = cx + k * b.hw;
        g.strokeStyle = col(C.dim, a);
        line(g, px - b.pw * 0.5, b.ys, px - b.pw * 0.5, b.fy); line(g, px + b.pw * 0.5, b.ys, px + b.pw * 0.5, b.fy);
        g.strokeStyle = col(C.dim, a * 0.8);
        line(g, px - b.pw * 0.75, b.ys, px + b.pw * 0.75, b.ys); line(g, px - b.pw * 0.75, b.ys + 4 * b.s, px + b.pw * 0.75, b.ys + 4 * b.s);
        line(g, px - b.pw * 0.8, b.fy, px + b.pw * 0.8, b.fy);
        /* stone courses and shading hatch on the pillar */
        g.strokeStyle = col(C.dim, a * 0.5);
        var n = Math.round(14 * b.s) + 3;
        for (var j = 1; j < n; j++) {
          var yy = b.ys + (b.fy - b.ys) * j / n;
          line(g, px - b.pw * 0.5, yy, px + b.pw * 0.5, yy);
          var hx = px + (k < 0 ? 0.1 : -0.5) * b.pw;
          for (var q = 0; q < 3; q++) line(g, hx + q * b.pw * 0.13, yy - (b.fy - b.ys) / n * 0.8, hx + q * b.pw * 0.13, yy - 2);
        }
        if (i < bays.length - 1) {
          var nb = bays[i + 1], nx = cx + k * nb.hw;
          g.strokeStyle = col(C.dim, a * 0.55);
          line(g, px, b.fy, nx, nb.fy); line(g, px, b.ys, nx, nb.ys);
        }
      }
      /* vault ribs crossing to the next bay */
      if (i < bays.length - 1) {
        var n2 = bays[i + 1];
        g.strokeStyle = col(C.dim, a * 0.4);
        g.beginPath(); g.moveTo(cx - b.hw, b.ys); g.quadraticCurveTo(cx - b.hw * 0.5, b.ys - b.rise * 0.9, cx + n2.hw, n2.ys); g.stroke();
        g.beginPath(); g.moveTo(cx + b.hw, b.ys); g.quadraticCurveTo(cx + b.hw * 0.5, b.ys - b.rise * 0.9, cx - n2.hw, n2.ys); g.stroke();
      }
    }
    /* flagstones */
    g.lineWidth = 0.7;
    for (i = -9; i <= 9; i++) {
      g.strokeStyle = col(C.dim, 0.14);
      line(g, cx + i * W * 0.012, vy + H * 0.09, cx + i * W * 0.085, H);
    }
    /* scattered wall hatching near the edges */
    for (i = 0; i < 90; i++) {
      var ex = R() < 0.5 ? R() * W * 0.1 : W - R() * W * 0.1, ey = R() * H * 0.86, len = 5 + R() * 16;
      g.strokeStyle = col(C.dim, 0.1 + R() * 0.16);
      line(g, ex, ey, ex + len, ey - len * 0.3);
    }
    /* the shaft of light, upper left */
    var sh = { t0: W * 0.2, t1: W * 0.275, b0: W * 0.035, b1: W * 0.27 };
    for (i = 0; i < 5; i++) {
      var inset = i * 0.09;
      var lg = g.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, col(C.bone, 0.07)); lg.addColorStop(0.75, col(C.bone, 0.028)); lg.addColorStop(1, col(C.bone, 0));
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(sh.t0 + (sh.t1 - sh.t0) * inset, 0); g.lineTo(sh.t1 - (sh.t1 - sh.t0) * inset, 0);
      g.lineTo(sh.b1 - (sh.b1 - sh.b0) * inset, H); g.lineTo(sh.b0 + (sh.b1 - sh.b0) * inset, H);
      g.closePath(); g.fill();
    }
    g.strokeStyle = col(C.bone, 0.09); g.lineWidth = 0.7;
    for (i = 0; i < 9; i++) { k = (i + 0.5) / 9; line(g, sh.t0 + (sh.t1 - sh.t0) * k, 0, sh.b0 + (sh.b1 - sh.b0) * k, H * (0.55 + 0.45 * R())); }

    var candles = [[0.035, 0.975, 58], [0.072, 0.985, 34], [0.112, 0.97, 46], [0.885, 0.97, 40], [0.928, 0.985, 64], [0.967, 0.975, 30]];
    for (i = 0; i < candles.length; i++) {
      var c = candles[i]; c.x = c[0] * W; c.y = c[1] * H; c.h = c[2] * clamp(H / 800, 0.7, 1.3); c.ph = R() * TAU;
      candleBody(g, c.x, c.y, 7, c.h, R);
    }
    g.strokeStyle = col(C.dim, 0.3); line(g, 0, H * 0.972, W * 0.15, H * 0.972); line(g, W * 0.85, H * 0.972, W, H * 0.972);

    var motes = new Motes(Math.min(90, Math.round(W * H / 16000)), R, 'bone');
    function inShaft(m) {
      var k2 = m.y / H, l = sh.t0 + (sh.b0 - sh.t0) * k2, r = sh.t1 + (sh.b1 - sh.t1) * k2;
      return (m.x > l && m.x < r) ? 0.95 * (1 - k2 * 0.5) : 0.2;
    }
    return {
      draw: function (g2, t, dt) {
        blit(g2, L);
        motes.draw(g2, t, dt, inShaft);
        for (var n = 0; n < candles.length; n++) candleFlame(g2, candles[n].x, candles[n].y - candles[n].h - 3, 15, t, candles[n].ph);
      },
      dispose: function () { free(L.c); }
    };
  };

  /* LIBRARY — towering shelves, candle to the left, a drifting scrap */
  defs.library = function () {
    var R = rng(23), L = base(), g = L.g, i;
    var lx = W * 0.065, ly = H * 0.62;
    function lit(x, y) { var d = Math.sqrt((x - lx) * (x - lx) + (y - ly) * (y - ly) * 1.3) / (W * 0.95); d = 1 - d; return d < 0 ? 0 : d * d; }
    var nb = clamp(Math.round(W / 150), 4, 14), bw = W / nb;
    var y = H * 1.03, rh = H * 0.125, row = 0;
    g.lineWidth = 0.8;
    while (y > -10) {
      var yt = y - rh, fadeUp = 0.42 + 0.58 * clamp(y / H, 0, 1);
      for (var b = 0; b < nb; b++) {
        var x0 = b * bw, x1 = x0 + bw, f0 = lit((x0 + x1) / 2, y);
        g.strokeStyle = col(mix(C.dim, C.brass, f0), (0.2 + 0.45 * f0) * fadeUp);
        line(g, x0 + 3, y, x1 - 3, y); line(g, x0 + 3, y + 3, x1 - 3, y + 3);
        var x = x0 + 7;
        while (x < x1 - 8) {
          var w = 4 + R() * 7, h = rh * (0.5 + R() * 0.38), f = lit(x, y - h / 2);
          var a = (0.13 + 0.6 * f) * fadeUp * (0.7 + R() * 0.5);
          g.strokeStyle = col(mix(C.dim, R() < 0.25 ? C.bone : C.brass, f * 0.9), a);
          var roll = R();
          if (roll < 0.06) { x += 8 + R() * 18; continue; }
          if (roll < 0.11 && x + h * 0.35 + w < x1 - 8) {
            g.beginPath(); g.moveTo(x, y - 1); g.lineTo(x + h * 0.3, y - h * 0.95); g.lineTo(x + h * 0.3 + w, y - h * 0.92); g.lineTo(x + w, y - 1); g.stroke();
            x += h * 0.3 + w + 2; continue;
          }
          if (x + w > x1 - 6) break;
          g.beginPath(); g.moveTo(x, y - 1); g.lineTo(x, y - h); g.lineTo(x + w, y - h); g.lineTo(x + w, y - 1); g.stroke();
          if (w > 6.5 && R() < 0.6) {
            g.strokeStyle = col(mix(C.dim, C.brass, f), a * 0.8);
            line(g, x + 1, y - h * 0.82, x + w - 1, y - h * 0.82); line(g, x + 1, y - h * 0.2, x + w - 1, y - h * 0.2);
            if (R() < 0.4) line(g, x + 1, y - h * 0.76, x + w - 1, y - h * 0.76);
          } else if (R() < 0.3) {
            line(g, x + w * 0.5, y - h * 0.7, x + w * 0.5, y - h * 0.3);
          }
          x += w + 0.6;
        }
      }
      y = yt; rh *= 0.94; row++;
    }
    /* uprights */
    for (i = 0; i <= nb; i++) {
      var ux = i * bw, fu = lit(ux, ly);
      var ug = g.createLinearGradient(0, 0, 0, H);
      var uc = mix(C.dim, C.brass, fu);
      ug.addColorStop(0, col(uc, 0.07)); ug.addColorStop(1, col(uc, 0.26 + 0.4 * fu));
      g.strokeStyle = ug; g.lineWidth = 1;
      line(g, ux - 3, 0, ux - 3, H); line(g, ux + 3, 0, ux + 3, H);
    }
    /* a ladder leaning on the right */
    var lx0 = W * 0.865, lx1 = W * 0.825, lt = H * 0.16;
    g.strokeStyle = col(C.dim, 0.48); g.lineWidth = 1.1;
    line(g, lx0, H, lx1, lt); line(g, lx0 + W * 0.03, H, lx1 + W * 0.026, lt);
    g.lineWidth = 0.8;
    for (i = 1; i < 17; i++) { var k = i / 17; line(g, lx0 + (lx1 - lx0) * k, H + (lt - H) * k, lx0 + W * 0.03 + (lx1 - lx0 - W * 0.004) * k, H + (lt - H) * k); }
    /* sconce and candle on the left */
    var cx = lx, cy = ly, ch = 44;
    g.strokeStyle = col(C.brass, 0.45); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, cy + 26); g.quadraticCurveTo(cx - 6, cy + 30, cx, cy + 4); g.stroke();
    g.beginPath(); g.ellipse(cx, cy + 3, 13, 3.5, 0, 0, TAU); g.stroke();
    candleBody(g, cx, cy, 7, ch, R);
    /* warm haze baked in */
    glow(g, 'brass', lx, ly - ch, W * 0.42, 0.1);
    glow(g, 'ember', lx, ly, W * 0.6, 0.05);

    var motes = new Motes(Math.min(70, Math.round(W * H / 20000)), R, 'brass');
    function moteA(m) { var d = lit(m.x, m.y); return 0.08 + 0.6 * d; }
    var scrap = null, nextScrap = 4 + Math.random() * 6;
    return {
      draw: function (g2, t, dt) {
        blit(g2, L);
        var fl = candleFlame(g2, cx, cy - ch - 3, 17, t, 1.3);
        glow(g2, 'brass', lx, ly - ch, W * 0.36, 0.05 * fl + 0.05 * pulse);
        motes.draw(g2, t, dt, moteA);
        nextScrap -= dt;
        if (!scrap && nextScrap <= 0) {
          var side = Math.random() < 0.5;
          scrap = { x: W * (side ? 0.06 + Math.random() * 0.2 : 0.74 + Math.random() * 0.2), y: -20, r: Math.random() * TAU, sp: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.8, s: 11 + Math.random() * 7, ph: Math.random() * TAU };
        }
        if (scrap) {
          scrap.y += (14 + 5 * Math.sin(t * 0.9 + scrap.ph)) * dt;
          scrap.x += Math.sin(t * 0.6 + scrap.ph) * 16 * dt;
          scrap.r += scrap.vr * dt; scrap.sp += 0.9 * dt;
          var sx = Math.cos(scrap.sp), s = scrap.s, la = 0.3 + 0.4 * lit(scrap.x, scrap.y);
          var c = Math.cos(scrap.r), sn = Math.sin(scrap.r);
          g2.setTransform(dpr * c * sx, dpr * sn * sx, -dpr * sn, dpr * c, dpr * scrap.x, dpr * scrap.y);
          g2.fillStyle = col(C.bone, la * 0.55); g2.strokeStyle = col(C.bone, la);
          g2.lineWidth = 0.8;
          g2.beginPath(); g2.moveTo(-s * 0.7, -s); g2.lineTo(s * 0.7, -s * 0.9); g2.lineTo(s * 0.62, s); g2.lineTo(-s * 0.66, s * 0.92); g2.closePath(); g2.fill(); g2.stroke();
          g2.strokeStyle = col(C.bg, 0.5);
          for (var q = -2; q <= 2; q++) line(g2, -s * 0.45, q * s * 0.3, s * 0.4, q * s * 0.3);
          g2.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (scrap.y > H + 30) { scrap = null; nextScrap = 9 + Math.random() * 14; }
        }
      },
      dispose: function () { free(L.c); }
    };
  };

  /* COURT — receding columns, banners, the legions passing below */
  defs.court = function () {
    var R = rng(37), L = base(), g = L.g, cx = W / 2, vy = H * 0.56, i, k;
    glow(g, 'brass', W * 0.04, -H * 0.05, W * 0.55, 0.17);
    glow(g, 'brass', W * 0.96, -H * 0.05, W * 0.55, 0.17);
    var bgr = g.createLinearGradient(0, H * 0.8, 0, H);
    bgr.addColorStop(0, col(C.brass, 0)); bgr.addColorStop(1, col(C.brass, 0.09));
    g.fillStyle = bgr; g.fillRect(0, H * 0.8, W, H * 0.2);

    var cols = [];
    for (i = 0; i < 8; i++) {
      var s = 1 / (1 + i * 0.62);
      cols.push({ s: s, dx: W * 0.47 * s, w: W * 0.05 * s, top: vy - H * 0.82 * s, bot: vy + H * 0.37 * s, a: 0.15 + 0.5 * Math.pow(s, 0.9) });
    }
    /* floor */
    g.lineWidth = 0.7;
    for (i = -14; i <= 14; i++) {
      g.strokeStyle = col(C.brass, 0.12);
      line(g, cx + i * W * 0.006, vy + H * 0.05, cx + i * W * 0.075, H);
    }
    for (i = 0; i < 16; i++) {
      var fs = 1 / (1 + i * 0.31), fy = vy + H * 0.37 * fs;
      g.strokeStyle = col(C.brass, 0.06 + 0.11 * fs);
      line(g, cx - W * 0.5 * fs * 1.4, fy, cx + W * 0.5 * fs * 1.4, fy);
    }
    /* far wall: arch, dais, a throne barely there */
    var e = cols[cols.length - 1], tw = e.dx * 0.8;
    g.strokeStyle = col(C.brass, 0.2); g.lineWidth = 0.7;
    g.beginPath(); g.moveTo(cx - tw, e.bot); g.lineTo(cx - tw, e.top + tw); g.arc(cx, e.top + tw, tw, Math.PI, 0); g.lineTo(cx + tw, e.bot); g.stroke();
    for (i = 0; i < 3; i++) line(g, cx - tw * (1.3 - i * 0.2), e.bot + (3 - i) * 3, cx + tw * (1.3 - i * 0.2), e.bot + (3 - i) * 3);
    g.strokeStyle = col(C.brass, 0.26);
    g.beginPath(); g.moveTo(cx - tw * 0.3, e.bot); g.lineTo(cx - tw * 0.3, e.bot - tw * 1.5); g.lineTo(cx, e.bot - tw * 1.9); g.lineTo(cx + tw * 0.3, e.bot - tw * 1.5); g.lineTo(cx + tw * 0.3, e.bot); g.stroke();

    for (i = cols.length - 1; i >= 0; i--) {
      var c = cols[i];
      for (k = -1; k <= 1; k += 2) {
        var x = cx + k * c.dx, hw = c.w / 2;
        g.fillStyle = BG; g.fillRect(x - hw, c.top, c.w, c.bot - c.top);
        g.lineWidth = 0.6 + 0.6 * c.s;
        g.strokeStyle = col(C.brass, c.a);
        line(g, x - hw, c.top, x - hw, c.bot); line(g, x + hw, c.top, x + hw, c.bot);
        g.strokeStyle = col(C.brass, c.a * 0.45);
        for (var f = 1; f < 6; f++) {
          /* fluting, denser on the shadow side */
          var fx = x - hw + c.w * (k < 0 ? Math.pow(f / 6, 0.7) : 1 - Math.pow(f / 6, 0.7));
          line(g, fx, c.top + c.w * 0.3, fx, c.bot - c.w * 0.3);
        }
        g.strokeStyle = col(C.brass, c.a);
        g.strokeRect(x - hw * 1.3, c.bot - c.w * 0.28, c.w * 1.3, c.w * 0.28);
        line(g, x - hw * 1.15, c.bot - c.w * 0.4, x + hw * 1.15, c.bot - c.w * 0.4);
        g.strokeRect(x - hw * 1.35, c.top, c.w * 1.35, c.w * 0.3);
        line(g, x - hw * 1.15, c.top + c.w * 0.42, x + hw * 1.15, c.top + c.w * 0.42);
        if (i < cols.length - 1) {
          var n = cols[i + 1], nx = cx + k * n.dx;
          g.strokeStyle = col(C.brass, c.a * 0.5);
          line(g, x, c.top, nx, n.top); line(g, x, c.top - c.w * 0.5, nx, n.top - n.w * 0.5);
        }
      }
    }
    /* banners between the nearer columns */
    var banners = [];
    for (i = 0; i < 4; i++) {
      var c0 = cols[i], c1 = cols[i + 1], sm = (c0.s + c1.s) / 2;
      for (k = -1; k <= 1; k += 2) {
        banners.push({ x: cx + k * (c0.dx + c1.dx) / 2, y: vy - H * 0.6 * sm, w: W * 0.036 * sm, h: H * 0.3 * sm, s: sm, ph: R() * TAU });
      }
    }
    /* the legions */
    var pts = [], rows = 3, per = Math.min(80, Math.round(W / 20));
    for (var r = 0; r < rows; r++) {
      for (i = 0; i < per; i++) {
        pts.push({ x: (i + R() * 0.8) / per * W, y: H * (0.918 + r * 0.026) + (R() - 0.5) * 5, v: 5 + r * 2.5 + R() * 0.6, s: 1 + r * 0.45, ph: R() * TAU, torch: R() < 0.13 });
      }
    }
    return {
      draw: function (g2, t, dt) {
        blit(g2, L);
        var n, b, p, a;
        g2.lineWidth = 0.8;
        for (n = 0; n < banners.length; n++) {
          b = banners[n];
          var sway = Math.sin(t * 0.45 + b.ph) * 5 * b.s, hw = b.w / 2;
          g2.beginPath();
          g2.moveTo(b.x - hw, b.y); g2.lineTo(b.x + hw, b.y);
          g2.quadraticCurveTo(b.x + hw + sway * 0.4, b.y + b.h * 0.5, b.x + hw + sway, b.y + b.h);
          g2.lineTo(b.x + sway, b.y + b.h * 0.86); g2.lineTo(b.x - hw + sway, b.y + b.h);
          g2.quadraticCurveTo(b.x - hw + sway * 0.4, b.y + b.h * 0.5, b.x - hw, b.y);
          g2.fillStyle = col(C.blood, 0.16 + 0.3 * b.s); g2.fill();
          g2.strokeStyle = col(C.brass, 0.12 + 0.3 * b.s); g2.stroke();
          g2.beginPath(); g2.arc(b.x + sway * 0.35, b.y + b.h * 0.36, hw * 0.5, 0, TAU); g2.stroke();
          line(g2, b.x - hw * 1.3, b.y, b.x + hw * 1.3, b.y);
        }
        g2.fillStyle = col(C.brass, 1);
        for (n = 0; n < pts.length; n++) {
          p = pts[n];
          p.x += p.v * dt; if (p.x > W + 6) p.x = -6;
          a = 0.6 + 0.3 * Math.sin(t * 2.3 + p.ph);
          var yy = p.y + Math.sin(t * 1.7 + p.ph) * 0.8;
          if (p.torch) {
            glow(g2, 'brass', p.x, yy - 3, 13 + 5 * pulse, 0.4 + 0.3 * pulse);
            g2.fillStyle = col(C.brass, 1);
            g2.globalAlpha = 0.9; g2.fillRect(p.x - 0.8, yy - 4, 1.8, 1.8);
          }
          g2.globalAlpha = a; g2.fillRect(p.x, yy, p.s, p.s * 1.6);
        }
        g2.globalAlpha = 1;
      },
      dispose: function () { free(L.c); }
    };
  };

  /* STORM — engraved cloud bands, rain, a rare soft lightning */
  defs.storm = function () {
    var R = rng(41), L = base(), g = L.g, i;
    var sg = g.createLinearGradient(0, 0, 0, H * 0.8);
    sg.addColorStop(0, col(C.uv, 0.14)); sg.addColorStop(1, col(C.uv, 0));
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    /* a low jagged horizon */
    var hy = H * 0.9, pts = [], x = -10;
    while (x < W + 30) { pts.push([x, hy + (R() - 0.5) * H * 0.035 - Math.abs(x / W - 0.5) * H * 0.07]); x += 18 + R() * 50; }
    g.beginPath(); g.moveTo(-10, H + 5);
    for (i = 0; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.lineTo(W + 30, H + 5); g.closePath(); g.fillStyle = BG; g.fill();
    g.strokeStyle = col(C.dim, 0.55); g.lineWidth = 0.9; g.stroke();
    g.strokeStyle = col(C.dim, 0.22); g.lineWidth = 0.7;
    for (i = 0; i < pts.length - 1; i++) {
      for (var q = 0; q < 4; q++) { var hx = pts[i][0] + q * 9, yy0 = pts[i][1] + 5 + q * 2; line(g, hx, yy0, hx - 14, yy0 + 30 + R() * 30); }
    }

    function tiles(seed, tw, th, scale, n) {
      var Rr = rng(seed), shapes = [], j;
      for (j = 0; j < n; j++) {
        var cw = (180 + Rr() * 380) * scale, cxx = Rr() * tw, cyy = th * (0.14 + Rr() * 0.62), puffs = [], px = -cw / 2;
        while (px < cw / 2) {
          var edge = 1 - Math.abs(px / (cw / 2)), pr = (20 + Rr() * 34) * scale * (0.55 + 0.6 * edge);
          puffs.push({ x: px, y: -edge * 24 * scale * (0.6 + Rr() * 0.8), r: pr }); px += pr * (1.1 + Rr() * 0.5);
        }
        var hat = [];
        for (var hh = 0; hh < 9; hh++) hat.push({ y: (6 + hh * 6.5) * scale, l: cw * (1.05 - hh * 0.085) * (0.8 + Rr() * 0.3), o: (Rr() - 0.5) * cw * 0.2, gap: Rr() });
        shapes.push({ x: cxx, y: cyy, puffs: puffs, hat: hat });
      }
      function render(lit) {
        var T = layer(tw, th), tg = T.g;
        for (var a = 0; a < shapes.length; a++) {
          var s = shapes[a];
          for (var off = -1; off <= 1; off++) {
            var ox = s.x + off * tw, b, p;
            tg.lineWidth = lit ? 1.3 : 0.9;
            tg.strokeStyle = lit ? col(C.bone, 0.8) : col(C.dim, 0.62);
            for (b = 0; b < s.puffs.length; b++) {
              p = s.puffs[b];
              tg.beginPath(); tg.arc(ox + p.x, s.y + p.y, p.r, Math.PI * 1.08, Math.PI * 1.92); tg.stroke();
              if (!lit) { tg.strokeStyle = col(C.dim, 0.3); tg.beginPath(); tg.arc(ox + p.x, s.y + p.y, p.r * 0.72, Math.PI * 1.2, Math.PI * 1.7); tg.stroke(); tg.strokeStyle = col(C.dim, 0.62); }
            }
            tg.lineWidth = 0.7;
            for (b = 0; b < s.hat.length; b++) {
              p = s.hat[b];
              tg.strokeStyle = lit ? col(C.uv, 0.3 * (1 - b / 9)) : col(C.dim, 0.44 * (1 - b / 11));
              var x0 = ox + p.o - p.l / 2, x1 = ox + p.o + p.l / 2, mid = x0 + (x1 - x0) * (0.3 + 0.4 * p.gap);
              tg.beginPath(); tg.moveTo(x0, s.y + p.y); tg.quadraticCurveTo((x0 + mid) / 2, s.y + p.y + 2.5, mid - 8, s.y + p.y);
              tg.moveTo(mid + 8, s.y + p.y); tg.quadraticCurveTo((x1 + mid) / 2, s.y + p.y + 2.5, x1, s.y + p.y); tg.stroke();
            }
          }
        }
        return T;
      }
      return { tw: tw, base: render(false), lit: render(true) };
    }
    var tw = Math.max(W, 900);
    var far = tiles(5, tw, H * 0.46, 0.62, Math.round(tw / 190));
    var near = tiles(9, tw, H * 0.66, 1.15, Math.round(tw / 260));

    var drops = [], nd = Math.min(150, Math.round(W * H / 9000));
    for (i = 0; i < nd; i++) drops.push({ x: R() * (W + H * 0.3), y: R() * H, l: 9 + R() * 20, v: 420 + R() * 380, far: R() < 0.5 });
    var next = 7 + Math.random() * 9, age = -1, bolt = null, bx = 0;

    function strike() {
      age = 0; bx = W * (Math.random() < 0.5 ? 0.06 + Math.random() * 0.16 : 0.78 + Math.random() * 0.16);
      bolt = []; var y = 0, xx = bx;
      while (y < H * 0.86) { bolt.push([xx, y]); y += 14 + Math.random() * 40; xx += (Math.random() - 0.5) * 46; }
      next = 14 + Math.random() * 20;
    }
    function band(g2, T, off, lit) {
      var o = off % T.tw;
      g2.drawImage(lit ? T.lit.c : T.base.c, -o, 0, T.base.w, T.base.h);
      g2.drawImage(lit ? T.lit.c : T.base.c, T.tw - o, 0, T.base.w, T.base.h);
    }
    return {
      strike: strike,
      draw: function (g2, t, dt) {
        var e = 0, n, d;
        if (!reduced) { next -= dt; if (next <= 0) strike(); }
        if (age >= 0) {
          age += dt;
          e = age < 0.14 ? smooth(age / 0.14) : Math.exp(-(age - 0.14) * 2.6);
          if (age > 2.6) { age = -1; e = 0; }
        }
        blit(g2, L);
        if (e > 0.01) glow(g2, 'uv', bx, H * 0.18, W * 0.62, 0.2 * e);
        band(g2, far, t * 5 + 300, false);
        band(g2, near, t * 12, false);
        if (e > 0.01) {
          g2.globalAlpha = e * 0.6; band(g2, far, t * 5 + 300, true);
          g2.globalAlpha = e * 0.8; band(g2, near, t * 12, true);
          g2.globalAlpha = 1;
          var be = e * e;
          if (bolt && be > 0.02) {
            g2.strokeStyle = col(C.bone, 0.55 * be); g2.lineWidth = 1.1;
            g2.beginPath(); g2.moveTo(bolt[0][0], bolt[0][1]);
            for (n = 1; n < bolt.length; n++) g2.lineTo(bolt[n][0], bolt[n][1]);
            g2.stroke();
          }
        }
        /* rain: two batched paths */
        for (var pass = 0; pass < 2; pass++) {
          g2.strokeStyle = col(pass ? C.bone : C.dim, (pass ? 0.34 : 0.3) + e * 0.15);
          g2.lineWidth = pass ? 1 : 0.8;
          g2.beginPath();
          for (n = 0; n < drops.length; n++) {
            d = drops[n]; if (d.far === !!pass) continue;
            if (!pass || true) { /* both passes update only their own drops */
              d.y += d.v * dt * (pass ? 1 : 0.7); d.x -= d.v * dt * 0.3 * (pass ? 1 : 0.7);
              if (d.y > H + 20) { d.y = -20; d.x = Math.random() * (W + H * 0.3); }
            }
            g2.moveTo(d.x, d.y); g2.lineTo(d.x - d.l * 0.3, d.y + d.l);
          }
          g2.stroke();
        }
      },
      dispose: function () { free(L.c); free(far.base.c); free(far.lit.c); free(near.base.c); free(near.lit.c); }
    };
  };

  /* SEA — woodcut swell, a low moon and its road on the water */
  defs.sea = function () {
    var R = rng(53), L = base(), g = L.g, i, hy = H * 0.56;
    var mx = W * 0.87, my = H * 0.4, mr = clamp(U * 0.052, 20, 60);
    var sg = g.createLinearGradient(0, 0, 0, hy);
    sg.addColorStop(0, col(C.uv, 0)); sg.addColorStop(1, col(C.uv, 0.1));
    g.fillStyle = sg; g.fillRect(0, 0, W, hy);
    glow(g, 'bone', mx, my, mr * 7, 0.2);
    glow(g, 'uv', mx, my, mr * 14, 0.1);
    /* engraved sky: broken horizontal strokes, denser toward the horizon */
    g.lineWidth = 0.7;
    for (i = 0; i < 46; i++) {
      var k = Math.pow(i / 45, 0.6), y = hy * k - 2, x = -R() * 200;
      while (x < W) {
        var len = 30 + R() * 190, dm = Math.sqrt((x + len / 2 - mx) * (x + len / 2 - mx) + (y - my) * (y - my));
        if (dm > mr * 1.5) { g.strokeStyle = col(C.dim, (0.07 + 0.15 * k) * (0.6 + R() * 0.6) + 0.1 * Math.max(0, 1 - dm / (mr * 6))); line(g, x, y, x + len, y); }
        x += len + 14 + R() * 90 * (1.3 - k);
      }
    }
    for (i = 0; i < 46; i++) {
      var sx = R() * W, sy = R() * hy * 0.7;
      g.fillStyle = col(C.bone, 0.15 + R() * 0.4); g.fillRect(sx, sy, 1 + R(), 1 + R());
    }
    /* the moon: a bone disc cut with shadow hatching */
    g.save();
    g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.fillStyle = col(C.bone, 0.86); g.fill(); g.clip();
    g.strokeStyle = col(C.bg, 0.5); g.lineWidth = 1;
    for (i = 0; i < 16; i++) {
      var hx = mx - mr + i * mr * 0.085;
      g.beginPath(); g.arc(hx + mr * 1.6, my + mr * 0.3, mr * 1.9, Math.PI * 0.75, Math.PI * 1.25); g.stroke();
    }
    g.fillStyle = col(C.dim, 0.3);
    g.beginPath(); g.arc(mx + mr * 0.25, my - mr * 0.3, mr * 0.2, 0, TAU); g.fill();
    g.beginPath(); g.arc(mx + mr * 0.4, my + mr * 0.25, mr * 0.13, 0, TAU); g.fill();
    g.restore();
    g.strokeStyle = col(C.bone, 0.5); g.lineWidth = 0.8;
    g.beginPath(); g.arc(mx, my, mr + 3, 0, TAU); g.stroke();
    g.fillStyle = BG; g.fillRect(0, hy, W, H - hy);
    g.strokeStyle = col(C.dim, 0.3); line(g, 0, hy, W, hy);

    var N = 30, waves = [];
    for (i = 0; i < N; i++) {
      var p = i / (N - 1);
      waves.push({ p: p, y: hy + 3 + (H - hy) * Math.pow(p, 1.65), amp: 0.8 + 9 * p, wl: TAU / (50 + 250 * p), sp: 0.22 + 0.5 * p, ph: R() * TAU, ph2: R() * TAU,
        a: 0.2 + 0.42 * p, dash: [30 + R() * 60 + p * 150, 6 + R() * 10 + p * 22], off: R() * 300 });
    }
    function wy(w, x, t) { return w.y + w.amp * Math.sin(x * w.wl + w.ph + t * w.sp) + w.amp * 0.38 * Math.sin(x * w.wl * 2.7 + w.ph2 - t * w.sp * 1.4); }
    return {
      draw: function (g2, t, dt) {
        blit(g2, L);
        glow(g2, 'bone', mx, my, mr * 5, 0.05 + 0.05 * pulse + 0.02 * Math.sin(t * 0.3));
        var n, w, x, step = 14;
        for (n = 0; n < N; n++) {
          w = waves[n];
          g2.strokeStyle = col(C.dim, w.a); g2.lineWidth = 0.7 + 0.6 * w.p;
          g2.setLineDash(w.dash); g2.lineDashOffset = w.off - t * w.sp * 9;
          g2.beginPath(); g2.moveTo(-4, wy(w, -4, t));
          for (x = step - 4; x < W + step; x += step) g2.lineTo(x, wy(w, x, t));
          g2.stroke();
        }
        g2.setLineDash([]);
        /* the moon-road */
        for (n = 0; n < N; n++) {
          w = waves[n];
          var hw = mr * (0.5 + 2.4 * w.p) * (0.62 + 0.38 * Math.sin(t * 0.7 + n * 1.9)), sh = Math.sin(t * 0.33 + n * 0.8) * mr * 0.5 * w.p;
          g2.strokeStyle = col(C.bone, 0.62 * (1 - w.p * 0.55)); g2.lineWidth = 1 + 0.8 * w.p;
          g2.beginPath(); g2.moveTo(mx + sh - hw, wy(w, mx + sh - hw, t));
          for (x = mx + sh - hw + 7; x < mx + sh + hw; x += 7) g2.lineTo(x, wy(w, x, t));
          g2.stroke();
        }
      },
      dispose: function () { free(L.c); }
    };
  };

  /* FIRE — tongues along the bottom, embers rising, shimmer */
  defs.fire = function () {
    var R = rng(67), L = base(), g = L.g, i;
    var fg = g.createLinearGradient(0, H * 0.45, 0, H);
    fg.addColorStop(0, col(C.ember, 0)); fg.addColorStop(0.7, col(C.ember, 0.14)); fg.addColorStop(1, col(C.ember, 0.36));
    g.fillStyle = fg; g.fillRect(0, H * 0.45, W, H * 0.55);
    glow(g, 'ember', 0, H, W * 0.5, 0.3); glow(g, 'ember', W, H, W * 0.5, 0.3);
    glow(g, 'blood', W * 0.5, H * 1.1, W * 0.6, 0.3);
    /* coals */
    var x = -10;
    while (x < W + 10) {
      var cw = 16 + R() * 40, ch = 6 + R() * 16, y = H - 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + cw * 0.15, y - ch); g.lineTo(x + cw * 0.6, y - ch * (0.8 + R() * 0.5)); g.lineTo(x + cw, y - ch * 0.4); g.lineTo(x + cw, y); g.closePath();
      g.fillStyle = col(C.bg, 0.8); g.fill();
      g.strokeStyle = col(R() < 0.4 ? C.brass : C.ember, 0.35 + R() * 0.35); g.lineWidth = 0.9; g.stroke();
      g.strokeStyle = col(C.ember, 0.25);
      for (i = 0; i < 3; i++) line(g, x + cw * (0.25 + i * 0.2), y - ch * 0.7, x + cw * (0.2 + i * 0.2), y - 2);
      x += cw * (0.7 + R() * 0.5);
    }
    var tongues = [], nt = clamp(Math.round(W / 62), 8, 30);
    for (i = 0; i < nt; i++) {
      var fx = (i + 0.2 + R() * 0.6) / nt, edge = Math.pow(Math.abs(fx - 0.5) * 2, 1.6);
      tongues.push({ x: fx * W, h: H * (0.07 + 0.25 * edge) * (0.7 + R() * 0.6), w: 13 + R() * 16 + edge * 12, ph: R() * TAU, sp: 0.8 + R() * 0.9 });
    }
    var embers = [], ne = Math.min(120, Math.round(W * H / 11000));
    function spawn(e, init) {
      var side = Math.random();
      e.x = W * (side < 0.6 ? (Math.random() < 0.5 ? Math.random() * 0.3 : 1 - Math.random() * 0.3) : Math.random());
      e.y = init ? Math.random() * H : H + Math.random() * 20;
      e.vy = 18 + Math.random() * 55; e.wob = 8 + Math.random() * 22; e.ph = Math.random() * TAU;
      e.s = 1.6 + Math.random() * 2.2; e.halo = Math.random() < 0.28; e.life = 0; e.max = 5 + Math.random() * 11; e.spark = Math.random() < 0.14;
      if (init) e.life = Math.random() * e.max;
    }
    for (i = 0; i < ne; i++) { var e0 = {}; spawn(e0, true); embers.push(e0); }
    var shim = [];
    for (i = 0; i < 12; i++) shim.push({ x: R() * W, ph: R() * TAU, k: 0.012 + R() * 0.012 });
    var cE = col(C.ember, 1), cB = col(C.brass, 1), cBl = col(C.blood, 1);
    return {
      draw: function (g2, t, dt) {
        blit(g2, L);
        var n, s, e, y, breathe = 0.5 + 0.5 * Math.sin(t * 0.7) * Math.sin(t * 1.9 + 1);
        glow(g2, 'ember', W * 0.5, H * 1.12, W * 0.62, 0.1 + 0.07 * breathe + 0.12 * pulse);
        /* heat shimmer: faint wavering threads */
        g2.strokeStyle = col(C.brass, 0.1); g2.lineWidth = 0.8;
        g2.beginPath();
        for (n = 0; n < shim.length; n++) {
          s = shim[n];
          g2.moveTo(s.x + 9 * Math.sin(H * 0.92 * s.k - t * 1.6 + s.ph), H * 0.92);
          for (y = H * 0.92 - 26; y > H * 0.25; y -= 26) g2.lineTo(s.x + 9 * Math.sin(y * s.k - t * 1.6 + s.ph) * (1.4 - y / H), y);
        }
        g2.stroke();
        /* engraved tongues of flame */
        for (n = 0; n < tongues.length; n++) {
          s = tongues[n];
          var hh = s.h * (0.8 + 0.14 * Math.sin(t * s.sp * 2.3 + s.ph) + 0.08 * Math.sin(t * s.sp * 5.1 + s.ph * 2) + 0.1 * pulse);
          var lean = (Math.sin(t * s.sp + s.ph) * 0.6 + Math.sin(t * s.sp * 2.7 + s.ph) * 0.3) * s.w;
          flamePath(g2, s.x, H + 2, hh, s.w, lean);
          g2.fillStyle = col(C.ember, 0.1); g2.fill();
          g2.strokeStyle = col(C.ember, 0.85); g2.lineWidth = 1.2; g2.stroke();
          flamePath(g2, s.x, H + 2, hh * 0.62, s.w * 0.55, lean * 0.6);
          g2.strokeStyle = col(C.brass, 0.7); g2.lineWidth = 1; g2.stroke();
          flamePath(g2, s.x, H + 2, hh * 0.3, s.w * 0.25, lean * 0.3);
          g2.strokeStyle = col(C.bone, 0.5); g2.stroke();
        }
        /* embers */
        g2.lineWidth = 1.2;
        for (n = 0; n < embers.length; n++) {
          e = embers[n];
          e.life += dt; e.y -= e.vy * dt;
          var vx = Math.sin(t * 0.8 + e.ph) * e.wob + Math.sin(t * 2.1 + e.ph * 3) * e.wob * 0.3;
          e.x += vx * dt;
          var k = e.life / e.max;
          if (k >= 1 || e.y < -10) { spawn(e, false); continue; }
          var a = (k < 0.1 ? k * 10 : 1 - (k - 0.1) / 0.9) * (0.55 + 0.45 * Math.sin(t * 6 + e.ph * 5));
          var c = k < 0.3 ? cB : k < 0.75 ? cE : cBl;
          g2.globalAlpha = clamp(a, 0, 1) * 0.9;
          if (e.spark) {
            g2.strokeStyle = c; g2.beginPath(); g2.moveTo(e.x, e.y); g2.lineTo(e.x - vx * 0.12, e.y + e.vy * 0.14); g2.stroke();
          } else {
            g2.fillStyle = c; g2.fillRect(e.x, e.y, e.s, e.s);
            if (e.halo && k < 0.75) { glow(g2, k < 0.3 ? 'brass' : 'ember', e.x, e.y, 9 + e.s * 2, clamp(a, 0, 1) * 0.5); g2.lineWidth = 1.2; }
          }
        }
        g2.globalAlpha = 1;
      },
      dispose: function () { free(L.c); }
    };
  };

  /* VOID — parallax stars, constellations that draw themselves, an armillary */
  defs.void = function () {
    var R = rng(79), L = base(), g = L.g, i;
    glow(g, 'uv', W * 0.1, H * 0.2, W * 0.5, 0.17);
    glow(g, 'uv', W * 0.93, H * 0.8, W * 0.45, 0.14);
    glow(g, 'blood', W * 0.85, H * 0.1, W * 0.35, 0.08);
    var stars = [], ns = Math.min(280, Math.round(W * H / 5200)), speeds = [2.2, 1.1, 0.5];
    for (i = 0; i < ns; i++) {
      var ly = i < ns * 0.24 ? 0 : i < ns * 0.58 ? 1 : 2, pick = R();
      stars.push({ x: R() * W, y: R() * H, l: ly, s: ly === 0 ? 1.5 + R() * 1.2 : ly === 1 ? 1.1 + R() * 0.8 : 0.8 + R() * 0.5,
        a: ly === 0 ? 0.7 + R() * 0.3 : ly === 1 ? 0.45 + R() * 0.4 : 0.26 + R() * 0.3, ph: R() * TAU, tw: 0.4 + R() * 1.6,
        c: pick < 0.1 ? col(C.uv, 1) : pick < 0.19 ? col(C.brass, 1) : col(C.bone, 1), cross: ly === 0 && R() < 0.22 });
    }
    var bright = stars.filter(function (s) { return s.l === 0; });
    var cons = [], nextCon = 2;
    function makeCon() {
      var tries = 0, s0;
      do { s0 = bright[(Math.random() * bright.length) | 0]; tries++; } while (tries < 16 && (Math.abs(s0.x / W - 0.5) < 0.24 || s0.x < 40 || s0.x > W - 20));
      if (Math.abs(s0.x / W - 0.5) < 0.24) return;
      var side = s0.x > W / 2;
      var chain = [s0], n = 3 + ((Math.random() * 3) | 0);
      while (chain.length <= n) {
        var last = chain[chain.length - 1], best = null, bd = 1e9;
        for (var b = 0; b < bright.length; b++) {
          var c = bright[b]; if (chain.indexOf(c) >= 0 || (c.x > W / 2) !== side || Math.abs(c.x / W - 0.5) < 0.22) continue;
          var d = Math.sqrt((c.x - last.x) * (c.x - last.x) + (c.y - last.y) * (c.y - last.y));
          if (d > 40 && d < bd) { bd = d; best = c; }
        }
        if (!best || bd > U * 0.3) break;
        chain.push(best);
      }
      if (chain.length < 3) return;
      cons.push({ s: chain, age: 0, grow: (chain.length - 1) * 1.7, hold: 7, fade: 4, uv: Math.random() < 0.4 });
    }
    var cx = W / 2, cy = H / 2, Rr = U * 0.455;
    return {
      draw: function (g2, t, dt) {
        blit(g2, L);
        var n, s, a, k;
        for (n = 0; n < stars.length; n++) {
          s = stars[n];
          s.x -= speeds[s.l] * dt; if (s.x < -3) { s.x = W + 3; s.wrap = t; }
          a = s.a * (0.72 + 0.28 * Math.sin(t * s.tw + s.ph));
          g2.globalAlpha = a; g2.fillStyle = s.c; g2.fillRect(s.x - s.s / 2, s.y - s.s / 2, s.s, s.s);
          if (s.cross) {
            g2.globalAlpha = a * 0.5; g2.strokeStyle = s.c; g2.lineWidth = 0.6;
            g2.beginPath(); g2.moveTo(s.x - 4.5, s.y); g2.lineTo(s.x + 4.5, s.y); g2.moveTo(s.x, s.y - 4.5); g2.lineTo(s.x, s.y + 4.5); g2.stroke();
          }
        }
        g2.globalAlpha = 1;
        /* constellations */
        nextCon -= dt;
        if (nextCon <= 0 && cons.length < 2) { makeCon(); nextCon = 5 + Math.random() * 7; }
        g2.lineWidth = 0.8;
        for (n = cons.length - 1; n >= 0; n--) {
          var c = cons[n]; c.age += dt;
          var total = c.grow + c.hold + c.fade, broken = false;
          for (k = 1; k < c.s.length; k++) if (Math.abs(c.s[k].x - c.s[k - 1].x) > U * 0.5) broken = true;
          if (c.age > total || broken) { cons.splice(n, 1); continue; }
          var al = c.age > c.grow + c.hold ? 1 - (c.age - c.grow - c.hold) / c.fade : 1;
          var prog = Math.min(1, c.age / c.grow) * (c.s.length - 1);
          g2.strokeStyle = col(c.uv ? C.uv : C.brass, 0.62 * al);
          g2.beginPath(); g2.moveTo(c.s[0].x, c.s[0].y);
          for (k = 1; k < c.s.length; k++) {
            var f = clamp(prog - (k - 1), 0, 1); if (f <= 0) break;
            g2.lineTo(c.s[k - 1].x + (c.s[k].x - c.s[k - 1].x) * f, c.s[k - 1].y + (c.s[k].y - c.s[k - 1].y) * f);
          }
          g2.stroke();
          for (k = 0; k < c.s.length && k <= prog + 0.01; k++) {
            g2.beginPath(); g2.arc(c.s[k].x, c.s[k].y, 3.5, 0, TAU); g2.stroke();
          }
        }
        /* armillary */
        var rot = t * 0.012;
        g2.strokeStyle = col(C.brass, 0.42); g2.lineWidth = 1;
        g2.beginPath(); g2.arc(cx, cy, Rr, 0, TAU); g2.stroke();
        g2.strokeStyle = col(C.brass, 0.22);
        g2.beginPath(); g2.arc(cx, cy, Rr * 1.035, 0, TAU); g2.stroke();
        g2.strokeStyle = col(C.brass, 0.5);
        g2.beginPath();
        for (k = 0; k < 72; k++) {
          var an = rot + k / 72 * TAU, r1 = Rr * (k % 6 === 0 ? 1.035 : 1.018), ca = Math.cos(an), sa = Math.sin(an);
          g2.moveTo(cx + ca * Rr, cy + sa * Rr); g2.lineTo(cx + ca * r1, cy + sa * r1);
        }
        g2.stroke();
        var rings = [[0.93, 0.05, 0.0, 0.42, C.brass, 0.4], [0.84, 0.037, 1.3, -0.95, C.brass, 0.3], [0.74, 0.061, 2.4, 1.9, C.uv, 0.42]];
        for (k = 0; k < rings.length; k++) {
          var rg = rings[k], rx = Rr * rg[0], ry = rx * (0.3 + 0.35 * (1 + Math.sin(t * rg[1] + rg[2]))), tilt = rg[3] + t * 0.004;
          g2.strokeStyle = col(rg[4], rg[5]);
          g2.beginPath(); g2.ellipse(cx, cy, rx, ry, tilt, 0, TAU); g2.stroke();
          var th = t * (0.06 + k * 0.025) + k * 2, px = rx * Math.cos(th), py = ry * Math.sin(th);
          var qx = cx + px * Math.cos(tilt) - py * Math.sin(tilt), qy = cy + px * Math.sin(tilt) + py * Math.cos(tilt);
          g2.fillStyle = col(rg[4], 0.8); g2.beginPath(); g2.arc(qx, qy, 2, 0, TAU); g2.fill();
          glow(g2, k === 2 ? 'uv' : 'brass', qx, qy, 12, 0.3 + 0.3 * pulse);
        }
      },
      dispose: function () { free(L.c); }
    };
  };

  /* DAWN — violet warming to brass, thin rays, the stars going out */
  defs.dawn = function () {
    var R = rng(97), L = base(), g = L.g, i, hy = H * 0.74, sx = W * 0.22;
    var ng = g.createLinearGradient(0, 0, 0, hy);
    ng.addColorStop(0, col(C.uv, 0.02)); ng.addColorStop(0.6, col(C.uv, 0.1)); ng.addColorStop(1, col(C.uv, 0.24));
    g.fillStyle = ng; g.fillRect(0, 0, W, hy);
    /* warm sky as a 1px strip, stretched */
    var strip = mk(1, 256), sg2 = strip.getContext('2d'), wg = sg2.createLinearGradient(0, 0, 0, 256);
    wg.addColorStop(0, col(C.blood, 0)); wg.addColorStop(0.35, col(C.blood, 0.1)); wg.addColorStop(0.62, col(C.blood, 0.26));
    wg.addColorStop(0.82, col(C.ember, 0.34)); wg.addColorStop(0.94, col(C.brass, 0.5)); wg.addColorStop(1, col(C.brass, 0.66));
    sg2.fillStyle = wg; sg2.fillRect(0, 0, 1, 256);
    /* land, drawn over the sun */
    var lh = H - hy + 60, Ld = layer(W, lh), lg = Ld.g, oy = 60;
    function ridge(amp, yb, seed, fillA, strokeA, hatch) {
      var Rr = rng(seed), pts = [], x = -20;
      while (x < W + 40) { pts.push([x, oy + yb + (Rr() - 0.5) * amp + Math.sin(x * 0.004 + seed) * amp * 0.8]); x += 22 + Rr() * 60; }
      lg.beginPath(); lg.moveTo(-20, lh + 5);
      for (var a = 0; a < pts.length; a++) lg.lineTo(pts[a][0], pts[a][1]);
      lg.lineTo(W + 40, lh + 5); lg.closePath();
      lg.fillStyle = BG; lg.fill();
      if (fillA) { lg.fillStyle = col(C.uv, fillA); lg.fill(); }
      lg.strokeStyle = col(C.brass, strokeA); lg.lineWidth = 0.9; lg.stroke();
      if (hatch) {
        lg.strokeStyle = col(C.dim, hatch); lg.lineWidth = 0.7;
        for (a = 0; a < pts.length - 1; a++) for (var q = 0; q < 5; q++) {
          var hx = pts[a][0] + q * (pts[a + 1][0] - pts[a][0]) / 5, hyy = pts[a][1] + (pts[a + 1][1] - pts[a][1]) * q / 5 + 4;
          line(lg, hx, hyy, hx + 10 + Rr() * 8, hyy + 16 + Rr() * 34);
        }
      }
    }
    ridge(H * 0.012, 0, 3, 0.05, 0.4, 0);
    /* a small domed house and cypresses on the right */
    var tx = W * 0.83, ty = oy + 2, ts = clamp(U * 0.012, 6, 12);
    lg.fillStyle = BG; lg.strokeStyle = col(C.brass, 0.45); lg.lineWidth = 0.8;
    lg.beginPath(); lg.moveTo(tx - ts * 1.6, ty + 4); lg.lineTo(tx - ts * 1.6, ty - ts * 1.4); lg.lineTo(tx - ts, ty - ts * 1.4);
    lg.arc(tx, ty - ts * 1.4, ts, Math.PI, 0); lg.lineTo(tx + ts * 1.6, ty - ts * 1.4); lg.lineTo(tx + ts * 1.6, ty + 4); lg.closePath(); lg.fill(); lg.stroke();
    line(lg, tx, ty - ts * 2.4, tx, ty - ts * 3);
    for (i = 0; i < 5; i++) {
      var px = tx + (i < 2 ? -ts * (3 + i * 1.5) : ts * (2.8 + (i - 2) * 1.4)), ph = ts * (2 + R() * 1.6);
      flamePath(lg, px, ty + 4, ph, ts * 0.45, 0); lg.fill(); lg.stroke();
    }
    ridge(H * 0.03, H * 0.06, 8, 0.02, 0.22, 0.13);
    ridge(H * 0.035, H * 0.15, 15, 0, 0.14, 0.1);

    var stars = [];
    for (i = 0; i < 130; i++) stars.push({ x: R() * W, y: Math.pow(R(), 1.5) * hy * 0.92, s: 0.7 + R() * 1.1, a: 0.25 + R() * 0.6, ph: R() * TAU });
    var rays = [];
    for (i = 0; i < 22; i++) rays.push({ a: -Math.PI * (0.04 + 0.92 * (i + R() * 0.7) / 22), l: (0.5 + R() * 0.7), d: [20 + R() * 80, 5 + R() * 14], ph: R() * TAU, w: R() < 0.3 ? 1.1 : 0.7 });
    var sr = clamp(U * 0.075, 30, 80), t0 = -1, cRay = col(C.brass, 1);
    return {
      enter: function () { t0 = -1; },
      draw: function (g2, t, dt) {
        if (t0 < 0) t0 = t;
        var k = reduced ? 0.7 : 0.3 + 0.66 * smooth((t - t0) / 100) + 0.03 * Math.sin(t * 0.21), n, s;
        blit(g2, L);
        g2.globalAlpha = k; g2.drawImage(strip, 0, 0, 1, 256, 0, 0, W, hy + 1); g2.globalAlpha = 1;
        var sa = Math.pow(1 - k, 1.4);
        g2.fillStyle = col(C.bone, 1);
        for (n = 0; n < stars.length; n++) {
          s = stars[n];
          g2.globalAlpha = s.a * sa * (0.7 + 0.3 * Math.sin(t * 1.1 + s.ph));
          g2.fillRect(s.x, s.y, s.s, s.s);
        }
        g2.globalAlpha = 1;
        var sy = hy + sr * (0.95 - 1.15 * k);
        glow(g2, 'brass', sx, hy, W * 0.5, (0.12 + 0.34 * k) * (1 + 0.25 * pulse));
        glow(g2, 'ember', sx, hy, W * 0.24, 0.3 * k);
        /* rays */
        for (n = 0; n < rays.length; n++) {
          s = rays[n];
          var an = s.a + 0.012 * Math.sin(t * 0.13 + s.ph), ca = Math.cos(an), sn = Math.sin(an), r0 = sr * 1.25, r1 = r0 + W * s.l * (0.45 + 0.4 * k);
          var rm = r0 + (r1 - r0) * 0.45;
          var ra = (0.1 + 0.3 * k) * (0.7 + 0.3 * Math.sin(t * 0.4 + s.ph));
          g2.strokeStyle = cRay; g2.lineWidth = s.w; g2.setLineDash(s.d);
          g2.globalAlpha = ra; line(g2, sx + ca * r0, sy + sn * r0, sx + ca * rm, sy + sn * rm);
          g2.globalAlpha = ra * 0.4; line(g2, sx + ca * rm, sy + sn * rm, sx + ca * r1, sy + sn * r1);
        }
        g2.setLineDash([]); g2.globalAlpha = 1;
        /* the sun: engraved concentric arcs */
        g2.fillStyle = col(C.brass, 0.1 + 0.25 * k); g2.beginPath(); g2.arc(sx, sy, sr, 0, TAU); g2.fill();
        g2.lineWidth = 1;
        for (n = 0; n < 5; n++) {
          g2.strokeStyle = col(n === 0 ? C.bone : C.brass, (0.75 - n * 0.12) * (0.4 + 0.6 * k));
          g2.beginPath(); g2.arc(sx, sy, sr * (1 - n * 0.17), 0, TAU); g2.stroke();
        }
        /* mist lines along the horizon */
        g2.strokeStyle = col(C.brass, 0.1 + 0.2 * k); g2.lineWidth = 0.7;
        g2.setLineDash([70, 26, 18, 40]);
        for (n = 0; n < 5; n++) { g2.lineDashOffset = n * 57 + t * (1.5 + n); line(g2, 0, hy - 5 - n * n * 3.2, W, hy - 5 - n * n * 3.2); }
        g2.setLineDash([]); g2.lineDashOffset = 0;
        blit(g2, Ld, 0, hy - oy);
      },
      dispose: function () { free(L.c); free(Ld.c); free(strip); }
    };
  };

  /* ---------- engine ---------- */

  var blank = { draw: function (g) { g.fillStyle = BG; g.fillRect(0, 0, W, H); }, dispose: function () {}, blank: true };

  function get(name) {
    if (!live[name]) live[name] = defs[name]();
    return live[name];
  }
  function disposeExcept(keep) {
    for (var k in live) if (live[k] !== keep) { live[k].dispose(); delete live[k]; }
  }
  function tidy(g) {
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.setLineDash([]); g.lineDashOffset = 0; g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function ensureBuffer() {
    if (!buffer) { buffer = mk(canvas.width, canvas.height); bufCtx = buffer.getContext('2d'); }
    if (buffer.width !== canvas.width || buffer.height !== canvas.height) { buffer.width = canvas.width; buffer.height = canvas.height; }
    bufCtx.setTransform(dpr, 0, 0, dpr, 0, 0); bufCtx.lineCap = 'round'; bufCtx.lineJoin = 'round';
  }

  function buildOverlay() {
    /* centre-column darkening + vignette, half resolution */
    var ow = Math.max(2, Math.round(W / 2)), oh = Math.max(2, Math.round(H / 2));
    overlay = mk(ow, oh);
    var g = overlay.getContext('2d'), cx = ow / 2, colW = Math.min(820, W * 0.66) / 2;
    var lg = g.createLinearGradient(cx - colW * 0.85, 0, cx + colW * 0.85, 0);
    lg.addColorStop(0, col(C.bg, 0)); lg.addColorStop(0.24, col(C.bg, 0.36)); lg.addColorStop(0.5, col(C.bg, 0.44));
    lg.addColorStop(0.76, col(C.bg, 0.36)); lg.addColorStop(1, col(C.bg, 0));
    g.fillStyle = lg; g.fillRect(0, 0, ow, oh);
    var d = Math.sqrt(ow * ow + oh * oh) / 2;
    var rg = g.createRadialGradient(cx, oh / 2, d * 0.5, cx, oh / 2, d * 1.02);
    rg.addColorStop(0, 'rgba(3,2,5,0)'); rg.addColorStop(0.6, 'rgba(3,2,5,0.15)'); rg.addColorStop(1, 'rgba(3,2,5,0.55)');
    g.fillStyle = rg; g.fillRect(0, 0, ow, oh);
  }
  function buildGrain() {
    var n = 192; grain = mk(n, n);
    var g = grain.getContext('2d'), id = g.createImageData(n, n), d = id.data, R = rng(1234);
    for (var i = 0; i < d.length; i += 4) {
      var v = R(), lightPx = v > 0.5;
      d[i] = lightPx ? 239 : 0; d[i + 1] = lightPx ? 230 : 0; d[i + 2] = lightPx ? 214 : 0;
      d[i + 3] = lightPx ? (v - 0.5) * 2 * 15 : (0.5 - v) * 2 * 38;
    }
    g.putImageData(id, 0, 0);
    grainPat = ctx.createPattern(grain, 'repeat');
  }

  function measure() {
    var r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var w = r && r.width > 1 ? r.width : window.innerWidth, h = r && r.height > 1 ? r.height : window.innerHeight;
    w = Math.max(64, Math.min(w, 8192)); h = Math.max(64, Math.min(h, 8192));
    var d = Math.min(2, window.devicePixelRatio || 1);
    /* keep the backing store sane on very large displays */
    if (w * h * d * d > 9e6) d = Math.max(1, Math.sqrt(9e6 / (w * h)));
    var ib = 0, el = avoidEl || document.getElementById('player');
    if (el && el.getBoundingClientRect) {
      var er = el.getBoundingClientRect();
      /* only a bar that sits on the bottom edge and takes less than a third of the height */
      if (er.height > 0 && er.bottom >= h - 2 && er.top > h * 0.66) ib = Math.round(h - er.top);
    }
    return { w: Math.round(w), h: Math.round(h), d: d, ib: ib };
  }
  function resize(force) {
    var m = measure();
    if (!force && m.w === W && m.h === VH && m.d === dpr && m.ib === insetB) return;
    W = m.w; VH = m.h; insetB = m.ib; H = VH - insetB; dpr = m.d; U = Math.min(W, H);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(VH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (prev && prev.snap) prev.dispose();
    prev = null; fadeT = fadeDur = 0;
    disposeExcept(null);
    if (buffer) { free(buffer); buffer = null; }
    buildOverlay();
    if (!grain) buildGrain(); else grainPat = ctx.createPattern(grain, 'repeat');
    cur = curName ? get(curName) : blank;
    if (!running) render(0);
  }
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resize(false); }, 140);
  }

  function drawScene(g, sc, dt) {
    if (insetB && !sc.snap) { g.fillStyle = BG; g.fillRect(0, H, W, insetB); }
    sc.draw(g, time, dt); tidy(g);
  }

  function drawFlares(g, dt) {
    var cx = W / 2, cy = H / 2, maxR = Math.sqrt(W * W + H * H) * 0.55;
    for (var i = flares.length - 1; i >= 0; i--) {
      var f = flares[i]; f.age += dt;
      var p = f.age / f.dur;
      if (p >= 1) { flares.splice(i, 1); continue; }
      var e = 1 - Math.pow(1 - p, 2.4), a = Math.pow(1 - p, 1.6) * f.gain;
      glow(g, 'brass', cx, cy, U * (0.2 + 0.5 * e), 0.22 * Math.pow(1 - p, 3) * f.gain);
      for (var k = 0; k < 3; k++) {
        var r = maxR * e * (1 - k * 0.11) - k * 6;
        if (r <= 1) continue;
        g.strokeStyle = col(k === 0 ? C.brass : k === 1 ? C.bone : C.brass, a * (k === 0 ? 0.7 : k === 1 ? 0.22 : 0.3));
        g.lineWidth = k === 0 ? 1.6 : 0.8;
        g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
      }
      /* engraved tick marks riding the ring */
      var rr = maxR * e;
      g.strokeStyle = col(C.brass, a * 0.5); g.lineWidth = 0.8;
      g.beginPath();
      for (k = 0; k < 72; k++) {
        var an = k / 72 * TAU + f.rot + p * 0.5, ca = Math.cos(an), sa = Math.sin(an), l = k % 6 === 0 ? 14 : 6;
        g.moveTo(cx + ca * (rr + 4), cy + sa * (rr + 4)); g.lineTo(cx + ca * (rr + 4 + l), cy + sa * (rr + 4 + l));
      }
      g.stroke();
    }
  }

  function render(dt) {
    if (!ctx) return;
    var t0 = performance.now();
    time += dt;
    /* voice level: follow the target, let the target decay if the app goes quiet */
    pulse += (pulseTarget - pulse) * Math.min(1, dt * 7);
    pulseTarget *= Math.exp(-dt * 1.6);
    if (pulse < 0.001) pulse = 0;

    tidy(ctx);
    if (prev) {
      fadeT += dt;
      var k = fadeDur > 0 ? smooth(fadeT / fadeDur) : 1;
      if (k >= 1) {
        if (prev.snap) prev.dispose();
        prev = null; disposeExcept(cur);
        drawScene(ctx, cur, dt);
      } else {
        ensureBuffer();
        drawScene(ctx, prev, dt);
        drawScene(bufCtx, cur, dt);
        ctx.globalAlpha = k; ctx.drawImage(buffer, 0, 0, W, VH); ctx.globalAlpha = 1;
      }
    } else {
      drawScene(ctx, cur || blank, dt);
    }
    ctx.drawImage(overlay, 0, 0, W, H);
    if (flares.length) { drawFlares(ctx, dt); tidy(ctx); }
    /* film grain: cached tile, shifted ~18 times a second */
    grainClock += dt;
    if (grainClock > 0.055 && !reduced) { grainClock = 0; grainX = (Math.random() * 192) | 0; grainY = (Math.random() * 192) | 0; }
    ctx.setTransform(1, 0, 0, 1, -grainX, -grainY);
    ctx.fillStyle = grainPat;
    ctx.fillRect(grainX, grainY, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var ms = performance.now() - t0;
    stats.ms += (ms - stats.ms) * 0.08;
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var real = (now - lastNow) / 1000; lastNow = now;
    if (real > 0 && real < 1) stats.fps += (1 / real - stats.fps) * 0.06;
    if (reduced) {
      /* near-static: ~6 frames a second, time running at a fifth of normal speed */
      if (now - lastDraw < 160 && !flares.length && !prev) return;
      var el = Math.min(0.25, (now - lastDraw) / 1000); lastDraw = now;
      render(prev || flares.length ? el : el * 0.2);
      return;
    }
    lastDraw = now;
    render(real < 0 ? 0 : real > 0.05 ? 0.05 : real);
  }
  function start() {
    if (running || !ctx || document.hidden) return;
    running = true; lastNow = lastDraw = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }

  /* ---------- public API ---------- */

  var Scenes = {
    current: null,
    names: NAMES.slice(),
    stats: stats,

    init: function (cv) {
      if (!cv || !cv.getContext) return Scenes;
      if (canvas === cv) return Scenes;
      if (canvas) { stop(); disposeExcept(null); prev = null; buffer = null; }
      canvas = cv; ctx = cv.getContext('2d', { alpha: false }) || cv.getContext('2d');
      if (!Scenes._bound) {
        Scenes._bound = true;
        window.addEventListener('resize', onResize);
        document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
        if (window.matchMedia) {
          var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
          reduced = mq.matches;
          var on = function (e) { reduced = e.matches; };
          if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
        }
        if (window.ResizeObserver) {
          try {
            var ro = new ResizeObserver(onResize), pl = document.getElementById('player');
            ro.observe(cv); if (pl) ro.observe(pl);
          } catch (e) {}
        }
      }
      W = H = 0;
      resize(true);
      if (curName) {
        /* a scene was chosen before init: fade it up from black */
        prev = blank; fadeT = 0; fadeDur = Scenes._pendingFade != null ? Scenes._pendingFade : 3;
        if (cur.enter) cur.enter();
      }
      render(0);
      start();
      return Scenes;
    },

    set: function (name, opts) {
      if (!defs.hasOwnProperty(name)) return false;
      var fade = opts && opts.fade != null && isFinite(+opts.fade) ? Math.max(0, +opts.fade) : 3;
      if (name === curName) return true;
      curName = name; Scenes.current = name;
      if (!ctx) { Scenes._pendingFade = fade; return true; }
      if (prev && fadeDur > 0 && fadeT < fadeDur) {
        /* mid-fade: freeze what is on screen and fade on from that */
        var snap = mk(canvas.width, canvas.height), sg = snap.getContext('2d');
        sg.setTransform(dpr, 0, 0, dpr, 0, 0);
        ensureBuffer();
        drawScene(sg, prev, 0); drawScene(bufCtx, cur, 0);
        sg.globalAlpha = smooth(fadeT / fadeDur); sg.drawImage(buffer, 0, 0, W, VH); sg.globalAlpha = 1;
        if (prev.snap) prev.dispose();
        prev = { snap: true, draw: function (g) { g.drawImage(snap, 0, 0, W, VH); }, dispose: function () { free(snap); } };
      } else {
        prev = cur || blank;
      }
      cur = get(name);
      if (cur.enter) cur.enter();
      fadeT = 0; fadeDur = fade;
      if (fade <= 0) { if (prev && prev.snap) prev.dispose(); prev = null; disposeExcept(cur); }
      if (!running || fade <= 0) render(0);
      return true;
    },

    /* keep bottom-anchored detail above an opaque bar (e.g. the player). Pass an element, or null to
       clear. If never called, an element with id "player" is used when present. */
    avoid: function (el) {
      avoidEl = el || { getBoundingClientRect: function () { return { height: 0 }; } };
      if (el && window.ResizeObserver) { try { new ResizeObserver(onResize).observe(el); } catch (e) {} }
      if (ctx) resize(false);
      return Scenes;
    },

    pulse: function (level) {
      level = +level;
      pulseTarget = level > 0 ? (level > 1 ? 1 : level) : 0;
    },

    flare: function () {
      if (flares.length >= 3) flares.shift();
      flares.push({ age: 0, dur: reduced ? 4.2 : 2.8, gain: reduced ? 0.5 : 1, rot: Math.random() * TAU });
      if (!running && ctx) render(0);
    },

    /* test hook: skip scene time forward by s seconds */
    _warp: function (s) { time += +s || 0; },

    /* test hook: render one frame by hand, advancing dt seconds */
    _step: function (dt) { if (ctx) render(Math.min(0.05, Math.max(0, +dt || 0))); },

    /* test hook: force a lightning strike if the storm is up */
    _strike: function () { if (live.storm && live.storm.strike) live.storm.strike(); }
  };

  window.Scenes = Scenes;
})();
