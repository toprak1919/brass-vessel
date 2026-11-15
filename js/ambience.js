/* THE BRASS VESSEL — generative ambience (Web Audio only, no assets).
 *
 * window.Ambience:
 *   init()                       create/resume the AudioContext (call from a user gesture). Returns ctx or null.
 *   setMood(name, {fade = 4})    crypt | library | court | storm | sea | fire | void | dawn
 *   sfx(name)                    bell | seal | threshold | choose | page | candle | depart
 *   setVolume(0..1)              ambience master (default 0.5)
 *   duck(amount 0..1, time = 0.6) lower the bed (not the sfx) while the voice speaks
 *   stop({fade = 2})             fade the bed out (context stays alive)
 *   connectVoice(audioEl)        optional: narration through warmth + small stone room + soft compressor
 *   setVoice({wet, gain})        optional: tune the voice chain (defaults wet 0.15, gain 0.9)
 *   mood, analyser, voiceAnalyser, context   (read-only properties; null before init / connectVoice)
 *
 * Graph:
 *   mood.out -> bed (duck) ----------------------> master (volume) -> limiter -> post -> analyser -> destination
 *   mood.wet -> bedWet (duck) -> hall convolver -> master
 *   sfx ------------------------------------------> master   (sfx are NOT ducked)
 *   voice <audio> -> lowshelf -> compressor -> dry + room convolver -> voiceOut -> voiceAnalyser -> destination
 */
(function () {
  'use strict';

  var MOODS = ['crypt', 'library', 'court', 'storm', 'sea', 'fire', 'void', 'dawn'];
  var SFX = ['bell', 'seal', 'threshold', 'choose', 'page', 'candle', 'depart'];

  // Per-mood output trim, set by measurement (analyser RMS at volume 0.5, unducked): about -26..-28 dBFS for the
  // sub-heavy beds (crypt, void), -29 court, -30..-33 for the noisier ones that share the speech band.
  var TRIM = { crypt: 0.1, library: 0.23, court: 0.1, storm: 1.0, sea: 0.8, fire: 0.3, void: 0.1, dawn: 0.17 };

  var ctx = null, master, bed, bedWet, sfxBus, sfxWet, limiter, post, analyser, hall;
  var buf = {};
  var volume = 0.5, duckAmt = 0;
  var moodName = null;      // requested / current mood
  var current = null;       // live Kit
  var dying = [];           // kits fading out
  var voice = null;         // shared voice chain
  var voiceCfg = { wet: 0.15, gain: 0.9 };
  var voiceEls = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var pendingVoice = [];

  function R(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp01(v) { v = +v; return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0; }
  function volGain(v) { return Math.pow(v * 2, 1.6); }   // 0.5 -> 1.0, 1.0 -> ~3.0 (+9.6 dB)

  /* ---------- generated buffers ---------- */

  // Seamlessly looping noise: the head is cross-faded with samples generated past the tail.
  function mkNoise(sec, brown) {
    var sr = ctx.sampleRate, n = Math.floor(sec * sr), x = Math.floor(0.5 * sr);
    var b = ctx.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var raw = new Float32Array(n + x), last = 0, peak = 0, i;
      for (i = 0; i < n + x; i++) {
        var w = Math.random() * 2 - 1;
        if (brown) { last = (last + 0.02 * w) / 1.02; raw[i] = last; } else raw[i] = w;
      }
      var d = b.getChannelData(ch);
      for (i = 0; i < n; i++) {
        if (i < x) { var k = i / x; d[i] = raw[i] * Math.sqrt(k) + raw[n + i] * Math.sqrt(1 - k); }
        else d[i] = raw[i];
        if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
      }
      if (brown && peak > 0) for (i = 0; i < n; i++) d[i] /= peak;
    }
    return b;
  }

  // Sparse random pops (Poisson), heavy-tailed amplitudes: fire / candle / rain patter.
  function mkCrackle(sec, perSec) {
    var sr = ctx.sampleRate, n = Math.floor(sec * sr);
    var b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), t = 0;
    for (;;) {
      t += Math.floor(-Math.log(1 - Math.random()) / perSec * sr) + 1;
      var len = Math.floor(R(0.0008, 0.007) * sr);
      if (t + len >= n) break;
      var amp = Math.pow(Math.random(), 3.2) * (Math.random() < 0.5 ? -1 : 1);
      for (var j = 0; j < len; j++) d[t + j] += amp * (Math.random() * 2 - 1) * Math.exp(-j / (len * 0.22));
    }
    return b;
  }

  // Impulse response: decaying noise that gets darker along the tail, short pre-delay.
  function mkIR(sec, tau, bright) {
    var sr = ctx.sampleRate, n = Math.floor(sec * sr), pre = Math.floor(0.012 * sr);
    var b = ctx.createBuffer(2, n, sr);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch), y = 0;
      for (var i = pre; i < n; i++) {
        var p = (i - pre) / (n - pre);
        var a = bright * (1 - p) + 0.05;                     // one-pole lowpass closes over time
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.exp(-(i - pre) / (sr * tau)) * (1 - p);
      }
    }
    return b;
  }

  /* ---------- node helpers ---------- */

  function G(v) { var g = ctx.createGain(); g.gain.value = v; return g; }
  function F(type, f, q, gain) {
    var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f;
    if (q != null) n.Q.value = q;
    if (gain != null) n.gain.value = gain;
    return n;
  }
  function chain() {
    for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  }
  function panner(p) {
    if (ctx.createStereoPanner) { var n = ctx.createStereoPanner(); n.pan.value = p; return n; }
    return G(1);
  }
  function hold(param, t) {
    var v = param.value;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
    else { param.cancelScheduledValues(t); param.setValueAtTime(v, t); }
  }
  function rampTo(param, v, sec) {
    var t = ctx.currentTime;
    hold(param, t);
    param.linearRampToValueAtTime(v, t + Math.max(0.02, sec));
  }

  /* ---------- mood kit: owns its sources and timers ---------- */

  function Kit(name) {
    this.name = name; this.alive = true; this.srcs = []; this.slots = [];
    this.out = G(0); this.wet = G(0);
    this.out.connect(bed); this.wet.connect(bedWet);
  }
  Kit.prototype.noise = function (name, rate) {
    var s = ctx.createBufferSource(); s.buffer = buf[name]; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    s.start(0, Math.random() * (s.buffer.duration - 0.1));
    this.srcs.push(s); return s;
  };
  Kit.prototype.osc = function (type, f) {
    var o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    o.start(); this.srcs.push(o); return o;
  };
  Kit.prototype.lfo = function (f, depth, param) {
    var o = this.osc('sine', f), g = G(depth); o.connect(g); g.connect(param); return o;
  };
  // Random-interval timer chain; fn(t, intervalSeconds). Skips work while the context is not running.
  Kit.prototype.every = function (min, max, fn, firstMin, firstMax) {
    var self = this, slot = { id: 0 };
    this.slots.push(slot);
    function arm(s) {
      slot.id = setTimeout(function () {
        if (!self.alive) return;
        var next = R(min, max);
        if (ctx && ctx.state === 'running') { try { fn(ctx.currentTime, next); } catch (e) { /* keep the chain alive */ } }
        arm(next);
      }, s * 1000);
    }
    arm(firstMin == null ? R(min, max) : R(firstMin, firstMax == null ? firstMin : firstMax));
  };
  // Slow random walk of a parameter: never repeats, cheap.
  Kit.prototype.wander = function (param, lo, hi, tmin, tmax) {
    this.every(tmin, tmax, function (t, s) { param.setTargetAtTime(R(lo, hi), t, s / 3); }, 0, tmin);
  };
  Kit.prototype.kill = function () {
    if (!this.alive) return;
    this.alive = false;
    this.slots.forEach(function (s) { clearTimeout(s.id); });
    this.srcs.forEach(function (s) { try { s.stop(); } catch (e) {} try { s.disconnect(); } catch (e) {} });
    try { this.out.disconnect(); } catch (e) {}
    try { this.wet.disconnect(); } catch (e) {}
    this.srcs = []; this.slots = [];
  };

  /* ---------- one-shot building blocks (used by moods and sfx) ---------- */

  // Output for a one-shot; disconnects itself after `dur` seconds. opts: {wet, pan, lp, at}
  function shot(dest, wetDest, dur, opts) {
    opts = opts || {};
    var o = G(1), p = panner(opts.pan || 0), w = null;
    if (opts.lp) chain(o, F('lowpass', opts.lp, 0.5), p); else o.connect(p);
    p.connect(dest);
    if (wetDest && opts.wet) { w = G(opts.wet); p.connect(w); w.connect(wetDest); }
    var lead = Math.max(0, (opts.at || 0) - ctx.currentTime);
    setTimeout(function () {
      try { p.disconnect(); } catch (e) {}
      try { if (w) w.disconnect(); } catch (e) {}
    }, (lead + dur + 0.5) * 1000);
    return o;
  }
  // Enveloped oscillator: attack `att`, exponential-ish decay over `dec`, optional glide to f1.
  function tone(o, t, type, f, peak, att, dec, f1, gl) {
    var os = ctx.createOscillator(), g = G(0);
    os.type = type; os.frequency.setValueAtTime(f, t);
    if (f1) os.frequency.exponentialRampToValueAtTime(f1, t + (gl || att + dec));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setTargetAtTime(0, t + att, dec / 6);
    os.connect(g); g.connect(o);
    os.start(t); os.stop(t + att + dec);
    return os;
  }
  // Enveloped noise burst through filters; pts = [[dt, level], ...] (linear segments from 0).
  function nz(o, t, name, dur, filters, pts, rate) {
    var s = ctx.createBufferSource(), g = G(0), last = s;
    s.buffer = buf[name]; s.loop = true;
    if (rate) s.playbackRate.value = rate;
    filters.forEach(function (f) { last.connect(f); last = f; });
    last.connect(g); g.connect(o);
    g.gain.setValueAtTime(0, t);
    pts.forEach(function (p) { g.gain.linearRampToValueAtTime(p[1], t + p[0]); });
    s.start(t, Math.random() * Math.max(0.1, s.buffer.duration - dur - 0.2));
    s.stop(t + dur + 0.05);
    return s;
  }

  function drip(t, dest, wet, lvl) {
    var o = shot(dest, wet, 4, { wet: 1.0, pan: R(-0.6, 0.6) });
    var f = R(850, 1500);
    tone(o, t, 'sine', f, lvl, 0.002, 0.16, f * 1.55, 0.05);
    if (Math.random() < 0.4) tone(o, t + R(0.09, 0.22), 'sine', f * 1.3, lvl * 0.45, 0.002, 0.12, f * 1.9, 0.04);
  }

  // Inharmonic bell partials: [ratio to strike note, amplitude, decay factor]
  var BELL = [[0.5, 1, 1], [1, 0.8, 0.8], [1.183, 0.5, 0.6], [1.506, 0.35, 0.45], [2, 0.45, 0.4],
    [2.514, 0.2, 0.28], [2.662, 0.18, 0.25], [3.011, 0.15, 0.2], [4.166, 0.09, 0.12], [5.433, 0.05, 0.08]];
  function bell(t, dest, wet, lvl, base, decay, n, opts) {
    var o = shot(dest, wet, decay + 1, opts);
    for (var i = 0; i < Math.min(n, BELL.length); i++) {
      var p = BELL[i];
      tone(o, t, 'sine', base * p[0] * (1 + R(-0.0015, 0.0015)), lvl * p[1], 0.004, decay * p[2]);
    }
    nz(o, t, 'white', 0.05, [F('lowpass', 1800, 0.5)], [[0.003, lvl * 0.8], [0.05, 0]]);
  }

  function page(t, dest, wet, lvl) {
    var o = shot(dest, wet, 1.2, { wet: 0.12, pan: R(-0.3, 0.3) });
    var bp = F('bandpass', 1700, 0.7);
    bp.frequency.setValueAtTime(1700, t); bp.frequency.linearRampToValueAtTime(4200, t + 0.32);
    nz(o, t, 'white', 0.44, [bp], [[0.04, lvl * 0.5], [0.11, lvl * 0.18], [0.21, lvl], [0.44, 0]]);
    nz(o, t, 'fire', 0.42, [F('highpass', 2400, 0.5)], [[0.05, lvl * 2], [0.34, lvl * 1.4], [0.42, 0]]);
  }

  // Stick-slip wood/rope creak: slow sawtooth pulses ringing a resonance.
  function creak(t, dest, wet, lvl) {
    var dur = R(0.45, 1.1), o = shot(dest, wet, dur + 1.5, { wet: 0.35, pan: R(-0.5, 0.5) });
    var os = ctx.createOscillator(), bp = F('bandpass', R(450, 1000), 7), g = G(0), f0 = R(38, 70);
    os.type = 'sawtooth';
    os.frequency.setValueAtTime(f0, t);
    os.frequency.linearRampToValueAtTime(f0 * R(1.2, 1.7), t + dur * 0.6);
    os.frequency.linearRampToValueAtTime(f0 * R(0.8, 1.1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + 0.07);
    g.gain.linearRampToValueAtTime(lvl * 0.6, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    chain(os, bp, g, o);
    os.start(t); os.stop(t + dur + 0.05);
  }

  function thunder(t, dest, wet, lvl) {
    var dur = R(4.5, 8), o = shot(dest, wet, dur + 3, { wet: 0.5, pan: R(-0.5, 0.5) });
    var lp = F('lowpass', R(220, 420), 0.3);
    lp.frequency.setTargetAtTime(65, t + 0.4, 1.6);
    nz(o, t, 'brown', dur, [lp], [[R(0.1, 0.5), lvl], [1.0, lvl * 0.45], [1.5, lvl * R(0.5, 0.9)],
      [2.4, lvl * 0.3], [3.1, lvl * R(0.3, 0.6)], [dur, 0]], 0.7);
  }

  function chirp(t, dest, wet, lvl) {
    var o = shot(dest, wet, 2.5, { wet: 0.5, pan: R(-0.8, 0.8) });
    var n = 1 + Math.floor(Math.random() * 4), f = R(2500, 4200), at = t;
    for (var i = 0; i < n; i++) {
      var a = f * R(0.92, 1.08);
      tone(o, at, 'sine', a, lvl * R(0.5, 1), 0.012, 0.09, a * (Math.random() < 0.6 ? R(1.1, 1.3) : R(0.8, 0.92)), 0.07);
      at += R(0.09, 0.17);
    }
  }

  function knock(o, t, lvl) {
    tone(o, t, 'sine', 115, lvl, 0.003, 0.26, 50, 0.1);
    nz(o, t, 'brown', 0.13, [F('lowpass', 320, 0.5)], [[0.004, lvl * 1.3], [0.13, 0]]);
  }

  function pop(t, dest, lvl) {
    var o = shot(dest, null, 0.3, { pan: R(-0.5, 0.5) });
    nz(o, t, 'white', 0.045, [F('bandpass', R(800, 2400), 2)], [[0.001, lvl], [0.045, 0]]);
  }

  /* ---------- moods ---------- */

  var BUILD = {
    crypt: function (M) {
      var d = G(0.5), h = G(0.3);
      M.osc('sine', 41.2).connect(d); chain(M.osc('sine', 41.55), G(0.55), d);   // unequal: throbs, never cancels
      M.osc('triangle', 82.5).connect(h); M.osc('sine', 123.9).connect(h);   // audible on small speakers
      chain(M.osc('sine', 165.3), G(0.4), h);
      h.connect(d); d.connect(M.out);
      M.wander(d.gain, 0.32, 0.6, 9, 20);
      var bp = F('lowpass', 500, 0.5), ag = G(1.8), aw = G(0.3);
      chain(M.noise('brown', 0.8), F('highpass', 180, 0.5), bp, ag, M.out); chain(ag, aw, M.wet);
      M.wander(bp.frequency, 350, 850, 8, 19);
      M.wander(ag.gain, 1.2, 2.6, 7, 16);
      M.every(7, 22, function (t) { drip(t + 0.05, M.out, M.wet, 0.1); }, 3, 8);
    },

    library: function (M) {
      chain(M.noise('brown'), F('lowpass', 480, 0.4), G(0.5), M.out);
      var cg = G(0.2);
      chain(M.noise('crk'), F('highpass', 1500, 0.5), F('lowpass', 6000, 0.5), cg, M.out);
      M.wander(cg.gain, 0.15, 0.4, 4, 11);
      var lp = F('lowpass', 650, 0.4), pg = G(0.06);
      [[110, 1], [164.9, 0.7], [220.5, 0.5], [329.3, 0.2]].forEach(function (n) {
        chain(M.osc('sine', n[0]), G(n[1]), lp);
      });
      chain(lp, pg, M.out);
      M.lfo(0.071, 0.02, pg.gain);
      M.wander(pg.gain, 0.035, 0.08, 10, 24);
      M.every(16, 40, function (t) {
        if (Math.random() < 0.5) page(t + 0.05, M.out, M.wet, 0.045);
        else creak(t + 0.05, M.out, M.wet, 0.08);
      }, 8, 16);
    },

    court: function (M) {
      var lp = F('lowpass', 700, 0.4), sw = G(0.5);
      [[36.71, 'sine', 0.5], [73.42, 'triangle', 0.35], [73.62, 'sawtooth', 0.08], [110.2, 'triangle', 0.28],
        [146.6, 'triangle', 0.2], [220.6, 'sine', 0.1], [293.3, 'sine', 0.05]].forEach(function (n) {
        chain(M.osc(n[1], n[0]), G(n[2]), lp);
      });
      chain(lp, sw, M.out); chain(sw, G(0.35), M.wet);
      M.lfo(0.031, 0.17, sw.gain); M.lfo(0.0173, 0.12, sw.gain);   // slow, incommensurate swells
      M.wander(lp.frequency, 550, 1400, 10, 25);
      M.every(20, 40, function (t) {
        bell(t + 0.05, M.out, M.wet, 0.12, pick([146.83, 196, 220]), 7, 6, { wet: 1.6, lp: 1100, pan: R(-0.4, 0.4) });
      }, 6, 14);
    },

    storm: function (M) {
      var bp1 = F('bandpass', 500, 1.2), g1 = G(0.15);
      chain(M.noise('white'), bp1, g1, M.out);
      M.wander(bp1.frequency, 280, 900, 4, 11); M.wander(g1.gain, 0.04, 0.3, 3, 9);
      var bp2 = F('bandpass', 1100, 4), g2 = G(0.02);
      chain(M.noise('white', 0.9), bp2, g2, M.out);
      M.wander(bp2.frequency, 700, 1700, 3, 8); M.wander(g2.gain, 0, 0.06, 3, 10);
      var rg = G(0.03);
      chain(M.noise('white', 1.1), F('highpass', 3500, 0.5), F('lowpass', 9000, 0.5), rg, M.out);
      M.wander(rg.gain, 0.018, 0.04, 6, 15);
      chain(M.noise('crk', 2.2), F('highpass', 2000, 0.5), G(0.07), M.out);     // rain patter
      chain(M.noise('brown'), F('lowpass', 110, 0.5), G(0.14), M.out);
      M.every(14, 38, function (t) { thunder(t + 0.05, M.out, M.wet, 0.25); }, 4, 10);
    },

    sea: function (M) {
      var lp = F('lowpass', 500, 0.3), g = G(0.02), fg = G(0.002);
      chain(M.noise('white'), lp, g, M.out);
      chain(M.noise('white', 1.07), F('highpass', 3200, 0.5), fg, M.out);       // foam
      M.every(8, 12, function (t, P) {
        g.gain.setTargetAtTime(R(0.2, 0.36), t, P * 0.13);
        g.gain.setTargetAtTime(0.03, t + P * 0.42, P * 0.17);
        lp.frequency.setTargetAtTime(R(1300, 2300), t, P * 0.12);
        lp.frequency.setTargetAtTime(450, t + P * 0.4, P * 0.2);
        fg.gain.setTargetAtTime(R(0.01, 0.022), t + P * 0.33, 0.5);
        fg.gain.setTargetAtTime(0.002, t + P * 0.5, P * 0.15);
      }, 0);
      var g2 = G(0.08);
      chain(M.noise('brown'), F('lowpass', 220, 0.4), g2, M.out);              // body of the swell
      M.every(11, 17, function (t, P) {
        g2.gain.setTargetAtTime(R(0.12, 0.22), t, P * 0.15);
        g2.gain.setTargetAtTime(0.05, t + P * 0.45, P * 0.18);
      }, 0);
      var hum = G(0.025);
      M.osc('sine', 55).connect(hum); M.osc('sine', 55.3).connect(hum);
      chain(M.osc('sine', 110.2), G(0.25), hum); hum.connect(M.out);
      M.every(14, 40, function (t) { creak(t + 0.05, M.out, M.wet, 0.04); }, 9, 20);
    },

    fire: function (M) {
      var c1 = G(0.4), c2 = G(0.55);
      chain(M.noise('fire'), F('highpass', 400, 0.5), F('lowpass', 7000, 0.5), c1, M.out);
      chain(M.noise('fire', 0.61), F('bandpass', 1200, 0.7), c2, M.out);        // 19 s vs 31 s loops: no audible cycle
      M.wander(c1.gain, 0.25, 0.5, 3, 9); M.wander(c2.gain, 0.32, 0.68, 4, 10);
      var lp = F('lowpass', 260, 0.5), rg = G(0.7);
      chain(M.noise('brown'), lp, rg, M.out);
      M.wander(lp.frequency, 160, 380, 3, 8); M.wander(rg.gain, 0.5, 0.9, 2, 6);
      var wg = G(0.02);
      chain(M.noise('white'), F('bandpass', 600, 0.8), wg, M.out);
      M.wander(wg.gain, 0.008, 0.035, 1.5, 5);
      M.every(3, 12, function (t) { pop(t + 0.03, M.out, R(0.08, 0.22)); });
    },

    'void': function (M) {
      var sub = G(0.5), un = G(0.06);
      M.osc('sine', 36.7).connect(sub); chain(M.osc('sine', 37.05), G(0.55), sub);
      chain(M.osc('triangle', 73.9), G(0.1), sub); sub.connect(M.out);
      M.osc('sine', 146.8).connect(un); M.osc('sine', 147.55).connect(un);      // slow beating: unease
      un.connect(M.out);
      M.wander(un.gain, 0.03, 0.08, 8, 20);
      var sh = G(1);
      [1864.7, 2217.5, 2793.8, 3744.2, 4698.6].forEach(function (f) {
        var o = M.osc('sine', f), g = G(0.033);
        M.lfo(R(0.011, 0.045), 0.033, g.gain);                                  // each partial drifts in and out
        M.wander(o.detune, -25, 25, 6, 15);
        chain(o, g, panner(R(-0.8, 0.8)), sh);
      });
      sh.connect(M.out); chain(sh, G(0.9), M.wet);
      chain(M.noise('white'), F('bandpass', 5200, 1.5), G(0.006), M.out);
    },

    dawn: function (M) {
      var lp = F('lowpass', 1100, 0.4), pg = G(0.35);
      [[73.42, 0.2, 'triangle'], [146.83, 0.3], [147.3, 0.2], [220, 0.25], [220.7, 0.15], [293.66, 0.14],
        [369.99, 0.05], [440.4, 0.05]].forEach(function (n) {
        chain(M.osc(n[2] || 'sine', n[0]), G(n[1]), lp);
      });
      chain(lp, pg, M.out); chain(pg, G(0.3), M.wet);
      M.lfo(0.043, 0.08, pg.gain); M.lfo(0.019, 0.06, pg.gain);
      var ag = G(0.02);
      chain(M.noise('white'), F('bandpass', 900, 0.4), ag, M.out);
      M.wander(ag.gain, 0.012, 0.03, 5, 13);
      M.every(4, 14, function (t) { chirp(t + 0.05, M.out, M.wet, 0.05); }, 5, 10);
    }
  };

  /* ---------- sfx ---------- */

  var PLAY = {
    bell: function (t) {
      bell(t, sfxBus, sfxWet, 0.07, 196, 10, 10, { wet: 0.5 });
    },
    seal: function (t) {
      var o = shot(sfxBus, sfxWet, 5, { wet: 0.6 });
      [[1, 1, 3.6], [2.71, 0.5, 2.2], [5.15, 0.22, 1.2], [8.2, 0.08, 0.6]].forEach(function (p) {
        tone(o, t + 0.12, 'sine', 587.3 * p[0], 0.075 * p[1], 0.004, p[2]);
        tone(o, t + 0.12, 'sine', 587.3 * p[0] * 1.004, 0.04 * p[1], 0.004, p[2]);   // bowl beating
      });
      var bp = F('bandpass', 500, 1);
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
      bp.frequency.exponentialRampToValueAtTime(700, t + 1.2);
      nz(o, t, 'white', 1.2, [bp], [[0.4, 0.13], [1.2, 0]]);
    },
    threshold: function (t) {
      var o = shot(sfxBus, sfxWet, 6, { wet: 0.5 });
      knock(o, t, 0.18); knock(o, t + 0.34, 0.15);
      tone(o, t + 0.1, 'sine', 174.6, 0.05, 0.9, 4.2);
      tone(o, t + 0.1, 'sine', 175.5, 0.04, 0.9, 4.2);
      tone(o, t + 0.1, 'sine', 261.9, 0.018, 1.1, 3.4);
    },
    choose: function (t) {
      var o = shot(sfxBus, sfxWet, 2, { wet: 0.4 });
      tone(o, t, 'sine', 587.3, 0.11, 0.006, 0.5);
      tone(o, t + 0.09, 'sine', 880, 0.08, 0.006, 0.75);
    },
    page: function (t) { page(t, sfxBus, sfxWet, 0.2); },
    candle: function (t) {
      var o = shot(sfxBus, sfxWet, 3, { wet: 0.15 });
      nz(o, t, 'white', 0.24, [F('highpass', 2200, 0.5)], [[0.01, 0.12], [0.07, 0.05], [0.16, 0.15], [0.24, 0]]);
      nz(o, t + 0.2, 'white', 1.4, [F('bandpass', 700, 0.7)], [[0.12, 0.2], [0.45, 0.08], [1.4, 0]]);
      nz(o, t + 0.2, 'fire', 1.5, [F('highpass', 800, 0.5)], [[0.1, 0.12], [1.5, 0]]);
    },
    depart: function (t) {
      // Reverse swell that cuts dead: no reverb tail on purpose.
      var D = 2.8, o = shot(sfxBus, null, D + 0.5, {}), c = G(0), lp = F('lowpass', 250, 0.5);
      lp.frequency.setValueAtTime(250, t); lp.frequency.exponentialRampToValueAtTime(4500, t + D);
      c.gain.setValueAtTime(0.0005, t);
      c.gain.exponentialRampToValueAtTime(0.5, t + D);
      c.gain.linearRampToValueAtTime(0, t + D + 0.05);
      chain(lp, c, o);
      [[110, 0.3], [165.2, 0.25], [220.6, 0.2], [330, 0.12], [441, 0.07]].forEach(function (n) {
        var os = ctx.createOscillator(), g = G(n[1]);
        os.type = 'triangle'; os.frequency.value = n[0];
        chain(os, g, lp); os.start(t); os.stop(t + D + 0.1);
      });
      var s = ctx.createBufferSource(); s.buffer = buf.white; s.loop = true;
      chain(s, F('bandpass', 1500, 0.6), G(0.12), lp);
      s.start(t, Math.random() * 5); s.stop(t + D + 0.1);
    }
  };

  /* ---------- engine ---------- */

  function build() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC({ latencyHint: 'playback' });

    buf.white = mkNoise(11, false);
    buf.brown = mkNoise(13, true);
    buf.fire = mkCrackle(19, 13);
    buf.crk = mkCrackle(29, 1.6);
    buf.hall = mkIR(3.4, 0.9, 0.55);
    buf.room = mkIR(0.9, 0.22, 0.5);

    master = G(volGain(volume));
    bed = G(1 - duckAmt); bedWet = G(1 - duckAmt);
    sfxBus = G(1); sfxWet = G(1);
    hall = ctx.createConvolver(); hall.buffer = buf.hall;
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.003; limiter.release.value = 0.25;
    post = G(POST);
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8;

    bed.connect(master); sfxBus.connect(master);
    bedWet.connect(hall); sfxWet.connect(hall);
    chain(hall, G(0.5), master);
    chain(master, limiter, post, analyser, ctx.destination);
    return true;
  }
  var POST = 0.7;   // undoes the compressor's automatic make-up gain

  function init() {
    try {
      if (!ctx) {
        if (!build()) { ctx = null; return null; }
        var pv = pendingVoice; pendingVoice = [];
        pv.forEach(function (el) { connectVoice(el); });
        if (moodName) startMood(moodName, 4);
      }
      if (ctx.state === 'suspended') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
      return ctx;
    } catch (e) {
      return ctx;
    }
  }

  function retire(kit, fade) {
    if (!kit) return;
    rampTo(kit.out.gain, 0, fade); rampTo(kit.wet.gain, 0, fade);
    dying.push(kit);
    setTimeout(function () {
      kit.kill();
      var i = dying.indexOf(kit); if (i >= 0) dying.splice(i, 1);
    }, (fade + 0.3) * 1000);
  }

  function startMood(name, fade) {
    var kit = new Kit(name);
    try { BUILD[name](kit); } catch (e) { kit.kill(); return; }
    retire(current, fade);
    current = kit;
    rampTo(kit.out.gain, TRIM[name], fade);
    rampTo(kit.wet.gain, TRIM[name], fade);
  }

  function setMood(name, opts) {
    try {
      if (MOODS.indexOf(name) < 0) return;
      var fade = opts && isFinite(+opts.fade) && opts.fade != null ? Math.max(0.05, +opts.fade) : 4;
      if (name === moodName && (current || !ctx)) return;
      moodName = name;
      if (ctx) startMood(name, fade);
    } catch (e) {}
  }

  function stop(opts) {
    try {
      var fade = opts && isFinite(+opts.fade) && opts.fade != null ? Math.max(0.05, +opts.fade) : 2;
      moodName = null;
      if (!ctx) return;
      retire(current, fade); current = null;
    } catch (e) {}
  }

  function sfx(name) {
    try {
      if (!ctx || !PLAY.hasOwnProperty(name)) return;
      if (ctx.state === 'suspended') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
      PLAY[name](ctx.currentTime + 0.02);
    } catch (e) {}
  }

  function setVolume(v) {
    volume = clamp01(v);
    try { if (ctx) master.gain.setTargetAtTime(volGain(volume), ctx.currentTime, 0.05); } catch (e) {}
  }

  function duck(amount, time) {
    duckAmt = clamp01(amount);
    try {
      if (!ctx) return;
      var tc = Math.max(0.02, (isFinite(+time) && time != null ? +time : 0.6) / 3), t = ctx.currentTime;
      bed.gain.setTargetAtTime(1 - duckAmt, t, tc);
      bedWet.gain.setTargetAtTime(1 - duckAmt, t, tc);
    } catch (e) {}
  }

  /* ---------- voice chain ---------- */

  // The normalised room IR comes back ~11 dB under its send; WET_K makes `wet` read as a true wet/dry ratio (measured).
  var WET_K = 3.7;

  function buildVoice() {
    var v = {};
    v.in = F('lowshelf', 180, null, 2.5);
    v.comp = ctx.createDynamicsCompressor();
    v.comp.threshold.value = -20; v.comp.knee.value = 14; v.comp.ratio.value = 2.5;
    v.comp.attack.value = 0.008; v.comp.release.value = 0.22;
    v.pre = ctx.createDelay(0.1); v.pre.delayTime.value = 0.018;
    v.conv = ctx.createConvolver(); v.conv.buffer = buf.room;
    v.tone = F('lowpass', 4200, 0.4);
    v.wet = G(voiceCfg.wet * WET_K);
    v.out = G(voiceCfg.gain);
    v.analyser = ctx.createAnalyser(); v.analyser.fftSize = 1024; v.analyser.smoothingTimeConstant = 0.75;
    chain(v.in, v.comp, v.out, v.analyser, ctx.destination);
    chain(v.comp, v.pre, v.conv, v.tone, v.wet, v.out);
    return v;
  }

  function connectVoice(el) {
    try {
      if (!el || !voiceEls || typeof el.play !== 'function') return false;
      if (voiceEls.has(el)) return true;
      if (!ctx) {                                   // defer: capturing into a missing/suspended context would mute the element
        if (pendingVoice.indexOf(el) < 0) pendingVoice.push(el);
        return false;
      }
      if (!voice) voice = buildVoice();             // everything is wired before the element is captured
      var src = ctx.createMediaElementSource(el);   // can only ever happen once per element
      voiceEls.set(el, src);
      try { src.connect(voice.in); } catch (e) { try { src.connect(ctx.destination); } catch (e2) {} }
      var wake = function () {
        if (ctx && ctx.state !== 'running') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); }
      };
      el.addEventListener('play', wake); el.addEventListener('playing', wake);
      wake();
      return true;
    } catch (e) {
      return false;                                 // element untouched (or already captured): it keeps playing
    }
  }

  function setVoice(o) {
    try {
      if (!o) return;
      if (o.wet != null) voiceCfg.wet = clamp01(o.wet);
      if (o.gain != null && isFinite(+o.gain)) voiceCfg.gain = Math.max(0, Math.min(2, +o.gain));
      if (voice) {
        voice.wet.gain.setTargetAtTime(voiceCfg.wet * WET_K, ctx.currentTime, 0.05);
        voice.out.gain.setTargetAtTime(voiceCfg.gain, ctx.currentTime, 0.05);
      }
    } catch (e) {}
  }

  var api = {
    MOODS: MOODS.slice(), SFX: SFX.slice(),
    init: init, setMood: setMood, sfx: sfx, setVolume: setVolume, duck: duck, stop: stop,
    connectVoice: connectVoice, setVoice: setVoice,
    _debug: function () {
      return {
        state: ctx ? ctx.state : 'none', mood: moodName, live: current ? current.name : null,
        dying: dying.length, sources: current ? current.srcs.length : 0, timers: current ? current.slots.length : 0,
        volume: volume, duck: duckAmt
      };
    }
  };
  Object.defineProperties(api, {
    mood: { get: function () { return moodName; }, enumerable: true },
    analyser: { get: function () { return ctx ? analyser : null; }, enumerable: true },
    voiceAnalyser: { get: function () { return voice ? voice.analyser : null; }, enumerable: true },
    context: { get: function () { return ctx; }, enumerable: true },
    volume: { get: function () { return volume; }, enumerable: true }
  });
  window.Ambience = api;
})();
