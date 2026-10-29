import { CONFIG } from './config.js';
import { renderPoster, liveHeight, esc, spoilerState, cssVars, seeded, nebulaSVG, starField, drawStars, fnGlyph, starPoints } from './render.js';
import { Viewer } from './view.js';
import { Search } from './search.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const body = document.body, host = $('#poster'), stage = $('#stage'), pop = $('#pop');
const T0 = performance.now();
let data, baseTheme, theme, S, LH, viewer, settings;   // theme: baseTheme with the chosen background preset's sky
let epById, epByN, evByNum, lineY, lineEps, majorsByX;
const thumbs = {};            // id -> blob URL, all decoded behind the loading screen
const thumbBlobs = {};        // id -> Blob, for the PNG export
const keepDecoded = [];       // the decoded <img> objects, kept so the browser keeps their bitmaps
// Layout mode: 'desk', 'phone' (narrow) or 'land' (a touch screen held sideways, at most site_land_max_h tall). phone is
// true in both phone modes (touch taps, sheets, the icon toolbar); land swaps the bottom sheets and the top toolbar for
// side panels and a button column at the right edge.
let mode = null, phone = false, land = false;
const safe = { t: 0, r: 0, b: 0, l: 0 };   // safe-area insets (notches, the home indicator), CSS px
let search;
let cardY0 = 0, cardY1 = 1;   // top of the highest card, bottom of the lowest: 100% zoom fits these

// ---------------------------------------------------------------- settings (this browser only)
// dockHigh: the events dock shows only the major events and highlights; bgPreset: a key of theme.yaml `presets`;
// spoiler.modeSet: the visitor picked Blur or Hide themselves
const DEFAULTS = { spoiler: { on: false, upTo: 1, mode: 'hide', modeSet: false }, bgPreset: 'night', dockOpen: false, dockHigh: false };
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(CONFIG.storageKey) || '{}');
    delete s.arcColors; delete s.bgDim;   // rounds 1-8: arc colours and the custom background, both removed
    if ('dockTier' in s) { s.dockHigh = s.dockTier === 'high'; delete s.dockTier; }   // rounds 9-11: a three-way tier filter
    localStorage.removeItem(CONFIG.storageKey + ':bg');
    const out = { ...DEFAULTS, ...s, spoiler: { ...DEFAULTS.spoiler, ...(s.spoiler || {}) } };
    if (!out.spoiler.modeSet) out.spoiler.mode = DEFAULTS.spoiler.mode;   // rounds 1-10 saved Blur, then the default, without it being chosen
    return out;
  } catch { return structuredClone(DEFAULTS); }
}
function saveSettings() {
  try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(settings)); } catch { /* private mode: settings last for this visit */ }
}
const sp = () => spoilerState(data, settings);
const hiddenN = n => { const s = sp(); return s.later(n) && s.mode === 'hide'; };

// ---------------------------------------------------------------- startup
async function start() {
  const [d, t] = await Promise.all([fetch(CONFIG.poster).then(r => r.json()), fetch(CONFIG.theme).then(r => r.json())]);
  data = d; baseTheme = t; S = data.sizes; LH = liveHeight(data);
  settings = loadSettings();
  if (!(baseTheme.presets || {})[settings.bgPreset]) settings.bgPreset = DEFAULTS.bgPreset;
  theme = skyTheme(settings.bgPreset);
  settings.spoiler.upTo = Math.min(Math.max(data.ep_first, settings.spoiler.upTo), data.ep_last);
  index();
  applyVars();
  readSafe();
  setMode(layoutMode());
  buildSky();
  const nebulaDone = showNebula(settings.bgPreset);
  stars = { field: fieldFor(settings.bgPreset), ctx: $('#pstars').getContext('2d') };

  const fontsDone = loadFonts().then(() => body.classList.add('fonts'));
  const thumbsDone = preloadThumbs();
  await Promise.all([fontsDone, nebulaDone]);   // text is measured with the page's fonts, so the poster is drawn once they're in
  document.title = `Unstable Universe Timeline · E${data.ep_first}–${data.ep_last}`;
  draw();
  viewer = new Viewer(stage, host, data.W, LH, {
    maxScale: S.site_max_scale, insets, fitHeight: () => phone && !land,
    homeScale: () => land ? S.site_land_home_zoom / 100 * fitScale() : null,
    onTransform: v => { moveNebulae(v); paintStars(v); lastMove = performance.now(); },
    rubberMax: S.site_rubber_max, rubberK: S.site_rubber_k, rubberMs: S.site_rubber_ms,
    onChange: frame, onSettle: settle, onTap: tap, onHover: hover, onGestureStart: () => { hoverLabel(null); setHalo(null); endTips(); },
  });
  const h = viewer.home();
  viewer.set(h.s, h.tx, h.ty);
  syncDock();
  buildRail(); buildSpoilers(); buildAppearance(); buildExport(); buildLegend(); buildMajorTags(); buildMenu();
  search = new Search($('#search'), { data, sp, thumbs, faces: faces(), go: goToResult,
    glyph: (kind, tier, num) => kind === 'major' ? diamondSVG(24) : glyphSVG(tier, num), tierName: t => TIER[t] });
  applyHash(true);
  addEventListener('hashchange', () => applyHash(false));
  window.__timing = { ...(window.__timing || {}), interactive: performance.now() - T0 };
  await thumbsDone;
  await setThumbs();
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  $('#loading').classList.add('done');
  body.classList.add('ready');
  window.__timing.ready = performance.now() - T0;
  setTimeout(warmPresets, 1500);   // the other presets' sky, once the page has settled
}

function index() {
  epById = Object.fromEntries(data.episodes.map(e => [e.id, e]));
  epByN = Object.fromEntries(data.episodes.map(e => [e.n, e]));
  evByNum = Object.fromEntries(data.events.map(e => [e.num, e]));
  lineY = Object.fromEntries(data.lines.map(l => [l.p, l.y]));
  lineEps = {};
  for (const p of data.protags) lineEps[p] = data.episodes.filter(e => e.creator === p).sort((a, b) => a.x - b.x || a.n - b.n);
  majorsByX = data.majors.map((m, i) => ({ ...m, i })).sort((a, b) => a.x - b.x);
  cardY0 = Math.min(...data.episodes.map(e => e.top));
  cardY1 = Math.max(...data.episodes.map(e => e.top + e.h));
}

function layoutMode() {
  if (innerHeight <= S.site_land_max_h && innerWidth > innerHeight && matchMedia('(pointer: coarse)').matches) return 'land';
  return innerWidth <= S.site_phone_max_w ? 'phone' : 'desk';
}
function setMode(m) {
  mode = m; phone = m !== 'desk'; land = m === 'land';
  body.classList.toggle('phone', phone); body.classList.toggle('land', land);
  applyVars.setMode(m);
  updateSpoilerUI();
}
function readSafe() {   // env(safe-area-inset-*) as numbers, through a probe padded with them
  const cs = getComputedStyle($('#safe-probe'));
  Object.assign(safe, { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 });
}
const colW = () => safe.r + S.site_btn_land + 16;   // landscape: the button column at the right edge, with its margins
const insets = () => land ? { top: safe.t, bottom: safe.b, left: safe.l, right: colW() }
  : phone ? { top: S.site_bar_h_phone + safe.t, bottom: S.site_pill_h_phone + 16 + safe.b }
  : { top: S.site_bar_h + safe.t, bottom: S.site_dock_h + safe.b };

function applyVars() {   // theme.yaml `ui` colours and layout.yaml `site` sizes as CSS variables
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(theme.ui || {})) r.setProperty(`--ui-${k}`, v);
  const px = (k, v) => r.setProperty(k, v + 'px');
  px('--sz-dock', S.site_dock_h); px('--sz-chip-w', S.site_dock_chip_w); px('--sz-legend', S.site_legend_w); px('--sz-popup', S.site_popup_w);
  const setMode = m => {
    const k = { desk: '', phone: '_phone', land: '_land' }[m], ph = m === 'desk' ? '' : '_phone';
    px('--sz-btn', S['site_btn' + k]); px('--sz-bar', S['site_bar_h' + ph]);
    px('--sz-rail', S['site_rail_w' + k]); px('--sz-rail-face', S['site_rail_face' + k]);
    px('--sz-pill', S['site_pill_h' + ph]);
    r.setProperty('--sheet-h', `${S.site_sheet_frac * 100}dvh`);
    px('--sz-side', S.site_land_side_w); px('--sz-col', S.site_btn_land + 16);
  };
  applyVars.setMode = setMode;
  px('--sz-btn-land', S.site_btn_land);
  r.setProperty('--focus-dim', S.site_focus_dim);
  r.setProperty('--pix', `'${theme.fonts.pixel.family}', monospace`);
  r.setProperty('--txt', `'${theme.fonts.text.family}', system-ui, sans-serif`);
  setRootColours();
}
function setRootColours() {   // the legend and the dock draw marks with the poster's classes, so they need its colours too
  document.documentElement.style.cssText = document.documentElement.style.cssText.replace(/--[ca]-[^;]+;?/g, '') + ';' + cssVars(theme);
}

// ---------------------------------------------------------------- background presets (theme.yaml `presets`)
// A preset overrides only the sky: its gradient, the stars, the nebulae, the sparkles and `bg`. The page's sky layers, the
// live stars and nebulae, the poster's --c-* variables and the PNG export all read the chosen one through `theme`.
const SKY_KEYS = ['sky_top', 'sky_mid', 'sky_bottom', 'stars', 'nebulae', 'sparkle', 'bg'];
function skyTheme(id) {
  const p = (baseTheme.presets || {})[id] || {}, colors = { ...baseTheme.colors };
  for (const k of SKY_KEYS) if (p[k] != null) colors[k] = p[k];
  return { ...baseTheme, colors };
}
// Switching is immediate: the poster's sky colours are CSS variables on its <svg>, so they're set rather than redrawn,
// and the starfield tile, the star field and the nebula bitmap come from caches that warmPresets fills in idle time
// after the page is ready (or are made on the spot if the visitor is quicker). The nebulae crossfade (showNebula).
async function setPreset(id) {
  if (id === settings.bgPreset) return;
  settings.bgPreset = id; saveSettings();
  theme = skyTheme(id);
  setRootColours();
  const svg = host.firstElementChild;
  if (svg) for (const k of SKY_KEYS) { const v = theme.colors[k]; if (typeof v === 'string') svg.style.setProperty(`--c-${k}`, v); }
  buildSky(); bgCam = null;
  stars.field = fieldFor(id);
  if (viewer) { moveSky(viewer.view()); paintStars(viewer); }
  syncSwatches();
  await showNebula(id);
}
const starFields = {}, nebulae = {}, skyTiles = {};   // per preset
const fieldFor = id => starFields[id] || (starFields[id] = starField(data, skyTheme(id), LH));
const nebulaFor = id => nebulae[id] || (nebulae[id] = makeNebula(skyTheme(id)));
let lastMove = 0;   // when the camera last moved: presets are made only while it has been still for 500 ms
const idle = f => {
  const wait = () => window.requestIdleCallback ? requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 300);
  const go = () => performance.now() - lastMove < 500 || (viewer && (viewer.anim || viewer.pointers.size)) ? wait() : f();
  wait();
};
function warmPresets() {   // one preset per idle slot, so a visitor's first moves never wait on it
  const ids = Object.keys(baseTheme.presets || {});
  const next = () => {
    const id = ids.shift(); if (!id) return;
    idle(async () => { skyTile(id); fieldFor(id); await nebulaFor(id); next(); });
  };
  next();
}
function swatchURL(id, w = 96, h = 56) {   // a miniature of a preset's sky, from its colours and the same seeded draws
  const c = skyTheme(id).colors, k = 2, cv = document.createElement('canvas'); cv.width = w * k; cv.height = h * k;
  const x = cv.getContext('2d'); x.scale(k, k);
  const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, c.sky_top); g.addColorStop(0.55, c.sky_mid); g.addColorStop(1, c.sky_bottom);
  x.fillStyle = g; x.fillRect(0, 0, w, h);
  const rnd = seeded(3);
  for (let i = 0; i < 4; i++) {   // the nebulae, stronger than on the poster so they read at this size
    const cx = rnd() * w, cy = (0.1 + 0.8 * rnd()) * h, r = 24 + 22 * rnd(), col = c.nebulae[Math.floor(rnd() * c.nebulae.length)];
    const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, `rgba(${col},.55)`); rg.addColorStop(0.7, `rgba(${col},0)`);
    x.fillStyle = rg; x.fillRect(0, 0, w, h);
  }
  const rs = seeded(7);
  for (let i = 0; i < 70; i++) {
    const sx = rs() * w, sy = rs() * h, sz = rs() < 0.8 ? 0.8 : 1.4;
    x.globalAlpha = 0.35 + 0.6 * rs(); x.fillStyle = c.stars[Math.floor(rs() * c.stars.length)]; x.fillRect(sx, sy, sz, sz);
  }
  x.globalAlpha = 1; x.fillStyle = c.sparkle;
  for (const [sx, sy] of [[0.72, 0.3], [0.2, 0.7]]) { x.fillRect(sx * w - 0.75, sy * h - 3.5, 1.5, 7); x.fillRect(sx * w - 3.5, sy * h - 0.75, 7, 1.5); }
  return cv.toDataURL();
}
function buildAppearance() {
  const box = $('#bg-presets');
  box.innerHTML = Object.entries(baseTheme.presets || { night: { name: 'Night sky' } }).map(([id, p]) =>
    `<button class="u-swatch" role="radio" data-preset="${esc(id)}"><img src="${swatchURL(id)}" alt="" width="96" height="56"><span>${esc(p.name || id)}</span></button>`).join('');
  box.onclick = e => { const b = e.target.closest('[data-preset]'); if (b) setPreset(b.dataset.preset); };
  syncSwatches();
}
function syncSwatches() { for (const b of $$('#bg-presets [data-preset]')) b.setAttribute('aria-checked', b.dataset.preset === settings.bgPreset); }

async function loadFonts() {
  for (const f of Object.values(theme.fonts)) {
    const face = new FontFace(f.family, `url(${CONFIG.fonts}${f.file})`, f.family === theme.fonts.text.family ? { weight: '300 900' } : {});
    document.fonts.add(face);
  }
  await Promise.all([...document.fonts].map(f => f.load().catch(() => null)));
}

// every thumbnail, decoded before the loading screen goes, so nothing pops in later
async function preloadThumbs() {
  const eps = [...data.episodes].sort((a, b) => a.x - b.x);
  const sizes = data.thumb_bytes || {};
  const total = Object.values(sizes).reduce((a, b) => a + b, 0) || eps.length;
  let done = 0, i = 0;
  const fill = $('#load-fill'), text = $('#load-text');
  const worker = async () => {
    while (i < eps.length) {
      const e = eps[i++];
      try {
        const blob = await fetch(CONFIG.thumbUrl(e)).then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await img.decode();
        thumbs[e.id] = url; thumbBlobs[e.id] = blob; keepDecoded.push(img);
      } catch (err) { console.warn('thumbnail', e.id, err); }
      done += sizes[e.id] || 1;
      fill.style.width = `${(100 * done / total).toFixed(1)}%`;
      text.textContent = `Loading ${Object.keys(thumbs).length} / ${eps.length} episodes`;
    }
  };
  await Promise.all(Array.from({ length: CONFIG.thumbConcurrency }, worker));
  window.__timing = { ...(window.__timing || {}), thumbs: performance.now() - T0 };
}

function setThumbs() {   // fill every card's thumbnail at once and wait until they're painted-ready
  const imgs = host.querySelectorAll('image.th');
  const ps = [];
  for (const img of imgs) {
    const u = thumbs[img.dataset.id];
    if (!u || img.getAttribute('href') === u) continue;
    ps.push(new Promise(res => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }));
    img.setAttribute('href', u);
  }
  return Promise.race([Promise.all(ps), new Promise(r => setTimeout(r, 4000))]);
}

const creditLine = () => `Data: Unstable Universe Wiki (CC BY-SA 3.0) · Videos by ${data.protags.join(', ')} · fan-made, unofficial`;
const faces = () => Object.fromEntries(data.protags.map(p => [p, `${CONFIG.faces}${p}.png`]));

const idx = { ep: new Map(), ev: new Map(), mj: new Map(), dim: [] };
let titleBox = null;
function draw() {
  const t = performance.now();
  host.innerHTML = renderPoster(data, theme, { live: true, thumbs, faces: faces(), settings });
  host.style.width = data.W + 'px'; host.style.height = LH + 'px';
  host.firstElementChild.style.overflow = 'visible';   // its painted area is the nebulae's reach (see renderPoster)
  idx.ep.clear(); idx.ev.clear(); idx.mj.clear();
  for (const el of host.querySelectorAll('[data-ep]')) { const k = el.dataset.ep; if (!idx.ep.has(k)) idx.ep.set(k, []); idx.ep.get(k).push(el); }
  for (const el of host.querySelectorAll('.evmark[data-num], [data-stem]')) {
    const k = +(el.dataset.num || el.dataset.stem); if (!idx.ev.has(k)) idx.ev.set(k, []); idx.ev.get(k).push(el);
  }
  for (const el of host.querySelectorAll('[data-mj]')) { const k = +el.dataset.mj; if (!idx.mj.has(k)) idx.mj.set(k, []); idx.mj.get(k).push(el); }
  idx.dim = [...host.querySelectorAll('[data-dim]')];
  const pb = host.querySelector('.panel .panel-box');   // the title's box, a tap target (poster px)
  titleBox = pb ? [+pb.getAttribute('x'), +pb.getAttribute('y'), +pb.getAttribute('x') + +pb.getAttribute('width'), +pb.getAttribute('y') + +pb.getAttribute('height')] : null;
  hlKey = null; hlEls = []; boosts = []; haloKey = null; haloEls = [];
  if (viewer) paintStars(viewer);
  syncLineLit();
  if (focusArcId) applyFocus(focusArcId, false); else if (focusLineP) applyLineFocus(focusLineP); else if (focusCharName) applyCharFocus(focusCharName, false);
  updateSpoilerUI();
  buildDock();
  tagBlock = null;
  if (viewer) { syncDock(); frame(viewer.view()); }
  window.__timing = { ...(window.__timing || {}), draw: performance.now() - t };
}

// The nebulae as a bitmap at NEBULA_K poster px per pixel, in an <img> of its own that moves with the camera
// (moveNebulae). As an image layer the compositor only scales it: WebKit repainted an SVG layer, or a <canvas> inside a
// moving element, on every zoom step.
const NEBULA_K = 8;
let nebula = null;
async function makeNebula(th) {   // a preset's nebulae as a blob URL, kept for the visit: {url, x0, y0}
  const { svg, box: [x0, y0, x1, y1] } = nebulaSVG(data, th, LH), img = new Image(), k = NEBULA_K;
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode().catch(() => {});
  const cv = document.createElement('canvas');
  cv.width = Math.ceil((x1 - x0) / k); cv.height = Math.ceil((y1 - y0) / k);
  cv.getContext('2d').drawImage(img, 0, 0, (x1 - x0) / k, (y1 - y0) / k);
  URL.revokeObjectURL(img.src);
  const url = URL.createObjectURL(await new Promise(r => cv.toBlob(r)));
  cv.width = cv.height = 0;
  return { url, x0, y0 };
}
// Two <img> layers take turns: the new preset's nebulae, already decoded, go just above the old ones and fade in
// (.u-in is the start of the fade); then the old layer is hidden. At startup there's no fade.
const nebImgs = [$('#nebula'), $('#nebula2')];
let nebFront = nebImgs[0], nebTimer = null;
async function showNebula(id) {
  const n = await nebulaFor(id);
  if (id !== settings.bgPreset) return;
  const first = !nebula, old = nebFront, img = first ? old : nebImgs[1 - nebImgs.indexOf(old)];
  if (!first) { clearTimeout(nebTimer); img.classList.add('u-in'); }
  img.hidden = false; img.src = n.url;
  await img.decode().catch(() => {});
  if (id !== settings.bgPreset) return;
  nebula = n; nebFront = img;
  if (viewer) moveNebulae(viewer);
  if (first) return;
  old.after(img);   // above the old layer, still under the stars and the poster
  void img.offsetWidth;
  img.classList.remove('u-in');
  nebTimer = setTimeout(() => { old.hidden = true; }, 400);
}
function moveNebulae(v) {
  if (!nebula) return;
  const t = `translate(${v.tx + nebula.x0 * v.s}px,${v.ty + nebula.y0 * v.s}px) scale(${v.s * NEBULA_K})`;
  for (const el of nebImgs) if (!el.hidden) el.style.transform = t;
}

// The poster's own background stars, on a canvas the size of the stage, redrawn with every camera change.
let stars = null;
function paintStars(v) {
  const cv = stars.ctx.canvas;
  if (cv.hidden) return;
  const dpr = devicePixelRatio || 1, vw = v.vw, vh = v.vh, w = Math.round(vw * dpr), h = Math.round(vh * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  drawStars(stars.ctx, stars.field, v.s, v.tx, v.ty, vw, vh, dpr);
}

// ---------------------------------------------------------------- the sky behind the poster
// The poster itself is drawn without its sky gradient; the page draws it here, scaled with the poster, and sky_top /
// sky_bottom continue above and below it. An endless tiling starfield moves at a fraction of the pan (parallax).
function buildSky() {
  const c = theme.colors, sky = $('#sky'), tile = S.site_star_tile;
  sky.innerHTML = `<div style="position:absolute;left:0;right:0;bottom:100%;height:300vh;background:${c.sky_top}"></div>`;
  sky.style.cssText += `height:100px;background:linear-gradient(180deg,${c.sky_top},${c.sky_mid} 55%,${c.sky_bottom})`;
  stage.style.background = c.sky_bottom;
  const sf = $('#starfield');
  sf.style.cssText = `left:0;top:0;width:calc(100% + ${2 * tile}px);height:calc(100% + ${2 * tile}px);` +
    `background-image:url(${skyTile(settings.bgPreset)});background-size:${tile}px ${tile}px`;
}
function skyTile(id) {   // the endless starfield's tile for a preset, as a data URL (cached)
  if (skyTiles[id]) return skyTiles[id];
  const c = skyTheme(id).colors, tile = S.site_star_tile, dpr = Math.min(2, devicePixelRatio || 1);
  const cv = document.createElement('canvas'); cv.width = cv.height = tile * dpr;
  const x = cv.getContext('2d'), rnd = seeded(11);
  for (let i = 0; i < S.site_star_n; i++) {
    const px = Math.floor(rnd() * tile), py = Math.floor(rnd() * tile), s = [1, 1, 2, 2, 3][Math.floor(rnd() * 5)];
    x.globalAlpha = 0.2 + 0.5 * rnd();
    x.fillStyle = c.stars[Math.floor(rnd() * c.stars.length)];
    x.fillRect(px * dpr, py * dpr, s * dpr, s * dpr);
  }
  return (skyTiles[id] = cv.toDataURL());
}
// The starfield has its own camera: it pans site_parallax as far as the poster and zooms by (zoom ratio)^site_parallax,
// about the same screen point as the poster (the cursor or the pinch centre: the fixed point of the poster's change).
let bgCam = null;
function moveSky(v) {
  $('#sky').style.transform = `translate(0,${v.ty}px) scale(1,${LH * v.s / 100})`;
  const k = S.site_parallax, tile = S.site_star_tile;
  const b = Math.max(1, Math.pow(v.s / viewer.minScale, k));
  const c = bgCam || (bgCam = { x: 0, y: 0, b, s: v.s, tx: v.tx, ty: v.ty });
  const r = v.s / c.s, q = b / c.b;
  if (Math.abs(r - 1) < 1e-4) { c.x += k * (v.tx - c.tx); c.y += k * (v.ty - c.ty); }
  else {
    const fx = (v.tx - r * c.tx) / (1 - r), fy = (v.ty - r * c.ty) / (1 - r);
    c.x = fx + q * (c.x - fx); c.y = fy + q * (c.y - fy);
  }
  Object.assign(c, { b, s: v.s, tx: v.tx, ty: v.ty });
  const P = tile * b, m = a => ((a % P) + P) % P - P;
  $('#starfield').style.transform = `translate(${m(c.x).toFixed(1)}px,${m(c.y).toFixed(1)}px) scale(${b.toFixed(4)})`;
}

// ---------------------------------------------------------------- per frame and on settle
let lastS = null;
let geom = null;   // the camera as last drawn, for a rotation: the poster point at the area's centre, the scale, at home
function frame(v) {
  const a = viewer.area();
  geom = { x: ((a.x0 + a.x1) / 2 - v.tx) / v.s, y: ((a.y0 + a.y1) / 2 - v.ty) / v.s, s: v.s, home: atHome(), wide: v.vw > v.vh };
  moveSky(v);
  updateRail(v);
  updateMajorTags(v);
  if (!hoverEl.hidden || tipKey) hoverLabel(null);   // it named what was under the pointer before the camera moved
  if (popState) placePop();
  if (tips && tips.step !== 'wait' && camMoved(tips.cam)) endTips();   // a pan or zoom ends the events tip
  if (lastS !== v.s) { lastS = v.s; $('#zoom-pct').textContent = `${Math.round(zoomPct(v.s))}%`; }
}
function settle(v) {
  maybeEventTips(v);
  if (!popState && !viewer.anim && !viewer.pointers.size) setHash(atHome() ? '' : viewHash(v));
}

// ---------------------------------------------------------------- zoom indicator: 100% fits all four lines' cards
function fitScale() { const a = viewer.area(); return (a.y1 - a.y0) / (cardY1 - cardY0); }
const zoomPct = s => 100 * s / fitScale();
const zoomBtn = $('#zoom-pct'), zoomIn = $('#zoom-input');
zoomBtn.addEventListener('click', () => {
  zoomIn.value = Math.round(zoomPct(viewer.s));
  zoomBtn.hidden = true; zoomIn.hidden = false; zoomIn.focus(); zoomIn.select();
});
function endZoomEdit(apply) {
  if (zoomIn.hidden) return;
  const v = parseFloat(zoomIn.value.replace(',', '.'));
  zoomIn.hidden = true; zoomBtn.hidden = false;
  if (!apply || !(v > 0)) return;
  const a = viewer.area(), s = viewer.clampS(v / 100 * fitScale());
  viewer.zoomAt(s / viewer.s, innerWidth / 2, (a.y0 + a.y1) / 2, true);
}
zoomIn.addEventListener('keydown', e => { if (e.key === 'Enter') endZoomEdit(true); else if (e.key === 'Escape') endZoomEdit(false); e.stopPropagation(); });
zoomIn.addEventListener('blur', () => endZoomEdit(true));

// ---------------------------------------------------------------- deep links: #E028, #ev-12, #major-2 or #@x,y,zoom%
function setHash(h) {
  if ((location.hash || '') === h) return;
  history.replaceState(null, '', h || location.pathname + location.search);
}
function viewHash(v) {
  const a = viewer.area(), x = ((a.x0 + a.x1) / 2 - v.tx) / v.s, y = ((a.y0 + a.y1) / 2 - v.ty) / v.s;
  return `#@${Math.round(x)},${Math.round(y)},${+zoomPct(v.s).toFixed(1)}`;
}
function atHome() { const h = viewer.home(); return Math.abs(viewer.s - h.s) < 1e-4 && Math.abs(viewer.tx - h.tx) < 1 && Math.abs(viewer.ty - h.ty) < 1; }
function popHash(st) {
  if (st.kind === 'ep') return '#' + epNo(epById[st.id].n);
  return st.kind === 'ev' ? `#ev-${st.num}` : `#major-${st.i + 1}`;
}
function applyHash(initial) {
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch { /* a stray % (e.g. a hand-typed zoom) must not stop the page loading */ }
  let m, hit = null;
  if ((m = h.match(/^E0*(\d{1,3})$/i)) && epByN[+m[1]]) hit = { kind: 'ep', id: epByN[+m[1]].id };
  else if ((m = h.match(/^ev-(\d+)$/i)) && evByNum[+m[1]] && !sp().later(evByNum[+m[1]].first)) hit = { kind: 'ev', num: +m[1] };
  else if ((m = h.match(/^major-(\d+)$/i)) && data.majors[+m[1] - 1] && !sp().later(data.majors[+m[1] - 1].first)) hit = { kind: 'major', i: +m[1] - 1 };
  else if ((m = h.match(/^@(-?[\d.]+),(-?[\d.]+),([\d.]+)%?$/))) {
    const a = viewer.area(), s = viewer.clampS(+m[3] / 100 * fitScale());
    const t = { s, tx: (a.x0 + a.x1) / 2 - +m[1] * s, ty: (a.y0 + a.y1) / 2 - +m[2] * s };
    closePop(true);
    if (initial) viewer.set(t.s, t.tx, t.ty); else viewer.animateTo(t);
    return;
  }
  if (hit && !(popState && popHash(popState) === '#' + h)) openPop(hit, { fly: true, instant: initial });
}

// A rotation or a change of layout mode keeps the poster point at the centre and the scale (or the home view, if the
// camera was there), the open popup, sheet or dialog and the spoiler setting; a plain resize keeps the translation.
addEventListener('resize', () => {
  if (!data || !viewer) return;
  const was = mode, m = layoutMode(), g = geom;
  readSafe();
  if (m !== was) { setMode(m); if ((was === 'desk') !== (m === 'desk')) closeSheet(); buildLegend(); }
  tagBlock = null;
  if (g && (m !== was || (innerWidth > innerHeight) !== g.wide)) {
    viewer.stop();
    const t = g.home ? viewer.home() : viewer.centreOn(g.x, g.y, g.s);
    viewer.set(t.s, t.tx, t.ty);
    if (popState) relayoutPop();
  } else viewer.set(viewer.s, viewer.tx, viewer.ty);
  syncDock();
  lastS = null;
  if (tips && tips.step !== 'wait') { tips.cam = camNow(); placeTips(); }
});

// Variables the panes move by: set on those elements only, never on :root, which would restyle the whole poster.
const PANES = ['#bar', '#fabl', '#b-fit2', '#legend', '#arcs'];
function setPaneVar(k, v) { for (const sel of PANES) $(sel).style.setProperty(k, v); }

// ---------------------------------------------------------------- left rail: whose line is this
const rail = $('#rail');
let railOn = false, railFaceH = 0;
const railPos = {};   // protagonist -> {y: top of the face on screen, chip}, as updateRail last placed them
function buildRail() {
  rail.innerHTML = data.lines.map(l => `<div class="u-face" data-p="${esc(l.p)}"><img src="${CONFIG.faces}${esc(l.p)}.png" alt="${esc(l.p)}"><span>${esc(l.p)}</span></div>`).join('');
  rail.onclick = e => {
    const f = e.target.closest('.u-face'); if (!f) return;
    if (!f.classList.contains('chip')) return toggleCard(f.dataset.p);   // a face beside its line: who this is, and where to go on their line
    const a = viewer.area(), y = lineY[f.dataset.p];
    viewer.animateTo({ s: viewer.s, tx: viewer.tx, ty: (a.y0 + a.y1) / 2 - y * viewer.s });
  };
  rail.addEventListener('pointerover', e => {   // a mouse on a big face lights its line until it leaves
    const f = e.target.closest('.u-face');
    if (f && !f.classList.contains('chip') && e.pointerType === 'mouse') setHoverLine(f.dataset.p);
  });
  rail.addEventListener('pointerout', e => {
    const f = e.target.closest('.u-face');
    if (f && e.pointerType === 'mouse' && !(e.relatedTarget && f.contains(e.relatedTarget))) setHoverLine(null);
  });
}
function toggleCard(p, box = null) {   // box: the poster box it was opened from (a face on the poster, the dotted line)
  closeTransient();
  if (popState && popState.kind === 'line' && popState.p === p) return closePop();
  openPop({ kind: 'line', p, box });
}
// A protag line is lit (bright stroke) while a mouse is on its face, and while its protagonist card is open.
let hoverLineP = null;
function setHoverLine(p) { if (p !== hoverLineP) { hoverLineP = p; syncLineLit(); } }
function syncLineLit() {
  const want = new Set([hoverLineP, popState && popState.kind === 'line' ? popState.p : null].filter(Boolean));
  for (const el of host.querySelectorAll('.lit')) if (!want.has(el.dataset.pl)) el.classList.remove('lit');
  for (const p of want) for (const el of host.querySelectorAll(`.pline[data-pl="${CSS.escape(p)}"], .pglow[data-pl="${CSS.escape(p)}"]`)) el.classList.add('lit');
}
function updateRail(v) {
  const ln = data.lines[0], F = S.face, faceCx = ln.face.x + 60 + F / 2;
  const railW = land ? S.site_rail_w_land : phone ? S.site_rail_w_phone : S.site_rail_w;
  const on = v.tx + faceCx * v.s < (land ? safe.l : 0) + railW;
  if (on !== railOn) { railOn = on; rail.classList.toggle('on', on); setPaneVar('--rail-shift', on ? railW + 'px' : '0px'); tagBlock = null; }
  if (!on) return;
  const a = viewer.area(), fh = (land ? S.site_rail_face_land : phone ? S.site_rail_face_phone : S.site_rail_face) + (phone ? 4 : 18), ch = S.site_rail_chip + 14;
  let up = 0, down = 0;
  const items = rail.children, step = S.site_rail_chip_step;
  railFaceH = fh;
  const ys = data.lines.map(l => v.ty + l.y * v.s);
  const nUp = ys.filter(y => y < a.y0).length, nDown = ys.filter(y => y > a.y1).length;
  // the chips' stacks at the top and bottom are kept clear: a big face beside its line stops short of them
  const lo = nUp ? a.y0 + 4 + (nUp - 1) * step + ch + 2 : a.y0, hi = nDown ? a.y1 - ch - 4 - (nDown - 1) * step - 2 : a.y1;
  data.lines.forEach((l, k) => {
    const el = items[k], sy = ys[k];
    let y, chip = null;
    if (sy < a.y0) { chip = 'up'; y = a.y0 + 4 + up++ * step; }
    else if (sy > a.y1) { chip = 'down'; y = a.y1 - ch - 4 - (nDown - 1 - down++) * step; }
    else y = Math.max(lo, Math.min(hi - fh, sy - (phone ? fh / 2 : (S.site_rail_face + 4) / 2)));
    el.classList.toggle('chip', !!chip); el.classList.toggle('up', chip === 'up'); el.classList.toggle('down', chip === 'down');
    const tip = chip ? `Go to ${l.p}'s line` : '';   // a big face has no tooltip; its glow says it can be clicked
    if (el.title !== tip) el.title = tip;
    el.style.transform = `translateY(${y.toFixed(1)}px)`;
    el.style.zIndex = chip ? 3 : 2;   // chips over faces, always
    railPos[l.p] = { y, chip: !!chip };
  });
}

// ---------------------------------------------------------------- events dock: every event, in story order
// Numbered and major events by x (a numbered event on a major event's day comes first, as its mark does). Hidden until
// the visitor opens it with its toggle (the phone sheet too). It never follows the camera: it scrolls only when it's
// opened (to the selected event, or else to those in view at that moment) and when an event is selected.
const dock = $('#dock'), dockRow = $('#dock-row'), dockBtn = $('#dock-btn'), evSheet = $('#events-sheet'), evList = $('#events-list');
let dockItems = [], dockSel = null, dockCounts = { all: 0, high: 0 };
// The event tiers, biggest first, with one set of names everywhere (popups, tooltips, the dock, search, the Key and the
// poster's legend). The data keeps its own keys: `majors`, then the events' tier key, notable and minor. Major events and
// highlights are the gold ones, the story's biggest moments; the dock's "Highlights only" switch shows just those. The
// definitions say what each kind of event is, not how many there are.
const TIERS = ['major', 'key', 'notable', 'minor'];
const TIER = { major: 'Major event', key: 'Highlight', notable: 'Notable event', minor: 'Minor event' };
const tierDef = t => ({
  major: "A great battle or disaster where several protagonists' storylines meet. The gold line joins everyone involved.",
  key: "A storyline's biggest twist, such as a reveal, a death, an exile or a crowning.",
  notable: 'A turning point in one storyline.',
  minor: 'A smaller moment worth knowing.',
})[t];
const TIER_CH = { major: '◆', key: '★', notable: '●', minor: '○' };   // for the mark tooltips, which are plain text
const isHigh = it => it.kind === 'major' || evByNum[it.num].tier === 'key';
const isHighKey = k => { const [kind, n] = k.split(':'); return isHigh(kind === 'ev' ? { kind, num: +n } : { kind }); };
const shownInDock = it => !settings.dockHigh || isHigh(it);
const itemKey = it => it.kind === 'ev' ? `ev:${it.num}` : `major:${it.i}`;
function diamondSVG(size = 18) {   // the poster's major-event node: a gold square on its corner
  return `<svg class="u-diamond" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><rect x="4.4" y="4.4" width="11.2" height="11.2" rx="1" transform="rotate(45 10 10)" class="u-dia"/></svg>`;
}
function glyphSVG(tier, num, veiled = false) {   // the footnote glyph, as in the poster's band
  const G = S.fn_glyph, c = G / 2;
  if (veiled) return `<svg viewBox="0 0 ${G} ${G}"><circle cx="${c}" cy="${c}" r="${c - 8}" class="evm"/></svg>`;
  const ev = evByNum[num], fs = ev && ev.fn ? ev.fn.gfs : S.fn_num_fs[tier];
  return `<svg viewBox="0 0 ${G} ${G}" class="ev-${tier}">${fnGlyph(tier, num, fs, G, S.star_inner, S.fn_r)}</svg>`;
}
function tierGlyph(tier, size = 16) {   // a tier's mark without its number, filling a size-px box, with the poster's classes
  const shape = tier === 'key' ? `<polygon points="${starPoints(10, 10.6, 9.6, S.star_inner)}" class="evk" style="stroke-width:1"/>`
    : `<circle cx="10" cy="10" r="${tier === 'minor' ? 7.6 : 8.2}" class="ev${tier[0]}" style="stroke-width:${tier === 'minor' ? 2 : 1.4}"/>`;
  return `<svg class="u-tg ev-${tier}" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true">${shape}</svg>`;
}
// A dock chip's mark, drawn in a 30-unit box shown at 30 CSS px: one unit is one pixel, so strokes and the number are
// laid out for the size they're seen at (the footnote glyph scaled down to 30 px came out soft, with a hairline stroke
// and a number of 9 px or less).
const DG = 30;
function dockGlyph(tier, num, veiled = false) {
  const c = DG / 2, open = `<svg class="u-dg ev-${tier}" viewBox="0 0 ${DG} ${DG}" width="${DG}" height="${DG}" aria-hidden="true">`;
  if (veiled) return `${open}<circle cx="${c}" cy="${c}" r="9" class="evm" style="stroke-width:2"/></svg>`;
  const d = String(num).length, fs = tier === 'minor' ? [11, 11, 9][d - 1] : [13, 12, 10][d - 1];
  const shape = tier === 'key' ? `<polygon points="${starPoints(c, c + 1, 14.5, S.star_inner)}" class="evk" style="stroke-width:1.2"/>`
    : tier === 'notable' ? `<circle cx="${c}" cy="${c}" r="13" class="evn" style="stroke-width:1.5"/>`
    : `<circle cx="${c}" cy="${c}" r="11" class="evm" style="stroke-width:2"/>`;
  return `${open}${shape}<text x="${c}" y="${tier === 'key' ? c + 2 : c + 0.5}" class="evnum" style="font-size:${fs}px">${num}</text></svg>`;
}
function chipHTML(it) {
  if (it.kind === 'major') {
    const m = data.majors[it.i], veiled = sp().later(m.first);
    return `<button class="u-chip major${veiled ? ' veiled' : ''}" data-k="${itemKey(it)}" data-h="1"${veiled ? ' disabled' : ` title="${TIER.major}" aria-label="${TIER.major}: ${esc(m.full)}"`}>` +
      `<span class="u-gl">${veiled ? dockGlyph('minor', 0, true) : diamondSVG(30)}</span><span class="u-txt">${veiled ? 'Not watched yet' : esc(m.full)}</span></button>`;
  }
  const ev = evByNum[it.num], veiled = sp().later(ev.first);
  return `<button class="u-chip ${ev.tier}${veiled ? ' veiled' : ''}" data-k="${itemKey(it)}" data-h="${isHigh(it) ? 1 : 0}"${veiled ? ' disabled' : ` title="${TIER[ev.tier]} #${ev.num}" aria-label="${TIER[ev.tier]} ${ev.num}: ${esc(ev.short)}"`}>${dockGlyph(ev.tier, ev.num, veiled)}` +
    `<span class="u-txt">${veiled ? 'Not watched yet' : esc(ev.short)}</span></button>`;
}
function buildDock() {
  const items = [];
  for (const ev of data.events) {
    if (hiddenN(ev.first)) continue;
    const m = data.marks.find(mk => mk.num === ev.num);
    items.push({ kind: 'ev', num: ev.num, x: m ? m.x : 0, ord: 0 });
  }
  data.majors.forEach((m, i) => { if (!hiddenN(m.first)) items.push({ kind: 'major', i, x: m.x, ord: 1 }); });
  items.sort((a, b) => a.x - b.x || a.ord - b.ord || (a.num || 0) - (b.num || 0));
  dockItems = items;
  const html = items.map(chipHTML).join('');
  dockRow.innerHTML = html; evList.innerHTML = html;
  // the switch: "Highlights only", with what the list shows ("Showing all 153 events" / "Showing 15 highlights"; each event
  // counted once), set by applyDockTier
  dockCounts = { all: items.length, high: items.filter(isHigh).length };
  const sw = `<button class="u-hisw" role="switch" aria-checked="false" title="Show only the major events and highlights, the story's biggest moments">` +
    `<span class="u-track" aria-hidden="true"></span><span class="u-hilbl">Highlights only</span><small class="u-hicount"></small></button>`;
  $('#dock-tier').innerHTML = sw; $('#sheet-tier').innerHTML = sw;
  applyDockTier();
  if (dockSel) selectInDock(dockSel, false);
}
function applyDockTier() {   // hides the chips the switch leaves out, in the dock and the phone list
  for (const list of [dockRow, evList]) for (const c of list.children) c.hidden = settings.dockHigh && c.dataset.h !== '1';
  const n = dockCounts, count = settings.dockHigh ? `Showing ${n.high} highlight${n.high === 1 ? '' : 's'}` : `Showing all ${n.all} events`;
  for (const b of $$('.u-hisw')) { b.setAttribute('aria-checked', settings.dockHigh); b.querySelector('.u-hicount').textContent = count; }
  syncDockSteps();
}
function setDockHigh(on, keepScroll = false) {
  if (on === settings.dockHigh) return;
  settings.dockHigh = on; saveSettings();
  applyDockTier();
  if (keepScroll) return;
  if (dockSel && !dock.hidden) selectInDock(dockSel, true, 'auto'); else if (!dock.hidden) showInDock();
}
for (const el of [$('#dock-tier'), $('#sheet-tier')]) el.addEventListener('click', e => { if (e.target.closest('.u-hisw')) setDockHigh(!settings.dockHigh); });
function inViewKeys(v) {
  const a = viewer.area(), x0 = -v.tx / v.s, x1 = (v.vw - v.tx) / v.s, y0 = (a.y0 - v.ty) / v.s, y1 = (a.y1 - v.ty) / v.s;
  const keys = new Set();
  for (const m of data.marks) if (m.x >= x0 && m.x <= x1 && m.y >= y0 && m.y <= y1 && !hiddenN(m.first)) keys.add(`ev:${m.num}`);
  data.majors.forEach((m, i) => {
    if (m.x >= x0 && m.x <= x1 && !hiddenN(m.first) && m.segs.some(([a0, b0]) => b0 >= y0 && a0 <= y1)) keys.add(`major:${i}`);
  });
  return keys;
}
const dockOpen = () => phone ? !evSheet.hidden : settings.dockOpen;
function syncDock() {   // the toggle's state, the dock's visibility and the controls it lifts
  const open = dockOpen();
  dock.hidden = phone || !settings.dockOpen;
  dockBtn.setAttribute('aria-expanded', open);
  // the legend button sits level with the toggle, or above the open dock
  setPaneVar('--fab-bottom', phone ? '8px' : settings.dockOpen ? `${S.site_dock_h + 10}px` : `${(S.site_dock_h - S.site_btn) / 2}px`);
  rail.style.setProperty('--rail-bottom', !phone && settings.dockOpen ? `${S.site_dock_h}px` : '0px');
}
function setDockOpen(open) {
  if (phone) {
    if (open) {
      evSheet.hidden = false; closePop();
      const c = evList.querySelector('.u-sel:not([hidden])') || [...evList.children].find(c => !c.hidden && inViewKeys(viewer.view()).has(c.dataset.k));
      evList.scrollTop = c ? c.offsetTop - evList.offsetTop - 8 : 0;
    } else evSheet.hidden = true;
  } else {
    settings.dockOpen = open; saveSettings();
  }
  syncDock();
  if (open && !phone) showInDock();
}
function closeSheet() { if (!evSheet.hidden) { evSheet.hidden = true; syncDock(); } }
function showInDock() {   // on opening: the selected chip centred, or else the run of chips in view at this moment
  if (dockSel) return selectInDock(dockSel, true, 'auto');
  const keys = inViewKeys(viewer.view()), chips = [...dockRow.children].filter(c => !c.hidden && keys.has(c.dataset.k));
  if (!chips.length) return;
  const a = chips[0].offsetLeft, b = chips[chips.length - 1].offsetLeft + chips[chips.length - 1].offsetWidth, w = dockRow.clientWidth;
  dockRow.scrollLeft = b - a > w - 40 ? a - 20 : (a + b) / 2 - w / 2;
}
function selectInDock(k, scroll = true, behavior = null) {   // a selected event: marked and centred in the dock (and the phone list)
  if (settings.dockHigh && !isHighKey(k)) setDockHigh(false, true);   // an event the switch hides turns it off
  dockSel = k;
  for (const list of [dockRow, evList]) for (const c of list.children) c.classList.toggle('u-sel', c.dataset.k === k);
  syncDockSteps();
  const c = dockRow.querySelector(`[data-k="${k}"]`);
  if (!scroll || !c || dock.hidden) return;
  const left = c.offsetLeft + c.offsetWidth / 2 - dockRow.clientWidth / 2, far = Math.abs(left - dockRow.scrollLeft) > 2 * dockRow.clientWidth;
  dockRow.scrollTo({ left, behavior: behavior || (viewer.reduced || far ? 'auto' : 'smooth') });   // a long way: a jump, not a slow slide
}
function unselectInDock() {
  if (!dockSel) return;
  dockSel = null;
  for (const c of document.querySelectorAll('.u-chip.u-sel')) c.classList.remove('u-sel');
  syncDockSteps();
}
function chipEnter(e) {
  const c = e.target.closest('.u-chip');
  if (!c || c.disabled) return;
  const [kind, n] = c.dataset.k.split(':');
  if (kind === 'ev') { highlight('ev', +n); pulse(+n); } else highlight('major', +n);
}
function chipOpen(c) {
  const [kind, n] = c.dataset.k.split(':');
  if (kind === 'ev') openEventFromList(+n); else openPop({ kind: 'major', i: +n }, { glide: true });
}
dockRow.addEventListener('pointerover', chipEnter);
dockRow.addEventListener('pointerout', e => { if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.u-chip')) { if (!popState) highlight(null); } });
dockRow.addEventListener('click', e => { const c = e.target.closest('.u-chip'); if (c) chipOpen(c); });
dockBtn.addEventListener('click', () => setDockOpen(!dockOpen()));
evList.addEventListener('click', e => { const c = e.target.closest('.u-chip'); if (c) { setDockOpen(false); chipOpen(c); } });
swipeToClose(evSheet, () => setDockOpen(false), () => !land);

// ◀ ▶ in the dock: the previous or next event in story order (the dock's order) among those the switch shows,
// selected in the dock, its popup opened and the camera brought to it. With nothing selected, it starts from the
// middle of the view.
function dockStep(d) {
  const st = sp();
  const list = dockItems.filter(it => shownInDock(it) && !st.later(it.kind === 'ev' ? evByNum[it.num].first : data.majors[it.i].first));
  if (!list.length) return;
  let k = dockSel ? list.findIndex(it => itemKey(it) === dockSel) : -1, next;
  if (k >= 0) next = list[k + d];
  else {
    const v = viewer.view(), cx = (v.x0 + v.x1) / 2;
    next = d > 0 ? list.find(it => it.x > cx + 1) : [...list].reverse().find(it => it.x < cx - 1);
  }
  if (!next) return;
  if (next.kind === 'major') return openPop({ kind: 'major', i: next.i }, { nav: true });
  const v = viewer.view(), cy = (v.y0 + v.y1) / 2;
  const mark = data.marks.filter(m => m.num === next.num).sort((a, b) => Math.abs(a.y - cy) - Math.abs(b.y - cy))[0];
  openPop({ kind: 'ev', num: next.num, mark }, { nav: true });
}
$('#dock-prev').addEventListener('click', () => dockStep(-1));
$('#dock-next').addEventListener('click', () => dockStep(1));
function syncDockSteps() {   // disabled at either end of the filtered list
  const list = dockItems.filter(shownInDock), k = dockSel ? list.findIndex(it => itemKey(it) === dockSel) : -1;
  $('#dock-prev').disabled = k === 0; $('#dock-next').disabled = k >= 0 && k === list.length - 1;
}
function openEventFromList(num) {   // from the dock: the event's mark nearest the middle of the view
  const v = viewer.view(), cy = (v.y0 + v.y1) / 2;
  const ms = data.marks.filter(m => m.num === num).sort((a, b) => Math.abs(a.y - cy) - Math.abs(b.y - cy));
  if (ms.length) openPop({ kind: 'ev', num, mark: ms[0] }, { glide: true });
}
function pulse(num) {
  for (const el of idx.ev.get(num) || []) if (el.classList.contains('evmark')) { el.classList.remove('pulse'); void el.getBBox(); el.classList.add('pulse'); }
}

// ---------------------------------------------------------------- hover: instant highlight, no popup
let hlKey = null, hlEls = [], boosts = [];
function highlight(kind, id) {
  const key = kind ? `${kind}:${id}` : null;
  if (key === hlKey) return;
  for (const el of hlEls) el.classList.remove('hl');
  for (const b of boosts) b.remove();
  hlEls = []; boosts = []; hlKey = key;
  if (!kind) return;
  hlEls = (kind === 'ep' ? idx.ep.get(id) : kind === 'ev' ? idx.ev.get(+id) : idx.mj.get(+id)) || [];
  for (const el of hlEls) {
    el.classList.add('hl');
    if (el.classList.contains('beam')) {   // a brighter beam: a second copy over it at 0.6 (fill x1.6)
      const b = el.cloneNode(true); b.removeAttribute('data-dim'); b.classList.remove('hl'); b.classList.add('beam-boost');
      el.after(b); boosts.push(b);
    }
  }
}
function hitOf(el) { return el && el.closest ? el.closest('[data-hit]') : null; }
function hover(e) {
  if (viewer.gesture || viewer.anim) return;
  let h = hitOf(e.target);
  const open = !h || h.dataset.hit === 'arc';   // nothing under the pointer that outranks a mark or a major line's pad
  const near = open ? nearMark(e.clientX, e.clientY) : null;
  const mj = open && !near ? nearMajor(e.clientX, e.clientY) : null;
  const ab = open && !near && mj == null ? nearAbsent(e.clientX, e.clientY) : null;
  const gap = open && !near && mj == null && !ab ? nearGap(e.clientX, e.clientY, S.site_mark_hit) : null;
  const face = h && h.dataset.hit === 'face' ? h.dataset.face : null;
  stage.classList.toggle('u-pointer', !!near || mj != null || !!ab);
  setHoverLine(face || (ab && ab.p) || null);
  setHalo(!near && mj == null && !ab && !gap && h && (h.dataset.hit === 'arc' || h.dataset.hit === 'title' || face) ? h : null);
  if (near) { highlight('ev', near.num); hoverLabel(markTip(near.num), e, `ev:${near.num}`); return; }
  if (mj != null) { highlight('major', mj); hoverLabel(majorLabel(mj), e, `mj:${mj}`); return; }
  if (ab) { highlight(null); hoverLabel(joinText(ab.p), e); return; }
  if (gap) { highlight(null); hoverLabel(GAP_TEXT, e, `gap:${gap.p}:${gap.x}`); return; }
  if (!h) { highlight(null); hoverLabel(null); return; }
  if (face) { highlight(null); hoverLabel(null); return; }
  if (h.dataset.hit === 'title') { highlight(null); hoverLabel('About & credits', e, 'title'); return; }
  if (h.dataset.hit === 'arc') { highlight(null); hoverLabel(viewer.s < S.site_hover_label_scale ? data.arcs[h.dataset.arcHit].name : null, e); return; }
  if (h.dataset.hit === 'ep') {
    highlight('ep', h.dataset.id);
    const ep = epById[h.dataset.id];
    hoverLabel(viewer.s < S.site_hover_label_scale ? `${epNo(ep.n)} · ${sp().later(ep.n) ? 'Unwatched' : ep.title}` : null, e);
  } else if (h.dataset.hit === 'ev') { highlight('ev', h.dataset.num); hoverLabel(markTip(+h.dataset.num), e, `ev:${h.dataset.num}`); }
  else {   // a major event's line or diamond names it at any zoom; its label box only when zoomed out, as a card does
    const i = +h.dataset.i, box = h.classList.contains('mj-lbl');
    highlight('major', i);
    if (box) hoverLabel(viewer.s < S.site_hover_label_scale ? data.majors[i].full : null, e);
    else hoverLabel(majorLabel(i), e, `mj:${i}`);
  }
}
// The mark tooltip: "<glyph> <Tier> · #N <short>", desktop only, at once (site_tip_ms)
const markTip = num => { const ev = evByNum[num]; return `${TIER_CH[ev.tier]} ${TIER[ev.tier]} · #${num} ${ev.short}`; };
// A line drawn dotted before its protagonist joins the story (FlameFrags): the first episode on it
const joinEp = p => { const ln = data.lines.find(l => l.p === p); return ln && ln.start > ln.x0 ? lineEps[p][0] : null; };
const joinText = p => `${p} joins the story in ${epNo(joinEp(p).n)}`;
function nearAbsent(cx, cy) {   // a dotted stretch within site_major_pad screen px: {p, box} for the protagonist card's anchor
  const [px, py] = viewer.toPoster(cx, cy), R = S.site_major_pad / viewer.s + 3;
  for (const ln of data.lines) {
    if (ln.start > ln.x0 && px >= ln.x0 - R && px <= ln.start && Math.abs(py - ln.y) <= R) {
      const x = Math.max(ln.x0, Math.min(ln.start, px));
      return { p: ln.p, box: [x - 2, ln.y - 4, x + 2, ln.y + 4] };
    }
  }
  return null;
}
// A gap mark (//, a stretch of story time of unknown length): the nearest within pad screen px, {p, x, y}
function nearGap(cx, cy, pad) {
  const [px, py] = viewer.toPoster(cx, cy), R = pad / viewer.s;
  let best = null, bd = Infinity;
  for (const ln of data.lines) for (const x of ln.gaps) {
    const d = rectDist(px, py, x - 16, ln.y - 20, x + 16, ln.y + 20);
    if (d <= R && d < bd) { bd = d; best = { p: ln.p, x, y: ln.y }; }
  }
  return best;
}
function faceBox(p) {   // the face drawn at the start of a line, with its name under it (poster px)
  const ln = data.lines.find(l => l.p === p), fx = ln.face.x + 60, fy = ln.face.y, F = S.face;
  return [fx - 4, fy - 4, fx + F + 4, fy + F + 40];
}
const majorLabel = i => `${TIER_CH.major} ${TIER.major} · ${data.majors[i].full}`;
function majorAt(i, e) {   // the popup's anchor on a major event's line: the diamond within a tap's reach, else the point on the line
  const m = data.majors[i], py = viewer.toPoster(e.clientX, e.clientY)[1], R = S.site_tap_radius / viewer.s + S.node_half;
  const node = m.node_ys.find(y => Math.abs(y - py) <= R);
  if (node != null) return node;
  const seg = m.segs.find(([a, b]) => py >= a - R && py <= b + R) || m.segs[0];
  return Math.min(seg[1], Math.max(seg[0], py));
}
function nearMajor(cx, cy) {   // the watched major event whose line passes within site_major_pad screen px of a point
  const [px, py] = viewer.toPoster(cx, cy), R = S.site_major_pad / viewer.s + S.event_w / 2, st = sp();
  let best = null, bd = Infinity;
  data.majors.forEach((m, i) => {
    const dx = Math.abs(px - m.x);
    if (dx > R || st.later(m.first)) return;
    for (const [a, b] of m.segs) { const d = Math.hypot(dx, Math.max(0, a - py, py - b)); if (d <= R && d < bd) { bd = d; best = i; } }
  });
  return best;
}
// a touch pointer also "leaves" at the end of every tap: only a mouse leaving clears the hover state (and a tapped tooltip stays)
stage.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') return; highlight(null); hoverLabel(null); setHoverLine(null); setHalo(null); });
// Hover feedback that says "this can be clicked": an arc's bracket and its label glow together (data-br pairs them), a
// face on the poster glows. The glow is wide translucent strokes, no SVG filters, added to the hovered groups here and
// removed when the pointer leaves: kept in the poster even while hidden, they slowed WebKit's zooming.
let haloKey = null, haloEls = [];
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
function addHalo(g) {
  if (g.classList.contains('bracket')) {   // the bracket's own lines, wider, behind it
    const h = svgEl('g', { class: 'br-halo u-halo' });
    for (const l of g.querySelectorAll(':scope > line')) h.append(l.cloneNode());
    const xs = [...g.querySelectorAll(':scope > line')].flatMap(l => [+l.getAttribute('x1'), +l.getAttribute('x2')]), y = +g.querySelector(':scope > line').getAttribute('y1');
    h.prepend(svgEl('line', { x1: Math.min(...xs), y1: y, x2: Math.max(...xs), y2: y }));   // across the label's gap too
    g.prepend(h);
  } else if (g.classList.contains('arc-lbl')) {   // a ring around the label's knockout, in the arc's colour
    const ko = g.querySelector('.arc-ko'), a = n => +ko.getAttribute(n);
    g.prepend(svgEl('rect', { class: 'lbl-halo u-halo', x: a('x') - 5, y: a('y') - 5, width: a('width') + 10, height: a('height') + 10, rx: a('rx') + 5,
      stroke: g.querySelector('.arc-label').getAttribute('fill') }));
  } else if (g.classList.contains('panel')) {   // the title: a ring around its box
    const b = g.querySelector('.panel-box'), a = n => +b.getAttribute(n);
    g.prepend(svgEl('rect', { class: 'title-halo u-halo', x: a('x') - 9, y: a('y') - 9, width: a('width') + 18, height: a('height') + 18, rx: 10 }));
  } else {   // a face: two soft rings outside its glow
    const r = g.querySelector('.face-glow'), x = +r.getAttribute('x'), y = +r.getAttribute('y'), w = +r.getAttribute('width');
    const h = svgEl('g', { class: 'face-halo u-halo' });
    h.append(svgEl('rect', { x: x - 10, y: y - 10, width: w + 20, height: w + 20, rx: 10, 'stroke-width': 22, opacity: .18 }),
      svgEl('rect', { x: x - 5, y: y - 5, width: w + 10, height: w + 10, rx: 6, 'stroke-width': 8, opacity: .45 }));
    g.prepend(h);
  }
}
function setHalo(el) {
  const key = !el ? null : el.dataset.br != null ? `br:${el.dataset.br}` : el.dataset.face ? `face:${el.dataset.face}` : el.dataset.hit === 'title' ? 'title' : null;
  if (key === haloKey) return;
  for (const x of haloEls) { x.classList.remove('ahl', 'fhl', 'thl'); for (const h of x.querySelectorAll(':scope > .u-halo')) h.remove(); }
  haloKey = key;
  haloEls = !key ? [] : key.startsWith('br:') ? [...host.querySelectorAll(`[data-br="${el.dataset.br}"]`)] : [el];
  for (const x of haloEls) { x.classList.add(key.startsWith('br:') ? 'ahl' : key === 'title' ? 'thl' : 'fhl'); addHalo(x); }
}
function nearMark(cx, cy) {   // the nearest watched event mark within site_mark_hit screen px of a point
  const [px, py] = viewer.toPoster(cx, cy), R = S.site_mark_hit / viewer.s, st = sp();
  let best = null, bd = Infinity;
  for (const m of data.marks) {
    if (st.later(m.first)) continue;
    const d = Math.max(0, Math.hypot(px - m.x, py - m.y) - m.r);
    if (d <= R && d < bd) { bd = d; best = m; }
  }
  return best;
}
// The hover label beside the cursor. With a key (a mark, a major line or a gap mark) it's a tooltip: it shows after
// `delay` (site_tip_ms unless given) on the same target and then follows the cursor; without one it shows at once.
const hoverEl = $('#hover-label');
let tipKey = null, tipTimer = null, tipAt = null;
function hoverLabel(text, e, key = null, delay = S.site_tip_ms) {
  const l = hoverEl, put = p => { l.style.transform = `translate(${p.clientX + 14}px,${p.clientY + 16}px)`; };
  if (e) tipAt = { clientX: e.clientX, clientY: e.clientY };
  if (key && key === tipKey) { if (!l.hidden) put(tipAt); return; }
  clearTimeout(tipTimer); tipKey = key;
  if (!text) { l.hidden = true; return; }
  const show = () => { l.textContent = text; l.hidden = false; put(tipAt); };
  if (key && delay > 0) { l.hidden = true; tipTimer = setTimeout(show, delay); } else show();
}

// A touch tap on something that only has a tooltip (a gap mark): the hover label above the finger, for a few seconds.
function tapTip(text, e) {
  const l = hoverEl;
  clearTimeout(tipTimer); tipKey = 'tap';
  l.textContent = text; l.hidden = false;
  const w = l.offsetWidth, h = l.offsetHeight;
  const x = Math.max(8, Math.min(innerWidth - w - 8, e.clientX - w / 2)), y = Math.max(8, e.clientY - h - 28);
  l.style.transform = `translate(${x}px,${y}px)`;
  tipTimer = setTimeout(() => { if (tipKey === 'tap') hoverLabel(null); }, 3000);
}

// ---------------------------------------------------------------- taps and clicks
// A mouse click opens what's under it. A tap picks the nearest target within site_tap_radius, marks first on a tie.
// A touch tap on the poster is followed by a click at the same point. When the tap has just opened a sheet or side panel
// there, that click would land on it (e.g. a protagonist card's arc row, which focuses the arc), so it's swallowed.
let ghost = null;   // {t, x, y}: the last touch tap on the poster
document.addEventListener('click', e => {
  const g = ghost; ghost = null;
  if (g && performance.now() < g.t && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 12 && !e.target.closest('#stage')) { e.preventDefault(); e.stopPropagation(); }
}, true);
function tap(target, e) {
  closeTransient();
  ghost = e.pointerType !== 'mouse' ? { t: performance.now() + 600, x: e.clientX, y: e.clientY } : null;
  if (e.pointerType !== 'mouse') hoverLabel(null);   // a tapped tooltip (a gap mark's) goes on the next tap
  let hit = null;
  if (e.pointerType === 'mouse') {
    const h = hitOf(target), open = !h || h.dataset.hit === 'arc', near = open ? nearMark(e.clientX, e.clientY) : null;
    const mj = open && !near ? nearMajor(e.clientX, e.clientY) : null;
    const ab = open && !near && mj == null ? nearAbsent(e.clientX, e.clientY) : null;
    const gap = open && !near && mj == null && !ab ? nearGap(e.clientX, e.clientY, S.site_mark_hit) : null;
    if (near) hit = { kind: 'ev', num: near.num, mark: near };
    else if (mj != null) hit = { kind: 'major', i: mj, at: majorAt(mj, e) };
    else if (ab) hit = { kind: 'line', p: ab.p, box: ab.box };
    else if (gap) hit = { kind: 'gap' };
    else if (h) hit = hitFromEl(h, e);
  } else hit = nearestHit(e.clientX, e.clientY);
  tipsTap(hit);
  if (!hit) { closePop(); unfocusArc(); return false; }
  if (hit.kind === 'about') { openPanel('about'); return true; }
  if (hit.kind === 'gap') { closePop(); if (e.pointerType !== 'mouse') tapTip(GAP_TEXT, e); return true; }
  if (hit.kind === 'arc') { closePop(); focusArc(hit.arc); return true; }
  if (hit.kind === 'line') { toggleCard(hit.p, hit.box); return true; }
  openPop(hit, { glide: phone });
  return true;
}
function hitFromEl(h, e) {
  if (h.dataset.hit === 'title') return { kind: 'about' };
  if (h.dataset.hit === 'arc') return { kind: 'arc', arc: h.dataset.arcHit };
  if (h.dataset.hit === 'face') return { kind: 'line', p: h.dataset.face, box: faceBox(h.dataset.face) };
  if (h.dataset.hit === 'ep') return { kind: 'ep', id: h.dataset.id };
  if (h.dataset.hit === 'major') return { kind: 'major', i: +h.dataset.i, at: h.classList.contains('mj-lbl') ? null : majorAt(+h.dataset.i, e) };
  const num = +h.dataset.num, [px, py] = viewer.toPoster(e.clientX, e.clientY);
  const mark = data.marks.filter(m => m.num === num).sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
  return { kind: 'ev', num, mark };
}
function rectDist(px, py, x0, y0, x1, y1) { return Math.hypot(Math.max(x0 - px, 0, px - x1), Math.max(y0 - py, 0, py - y1)); }
function nearestHit(cx, cy) {
  const [px, py] = viewer.toPoster(cx, cy), s = viewer.s, R = S.site_tap_radius / s, st = sp();
  const cands = [];
  for (const m of data.marks) {
    if (st.later(m.first)) continue;   // later marks are hidden or veiled, never opened
    const d = Math.max(0, Math.hypot(px - m.x, py - m.y) - m.r);
    if (d <= R) cands.push({ d, pr: 0, hit: { kind: 'ev', num: m.num, mark: m } });
  }
  data.majors.forEach((m, i) => {
    if (st.later(m.first)) return;
    for (const y of m.node_ys) {   // the diamond: |dx| + |dy| <= its half-diagonal
      const d = Math.max(0, (Math.abs(px - m.x) + Math.abs(py - y) - S.event_node * Math.SQRT1_2) * Math.SQRT1_2);
      if (d <= R) cands.push({ d, pr: 1, hit: { kind: 'major', i, at: y } });
    }
    const d = rectDist(px, py, m.lo, m.y - m.h / 2, m.lo + m.w, m.y + m.h / 2);
    if (d <= R) cands.push({ d, pr: 1, hit: { kind: 'major', i } });
    const RL = S.site_major_pad / s + S.event_w / 2;   // the line: within its pad
    for (const [a, b] of m.segs) {
      const dl = Math.hypot(Math.abs(px - m.x), Math.max(0, a - py, py - b));
      if (dl <= RL) cands.push({ d: dl, pr: 3.5, hit: { kind: 'major', i, at: Math.min(b, Math.max(a, py)) } });
    }
  });
  for (const e of data.episodes) {
    if (hiddenN(e.n)) continue;
    const ly = lineY[e.creator], P = S.point / 2;
    const dp = rectDist(px, py, e.x - P, ly - P, e.x + P, ly + P);
    if (dp <= R) cands.push({ d: dp, pr: 2, hit: { kind: 'ep', id: e.id } });
    const dc = rectDist(px, py, e.L, e.top, e.L + S.card_w, e.top + e.h);
    if (dc <= R) cands.push({ d: dc, pr: 3, hit: { kind: 'ep', id: e.id } });
  }
  for (const ln of data.lines) {   // the faces at the start of the lines, and a line's dotted stretch before its protagonist joins
    const fb = faceBox(ln.p), df = rectDist(px, py, ...fb);
    if (df <= R) cands.push({ d: df, pr: 2, hit: { kind: 'line', p: ln.p, box: fb } });
    if (ln.start > ln.x0) {
      const da = rectDist(px, py, ln.x0, ln.y, ln.start, ln.y), RL = S.site_major_pad / s + 3;
      const x = Math.max(ln.x0, Math.min(ln.start, px));
      if (da <= RL) cands.push({ d: da, pr: 3.6, hit: { kind: 'line', p: ln.p, box: [x - 2, ln.y - 4, x + 2, ln.y + 4] } });
    }
  }
  for (const ln of data.lines) for (const x of ln.gaps) {   // gap marks: a tap shows what they mean
    const d = rectDist(px, py, x - 16, ln.y - 20, x + 16, ln.y + 20);
    if (d <= R) cands.push({ d, pr: 3.7, hit: { kind: 'gap' } });
  }
  if (titleBox) { const d = rectDist(px, py, ...titleBox); if (d <= R) cands.push({ d, pr: 5, hit: { kind: 'about' } }); }
  for (const b of data.brackets) {   // brackets last: a tap on one focuses its arc
    if (!b.members.some(([n]) => !st.later(n))) continue;
    const d = Math.min(rectDist(px, py, b.lo, b.y - S.bracket_tick, b.hi, b.y + S.bracket_tick), rectDist(px, py, b.lx, b.y - b.h / 2, b.lx + b.lw, b.y + b.h / 2));
    if (d <= R) cands.push({ d, pr: 4, hit: { kind: 'arc', arc: b.arc } });
  }
  const tie = 2 / s;   // within 2 screen px counts as a tie
  cands.sort((a, b) => (Math.abs(a.d - b.d) < tie ? a.pr - b.pr : a.d - b.d));
  return cands.length ? cands[0].hit : null;
}

// ---------------------------------------------------------------- popups: beside their anchor, following it
let popState = null;
const epNo = n => 'E' + String(n).padStart(3, '0');
const ytUrl = ep => ep.youtube ? `https://www.youtube.com/watch?v=${encodeURIComponent(ep.youtube)}` : null;
const arcColor = id => (id && theme.arcs[id]) || theme.colors.no_arc;

function anchorBox(st) {   // poster px
  if (st.kind === 'line') return st.box;
  if (st.kind === 'ep') { const e = epById[st.id]; return [e.L, e.top, e.L + S.card_w, e.top + e.h]; }
  if (st.kind === 'ev') { const m = st.mark; return [m.x - m.r, m.y - m.r, m.x + m.r, m.y + m.r]; }
  const m = data.majors[st.i];
  if (st.at != null) { const h = S.node_half; return [m.x - h, st.at - h, m.x + h, st.at + h]; }   // where the line or a diamond was clicked
  if (st.tag) {   // opened from its edge tag: the line where the tag row crosses it
    const t = tagRow(), y0 = (t - viewer.ty) / viewer.s, y1 = (t + TAG_H - viewer.ty) / viewer.s;
    return [m.x - 2, y0, m.x + 2, y1];
  }
  return [m.lo, m.y - m.h / 2, m.lo + m.w, m.y + m.h / 2];
}
function screenBox(st) {   // the anchor on screen: a rail face for a protagonist card opened there, else the poster anchor
  if (st.kind === 'line' && !st.box) {
    const r = railPos[st.p], x0 = land ? safe.l : 0, w = land ? S.site_rail_w_land : phone ? S.site_rail_w_phone : S.site_rail_w;
    return r && railOn && !r.chip ? [x0, r.y, x0 + w, r.y + railFaceH] : null;
  }
  const b = anchorBox(st), [x0, y0] = viewer.toScreen(b[0], b[1]), [x1, y1] = viewer.toScreen(b[2], b[3]);
  return [x0, y0, x1, y1];
}

function openPop(hit, { glide = false, nav = false, fly = false, instant = false } = {}) {
  closeTransient();
  endZoomEdit(false);
  if (hit.kind === 'ev' && !hit.mark) hit.mark = data.marks.find(m => m.num === hit.num);
  popState = { ...hit, s0: viewer.s, holdUntil: 0 };
  pop.innerHTML = (hit.kind === 'ep' ? epHTML(epById[hit.id]) : hit.kind === 'ev' ? evHTML(evByNum[hit.num]) : hit.kind === 'line' ? lineHTML(hit.p) : majorHTML(data.majors[hit.i])) +
    '<button class="u-popx" aria-label="Close">×</button><div class="u-arrow"></div>';
  pop.hidden = false; body.classList.add('u-popopen');
  pop.classList.toggle('u-linepop', hit.kind === 'line');
  popClass();
  popState.w = pop.offsetWidth; popState.h = pop.offsetHeight;
  if (hit.kind === 'line') {   // no deep link of its own; its line stays lit while it's open
    highlight(null); unselectInDock(); syncLineLit();
    if (hit.box && (glide || phone)) glideTo(popState, false, true);
    placePop(); return;
  }
  highlight(hit.kind, hit.kind === 'ep' ? hit.id : hit.kind === 'ev' ? hit.num : hit.i);
  if (hit.kind === 'ev') pulse(hit.num);
  if (hit.kind === 'ep') unselectInDock(); else selectInDock(itemKey(hit));
  if (fly) flyTo(popState, instant);
  else if (glide || nav) glideTo(popState, nav);
  setHash(popHash(hit));
  placePop();
}
// phone: a bottom sheet; landscape: a side panel beside the button column; desktop: beside its anchor, following it
function popClass() {
  pop.classList.toggle('u-sheetpop', phone && !land); pop.classList.toggle('u-sidepop', land);
  if (phone) pop.style.transform = '';
}
function freeArea(st) {   // the part of the poster's area an open popup leaves for its anchor
  const a = viewer.area();
  if (land) return { ...a, x1: Math.max(a.x0 + 80, innerWidth - colW() - st.w - 8) };
  return phone ? { ...a, y1: innerHeight - st.h } : a;
}
function relayoutPop() {   // after a rotation: the popup's new form, its anchor brought into view
  const st = popState;
  popClass();
  st.w = pop.offsetWidth; st.h = pop.offsetHeight; st.s0 = viewer.s;
  if ((st.kind !== 'line' || st.box) && !st.tag) glideTo(st, false, true);
  placePop();
}
function flyTo(st, instant) {   // search results and deep links: centred at site_search_scale (site_search_scale_land)
  const b = anchorBox(st), f = freeArea(st);
  const t = viewer.centreOn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, land ? S.site_search_scale_land : S.site_search_scale,
    (f.y0 + Math.max(f.y0 + 40, f.y1)) / 2, (f.x0 + f.x1) / 2);
  const ms = instant ? 0 : 700;
  st.holdUntil = performance.now() + ms + 120;
  st.s0 = viewer.clampS(t.s);
  if (instant) viewer.set(t.s, t.tx, t.ty); else viewer.animateTo(t, ms);
}

function glideTo(st, nav, whole = false) {   // bring the anchor (whole: all of it) into view: centred (or beside a phone's sheet or side panel), zoomed in to at least site_nav_min_scale
  const b = anchorBox(st), f = freeArea(st);
  const s = nav ? Math.max(viewer.s, S.site_nav_min_scale) : viewer.s;
  const sx = viewer.tx + (b[0] + b[2]) / 2 * s, sy0 = viewer.ty + b[1] * viewer.s, sy1 = viewer.ty + b[3] * viewer.s;
  const sxIn = whole ? viewer.tx + b[0] * s >= f.x0 && viewer.tx + b[2] * s <= f.x1 : sx > f.x0 + 20 && sx < f.x1 - 20;
  if (!nav && sxIn && sy0 > f.y0 && sy1 < f.y1) return;   // already in sight
  const cy = (f.y0 + Math.max(f.y0 + 40, f.y1)) / 2;
  const t = viewer.centreOn((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, s, cy, (f.x0 + f.x1) / 2);
  const ms = nav ? S.site_nav_ms : 300;
  st.holdUntil = performance.now() + ms + 80;   // no closing while the camera brings it in
  st.s0 = t.s;
  viewer.animateTo(t, ms);
}

function placePop() {
  const st = popState; if (!st) return;
  const sb = screenBox(st);
  if (!sb) return closePop(false, true);   // a protagonist card whose face left the rail
  const [x0, y0, x1, y1] = sb;
  const vw = innerWidth, vh = innerHeight, held = performance.now() < st.holdUntil || (st.kind === 'line' && !st.box);
  if (!held) {
    const z = viewer.s / st.s0;
    if (x1 < 0 || x0 > vw || y1 < 0 || y0 > vh || z > S.site_popup_close_zoom || z < 1 / S.site_popup_close_zoom) return closePop(false, true);
  }
  if (phone) return;
  const w = st.w, h = st.h, g = S.site_popup_gap + S.site_popup_arrow, m = 8, top = insets().top;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const clampY = y => Math.min(vh - m - h, Math.max(top, y)), clampX = x => Math.min(vw - m - w, Math.max(m, x));
  let side, x, y;
  if (x1 + g + w <= vw - m) { side = 'right'; x = x1 + g; y = clampY(cy - h / 2); }
  else if (x0 - g - w >= m) { side = 'left'; x = x0 - g - w; y = clampY(cy - h / 2); }
  else if (y1 + g + h <= vh - m) { side = 'below'; y = y1 + g; x = clampX(cx - w / 2); }
  else if (y0 - g - h >= top) { side = 'above'; y = y0 - g - h; x = clampX(cx - w / 2); }
  else {   // no side has room: the roomier of left and right, over the edge of the anchor at worst
    side = vw - x1 > x0 ? 'right' : 'left';
    x = side === 'right' ? clampX(x1 + g) : clampX(x0 - g - w); y = clampY(cy - h / 2);
  }
  pop.dataset.side = side;
  pop.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  const ar = pop.lastElementChild;
  if (side === 'right' || side === 'left') ar.style.cssText = `top:${Math.min(h - 22, Math.max(8, cy - y - 7)).toFixed(1)}px`;
  else ar.style.cssText = `left:${Math.min(w - 22, Math.max(8, cx - x - 7)).toFixed(1)}px`;
}

function closePop(keepHash = false, auto = false) {   // auto: the camera moved it out of sight; the dock keeps its selection
  if (!popState) return;
  const wasLine = popState.kind === 'line';
  popState = null; pop.hidden = true; pop.innerHTML = '';
  body.classList.remove('u-popopen');
  highlight(null);
  if (wasLine) syncLineLit();
  if (!auto) unselectInDock();
  if (!keepHash) setHash(atHome() ? '' : viewHash(viewer.view()));
  tipsPopClosed();
}

// previous / next: episodes along the same protagonist's line in story order; events by number; majors by x
function sequence(st) {
  if (st.kind === 'ep') { const p = epById[st.id].creator; return { list: lineEps[p].filter(e => !hiddenN(e.n)).map(e => ({ kind: 'ep', id: e.id })), label: `${p}'s line`, at: x => x.id === st.id }; }
  if (st.kind === 'ev') return { list: data.events.filter(e => !sp().later(e.first)).map(e => ({ kind: 'ev', num: e.num })), label: 'Events', at: x => x.num === st.num };
  return { list: majorsByX.filter(m => !sp().later(m.first)).map(m => ({ kind: 'major', i: m.i })), label: 'Major events', at: x => x.i === st.i };
}
function navStep(d) {
  if (!popState) return;
  const sq = sequence(popState), k = sq.list.findIndex(sq.at), next = sq.list[k + d];
  if (!next) return;
  if (next.kind === 'ev') {   // keep to the same line when the next event is on it
    const p = popState.mark && popState.mark.p;
    next.mark = data.marks.find(m => m.num === next.num && m.p === p) || data.marks.find(m => m.num === next.num);
  }
  openPop(next, { nav: true });
}
function navHTML(st) {
  const sq = sequence(st), k = sq.list.findIndex(sq.at);
  return `<div class="u-nav"><button data-nav="-1"${k <= 0 ? ' disabled' : ''}>◀ Previous</button><span>${esc(sq.label)}</span>` +
    `<button data-nav="1"${k < 0 || k >= sq.list.length - 1 ? ' disabled' : ''}>Next ▶</button></div>`;
}

function epHTML(ep) {
  const later = sp().later(ep.n), yt = ytUrl(ep);
  const st = { kind: 'ep', id: ep.id };
  if (later) return `<div class="u-pophead"><span class="u-badge" style="background:${theme.colors.no_arc}">${epNo(ep.n)}</span><strong>Unwatched · ${esc(ep.creator)}</strong></div>` +
    `<p class="u-muted">You haven't watched this one yet.</p>` + navHTML(st);
  const arc = ep.arc_name ? ` · <button class="u-link" data-arc="${esc(ep.arc)}">${esc(ep.arc_name)}</button>` : '';
  return `<div class="u-pophead"><span class="u-badge" style="background:${arcColor(ep.arc)}">${epNo(ep.n)}</span><strong>${esc(ep.title)}</strong></div>` +
    `<div class="u-popmeta">${esc(ep.creator)} · ${esc(ep.date)} · ${esc(ep.dur)}${arc}</div>` +
    (ep.summary ? `<p>${esc(ep.summary)}</p>` : '<p class="u-muted">No summary yet.</p>') +
    (yt ? `<a class="u-watch" href="${yt}" target="_blank" rel="noopener">▶ Watch on YouTube</a>` : '') + navHTML(st);
}
function lineHTML(p) {   // a protagonist's card: their episodes, their arcs (each focuses it), and where to go on their line
  const st = sp(), eps = lineEps[p].filter(e => !st.later(e.n)), join = joinEp(p);
  const meta = (eps.length ? `${eps.length} ${st.N != null ? 'watched ' : ''}episode${eps.length === 1 ? '' : 's'}` : 'Nothing watched yet') +
    (join ? ` · joins the story in ${epNo(join.n)}` : '');
  const seen = new Set(), arcs = data.brackets.filter(b => b.p === p && b.members.some(([n]) => !st.later(n))).sort((a, b) => a.lo - b.lo)
    .filter(b => !seen.has(b.arc) && seen.add(b.arc)).map(b => arcRowHTML(b.arc)).join('');
  const dis = eps.length ? '' : ' disabled';
  return `<div class="u-pophead u-linehead"><img src="${CONFIG.faces}${esc(p)}.png" alt="" width="32" height="32"><div><strong class="u-pname">${esc(p)}</strong>` +
    `<div class="u-popmeta">${meta}</div></div></div>` +
    (arcs ? `<div class="u-lgh">Arcs</div><div class="u-linearcs">${arcs}</div>` : '') +
    `<div class="u-linebtns"><button data-line="first"${dis}>First episode</button><button data-line="last"${dis}>Latest episode</button>` +
    `<button data-line="focus" class="u-wide"${dis}>${focusLineP === p ? 'Show every line' : 'Show only this line'}</button></div>`;
}
function lineGo(p, which) {
  const eps = lineEps[p].filter(e => !sp().later(e.n));
  if (which === 'focus') { closePop(); return focusLine(p); }
  const e = which === 'first' ? eps[0] : eps[eps.length - 1];
  if (e) openPop({ kind: 'ep', id: e.id }, { fly: true });
}
function epList(ids) {
  const s = sp();
  return ids.map(i => epById[i]).filter(Boolean).sort((a, b) => a.n - b.n).map(ep => s.later(ep.n)
    ? `<li class="u-muted">${epNo(ep.n)} · not watched yet</li>`
    : `<li><button data-go="${ep.id}">${epNo(ep.n)} · ${esc(ep.title)}</button>${ytUrl(ep) ? `<a href="${ytUrl(ep)}" target="_blank" rel="noopener" title="Watch on YouTube" aria-label="Watch on YouTube">▶</a>` : ''}</li>`).join('');
}
const INFO_SVG = '<svg class="u-info" viewBox="0 0 16 16" width="15" height="15" aria-label="definition"><circle cx="8" cy="8" r="6.6"/><path d="M8 7.2v4.2M8 4.6v.4"/></svg>';
// the tier line: the tier's name, and an ⓘ (or the name) that opens its definition in place
const tierLine = (t, glyph) => `<div class="u-popmeta u-tier">${glyph}<button class="u-tierbtn" aria-expanded="false" title="What does this mean?"><strong>${TIER[t]}</strong>${INFO_SVG}</button></div>` +
  `<div class="u-tierdef" hidden>${tierDef(t)}</div>`;
function evHTML(ev) {
  return `<div class="u-pophead"><span class="u-badge tier-${ev.tier}">#${ev.num}</span><strong>${esc(ev.name)}</strong></div>` +
    tierLine(ev.tier, tierGlyph(ev.tier)) +
    `<div class="u-popmeta">${ev.protags.map(esc).join(', ')}</div>` +
    `<p>${esc(ev.desc || ev.short)}</p><ul class="u-eps">${epList(ev.episodes)}</ul>` + navHTML({ kind: 'ev', num: ev.num });
}
function majorHTML(ev) {
  const i = data.majors.indexOf(ev);
  return `<div class="u-pophead"><span class="u-badge-dia">${diamondSVG(18)}</span><strong>${esc(ev.full)}</strong></div>` +
    tierLine('major', diamondSVG(16)) + `<div class="u-popmeta">${ev.protags.map(esc).join(', ')}</div>` + (ev.desc ? `<p>${esc(ev.desc)}</p>` : '') +
    `<ul class="u-eps">${epList(ev.episodes)}</ul>` + navHTML({ kind: 'major', i });
}

pop.addEventListener('click', e => {
  if (e.target.closest('.u-popx')) return closePop();
  const tb = e.target.closest('.u-tierbtn');
  if (tb) {   // the tier's definition, in place; the popup keeps its anchor
    const d = pop.querySelector('.u-tierdef'), open = d.hidden;
    d.hidden = !open; tb.setAttribute('aria-expanded', open);
    if (popState) { popState.h = pop.offsetHeight; placePop(); }
    return;
  }
  const nav = e.target.closest('[data-nav]');
  if (nav) return navStep(+nav.dataset.nav);
  const go = e.target.closest('[data-go]');
  if (go) return openPop({ kind: 'ep', id: go.dataset.go }, { nav: true });
  const ln = e.target.closest('[data-line]');
  if (ln && popState && popState.kind === 'line') return lineGo(popState.p, ln.dataset.line);
  const arc = e.target.closest('[data-arc]');
  if (arc) { const a = arc.dataset.arc; closePop(); focusArc(a); }
});
swipeToClose(pop, closePop, () => phone && !land);

// ---------------------------------------------------------------- search
function goToResult(r) {
  closeDialogs();
  if (r.kind === 'char') { closePop(); return focusChar(r.id); }
  if (r.kind === 'arc') { if (focusArcId === r.arc) applyFocus(r.arc, true); else focusArc(r.arc); return; }
  if (r.kind === 'line') {
    closePop();
    const a = viewer.area(), s = Math.max(viewer.s, fitScale()), cx = ((a.x0 + a.x1) / 2 - viewer.tx) / viewer.s;
    viewer.animateTo(viewer.centreOn(cx, lineY[r.p], s, (a.y0 + a.y1) / 2), 500);
    return;
  }
  openPop(r.kind === 'ep' ? { kind: 'ep', id: r.id } : r.kind === 'ev' ? { kind: 'ev', num: r.num } : { kind: 'major', i: r.i }, { fly: true });
}
function openSearch() {
  endTips();
  closeDialogs(); closePop(); closeSheet();
  if (!phone) {   // desktop: the panel opens over the search field, as if the field grew
    const r = $('#b-search').getBoundingClientRect(), w = Math.min(480, innerWidth - 20);
    const st = $('#search').style;
    st.setProperty('--sx', `${Math.max(10, Math.min(r.left, innerWidth - 10 - w))}px`); st.setProperty('--sy', `${r.top}px`); st.setProperty('--sw', `${w}px`);
  }
  search.open();
}
$('#b-search').addEventListener('click', openSearch);
$('#search').addEventListener('click', e => { if (e.target.id === 'search') search.close(); });

// ---------------------------------------------------------------- arc focus: dim everything else, fly to its brackets
// Only one focus at a time: an arc, a protag line or a character.
let focusArcId = null, focusLineP = null, focusCharName = null;
function focusArc(arc, fly = true) {
  if (focusArcId === arc && fly) return unfocusArc();
  focusArcId = arc; focusLineP = null; focusCharName = null;
  applyFocus(arc, fly);
}
function focusLine(p) {   // everything not on p's line dims; the camera stays
  if (focusLineP === p) return unfocusArc();
  focusArcId = null; focusLineP = p; focusCharName = null;
  applyLineFocus(p);
}
// Character focus (from search): every episode, event and major event that doesn't involve the character dims. The
// index is data.characters, built from kb/ by build_site.py (characters(): an episode involves whoever its wiki page
// links; an event, whoever its text names). The lines stay; the camera takes in all of it. `id` is the character's id.
function focusChar(id, fly = true) {
  focusArcId = null; focusLineP = null; focusCharName = id;
  applyCharFocus(id, fly);
}
// The major events' edge tags dim with the rest of a major event: mjs is the set of those in focus, or null for none
function dimTags(mjs) { tagEls.forEach((el, i) => el.classList.toggle('u-dim', !!mjs && !mjs.has(i))); }
function applyCharFocus(id, fly) {
  const c = (data.characters || []).find(x => x.id === id);
  if (!c) return unfocusArc();
  const eps = new Set(c.eps), evs = new Set(c.evs), mjs = new Set(c.majors);
  for (const el of idx.dim) {
    const d = el.dataset;
    const inF = d.pl != null || (d.ep && eps.has(d.ep)) || (d.num && evs.has(+d.num)) || (d.stem && evs.has(+d.stem)) || (d.mjl != null && mjs.has(+d.mjl));
    el.classList.toggle('in-focus', !!inF);
  }
  host.firstElementChild.classList.add('focusing');
  dimTags(mjs);
  const chip = $('#focus-chip');
  chip.textContent = `✕ ${c.name}`; chip.hidden = false; tagBlock = null;
  $$('.u-lgarc').forEach(b => b.classList.remove('on'));
  if (!fly) return;
  const st = sp(), es = c.eps.map(i => epById[i]).filter(e => e && !hiddenN(e.n));
  const ms = data.marks.filter(m => evs.has(m.num) && !st.later(m.first));
  for (const i of mjs) { const m = data.majors[i]; if (!st.later(m.first)) ms.push(...m.node_ys.map(y => ({ x: m.x, y }))); }
  if (!es.length && !ms.length) return;
  const x0 = Math.min(...es.map(e => e.L), ...ms.map(m => m.x - 40)), x1 = Math.max(...es.map(e => e.L + S.card_w), ...ms.map(m => m.x + 40));
  const y0 = Math.min(...es.map(e => e.top), ...ms.map(m => m.y - 40)), y1 = Math.max(...es.map(e => e.top + e.h), ...ms.map(m => m.y + 40));
  viewer.focusBox(x0, y0, x1, y1, 0.9);
}
function applyLineFocus(p) {
  for (const el of idx.dim) {
    const d = el.dataset;
    const inF = d.pl != null ? d.pl === p : d.p != null ? d.p === p : d.ep ? epById[d.ep].creator === p
      : d.mjl != null ? data.majors[+d.mjl].protags.includes(p) : false;
    el.classList.toggle('in-focus', inF);
  }
  host.firstElementChild.classList.add('focusing');
  dimTags(new Set(data.majors.flatMap((m, i) => m.protags.includes(p) ? [i] : [])));
  const chip = $('#focus-chip');
  chip.textContent = `✕ ${p}'s line`; chip.hidden = false; tagBlock = null;
  $$('.u-lgarc').forEach(b => b.classList.remove('on'));
}
function applyFocus(arc, fly) {
  const svg = host.firstElementChild;
  const brs = data.brackets.filter(b => b.arc === arc && b.members.some(([n]) => !hiddenN(n)));
  if (!brs.length) return unfocusArc();
  const members = new Set(brs.flatMap(b => b.members.map(([n]) => epByN[n].id)));
  const evs = new Set(data.events.filter(ev => ev.episodes.some(i => members.has(i))).map(ev => ev.num));
  const mjs = new Set(data.majors.flatMap((m, i) => m.episodes.some(id => members.has(id)) ? [i] : []));   // as for events
  for (const el of idx.dim) {
    const d = el.dataset;
    const inF = d.pl != null || d.arc === arc || (d.ep && members.has(d.ep)) || (d.num && evs.has(+d.num)) || (d.stem && evs.has(+d.stem)) || (d.mjl != null && mjs.has(+d.mjl));
    el.classList.toggle('in-focus', !!inF);
  }
  svg.classList.add('focusing');
  dimTags(mjs);
  const chip = $('#focus-chip');
  chip.textContent = `✕ ${data.arcs[arc].name}`; chip.hidden = false; tagBlock = null;
  $$('.u-lgarc').forEach(b => b.classList.toggle('on', b.dataset.arc === arc));
  if (!fly) return;
  const eps = [...members].map(i => epById[i]);
  const x0 = Math.min(...brs.map(b => b.lo), ...eps.map(e => e.L)), x1 = Math.max(...brs.map(b => b.hi), ...eps.map(e => e.L + S.card_w));
  const y0 = Math.min(...brs.map(b => b.y - b.h), ...eps.map(e => e.top)), y1 = Math.max(...brs.map(b => b.y + b.h), ...eps.map(e => e.top + e.h));
  viewer.focusBox(x0, y0, x1, y1, 0.9);
}
function unfocusArc() {   // clears any focus: an arc's, a line's or a character's
  focusArcId = null; focusLineP = null; focusCharName = null;
  const svg = host.firstElementChild;
  if (svg) svg.classList.remove('focusing');
  dimTags(null);
  $('#focus-chip').hidden = true; tagBlock = null;
  $$('.u-lgarc').forEach(b => b.classList.remove('on'));
}
$('#focus-chip').addEventListener('click', unfocusArc);

// ---------------------------------------------------------------- the Key ("Reading the map") and the Arcs panel
// The Key explains only what a visitor needs to read the poster, with the poster's own legend glyphs (data.legend.rows:
// [svg, text, key]) and the site's own short wording; the poster's longer legend rows are left out. A row is
// [key, text] (a glyph from the poster's legend, or 'card', drawn here) or [null, text] (a line of text).
const GAP_TEXT = 'Time skipped here; length unknown';
// A row's text may start with "**Name**:", shown bold. Events are one ranked list, biggest first (TIERS).
const LEGEND = () => [
  ['Events', [[null, 'The bigger and brighter, the more it matters.'],
    ...TIERS.map(t => [t, `**${TIER[t]}**: ${tierDef(t)[0].toLowerCase()}${tierDef(t).slice(1).replace(/\.$/, '')}`]),
    [null, `${phone ? 'Tap' : 'Click'} any mark to read it. **Events** lists them all in story order.`]]],
  ['Episodes', [['card', `**Episode**: its colour is its arc. ${phone ? 'Tap' : 'Click'} it for a summary and the video`], ['beam', '**Beam**: the days a long episode covers']]],
  ['Time', [[null, 'Time runs left to right; the same spot on every line is the same moment.'], ['ticks', '1 tick = 1 day in the story'], ['gap', GAP_TEXT]]],
];
const bold = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
function buildLegend() {
  const rows = new Map(data.legend.rows.map(([svg, text, key]) => [key, svg]));
  const arc = data.legend.arcs[0];
  rows.set('card', `<svg width="120" height="44" viewBox="0 0 120 44"><rect x="22" y="4" width="76" height="36" fill="var(--c-card_bg)" stroke="var(--a-${arc})" stroke-width="3"/>` +
    '<rect x="25.5" y="7.5" width="69" height="18" fill="var(--c-thumb_bg)"/></svg>');
  const row = ([k, t]) => k == null ? `<p class="u-lgintro">${bold(t)}</p>` : rows.get(k) ? `<div class="u-lgrow">${rows.get(k)}<span>${bold(t)}</span></div>` : '';
  $('#lg-rows').innerHTML = LEGEND().map(([h, rs]) => `<div class="u-lgh">${h}</div>` + rs.map(row).join('')).join('');
  $('#dock-btn .u-keygl').innerHTML = tierGlyph('key', 14) + tierGlyph('notable', 14) + diamondSVG(14);
  $('#arcs .u-arcshint').textContent = `${phone ? 'Tap' : 'Click'} one to show only it.`;
  fillLegendArcs();
}
function arcRowHTML(a) {   // an arc as a coloured bracket and its name; a click focuses it
  const col = `var(--a-${a})`;
  return `<button class="u-lgarc${a === focusArcId ? ' on' : ''}" data-arc="${a}" style="color:${col}"><svg viewBox="0 0 120 30"><g style="stroke:${col}" stroke-width="8">` +
    `<line x1="4" y1="15" x2="116" y2="15"/><line x1="4" y1="3" x2="4" y2="27"/><line x1="116" y1="3" x2="116" y2="27"/></g></svg>${esc(data.arcs[a].short.toUpperCase())}</button>`;
}
function fillLegendArcs() {   // the Arcs panel: every arc with a watched episode, in the poster's legend order
  const visible = new Set(data.brackets.filter(b => b.members.some(([n]) => !hiddenN(n))).map(b => b.arc));
  const arcs = [...data.legend.arcs, ...data.legend.sagas].filter(a => visible.has(a));
  $('#lg-arclist').innerHTML = arcs.map(a => arcRowHTML(a)).join('');
  $('#lg-arcn').textContent = `(${arcs.length})`;
}
$('#lg-arclist').addEventListener('click', e => {
  const b = e.target.closest('.u-lgarc'); if (!b) return;
  if (phone) closeDialogs();
  focusArc(b.dataset.arc);
});

// ---------------------------------------------------------------- major events' edge tags
// A major event's name is only in its label at the top of the poster. When its line is in view and the whole label is
// off screen, a fixed-size tag at the top of the poster area names it (its short `tag` from timeline.yaml), at the
// line's x; a click opens its popup. Never scaled.
const TAG_H = 22, tagBox = $('#mjtags');
let tagEls = [], tagW = [], tagBlock = null;
const tagRow = () => viewer.area().y0 + 6;
function buildMajorTags() {
  tagBox.innerHTML = data.majors.map((m, i) =>
    `<button class="u-mjtag" data-i="${i}" aria-label="${TIER.major}: ${esc(m.full)}" title="${esc(m.full)}">${diamondSVG(10)}<span>${esc((m.tag || m.name).toUpperCase())}</span><span class="u-up" aria-hidden="true">▲</span></button>`).join('');
  tagEls = [...tagBox.children];
  tagW = tagEls.map(el => el.offsetWidth);   // measured once, shown
  for (const el of tagEls) el.hidden = true;
}
function tagBlockers() {   // fixed controls the tag row can run into (the focus chip on a phone); cached until one changes
  if (!tagBlock) tagBlock = $$('#focus-chip, #bar > :not(.u-grow)').filter(el => el.offsetParent !== null).map(el => el.getBoundingClientRect());
  return tagBlock;
}
function updateMajorTags(v) {
  if (!tagEls.length) return;
  const a = viewer.area(), y = tagRow(), st = sp();
  const railR = railOn ? (land ? safe.l + S.site_rail_w_land : phone ? S.site_rail_w_phone : S.site_rail_w) : a.x0;
  const lo = Math.max(a.x0, railR), hi = a.x1, py0 = (a.y0 - v.ty) / v.s, py1 = (a.y1 - v.ty) / v.s;
  let lastR = -Infinity;
  for (const { i } of majorsByX) {
    const m = data.majors[i], el = tagEls[i], w = tagW[i], sx = v.tx + m.x * v.s;
    const offScreen = v.ty + (m.y + m.h / 2) * v.s <= 0 || v.ty + (m.y - m.h / 2) * v.s >= v.vh || v.tx + (m.lo + m.w) * v.s <= 0 || v.tx + m.lo * v.s >= v.vw;
    let show = !st.later(m.first) && offScreen && sx >= lo + 40 && sx <= hi - 40 && m.segs.some(([s0, s1]) => s1 >= py0 && s0 <= py1);
    const left = Math.min(hi - 4 - w, Math.max(lo + 4, sx - w / 2));
    if (show && (left < lastR + 6 || tagBlockers().some(r => r.left < left + w && r.right > left && r.top < y + TAG_H && r.bottom > y))) show = false;
    if (show) { lastR = left + w; el.style.transform = `translate(${left.toFixed(1)}px,${y.toFixed(1)}px)`; }
    if (el.hidden === show) el.hidden = !show;
  }
}
tagBox.addEventListener('click', e => {
  const t = e.target.closest('.u-mjtag'); if (!t) return;
  const i = +t.dataset.i;
  closeTransient();
  if (popState && popState.kind === 'major' && popState.i === i && popState.tag) return closePop();
  openPop({ kind: 'major', i, tag: true });
});
tagBox.addEventListener('pointerover', e => { const t = e.target.closest('.u-mjtag'); if (t && e.pointerType === 'mouse') highlight('major', +t.dataset.i); });
tagBox.addEventListener('pointerout', e => { if (e.pointerType === 'mouse' && !popState) highlight(null); });

// ---------------------------------------------------------------- the events tip: two steps, once per browser
// On the first settle zoomed in to site_key_hint_scale or closer, with the page ready, nothing open (popup, dialog,
// search, events sheet) and a gold mark in view (a highlight's star, else a major event's diamond, watched, clear of the
// edges and the controls), it waits 600 ms and, if the camera hasn't moved, rings the gold mark nearest the centre with a
// bubble (step 1); Next rings the Events button (step 2). Tapping a mark in step 1 opens it as usual and step 2 follows
// 300 ms after its popup closes. Anything else ends it: a pan or zoom, a tap elsewhere, any control, Escape, ✕ or
// Got it. It never dims the page, moves the camera or takes focus, and never comes back: localStorage seenEventTips is
// written when step 1 shows. Until then every settle checks again.
const TIPS_KEY = 'seenEventTips', tipsEl = $('#event-tips'), etRing = $('#et-ring'), etBub = $('#et-bubble');
let tips = null;   // {step: 1, 2 or 'wait' (a popup the tip led to is open), at: step 1's mark, cam: the camera it was shown at}
let tipsDone = (() => { try { return localStorage.getItem(TIPS_KEY) === '1'; } catch { return false; } })(), tipsTimer = null;
const camNow = () => ({ s: viewer.s, tx: viewer.tx, ty: viewer.ty });
const camMoved = c => Math.abs(viewer.s / c.s - 1) > 1e-6 || Math.abs(viewer.tx - c.tx) > 0.5 || Math.abs(viewer.ty - c.ty) > 0.5;
function maybeEventTips(v) {
  if (tipsDone || tips || v.s < S.site_key_hint_scale) return;
  clearTimeout(tipsTimer);
  const cam = camNow();
  tipsTimer = setTimeout(() => {
    if (tipsDone || tips || camMoved(cam) || viewer.anim || viewer.pointers.size) return;
    if (!body.classList.contains('ready') || popState || !$('#search').hidden || !evSheet.hidden || $$('.u-dlg').some(p => !p.hidden)) return;
    const m = goldInView();
    if (m) showTips(m);
  }, 600);
}
function goldInView() {   // the qualifying gold mark nearest the centre of the poster area, a star before a diamond
  const a = viewer.area(), st = sp(), M = 60, cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
  const blocks = $$('#bar > :not(.u-grow), #fabl, #dock-btn, #b-fit2, #focus-chip, #rail.on, #dock:not([hidden]), .u-mjtag:not([hidden])')
    .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
  const clear = (x, y, r) => x - r >= a.x0 + M && x + r <= a.x1 - M && y - r >= a.y0 + M && y + r <= a.y1 - M &&
    !blocks.some(b => x + r > b.left && x - r < b.right && y + r > b.top && y - r < b.bottom);
  const cands = data.marks.filter(m => m.tier === 'key' && !st.later(m.first)).map(m => ({ x: m.x, y: m.y, r: m.r, star: true }));
  for (const m of data.majors) if (!st.later(m.first)) for (const y of m.node_ys) cands.push({ x: m.x, y, r: S.event_node * Math.SQRT1_2, star: false });
  let best = null, bd = Infinity;
  for (const c of cands) {
    const [sx, sy] = viewer.toScreen(c.x, c.y);
    if (!clear(sx, sy, c.r * viewer.s)) continue;
    const d = Math.hypot(sx - cx, sy - cy) + (c.star ? 0 : 1e6);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function showTips(m) {
  tipsDone = true;
  try { localStorage.setItem(TIPS_KEY, '1'); } catch { /* private mode: at most once per page load */ }
  tips = { step: 1, at: m, cam: camNow() };
  document.addEventListener('pointerdown', tipsDown, true);
  fillTips();
}
function fillTips() {
  const one = tips.step === 1;
  $('#et-text').innerHTML = one ? `<b>Gold marks are the story's biggest moments.</b> White ones are smaller. ${phone ? 'Tap' : 'Click'} any mark to read it.`
    : `<b>Every event, in story order.</b> Turn on Highlights only to see just the gold ones.`;
  $('#et-step').textContent = one ? '1 of 2' : '2 of 2';
  $('#et-go').textContent = one ? 'Next' : 'Got it';
  tipsEl.hidden = false;
  etRing.classList.toggle('u-rect', !one);
  etRing.classList.remove('u-pulse'); void etRing.offsetWidth; etRing.classList.add('u-pulse');
  etBub.classList.remove('on');
  placeTips();
  requestAnimationFrame(() => requestAnimationFrame(() => tips && etBub.classList.add('on')));
}
function placeTips() {   // step 1: a circle round the mark, the bubble below it (above without room); step 2: round the Events button
  if (!tips || tips.step === 'wait') return;
  const vw = innerWidth, vh = innerHeight, g = 14, m = 16;
  let box;
  if (tips.step === 1) {
    const [x, y] = viewer.toScreen(tips.at.x, tips.at.y), r = tips.at.r * viewer.s + 8;
    box = [x - r, y - r, x + r, y + r];
  } else { const b = dockBtn.getBoundingClientRect(); box = [b.left - 5, b.top - 5, b.right + 5, b.bottom + 5]; }
  Object.assign(etRing.style, { transform: `translate(${box[0].toFixed(1)}px,${box[1].toFixed(1)}px)`, width: `${(box[2] - box[0]).toFixed(1)}px`, height: `${(box[3] - box[1]).toFixed(1)}px` });
  const w = etBub.offsetWidth, h = etBub.offsetHeight, cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  let side, x, y;
  if (tips.step === 2 && land) { side = 'left'; x = box[0] - g - w; y = clamp(cy - h / 2, m, vh - m - h); }
  else {
    side = tips.step === 2 || box[3] + g + h > vh - insets().bottom - 8 ? 'above' : 'below';
    y = side === 'below' ? box[3] + g : box[1] - g - h; x = clamp(cx - w / 2, m, vw - m - w);
  }
  etBub.dataset.side = side;
  etBub.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  etBub.style.setProperty('--ax', `${clamp(cx - x, 16, w - 16).toFixed(1)}px`); etBub.style.setProperty('--ay', `${clamp(cy - y, 16, h - 16).toFixed(1)}px`);
}
function endTips() {
  clearTimeout(tipsTimer);
  if (!tips) return;
  tips = null; tipsEl.hidden = true; etBub.classList.remove('on');
  document.removeEventListener('pointerdown', tipsDown, true);
}
// A press outside the bubble: on the poster, tap() decides (a mark leads on to step 2) and a pan ends it (frame,
// onGestureStart); in the popup the tip led to, it carries on; anything else (a control, the Events button) ends it.
function tipsDown(e) {
  if (!tips || e.target.closest('#et-bubble, #stage')) return;
  if (tips.step === 'wait' && e.target.closest('#pop')) return;
  endTips();
}
function tipsTap(hit) {   // a tap on the poster while the tip shows: on a mark in step 1, its popup opens and step 2 waits
  if (!tips) return;
  if (tips.step === 1 && hit && (hit.kind === 'ev' || hit.kind === 'major')) { tips.step = 'wait'; tipsEl.hidden = true; etBub.classList.remove('on'); }
  else endTips();
}
function tipsPopClosed() {
  if (!tips || tips.step !== 'wait') return;
  setTimeout(() => { if (tips && tips.step === 'wait' && !popState) { tips.step = 2; tips.cam = camNow(); fillTips(); } }, 300);
}
$('#et-go').addEventListener('click', () => { if (!tips) return; if (tips.step === 1) { tips.step = 2; fillTips(); } else endTips(); });
$('#et-x').addEventListener('click', endTips);

// ---------------------------------------------------------------- dialogs, menu, toolbar
function closeDialogs() { for (const p of $$('.u-dlg')) p.hidden = true; if (search) search.close(); }
function closeTransient() { closeDialogs(); closeSheet(); }
function openPanel(id) {
  endTips();
  const p = $('#' + id), was = !p.hidden;
  closeDialogs(); closePop(); closeSheet();
  if (was) return;
  p.hidden = false;
  if (id === 'spoilers') buildSpoilers.sync();
  if (id === 'export') fillExport();
  const f = id === 'spoilers' ? $('#sp-range') : p.querySelector('input:not([hidden]), button:not(.u-close), summary');
  if (f && !phone) f.focus({ preventScroll: true });
}
document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]');
  if (o) { e.preventDefault(); openPanel(o.dataset.open); }
});
$$('.u-dlg .u-close').forEach(b => b.addEventListener('click', () => { b.closest('.u-dlg').hidden = true; }));
const fit = () => viewer.animateTo(viewer.home());
$('#b-fit').onclick = fit; $('#b-fit2').onclick = fit;
const zoomBy = f => viewer.zoomAt(f, innerWidth / 2, innerHeight / 2, true);
$('#b-in').onclick = () => zoomBy(1.5); $('#b-out').onclick = () => zoomBy(1 / 1.5);

addEventListener('keydown', e => {
  if (!viewer) return;
  if (e.key === 'Escape' && tips && tips.step !== 'wait') { endTips(); return; }
  if (e.key === 'Escape' && !$('#search').hidden) { search.close(); return; }
  if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); return openSearch(); }
  if (e.key === 'Escape' && e.target.closest('.u-dlg')) { closeDialogs(); return; }
  if (e.target.closest('input, select, textarea, [contenteditable]')) return;
  if (e.key === '/') { e.preventDefault(); return openSearch(); }
  if (e.key === 'Escape') {
    if (popState) closePop();
    else if (!evSheet.hidden) closeSheet();
    else if ($$('.u-dlg').some(p => !p.hidden)) closeDialogs();
    else if (focusArcId || focusLineP || focusCharName) unfocusArc();
    return;
  }
  if (popState && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return navStep(e.key === 'ArrowLeft' ? -1 : 1); }
  if (e.target.closest('button, a, summary') && (e.key === 'Enter' || e.key === ' ')) return;
  if (viewer.key(e)) e.preventDefault();
});

function swipeToClose(el, close, when = () => true) {   // a downward swipe on a bottom sheet closes it
  let y0 = null, scroll0 = 0;
  el.addEventListener('pointerdown', e => { if (when() && e.pointerType !== 'mouse') { y0 = e.clientY; scroll0 = el.scrollTop; } });
  el.addEventListener('pointerup', e => { if (y0 != null && e.clientY - y0 > 60 && scroll0 <= 0) close(); y0 = null; });
  el.addEventListener('pointercancel', () => { y0 = null; });
  el.addEventListener('touchmove', e => { if (y0 != null && el.scrollTop <= 0 && e.touches[0].clientY > y0) e.preventDefault(); }, { passive: false });
}

// ---------------------------------------------------------------- spoilers: the Watched chip and the spoiler slider
function updateSpoilerUI() {   // the chip states the visitor's progress: "Watched: all" or "Watched: E080" (landscape: "All", "E080")
  if (!settings) return;
  const s = settings.spoiler, b = $('#b-watch'), v = s.on ? epNo(s.upTo) : land ? 'All' : 'all';
  b.querySelector('.u-cl').textContent = land ? v : `Watched: ${v} ▾`;
  b.classList.toggle('on', s.on);
  b.setAttribute('aria-label', s.on ? `Watched up to ${epNo(s.upTo)}` : 'Watched: everything');
}
// Positions 0 … M-1 are the episodes in number order, M is All (spoiler mode off). Any other position turns it on.
function buildSpoilers() {
  const s = settings.spoiler, range = $('#sp-range'), eps = [...data.episodes].sort((a, b) => a.n - b.n), M = eps.length;
  range.max = M;
  const bands = [];   // the season bands under the track, from the episodes' `season`
  eps.forEach((e, k) => { const b = bands[bands.length - 1]; if (b && b.season === e.season) b.k1 = k; else bands.push({ season: e.season, k0: k, k1: k }); });
  const label = id => String(id || '').toUpperCase().replace('PLUS', '+');
  // a band is a button: it moves the slider to the season's first episode
  $('#sp-seasons').innerHTML = bands.map(b => `<button class="u-season" data-k="${b.k0}" style="left:${(100 * b.k0 / M).toFixed(2)}%;width:${(100 * (b.k1 - b.k0) / M).toFixed(2)}%"` +
    ` title="Start of ${esc(label(b.season))}: ${epNo(eps[b.k0].n)}" aria-label="Start of ${esc(label(b.season))}, ${epNo(eps[b.k0].n)}"><span>${esc(label(b.season))}</span></button>`).join('');
  const pos = () => s.on ? Math.max(0, eps.findIndex(e => e.n === s.upTo)) : M;
  // the live counter: what the current position blurs or hides, so a visitor zoomed in on one part knows there's more
  const plural = (n, w) => `<b>${n}</b> ${n === 1 ? w : w + 's'}`;
  const count = () => {
    const st = sp();
    if (st.N == null) return 'Nothing is blurred or hidden.';
    const ne = eps.filter(e => st.later(e.n)).length, nv = data.events.filter(e => st.later(e.first)).length + data.majors.filter(m => st.later(m.first)).length;
    const verb = s.mode === 'hide' ? 'hidden' : 'blurred';
    if (!ne && !nv) return `Nothing is ${verb}: you've watched everything.`;
    const parts = [ne && plural(ne, 'episode'), nv && plural(nv, 'event')].filter(Boolean);
    return `${parts.join(' and ')} ${ne + nv === 1 ? 'is' : 'are'} ${verb}.`;
  };
  const sync = () => {
    const k = pos(), ep = eps[k];
    range.value = k; range.style.setProperty('--pct', k / M);
    range.setAttribute('aria-valuetext', ep ? `${epNo(ep.n)}, ${ep.title}` : 'Everything');
    $('#sp-preview').innerHTML = ep
      ? `<img src="${thumbs[ep.id] || ''}" alt="" width="96" height="54"><div><strong>${epNo(ep.n)}</strong> · ${esc(ep.title)}<span>${esc(ep.creator)}</span></div>`
      : '<div class="u-all"><strong>Everything</strong><span>No spoilers hidden</span></div>';
    $('#sp-prev').disabled = k <= 0; $('#sp-next').disabled = k >= M;
    $('#sp-all').disabled = k >= M;
    $('#sp-count').innerHTML = count();
    for (const b of $$('#sp-seasons .u-season')) { const k0 = +b.dataset.k, nx = b.nextElementSibling; b.classList.toggle('on', k < M && k >= k0 && (!nx || k < +nx.dataset.k)); }
    for (const b of $$('#sp-mode button')) b.setAttribute('aria-checked', b.dataset.mode === s.mode);
    $('#sp-mode').classList.toggle('u-off', !s.on);
  };
  buildSpoilers.sync = sync;
  sync();
  let t = null;
  const redraw = () => { clearTimeout(t); t = setTimeout(() => { closePop(); draw(); fillLegendArcs(); }, 60); };
  const set = k => {
    k = Math.max(0, Math.min(M, k));
    if (k === pos()) return;
    if (k >= M) s.on = false; else { s.on = true; s.upTo = eps[k].n; }
    sync(); updateSpoilerUI(); saveSettings(); redraw();
  };
  range.oninput = () => set(+range.value);
  range.onkeydown = e => {   // Page Up/Down: ten episodes
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); set(pos() + (e.key === 'PageUp' ? 10 : -10)); }
  };
  $('#sp-prev').onclick = () => set(pos() - 1);
  $('#sp-next').onclick = () => set(pos() + 1);
  $('#sp-all').onclick = () => set(M);
  $('#sp-seasons').onclick = e => { const b = e.target.closest('.u-season'); if (b) set(+b.dataset.k); };
  $('#sp-mode').onclick = e => { const b = e.target.closest('[data-mode]'); if (!b) return; s.mode = b.dataset.mode; s.modeSet = true; sync(); saveSettings(); if (s.on) redraw(); };
}

// ---------------------------------------------------------------- the More menu: Copy link to this view
function viewLink() {   // the page's address for what's on screen now (the camera; the menu closed any popup)
  return location.href.split('#')[0] + (atHome() ? '' : viewHash(viewer.view()));
}
function buildMenu() {
  const sub = $('#m-copy-sub'), text = sub.textContent;
  $('#m-copy').onclick = async () => {
    const url = viewLink();
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch {
      const ta = document.createElement('textarea'); ta.value = url; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    sub.textContent = ok ? 'Copied ✓' : url;
    clearTimeout(buildMenu.t);
    buildMenu.t = setTimeout(() => { sub.textContent = text; if (ok) $('#menu').hidden = true; }, ok ? 1100 : 6000);
  };
}

// ---------------------------------------------------------------- PNG export
function canvasWorks(w, h) {   // the real limit: a canvas this big can be drawn on and read back
  try {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return false;
    x.fillStyle = '#ff0000'; x.fillRect(w - 1, h - 1, 1, 1);
    const ok = x.getImageData(w - 1, h - 1, 1, 1).data[0] === 255;
    c.width = c.height = 0;
    return ok;
  } catch { return false; }
}
let exportChoices = null;
function fillExport() {   // only the sizes this browser can make
  if (!exportChoices) {
    exportChoices = [];
    let probed = false;
    for (const s of [...CONFIG.exportScales].sort((a, b) => b - a)) {
      const w = Math.round(data.W * s), h = Math.round(data.H * s);
      let ok = w <= CONFIG.exportMaxSide && h <= CONFIG.exportMaxSide && w * h <= CONFIG.exportMaxArea;
      if (ok && !probed) { ok = canvasWorks(w, h); probed = ok; }   // one success means every smaller size works too
      if (ok) exportChoices.unshift({ s, w, h });
    }
  }
  const best = exportChoices.filter(c => c.w * c.h <= CONFIG.exportSlowPx).pop() || exportChoices[0];
  const mb = c => Math.max(1, Math.round(c.w * c.h * (CONFIG.exportBytesPerPx[c.s] || 0.45) / 1e6));
  $('#ex-sizes').innerHTML = exportChoices.map(c => `<label><input type="radio" name="ex-s" value="${c.s}" ${c === best ? 'checked' : ''}>` +
    `<span class="u-exrow"><b>${CONFIG.exportNames[c.s] || c.s + '×'}</b><small>${c.w.toLocaleString()} × ${c.h.toLocaleString()} · about ${mb(c)} MB</small>` +
    (c.w * c.h > CONFIG.exportSlowPx ? '<em>Slow; may fail on phones</em>' : '') + '</span></label>').join('');
  const st = sp(), note = $('#ex-spoil');   // what spoiler mode does to the image
  note.hidden = st.N == null;
  if (st.N != null) note.textContent = `Episodes after ${epNo(st.N)} are ${st.mode === 'hide' ? 'left out' : 'blurred'}.`;
}
function buildExport() {
  const btn = $('#ex-go'), label = $('#ex-label'), bar = $('#ex-bar');
  btn.onclick = async () => {
    const s = +(document.querySelector('[name="ex-s"]:checked') || {}).value;
    if (!s) return;
    btn.disabled = true;
    const progress = (txt, f) => { label.textContent = txt; if (f != null) bar.style.width = `${(100 * f).toFixed(0)}%`; };
    try {
      const tr = $('#ex-transparent').checked;
      const blob = await exportPNG(s, tr, progress);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `unstable-universe-timeline-E${data.ep_first}-E${data.ep_last}-${s}x${tr ? '-transparent' : settings.bgPreset !== 'night' ? '-' + settings.bgPreset : ''}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      progress(`Saved ✓ (${(blob.size / 1e6).toFixed(0)} MB)`, 1);
    } catch (err) {
      progress(`Failed: try a smaller size`, 0);
      console.error(err);
    } finally {
      btn.disabled = false;
      setTimeout(() => { label.textContent = 'Save PNG'; bar.style.width = '0'; }, 2500);
    }
  };
}

const toDataURL = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function inlineUrls(urls) {
  const out = {};
  await Promise.all(Object.entries(urls).map(async ([k, u]) => { out[k] = await fetch(u).then(r => r.blob()).then(toDataURL); }));
  return out;
}

export async function exportPNG(scale, transparent, progress = () => {}) {
  const st = sp();
  const eps = data.episodes.filter(e => !(st.later(e.n) && st.mode === 'hide'));
  progress('Preparing…', 0);
  const th = {};
  await Promise.all(eps.map(async e => { if (thumbBlobs[e.id]) th[e.id] = await toDataURL(thumbBlobs[e.id]); }));
  const faceData = await inlineUrls(faces());
  const fontCss = [];
  for (const f of Object.values(theme.fonts)) {
    const d = await fetch(CONFIG.fonts + f.file).then(r => r.blob()).then(toDataURL);
    const mime = f.file.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
    fontCss.push(`@font-face{font-family:'${f.family}';src:url(${d.replace(/^data:[^;,]*/, `data:${mime}`)})${f.family === theme.fonts.text.family ? ';font-weight:300 900' : ''}}`);
  }
  progress('Drawing 0%', 0);
  const svg = renderPoster(data, theme, { thumbs: th, faces: faceData, fontFaces: fontCss.join(''), transparent, settings, creditLine: creditLine() });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the browser could not draw the poster')); img.src = url; });
    await new Promise(r => setTimeout(r, 50));
    const W = Math.round(data.W * scale), H = Math.round(data.H * scale);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no canvas this big');
    // in vertical strips: one huge drawImage of an SVG can come out blank in Chrome
    const strip = Math.max(256, Math.floor(16e6 / H));
    for (let x = 0; x < W; x += strip) {
      const w = Math.min(strip, W - x);
      ctx.drawImage(img, x / scale, 0, w / scale, data.H, x, 0, w, H);
      const f = (x + w) / W;
      progress(`Drawing ${Math.round(100 * f)}%`, 0.9 * f);
      await new Promise(r => setTimeout(r, 0));
    }
    progress('Encoding…', 0.95);
    const blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('PNG encoding ran out of memory')), 'image/png'));
    c.width = c.height = 0;
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
window.__exportPNG = (s, t) => exportPNG(s, t);
window.__app = () => ({ atHome, data, settings, viewer, draw, saveSettings, openPop, closePop, focusArc, unfocusArc, focusLine, focusChar, focus: () => ({ arc: focusArcId, line: focusLineP, char: focusCharName }), nearestHit, nearMajor, highlight, search, zoomPct, fitScale, popState, tips: () => tips && { step: tips.step, at: tips.at }, endTips, setPreset, theme, viewLink, dockStep, dockSel, warmed: () => Object.keys(nebulae) });

start().catch(err => { $('#load-text').textContent = 'Could not load the timeline: ' + err.message; console.error(err); });
