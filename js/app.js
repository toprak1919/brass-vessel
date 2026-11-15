/* The Brass Vessel — player, transcript sync, thresholds, grimoire, saved state. */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = t => { t = Math.max(0, t | 0); return (t / 60 | 0) + ':' + String(t % 60).padStart(2, '0'); };
  const roman = n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] || n;
  const safe = (name, fn, ...a) => { try { const o = window[name]; if (o && typeof o[fn] === 'function') return o[fn](...a); } catch (e) { console.warn(name + '.' + fn, e); } };

  const EPS = window.EPISODES || [];
  const KEY = 'brass-vessel-v1';
  const S = Object.assign({ unlocked: {}, terms: {}, choices: {}, traits: {}, pos: {}, done: {}, cur: EPS[0] && EPS[0].id, hands: false, amb: 55, speed: 1, word: '' },
    (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } };

  const SCENE_LABEL = { crypt: 'Below ground', library: 'Among the books', court: 'The court', storm: 'Weather coming in', sea: 'The water', fire: 'By the fire', void: 'The dark between', dawn: 'First light' };
  const TRAITS = ['scholar', 'seeker', 'skeptic', 'poet'];

  let CANON = { spirits: [] };
  const spiritEp = {};   // n -> {ep, seg}
  EPS.forEach(ep => ep.segments.forEach(s => { if (s.spirit) spiritEp[s.spirit] = { ep, seg: s }; }));
  const spirit = n => CANON.spirits.find(s => s.n === n) || { n, name: 'Spirit ' + n, rank: [], legions: null, appearance: '', office: '', quote: '' };

  const voice = $('#voice'), reply = $('#reply');
  let ep = null, curIdx = -1, prevT = 0, waiting = null, asked = {}, replying = false, applied = { scene: null, mood: null }, entered = false, lastSave = 0, cardTimer = 0, handsTimer = 0, nextTimer = 0;

  /* ------------------------------------------------------------ gate */
  function buildGate() {
    const svg = safe('Sigil', 'circle', { size: 760 });
    if (svg) { if (safe('Sigil', 'draw', $('#gate-circle'), svg, { duration: 7000 }) === undefined && !$('#gate-circle').firstChild) $('#gate-circle').innerHTML = svg; }
    const box = $('#candles'); let lit = 0;
    for (let i = 0; i < 5; i++) {
      const a = (-90 + i * 72) * Math.PI / 180;
      const c = el('button', 'candle', '<u></u><b></b><i></i>');
      c.style.left = (50 + 50 * Math.cos(a)) + '%'; c.style.top = (50 + 50 * Math.sin(a)) + '%';
      c.setAttribute('aria-label', 'Light candle ' + (i + 1));
      c.onclick = () => {
        if (c.classList.contains('lit')) return;
        safe('Ambience', 'init'); if (!lit) safe('Ambience', 'setMood', 'void', { fade: 3 });
        c.classList.add('lit'); lit++; safe('Ambience', 'sfx', 'candle'); safe('Scenes', 'pulse', lit / 5);
        $('#gate-hint').textContent = lit < 5 ? ['', 'Four more', 'Three more', 'Two more', 'One more'][lit] : 'The circle is lit';
        if (lit === 5) setTimeout(enter, 900);
      };
      box.appendChild(c);
    }
  }

  function enter() {
    if (entered) return; entered = true;
    safe('Ambience', 'init'); safe('Ambience', 'connectVoice', voice); safe('Ambience', 'connectVoice', reply);
    safe('Ambience', 'setVolume', S.amb / 100); safe('Ambience', 'sfx', 'bell');
    $('#gate').classList.add('gone'); $('#app').hidden = false;
    setTimeout(() => $('#app').classList.add('in'), 30);
    setTimeout(() => { $('#gate').style.display = 'none'; $('#app').style.transition = 'none'; $('#app').style.opacity = 1; }, 3600);
    loadEpisode(S.cur, false);
    setTimeout(() => play(), 2600);
  }

  /* ------------------------------------------------------------ episode */
  function loadEpisode(id, autoplay) {
    ep = EPS.find(e => e.id === id) || EPS[0]; if (!ep) return;
    clearTimeout(nextTimer); stopReply(); waiting = null; asked = {}; curIdx = -1; counting = false;
    S.cur = ep.id; save();
    let sc = ep.scene, mo = ep.mood;
    ep.segments.forEach(s => { if (s.scene) sc = s.scene; if (s.mood) mo = s.mood; s._scene = sc; s._mood = mo; });
    $('#ep-num').textContent = 'Night ' + roman(ep.num) + ' of ' + roman(EPS.length);
    $('#ep-title').textContent = ep.title; $('#ep-sub').textContent = ep.subtitle;
    buildScript(); buildMarks(); renderNights();
    const start = (S.pos[ep.id] || 0) < ep.duration - 8 ? (S.pos[ep.id] || 0) : 0;
    voice.src = ep.audio; voice.playbackRate = S.speed;
    const go = () => { voice.currentTime = start; prevT = start; sync(start, true); if (autoplay) play(); };
    if (voice.readyState >= 1) go(); else voice.addEventListener('loadedmetadata', go, { once: true });
    $('#t-dur').textContent = fmt(ep.duration);
    applyAir(ep.segments[0]._scene, ep.segments[0]._mood);
    $('#nights').classList.remove('open');
  }

  function words(text) {
    let acc = 0; const parts = text.split(/\s+/);
    const total = parts.reduce((n, w) => n + w.length + 1.5 + (/[.,;:?!]$/.test(w) ? 5 : 0), 0);
    return parts.map(w => { acc += w.length + 1.5 + (/[.,;:?!]$/.test(w) ? 5 : 0); return '<span class="w" data-f="' + (acc / total).toFixed(4) + '">' + esc(w) + '</span>'; }).join(' ');
  }

  function buildScript() {
    const box = $('#script'); box.innerHTML = ''; let scene = ep.scene;
    ep.segments.forEach((s, i) => {
      if (i === 0 || s._scene !== scene) { scene = s._scene; const m = el('div', 'mark', '· ' + (SCENE_LABEL[scene] || scene) + ' ·'); m.dataset.i = i; box.appendChild(m); }
      const p = el('p', 'seg' + (s.v === 'book' ? ' book' : '') + (s.kind === 'threshold' ? ' q' : ''), words(s.t) + (s.src ? '<cite>' + esc(s.src) + '</cite>' : ''));
      p.dataset.i = i; p.onclick = () => { if (p.classList.contains('heard')) seek(s.start + 0.01, true); };
      s._el = p; s._k = 0; s._w = $$('.w', p); s._f = s._w.map(w => +w.dataset.f);
      box.appendChild(p);
      if (s.spirit) { const sp = spirit(s.spirit); const m = el('div', 'mark sp', '✶ ' + esc(sp.name) + ' · seal ' + s.spirit + ' of 72 · kept in your grimoire'); m.dataset.i = i; m.onclick = () => showCard(s.spirit, true); box.appendChild(m); }
      if (s.term) { const g = (ep.glossary || []).find(x => x.id === s.term); if (g) { const m = el('div', 'mark sp', '+ lexicon · ' + esc(g.term)); m.dataset.i = i; m.onclick = () => openTab('lexicon'); box.appendChild(m); } }
      if (s.kind === 'threshold') {
        const c = el('div', 'choice'); s._choice = c;
        s.opts.forEach((o, j) => { const b = el('button', '', esc(o.label)); b.dataset.k = 'i'.repeat(j + 1); b.onclick = () => choose(s, o); o._b = b; c.appendChild(b); });
        c.appendChild(el('div', 'wait', 'the keeper is waiting for you'));
        const r = el('p', 'reply'); s._reply = r; box.appendChild(c); box.appendChild(r);
        const past = S.choices[s.id]; const o = past && s.opts.find(x => x.key === past);
        if (o) { c.classList.add('done'); o._b.classList.add('picked'); r.textContent = o.reply; r.dataset.ready = '1'; }
      }
    });
    const end = el('div', 'endcard'); end.id = 'endcard'; box.appendChild(end);
    box.scrollTop = 0;
  }

  function buildMarks() {
    const m = $('#scrub-marks'); m.innerHTML = '';
    ep.segments.forEach(s => {
      if (!s.spirit && s.kind !== 'threshold') return;
      const i = el('i', s.spirit ? 'sp' : 'th'); i.style.left = (100 * (s.spirit ? s.start : s.end) / ep.duration) + '%'; m.appendChild(i);
    });
  }

  function applyAir(scene, mood) {
    if (scene && scene !== applied.scene) { applied.scene = scene; safe('Scenes', 'set', scene, { fade: 3 }); }
    if (mood && mood !== applied.mood && entered) { applied.mood = mood; safe('Ambience', 'setMood', mood, { fade: 5 }); }
  }

  /* ------------------------------------------------------------ sync */
  function sync(t, jumped) {
    if (!ep) return;
    const segs = ep.segments; let idx = -1;
    for (let i = 0; i < segs.length; i++) { if (segs[i].start <= t + 0.02) idx = i; else break; }
    if (idx !== curIdx) {
      curIdx = idx;
      segs.forEach((s, i) => {
        s._el.classList.toggle('heard', i < idx); s._el.classList.toggle('now', i === idx);
        if (i < idx && s._k < s._w.length) { s._w.forEach(w => w.classList.add('s')); s._k = s._w.length; }
        if (i > idx && s._k) { s._w.forEach(w => w.classList.remove('s')); s._k = 0; }
        if (s._reply) s._reply.classList.toggle('on', i <= idx && !!s._reply.dataset.ready && (i < idx || t >= s.end));
        if (s._choice && i > idx) s._choice.classList.remove('open');
      });
      $$('#script .mark').forEach(m => m.classList.toggle('heard', +m.dataset.i <= idx));
      if (idx >= 0) {
        const s = segs[idx]; applyAir(s._scene, s._mood);
        for (let i = 0; i <= idx; i++) {
          if (segs[i].spirit) unlock(segs[i].spirit, i === idx && !jumped);
          if (segs[i].term) learn(segs[i].term);
        }
        if (i_isLastPage(idx) && !jumped) safe('Ambience', 'sfx', 'page');
        scrollTo(s._el);
      }
    }
    if (idx >= 0) {                                   // word glow
      const s = segs[idx], f = (t - s.start) / Math.max(0.2, s.end - s.start); let k = s._k;
      while (k < s._f.length && s._f[k] - 0.5 / s._f.length <= f) { s._w[k].classList.add('s'); k++; }
      while (k > 0 && s._f[k - 1] - 0.5 / s._f.length > f) { k--; s._w[k].classList.remove('s'); }
      s._k = k;
      if (s._reply && s._reply.dataset.ready && t >= s.end) s._reply.classList.add('on');
    }
    if (!jumped && !waiting) {
      for (const s of segs) {
        if (s.kind === 'threshold' && !asked[s.id] && !S.choices[s.id] && prevT < s.end && t >= s.end && t - prevT < 2) { openThreshold(s); break; }
      }
    }
    prevT = t;
    const p = Math.min(1, t / ep.duration);
    $('#scrub-fill').style.width = $('#scrub-knob').style.left = (p * 100) + '%';
    $('#t-now').textContent = fmt(t);
    if (Math.abs(t - lastSave) > 4) { lastSave = t; S.pos[ep.id] = t; save(); const b = $('#night-list li.on .bar i'); if (b) b.style.width = (p * 100) + '%'; }
  }
  const i_isLastPage = idx => idx > 0 && ep.segments[idx].v === 'book';

  function scrollTo(node) {
    const box = $('#script'); const y = node.offsetTop - box.clientHeight * 0.34;
    box.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  /* ------------------------------------------------------------ transport */
  function play() {
    if (!ep) return;
    if (waiting) return skipThreshold();
    if (replying) { reply.play().catch(() => { }); return; }
    clearTimeout(nextTimer);
    if (voice.ended || voice.currentTime >= ep.duration - 0.3) voice.currentTime = 0;
    voice.play().catch(e => console.warn('play', e));
  }
  function pause() { voice.pause(); if (replying) reply.pause(); }
  function toggle() { if (voice.ended && $('#endcard').classList.contains('on') && !replying) { stay(); return; } const on = replying ? !reply.paused : !voice.paused; on ? pause() : play(); }
  function seek(t, keepPlaying) {
    if (!ep) return;
    stopReply(); if (waiting) { waiting._choice.classList.remove('open'); waiting = null; clearTimeout(handsTimer); }
    t = Math.max(0, Math.min(ep.duration - 0.5, t));
    ep.segments.forEach(s => { if (s.kind === 'threshold' && s.end > t) delete asked[s.id]; });
    voice.currentTime = t; prevT = t; sync(t, true);
    if (keepPlaying) play();
  }
  function stopReply() { if (replying) { reply.pause(); replying = false; } }
  function setPlayingUI() {
    const on = (!voice.paused && !voice.ended) || (replying && !reply.paused);
    $('#play').classList.toggle('playing', on); $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play');
    safe('Ambience', 'duck', on ? 0.55 : 0, 1.2);
  }
  ['play', 'pause', 'ended'].forEach(ev => { voice.addEventListener(ev, setPlayingUI); reply.addEventListener(ev, setPlayingUI); });
  voice.addEventListener('timeupdate', () => sync(voice.currentTime));
  voice.addEventListener('ended', finish);
  reply.addEventListener('ended', () => { if (!replying) return; replying = false; setTimeout(() => voice.play().catch(() => { }), 500); });

  /* ------------------------------------------------------------ thresholds */
  function openThreshold(s) {
    voice.pause(); waiting = s; asked[s.id] = true;
    s._choice.classList.remove('done'); s._choice.classList.add('open');
    $('.wait', s._choice).textContent = S.hands ? 'hands-free · the keeper goes on in a moment' : 'the keeper is waiting for you';
    safe('Ambience', 'sfx', 'threshold'); scrollTo(s._el);
    clearTimeout(handsTimer); if (S.hands) handsTimer = setTimeout(() => { if (waiting === s) skipThreshold(); }, 9000);
  }
  function skipThreshold() {
    const s = waiting; if (!s) return; waiting = null; clearTimeout(handsTimer);
    s._choice.classList.remove('open'); voice.play().catch(() => { });
  }
  function choose(s, o) {
    if (waiting !== s) return; waiting = null; clearTimeout(handsTimer);
    S.choices[s.id] = o.key; S.traits[o.trait] = (S.traits[o.trait] || 0) + 1; save(); renderYou();
    safe('Ambience', 'sfx', 'choose');
    s._choice.classList.remove('open'); s._choice.classList.add('done'); s.opts.forEach(x => x._b.classList.toggle('picked', x === o));
    s._reply.textContent = o.reply; s._reply.dataset.ready = '1'; s._reply.classList.add('on'); scrollTo(s._reply);
    replying = true; reply.src = o.audio; reply.playbackRate = S.speed;
    reply.play().catch(() => { replying = false; voice.play().catch(() => { }); });
  }

  let counting = false;
  function stay() { if (!counting) return false; counting = false; clearTimeout(nextTimer); const c = $('#count'); if (c) c.textContent = 'staying here · go down again when you are ready'; return true; }
  document.addEventListener('pointerdown', stay, true);
  document.addEventListener('keydown', stay, true);
  /* ------------------------------------------------------------ end of a night */
  function finish() {
    S.done[ep.id] = true; S.pos[ep.id] = 0; save(); renderNights(); renderYou();
    safe('Ambience', 'sfx', 'depart');
    const i = EPS.indexOf(ep), next = EPS[i + 1], card = $('#endcard');
    if (next) {
      card.innerHTML = '<p class="k">Night ' + roman(ep.num) + ' is closed</p><p class="sub">Next: ' + esc(next.title) + '. ' + esc(next.blurb) + '</p><button>Go down again · Night ' + roman(next.num) + '</button><p class="fine" id="count"></p>';
      $('button', card).onclick = e => { e.stopPropagation(); counting = false; loadEpisode(next.id, true); };
      counting = true;
      let n = 20; const tick = () => { const c = $('#count'); if (!c) return; if (!counting) return; if (n <= 0) { counting = false; return loadEpisode(next.id, true); } c.textContent = 'continuing in ' + n + ' · touch anything to stay'; n--; nextTimer = setTimeout(tick, 1000); };
      tick();
    } else {
      safe('Scenes', 'set', 'dawn', { fade: 6 }); safe('Ambience', 'setMood', 'dawn', { fade: 8 });
      card.innerHTML = '<p class="k">The circle is closed</p><p class="sub">Twelve nights, seventy-two names. Your grimoire is yours to keep. Look under “You” for what the Keeper made of you.</p><button>Open my page</button>';
      $('button', card).onclick = () => openTab('you');
    }
    card.classList.add('on'); scrollTo(card);
  }

  /* ------------------------------------------------------------ grimoire */
  function unlock(n, announce) {
    const fresh = !S.unlocked[n];
    if (fresh) { S.unlocked[n] = Date.now(); save(); renderCell(n, true); tally(); }
    if (announce) { showCard(n, false); safe('Ambience', 'sfx', 'seal'); safe('Scenes', 'flare'); }
  }
  function learn(id) {
    if (S.terms[id]) return; const g = (ep.glossary || []).find(x => x.id === id); if (!g) return;
    S.terms[id] = { term: g.term, def: g.def, ep: ep.num }; save(); renderLex();
  }
  const tally = () => { $('#tally-seals').textContent = Object.keys(S.unlocked).length; };
  const sigil = (sp, size, label) => safe('Sigil', 'spirit', sp.n, sp.name, sp.rank || [], { size, label }) || '';

  function renderGrid() {
    const g = $('#seal-grid'); g.innerHTML = '';
    for (let n = 1; n <= 72; n++) { const c = el('div', 'cell'); c.id = 'cell-' + n; c.onclick = () => { if (S.unlocked[n]) showCard(n, true); }; g.appendChild(c); renderCell(n); }
    tally();
  }
  function renderCell(n, fresh) {
    const c = $('#cell-' + n); if (!c) return; const sp = spirit(n);
    if (S.unlocked[n]) { c.className = 'cell open' + (fresh ? ' new' : ''); c.innerHTML = sigil(sp, 80, false) + '<span class="nm">' + esc(sp.name) + '</span>'; c.title = sp.name; }
    else { c.className = 'cell'; c.textContent = n; const w = spiritEp[n]; c.title = w ? 'Sealed · waits in night ' + roman(w.ep.num) : 'Sealed'; }
  }
  function showCard(n, modal) {
    const sp = spirit(n), m = $('#manifest'), w = spiritEp[n];
    clearTimeout(cardTimer); m.hidden = false; m.classList.toggle('modal', !!modal); $('#veil').hidden = !modal;
    m.style.animation = 'none'; void m.offsetWidth; m.style.animation = '';
    const svg = sigil(sp, 240, true), box = $('.seal', m); box.innerHTML = '';
    if (svg && safe('Sigil', 'draw', box, svg, { duration: 2600 }) === undefined && !box.firstChild) box.innerHTML = svg;
    $('.body', m).innerHTML = '<h3>' + esc(sp.name) + '</h3><p class="rk">' + esc((sp.rank || []).join(' & ') || 'Spirit') + (sp.legions ? ' · ' + sp.legions + ' legions' : '') + ' · № ' + n + '</p>' +
      (sp.appearance ? '<p><b>Appears as</b>' + esc(sp.appearance) + '</p>' : '') + (sp.office ? '<p><b>Office</b>' + esc(sp.office) + '</p>' : '') +
      (modal && sp.quote ? '<blockquote>“' + esc(sp.quote) + '”</blockquote>' : '') +
      (modal && w ? '<button class="go">Hear it again · Night ' + roman(w.ep.num) + '</button>' : '');
    const go = $('.go', m); if (go) go.onclick = () => { hideCard(); if (ep !== w.ep) { S.pos[w.ep.id] = w.seg.start; loadEpisode(w.ep.id, true); } else seek(w.seg.start, true); };
    if (!modal) cardTimer = setTimeout(hideCard, 15000);
  }
  function hideCard() { $('#manifest').hidden = true; $('#veil').hidden = true; clearTimeout(cardTimer); }
  $('#manifest .x').onclick = hideCard; $('#veil').onclick = hideCard;

  function ask(q) {
    const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !['the', 'who', 'what', 'which', 'can', 'for', 'and', 'with', 'does', 'that', 'spirit', 'demon', 'teaches', 'makes'].includes(w));
    const note = $('#ask-note'); let hit = 0, sealed = 0; const nights = new Set();
    for (let n = 1; n <= 72; n++) {
      const c = $('#cell-' + n), sp = spirit(n); c.classList.remove('hit', 'miss'); if (!terms.length) continue;
      const hay = [sp.name, (sp.alt || []).join(' '), (sp.rank || []).join(' '), sp.appearance, sp.office, sp.quote].join(' ').toLowerCase();
      const ok = terms.every(t => hay.includes(t) || hay.includes(t.replace(/(s|es|ing|ed)$/, '')));
      if (ok && S.unlocked[n]) { c.classList.add('hit'); hit++; } else { c.classList.add('miss'); if (ok) { sealed++; if (spiritEp[n]) nights.add(spiritEp[n].ep.num); } }
    }
    note.textContent = !terms.length ? '' : (hit ? hit + ' in your grimoire answer' + (hit === 1 ? 's' : '') + '. ' : 'Nothing you have met answers. ') +
      (sealed ? sealed + ' more still sealed' + (nights.size ? ', waiting in night ' + [...nights].sort((a, b) => a - b).map(roman).join(', ') : '') + '.' : '');
  }
  $('#ask').addEventListener('input', e => ask(e.target.value));

  function renderLex() {
    const items = Object.values(S.terms).sort((a, b) => a.term.localeCompare(b.term));
    $('#lex').innerHTML = items.length ? items.map(t => '<dt>' + esc(t.term) + '</dt><dd>' + esc(t.def) + '</dd>').join('') : '<dd>Nothing yet. Listen.</dd>';
  }
  function renderYou() {
    const max = Math.max(1, ...TRAITS.map(t => S.traits[t] || 0));
    $('#traits').innerHTML = TRAITS.map(t => '<div>' + t + '<i><b style="width:' + (100 * (S.traits[t] || 0) / max) + '%"></b></i><span>' + (S.traits[t] || 0) + '</span></div>').join('');
    const top = TRAITS.slice().sort((a, b) => (S.traits[b] || 0) - (S.traits[a] || 0))[0], any = TRAITS.some(t => S.traits[t]);
    const nights = Object.keys(S.done).length;
    const V = {
      scholar: 'You read the seal before you touch it. The copyists would have liked you. So would the inquisitors, which is the trouble with scholars.',
      seeker: 'You came to feel the floor tilt. The book was written for you, and it knows it. Keep one hand on the rail.',
      skeptic: 'You do not believe a word, and you have not stopped listening. Weyer was the same. He printed the whole list.',
      poet: 'You hear it as a poem about wanting things. That may be the truest reading there is.'
    };
    $('#verdict').textContent = any ? 'The Keeper’s note, after ' + nights + ' night' + (nights === 1 ? '' : 's') + ': ' + V[top] : 'Answer the Keeper when she asks, and this page will fill in.';
  }
  function ownSeal() {
    const w = $('#seal-word').value.trim(); S.word = w; save();
    $('#seal-own').innerHTML = w ? (safe('Sigil', 'personal', w, { size: 260 }) || '') : '';
  }
  $('#seal-word').addEventListener('input', ownSeal);
  $('#reset').onclick = () => { if (confirm('Forget every seal, answer and place?')) { localStorage.removeItem(KEY); location.reload(); } };

  function renderNights() {
    const ol = $('#night-list'); ol.innerHTML = '';
    EPS.forEach(e => {
      const n = e.segments.filter(s => s.spirit).length, p = S.done[e.id] ? 1 : Math.min(1, (S.pos[e.id] || 0) / e.duration);
      const li = el('li', (ep === e ? 'on ' : '') + (S.done[e.id] ? 'done' : ''),
        '<span class="n">' + roman(e.num) + '</span><span class="t">' + esc(e.title) + '</span><span class="m">' + fmt(e.duration) + ' · ' + n + ' seal' + (n === 1 ? '' : 's') + '</span><span class="bar"><i style="width:' + (p * 100) + '%"></i></span>');
      li.title = e.blurb; li.onclick = () => { if (ep !== e) loadEpisode(e.id, true); };
      ol.appendChild(li);
    });
    const tot = EPS.reduce((a, e) => a + e.duration, 0);
    $('#total-time').textContent = EPS.length + ' nights · about ' + Math.round(tot / 60) + ' minutes, longer if you answer back';
  }

  /* ------------------------------------------------------------ chrome */
  function openTab(name) {
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + name));
    $('#grim').classList.add('open'); $('#grim').scrollTop = 0;
  }
  $$('.tabs button').forEach(b => b.onclick = () => openTab(b.dataset.tab));
  $('#btn-nights').onclick = () => { $('#nights').classList.toggle('open'); $('#grim').classList.remove('open'); };
  $('#btn-grim').onclick = () => { $('#grim').classList.toggle('open'); $('#nights').classList.remove('open'); };
  $('#stage').addEventListener('click', () => { $('#nights').classList.remove('open'); $('#grim').classList.remove('open'); });
  $('#play').onclick = toggle;
  $('#back').onclick = () => seek(voice.currentTime - 15, !voice.paused);
  $('#fwd').onclick = () => seek(voice.currentTime + 15, !voice.paused);
  const SPEEDS = [1, 1.15, 1.3, 0.9];
  const setSpeed = v => { S.speed = v; voice.playbackRate = reply.playbackRate = v; $('#speed').textContent = v + '×'; save(); };
  $('#speed').onclick = () => setSpeed(SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]);
  $('#amb').value = S.amb; $('#amb').oninput = e => { S.amb = +e.target.value; safe('Ambience', 'setVolume', S.amb / 100); save(); };
  const setHands = v => { S.hands = v; $('#hands').textContent = 'hands-free: ' + (v ? 'on' : 'off'); $('#hands').classList.toggle('on', v); save(); };
  $('#hands').onclick = () => setHands(!S.hands);
  const scrub = $('#scrub'); let drag = false;
  const scrubTo = e => { const r = scrub.getBoundingClientRect(); seek(ep.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), !voice.paused && !drag); };
  scrub.addEventListener('pointerdown', e => { if (!ep) return; const was = !voice.paused; drag = true; scrub.setPointerCapture(e.pointerId); scrubTo(e); scrub.onpointermove = scrubTo; scrub.onpointerup = () => { drag = false; scrub.onpointermove = scrub.onpointerup = null; if (was) play(); }; });
  document.addEventListener('keydown', e => {
    if (!entered || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    else if (e.code === 'ArrowLeft') seek(voice.currentTime - 15, !voice.paused);
    else if (e.code === 'ArrowRight') seek(voice.currentTime + 15, !voice.paused);
    else if (e.code === 'Escape') hideCard();
    else if (waiting && /^Digit[1-4]$/.test(e.code)) { const o = waiting.opts[+e.code.slice(5) - 1]; if (o) choose(waiting, o); }
  });

  /* ------------------------------------------------------------ frame loop: voice level -> backdrop, smooth word glow */
  let buf = null, level = 0;
  function frame() {
    requestAnimationFrame(frame);
    const A = window.Ambience, an = A && (A.voiceAnalyser || null);
    const speaking = (!voice.paused && !voice.ended) || (replying && !reply.paused);
    let v = 0;
    if (an && speaking) {
      try { if (!buf || buf.length !== an.fftSize) buf = new Uint8Array(an.fftSize); an.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i += 4) { const d = (buf[i] - 128) / 128; s += d * d; } v = Math.min(1, Math.sqrt(s / (buf.length / 4)) * 4); } catch (e) { }
    } else if (speaking) v = 0.35 + 0.25 * Math.sin(performance.now() / 300);
    level += (v - level) * 0.2; safe('Scenes', 'pulse', level);
    if (ep && !voice.paused && !waiting) sync(voice.currentTime);
  }

  /* ------------------------------------------------------------ boot */
  safe('Scenes', 'init', $('#backdrop')); safe('Scenes', 'set', 'void', { fade: 0.1 }); applied.scene = 'void';
  buildGate(); renderGrid(); renderLex(); renderYou(); setSpeed(S.speed); setHands(S.hands);
  if (S.word) { $('#seal-word').value = S.word; ownSeal(); }
  fetch('data/canon.json').then(r => r.ok ? r.json() : null).then(c => { if (c && c.spirits) { CANON = c; renderGrid(); if (ep) { const t = voice.currentTime; buildScript(); curIdx = -1; sync(t, true); } } }).catch(() => { });
  requestAnimationFrame(frame);
  window.BV = { S, seek, play, pause, loadEpisode, showCard, enter, get ep() { return ep; }, get waiting() { return waiting; } };
})();
