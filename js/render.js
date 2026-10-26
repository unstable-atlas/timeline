// Draws the poster as one SVG string from the layout export (data/poster.json) and the theme. Positions come from
// timeline/build/build.py and are never recomputed here; this file only turns them into marks, the way build.py's
// HTML does. Colours are CSS variables (--c-<theme colour>, --a-<arc id>), so they can change without a redraw.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const r1 = v => Math.round(v * 10) / 10;
const arcVar = id => (id ? `var(--a-${id})` : 'var(--c-no_arc)');

// ---------------------------------------------------------------- text measuring (canvas, with the page's fonts)
const mctx = document.createElement('canvas').getContext('2d');
export function textWidth(text, font) { mctx.font = font; return mctx.measureText(text).width; }
export function wrapText(text, font, width) {
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && textWidth(t, font) > width) { lines.push(cur); cur = w; } else cur = t;
  }
  return cur ? [...lines, cur] : lines;
}

// ---------------------------------------------------------------- spoilers
// N = last watched episode number, or null for no spoiler mode. Something is "later" when the first episode
// showing it comes after N (for a mark: the first of its own line's episodes).
export function spoilerState(data, settings) {
  const s = settings.spoiler;
  const N = s && s.on ? s.upTo : null;
  const later = n => N != null && n > N;
  return { N, mode: s ? s.mode : 'hide', later };
}

// ---------------------------------------------------------------- geometry helpers ported from build.py
function starPoints(cx, cy, R, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 === 0 ? R : R * inner;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}

function clipX(poly, a, b) {   // Sutherland-Hodgman: the part of a convex polygon with a <= x <= b
  const half = (pts, keep, cut) => {
    const out = [];
    for (let j = 0; j < pts.length; j++) {
      const [x1, y1] = pts[j], [x2, y2] = pts[(j + 1) % pts.length];
      const k1 = keep(x1), k2 = keep(x2);
      if (k1) out.push([x1, y1]);
      if (k1 !== k2) { const t = (cut - x1) / (x2 - x1); out.push([cut, y1 + t * (y2 - y1)]); }
    }
    return out;
  };
  let pts = a > -1e17 ? half(poly, x => x >= a, a) : poly;
  return pts.length && b < 1e17 ? half(pts, x => x <= b, b) : pts;
}

export function seeded(seed) {   // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the poster's CSS, inside the SVG so exports keep it
function posterCSS(S, fonts, fontFaces) {
  const P = `'${fonts.pixel.family}',monospace`, T = `'${fonts.text.family}',sans-serif`;
  return `${fontFaces}
.pline{stroke:var(--c-ink);stroke-width:${S.line_w}}
.pglow{stroke:var(--c-line_glow);stroke-width:${S.line_w + 4};filter:url(#glow)}
.pline-absent{stroke:var(--c-ink);stroke-width:5;stroke-dasharray:3 15;stroke-linecap:round;opacity:.5}
.slash{stroke:var(--c-slash);stroke-width:5;stroke-linecap:square}
.slash-bg{stroke:var(--c-bg);stroke-width:11;stroke-linecap:round;opacity:.8}
.tick{stroke:var(--c-tick);stroke-width:${S.tick_w_day};fill:none}
.tick-w{stroke:var(--c-tick_week);stroke-width:${S.tick_w_week};fill:none}
.arrow{fill:var(--c-ink)}
.event{stroke:var(--c-event);stroke-width:${S.event_w};stroke-dasharray:16 9;opacity:.8}
.eglow{stroke:var(--c-event_glow);stroke-width:${S.event_w + 6};opacity:.55;filter:url(#glow)}
.evnode{fill:var(--c-event);stroke:var(--c-bg);stroke-width:3}
.beam-edge{stroke-width:${S.beam_edge_w};fill:none}
.beam-cap{stroke-width:3}
.leader{fill:none;stroke-width:${S.leader_w};stroke-linejoin:miter}
.pt{stroke:var(--c-bg);stroke-width:3}
.pt-ol{fill:var(--c-bg)}
.pt-est{fill:var(--c-deep);stroke-width:4}
.stem{stroke:var(--c-bright);stroke-width:2;opacity:.7}.stem-minor{stroke:var(--c-dim_soft)}.stem-key{stroke:var(--c-star);opacity:.9}
.evk{fill:var(--c-star);stroke:var(--c-star_edge);stroke-width:2.5;stroke-linejoin:round}
.evn{fill:var(--c-notable_fill);stroke:var(--c-bright);stroke-width:3}
.evm{fill:var(--c-deep);stroke:var(--c-minor_edge);stroke-width:2}
.evnum{font-family:${T};font-weight:700;text-anchor:middle;dominant-baseline:central}
.ev-key .evnum,.fn-key .evnum{fill:var(--c-star_num);font-weight:800}
.ev-notable .evnum,.fn-notable .evnum{fill:var(--c-notable_num)}
.ev-minor .evnum,.fn-minor .evnum{fill:var(--c-minor_num);font-weight:600}
.band-edge{stroke:var(--c-band_edge);stroke-width:2}
.band-edge2{stroke:var(--c-band_edge2);stroke-width:1}
.band-strata{stroke:var(--c-band_strata);stroke-width:1;stroke-dasharray:2 10}
.notch{stroke:var(--c-notch);stroke-width:2}.notch-key{stroke:var(--c-notch_key);stroke-width:3}.notch-minor{stroke:var(--c-notch_minor)}
.fn-text{font-family:${T};font-size:${S.fn_fs}px;fill:var(--c-fn_text)}
.fn-key .fn-text{fill:var(--c-fn_key_text)}.fn-minor .fn-text{fill:var(--c-fn_minor_text)}
.stamp{font-family:${T};font-size:20px;font-weight:500;letter-spacing:3px;fill:var(--c-stamp);text-anchor:end}
.credit{font-family:${T};font-size:18px;fill:var(--c-stamp);opacity:.8}
.pix{font-family:${P}}
.fn-h{font-family:${P};font-size:24px;fill:var(--c-accent);letter-spacing:2px}
.fn-sub{font-family:${T};font-size:24px;fill:var(--c-dim_soft)}
.bracket line{stroke-width:${S.bracket_w};stroke-linecap:square}
.arc-ko{fill:var(--c-label_knockout)}
.arc-label{font-family:${P};font-size:${S.arc_fs}px;text-anchor:middle;dominant-baseline:central;stroke:var(--c-bg);stroke-width:5px;stroke-linejoin:round;paint-order:stroke}
.ev-box{fill:var(--c-event_label_bg);stroke:var(--c-event);stroke-width:3}
.ev-label{font-family:${P};font-size:${S.event_fs}px;fill:var(--c-event);text-anchor:middle;dominant-baseline:central}
.face-frame{fill:none;stroke:var(--c-ink);stroke-width:5}
.face-glow{fill:var(--c-face_glow);filter:url(#glow26)}
.pname{font-family:${P};font-size:20px;fill:var(--c-ink);text-anchor:middle}
.card-bg{fill:var(--c-card_bg)}
.card-ring{fill:none;stroke:var(--c-card_edge);stroke-width:2}
.card-glow{fill:none;stroke-width:9;opacity:.28}
.card-border{fill:none;stroke-width:${S.card_border}}
.thumb-bg{fill:var(--c-thumb_bg)}
.dur-bg{fill:var(--c-dur_bg)}
.dur{font-family:${T};font-size:${S.dur_fs}px;font-weight:500;fill:var(--c-ink)}
.epno{font-family:${P};font-size:${S.badge_fs}px;fill:var(--c-card_edge)}
.title{font-family:${T};font-size:${S.title_fs}px;font-weight:600;fill:var(--c-ink)}
.meta{font-family:${T};font-size:${S.meta_fs}px;fill:var(--c-dim)}
.redact{fill:var(--c-dim);opacity:.28}
.panel-box{stroke:var(--c-panel_border);stroke-width:3;fill:url(#panelg)}
.logo{font-family:${P};font-size:92px;fill:var(--c-logo)}
.sub{font-family:${P};font-size:26px;fill:var(--c-accent);letter-spacing:2px}
.lg-h{font-family:${P};font-size:24px;fill:var(--c-accent);letter-spacing:2px}
.lg-text{font-family:${T};font-size:28px;fill:var(--c-dim)}
.lg-row{font-family:${T};font-size:30px;fill:var(--c-ink)}
.lg-arc{font-family:${P};font-size:${S.arc_fs}px;dominant-baseline:central}
.spoiled{opacity:.55}
.hit{cursor:pointer}
.ptg rect,.evmark{transform-box:fill-box;transform-origin:center}
.hl .card-glow{opacity:.7;stroke-width:13}
.leader.hl{stroke-width:${S.leader_w * 1.8}}
.ptg.hl rect{transform:scale(1.4)}
.evmark.hl{transform:scale(1.25)}
.evmark.hl circle:not(.evpad),.evmark.hl polygon{stroke:var(--c-bright);stroke-width:3}
.evpad,.br-pad{fill:transparent;stroke:none}
.mjnode.hl .evnode{stroke:var(--c-bright);stroke-width:4}
.mj-lbl.hl .ev-box{stroke:var(--c-bright);stroke-width:4}
.mj-lbl.hl .ev-label{fill:var(--c-bright)}
.stem.hl{opacity:1}
.beam-boost{opacity:.6;pointer-events:none}
.evmark.pulse{animation:pulse .2s ease-out}
@keyframes pulse{50%{transform:scale(1.5)}}
.focusing [data-dim]:not(.in-focus){opacity:${S.site_focus_dim}}
`;
}

// ---------------------------------------------------------------- main entry
// The live view leaves out what the site shows in frozen panes instead (the footnote band, the legend) and the sky
// gradient (the page draws it behind, so it never ends at the poster's edge); it's cropped below the last cards.
export const liveHeight = data => data.band ? Math.round(data.band.top - data.sizes.fn_band_gap + data.sizes.site_live_pad) : data.H;

// opts: {live, thumbs: {id: href}, faces: {p: href}, fontFaces: css, transparent, background: dataURL|null,
//        bgDim, settings}
export function renderPoster(data, theme, opts) {
  const S = data.sizes, W = data.W, H = opts.live ? liveHeight(data) : data.H;
  const sp = spoilerState(data, opts.settings);
  const fonts = theme.fonts;
  const TF = fonts.text.family, PF = fonts.pixel.family;
  const epById = Object.fromEntries(data.episodes.map(e => [e.id, e]));
  const hiddenEp = e => sp.later(e.n) && sp.mode === 'hide';
  const blurEp = e => sp.later(e.n) && sp.mode === 'blur';
  const L = { bg: [], band: [], beams: [], ticks: [], lines: [], foot: [], events: [], leaders: [], points: [], marks: [], labels: [] };
  const defs = [];

  // ---- sky
  if (!opts.transparent) {
    if (opts.background && opts.live) {
      // the page draws the background image behind; only the stars' keep-out logic is skipped
    } else if (opts.background) {
      L.bg.push(`<rect width="${W}" height="${H}" fill="var(--c-bg)"/>`,
        `<image href="${opts.background}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`,
        `<rect width="${W}" height="${H}" fill="var(--c-bg)" opacity="${opts.bgDim ?? 0.45}"/>`);
    } else {
      defs.push(`<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--c-sky_top)" style="stop-color:var(--c-sky_top)"/>` +
        `<stop offset=".55" style="stop-color:var(--c-sky_mid)"/><stop offset="1" style="stop-color:var(--c-sky_bottom)"/></linearGradient>`);
      if (!opts.live) L.bg.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);
      L.bg.push(nebulae(W, H, theme.colors.nebulae, defs));
      L.bg.push(stars(W, H, theme.colors.stars, keepOut(data)));
    }
  }
  defs.push(`<filter id="glow" x="-1%" y="-200%" width="102%" height="500%"><feGaussianBlur stdDeviation="5"/></filter>`,
    `<filter id="glow26" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="13"/></filter>`,
    `<filter id="spoilblur" x="0" y="0" width="100%" height="100%"><feGaussianBlur stdDeviation="14"/></filter>`,
    `<linearGradient id="panelg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-panel_top)"/><stop offset="1" style="stop-color:var(--c-panel_bottom)"/></linearGradient>`);

  // ---- footnote band
  const band = opts.live ? null : data.band;
  if (band) {
    defs.push(`<linearGradient id="bandg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--c-band_top)" stop-opacity=".55"/>` +
      `<stop offset=".25" style="stop-color:var(--c-band_mid)" stop-opacity=".82"/><stop offset="1" style="stop-color:var(--c-band_bottom)" stop-opacity=".95"/></linearGradient>`);
    if (!opts.transparent) L.band.push(`<rect x="0" y="${band.top}" width="${W}" height="${r1(H - band.top)}" fill="url(#bandg)"/>`);
    L.band.push(`<line x1="0" y1="${band.top}" x2="${W}" y2="${band.top}" class="band-edge"/>`,
      `<line x1="0" y1="${band.top + 8}" x2="${W}" y2="${band.top + 8}" class="band-edge2"/>`);
    for (let r = 1; r < band.rows.length; r++) {
      const yy = r1(band.rows[r] - S.fn_row_gap / 2);
      L.band.push(`<line x1="${S.x_line0 - 80}" y1="${yy}" x2="${W}" y2="${yy}" class="band-strata"/>`);
    }
  }

  // ---- lines, ticks, gaps, faces
  for (const ln of data.lines) {
    const ly = ln.y;
    if (ln.start > ln.x0) L.lines.push(`<line x1="${ln.x0}" y1="${ly}" x2="${ln.start}" y2="${ly}" class="pline-absent"/>`);
    for (const [a, b] of ln.segs) {
      L.ticks.unshift(`<line x1="${a}" y1="${ly}" x2="${b}" y2="${ly}" class="pglow"/>`);
      L.lines.push(`<line x1="${a}" y1="${ly}" x2="${b}" y2="${ly}" class="pline"/>`);
    }
    for (const bx of ln.gaps) L.lines.push(gapMark(bx, ly));
    L.lines.push(`<path d="M${ln.end} ${ly - 11} L${r1(ln.end + 20)} ${ly} L${ln.end} ${ly + 11}" class="arrow"/>`);
    let dd = '', dw = '';
    for (const [x, wk] of ln.ticks) {
      const hh = wk ? S.tick_week : S.tick_day;
      if (wk) dw += `M${x} ${ly - hh}V${ly + hh}`; else dd += `M${x} ${ly - hh}V${ly + hh}`;
    }
    L.ticks.push(`<path d="${dd}" class="tick"/><path d="${dw}" class="tick-w"/>`);
    const fx = ln.face.x + 60, fy = ln.face.y, F = S.face;
    L.labels.push(`<g class="face"><rect x="${fx - 4}" y="${fy - 4}" width="${F + 8}" height="${F + 8}" class="face-glow"/>` +
      `<rect x="${fx}" y="${fy}" width="${F}" height="${F}" fill="var(--c-bg)"/>` +
      `<image href="${opts.faces[ln.p]}" x="${fx + 5}" y="${fy + 5}" width="${F - 10}" height="${F - 10}" style="image-rendering:pixelated"/>` +
      `<rect x="${fx + 2.5}" y="${fy + 2.5}" width="${F - 5}" height="${F - 5}" class="face-frame"/>` +
      `<text x="${fx + F / 2}" y="${r1(fy + F + 12 + 20)}" class="pname">${esc(ln.p)}</text></g>`);
  }

  // ---- brackets (a bracket shows only the watched part of its arc in spoiler mode)
  for (const br of data.brackets) {
    const seen = br.members.filter(([n]) => !sp.later(n));
    if (!seen.length && sp.N != null && sp.mode === 'hide') continue;
    const veiled = !seen.length;
    let lo = br.lo, hi = br.hi;
    if (sp.N != null && seen.length && seen.length < br.members.length) {
      hi = Math.max(seen[seen.length - 1][1] + S.br_pad, br.lx + br.lw + S.br_end);
      hi = Math.min(hi, br.hi);
    }
    const col = veiled ? 'var(--c-no_arc)' : arcVar(br.arc), y = br.y;
    const bars = [[lo, br.lx], [br.lx + br.lw, hi]].filter(([a, b]) => b - a > 1)
      .map(([a, b]) => `<line x1="${r1(a)}" y1="${y}" x2="${r1(b)}" y2="${y}"/>`).join('');
    const hitA = veiled ? '' : ` data-hit="arc" data-arc-hit="${br.arc}"`;
    L.lines.push(`<g stroke="${col}" class="bracket${veiled ? ' spoiled' : ' hit'}" data-arc="${br.arc}" data-dim="1"${hitA}>` +
      (veiled || !opts.live ? '' : `<rect x="${r1(lo)}" y="${r1(y - S.bracket_tick - 6)}" width="${r1(hi - lo)}" height="${2 * S.bracket_tick + 12}" class="br-pad"/>`) + bars +
      `<line x1="${r1(lo)}" y1="${y - S.bracket_tick}" x2="${r1(lo)}" y2="${y + S.bracket_tick}"/>` +
      `<line x1="${r1(hi)}" y1="${y - S.bracket_tick}" x2="${r1(hi)}" y2="${y + S.bracket_tick}"/></g>`);
    const kh = S.arc_fs + 2 * S.label_ko_pad;   // the knockout: leaders and event lines pass behind the centred label
    L.labels.push(`<g class="arc-lbl${veiled ? '' : ' hit'}" data-arc="${br.arc}" data-dim="1"${hitA}><rect x="${r1(br.lx)}" y="${r1(y - kh / 2)}" width="${br.lw}" height="${kh}" rx="${S.label_ko_r}" class="arc-ko"/>` +
      `<text x="${r1(br.lx + br.lw / 2)}" y="${y + 1}" class="arc-label" fill="${col}">${veiled ? '? ? ?' : esc(br.name)}</text></g>`);
  }

  // ---- major events
  data.majors.forEach((ev, i) => {
    const later = sp.later(ev.first);
    if (later && sp.mode === 'hide') return;
    const hit = later ? ' class="mj-lbl"' : ` class="mj-lbl hit" data-hit="major" data-i="${i}" data-mj="${i}"`;
    let segs = '', glow = '';
    for (const [a, b] of ev.segs) {
      segs += `<line x1="${ev.x}" y1="${a}" x2="${ev.x}" y2="${b}" class="event"/>`;
      glow += `<line x1="${ev.x}" y1="${a}" x2="${ev.x}" y2="${b}" class="eglow"/>`;
    }
    L.events.push(`<g data-dim="1"${later ? ' class="spoiled"' : ''}>${glow}${segs}</g>`);
    const h = S.event_node / 2;
    for (const yy of ev.node_ys) {   // live and watched: in a hit group with a pad as far past the diamond as an event mark's
      const node = `<rect x="${r1(ev.x - h)}" y="${r1(yy - h)}" width="${S.event_node}" height="${S.event_node}" transform="rotate(45 ${ev.x} ${yy})" class="evnode"/>`;
      L.points.push(later || !opts.live ? node : `<g class="mjnode hit" data-hit="major" data-i="${i}" data-mj="${i}">` +
        `<circle cx="${ev.x}" cy="${yy}" r="${r1(h * Math.SQRT2 + S.site_mark_pad)}" class="evpad"/>${node}</g>`);
    }
    const top = ev.y - ev.h / 2, lh = Math.round(S.event_fs * 1.5);
    const lines = later ? ['? ? ?'] : ev.lines;
    const t0 = top + 3 + (S.label_pad_y - 2) + lh / 2 + (ev.lines.length - lines.length) * lh / 2;
    L.labels.push(`<g${hit}><rect x="${r1(ev.lo + 1.5)}" y="${r1(top + 1.5)}" width="${ev.w - 3}" height="${ev.h - 3}" class="ev-box"/>` +
      lines.map((s, k) => `<text x="${r1(ev.lo + ev.w / 2)}" y="${r1(t0 + k * lh + 1)}" class="ev-label">${esc(s)}</text>`).join('') + `</g>`);
  });

  // ---- numbered event marks and footnotes
  const evByNum = Object.fromEntries(data.events.map(e => [e.num, e]));
  for (const m of data.marks) {
    const later = sp.later(m.first);
    if (later && sp.mode === 'hide') continue;
    if (m.y !== m.ly) {
      const sg = m.y > m.ly ? 1 : -1;
      L.leaders.push(`<line x1="${m.x}" y1="${m.ly + sg * S.line_w / 2}" x2="${m.x}" y2="${r1(m.y - sg * (m.r - 1))}" class="stem stem-${m.tier}" data-stem="${m.num}" data-dim="1"/>`);
    }
    L.marks.push(later ? `<circle cx="${m.x}" cy="${m.y}" r="${m.r - 1.5}" class="evm spoiled"/>` :
      `<g class="evmark ev-${m.tier} hit" data-hit="ev" data-num="${m.num}" data-dim="1">${opts.live ? `<circle cx="${m.x}" cy="${m.y}" r="${m.r + S.site_mark_pad}" class="evpad"/>` : ''}${markShape(m.tier, m.x, m.y, m.r, m.num, m.fs, S.star_inner)}</g>`);
  }
  if (band) {
    for (const ev of data.events) {
      const fn = ev.fn, later = sp.later(ev.first);
      if (!fn || (later && sp.mode === 'hide')) continue;
      L.band.push(`<line x1="${fn.fx}" y1="${band.top - 9}" x2="${fn.fx}" y2="${band.top + 9}" class="notch notch-${ev.tier}"/>`);
      const g = S.fn_glyph, tx = fn.L + g + S.fn_text_gap, ty = fn.y + (g - S.fn_lh) / 2;
      let body;
      if (later) body = fn.lines.map((s, k) => `<rect x="${tx}" y="${r1(ty + k * S.fn_lh + 5)}" width="${Math.min(240, s.length * 9)}" height="12" rx="6" class="redact"/>`).join('');
      else body = fn.lines.map((s, k) => `<text x="${tx}" y="${r1(ty + k * S.fn_lh + 18)}" class="fn-text">${esc(s)}</text>`).join('');
      L.labels.push(`<g class="fn fn-${ev.tier}${later ? ' spoiled' : ' hit'}"${later ? '' : ` data-hit="ev" data-num="${ev.num}"`}>` +
        `<rect x="${fn.L}" y="${fn.y}" width="${S.fn_w}" height="${fn.h}" fill="transparent"/>` +
        `<g transform="translate(${fn.L} ${fn.y})">${later ? `<circle cx="${g / 2}" cy="${g / 2}" r="${g / 2 - 6}" class="evm"/>` : fnGlyph(ev.tier, ev.num, fn.gfs, g, S.star_inner)}</g>${body}</g>`);
    }
    L.labels.push(`<text x="${W - S.panel_x}" y="${H - 52 + 19}" class="stamp">${esc(data.stamp)}</text>`);
    L.labels.push(`<text x="${S.panel_x}" y="${H - 52 + 19}" class="credit">${esc(opts.creditLine || '')}</text>`);
    const fx = S.panel_x + 70, fy = band.top + S.fn_pad_top - 4;
    const sub = wrapText(data.legend.fn_sub, `24px '${TF}'`, S.panel_w - 140);
    L.labels.push(`<text x="${fx}" y="${fy + 22}" class="fn-h">${esc(data.legend.fn_title)}</text>` +
      sub.map((s, k) => `<text x="${fx}" y="${fy + 24 + 18 + 24 + k * 34}" class="fn-sub">${esc(s)}</text>`).join(''));
  }

  // ---- beams
  for (const e of data.episodes) {
    if (!e.beam || hiddenEp(e)) continue;
    const bm = e.beam, col = blurEp(e) ? 'var(--c-no_arc)' : arcVar(e.arc);
    const attach = e.leader[e.leader.length - 1][1];
    const { defs: d, svg } = wedgeFill(bm.poly, attach, bm.near, col, bm.ops, bm.f0, bm.f1, bm.fade0, bm.fade1, `bg-${e.id}`, S);
    defs.push(...d);
    let g = `<g class="beam${blurEp(e) ? ' spoiled' : ''}" data-ep="${e.id}" data-dim="1">${svg}`;
    const ends = [[bm.poly[0][0], bm.f0, bm.est0], [bm.poly[1][0], bm.f1, bm.est1]];
    for (const [ax, endX, est] of ends) {
      g += `<line x1="${ax}" y1="${attach}" x2="${endX}" y2="${bm.near}" style="stroke:${col}" class="beam-edge" stroke-opacity="${bm.edge_op}"${est ? ` stroke-dasharray="${S.beam_dash}"` : ''}/>`;
      if (!est) L.foot.push(`<line x1="${endX}" y1="${bm.near}" x2="${endX}" y2="${r1(bm.near + bm.sign * S.beam_cap)}" style="stroke:${col}" class="beam-cap" stroke-opacity="${(0.95 * bm.alt).toFixed(2)}" data-ep="${e.id}" data-dim="1"/>`);
    }
    L.beams.push(g + '</g>');
  }

  // ---- episodes: point, leader, card
  const durFont = `500 ${S.dur_fs}px '${TF}'`;
  for (const e of data.episodes) {
    if (hiddenEp(e)) continue;
    const blur = blurEp(e), col = blur ? 'var(--c-no_arc)' : arcVar(e.arc);
    const ly = e.leader[0][1], ax = e.x, attach = e.leader[e.leader.length - 1][1];
    const hit = `class="hit" data-hit="ep" data-id="${e.id}"`;
    L.leaders.push(`<path d="M${e.leader.map(p => p.join(' ')).join(' L')}" style="stroke:${col}" class="leader" data-ep="${e.id}" data-dim="1"/>`);
    L.points.push(`<rect x="${r1(e.col - 5)}" y="${r1(attach - 5)}" width="10" height="10" style="fill:${col}" data-ep="${e.id}" data-dim="1"/>`);
    const P = S.point;
    L.points.push(`<g class="hit ptg" data-hit="ep" data-id="${e.id}" data-ep="${e.id}" data-dim="1">` + (e.hollow
      ? `<rect x="${r1(ax - P / 2)}" y="${ly - P / 2}" width="${P}" height="${P}" class="pt-ol"/><rect x="${r1(ax - P / 2 + 3.5)}" y="${ly - P / 2 + 3.5}" width="${P - 7}" height="${P - 7}" class="pt-est" style="stroke:${col}"/>`
      : `<rect x="${r1(ax - P / 2)}" y="${ly - P / 2}" width="${P}" height="${P}" class="pt" style="fill:${col}"/>`) + '</g>');
    L.labels.push(card(e, S, col, blur, hit, opts, durFont, `600 ${S.title_fs}px '${TF}'`));
  }

  // ---- legend panel
  L.labels.unshift(panel(data, theme, S, sp, TF, PF, opts.live));

  const vars = cssVars(theme, opts.settings);
  const order = ['bg', 'band', 'beams', 'ticks', 'lines', 'foot', 'events', 'leaders', 'points', 'marks', 'labels'];
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="${vars}">` +
    `<style>${posterCSS(S, fonts, opts.fontFaces || '')}</style><defs>${defs.join('')}</defs>` +
    order.map(k => `<g class="layer-${k}">${L[k].join('')}</g>`).join('') + `</svg>`;
}

export function cssVars(theme, settings) {
  const out = [];
  for (const [k, v] of Object.entries(theme.colors)) if (typeof v === 'string') out.push(`--c-${k}:${v}`);
  const arcs = { ...theme.arcs, ...(settings.arcColors || {}) };
  for (const [k, v] of Object.entries(arcs)) out.push(`--a-${k}:${v}`);
  return out.join(';');
}

// ---------------------------------------------------------------- pieces
function card(e, S, col, blur, hit, opts, durFont, titleFont) {
  const x = e.L, y = e.top, W = S.card_w, h = e.h, b = S.card_border, th = S.thumb_h;
  const tx = x + b, ty = y + b, tw = W - 2 * b;
  let s = `<g ${hit} data-card="${e.id}" data-ep="${e.id}" data-dim="1">` +
    `<rect x="${r1(x - 3)}" y="${r1(y - 3)}" width="${W + 6}" height="${h + 6}" class="card-glow" style="stroke:${col}"/>` +
    `<rect x="${x}" y="${y}" width="${W}" height="${h}" class="card-bg"/>` +
    `<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" class="thumb-bg"/>`;
  const href = (opts.thumbs || {})[e.id] || '';
  s += `<image class="th" data-id="${e.id}"${href ? ` href="${href}"` : ''} x="${tx}" y="${ty}" width="${tw}" height="${th}" preserveAspectRatio="xMidYMid slice"${blur ? ' filter="url(#spoilblur)"' : ''}/>`;
  if (!blur) {
    const dw = textWidth(e.dur, durFont) + 12;
    s += `<rect x="${r1(tx + tw - 6 - dw)}" y="${r1(ty + th - 6 - (S.dur_fs + 6))}" width="${r1(dw)}" height="${S.dur_fs + 6}" class="dur-bg"/>` +
      `<text x="${r1(tx + tw - 12 - dw + 12)}" y="${r1(ty + th - 6 - 6)}" class="dur">${esc(e.dur)}</text>`;
  }
  const bw = 4 * S.badge_fs + 14, bh = S.badge_fs + 11;
  s += `<rect x="${tx}" y="${ty}" width="${bw}" height="${bh}" style="fill:${col}"/>` +
    `<text x="${tx + 7}" y="${ty + 6 + S.badge_fs}" class="epno">E${String(e.n).padStart(3, '0')}</text>`;
  const t0 = ty + th + S.card_pad_top;
  e.lines.forEach((ln, k) => {
    if (blur) s += `<rect x="${tx + S.card_pad_x}" y="${t0 + k * S.title_lh + 7}" width="${Math.min(tw - 2 * S.card_pad_x, ln.length * 11)}" height="13" rx="6" class="redact"/>`;
    else {
      const last = k === S.title_max_lines - 1 && e.lines.length === S.title_max_lines && textWidth(ln, titleFont) > tw - 2 * S.card_pad_x;
      s += `<text x="${tx + S.card_pad_x}" y="${t0 + k * S.title_lh + 20}" class="title">${esc(last ? clip(ln, tw - 2 * S.card_pad_x, titleFont) : ln)}</text>`;
    }
  });
  s += `<text x="${tx + S.card_pad_x}" y="${t0 + e.lines.length * S.title_lh + 2 + 17}" class="meta">${esc(e.date)}</text>`;
  s += `<rect x="${r1(x - 1)}" y="${r1(y - 1)}" width="${W + 2}" height="${h + 2}" class="card-ring"/>` +
    `<rect x="${x + b / 2}" y="${y + b / 2}" width="${W - b}" height="${h - b}" class="card-border" style="stroke:${col}"/></g>`;
  return s;
}

function clip(text, width, font) {
  let t = text;
  while (t.length > 1 && textWidth(t + '…', font) > width) t = t.slice(0, -1);
  return t.trimEnd() + '…';
}

function markShape(tier, cx, cy, r, num, fs, inner) {
  if (tier === 'key')
    return `<polygon points="${starPoints(cx, cy, r, inner)}" class="evk"/><text x="${cx}" y="${r1(cy + r * 0.08)}" class="evnum" font-size="${fs}">${num}</text>`;
  return `<circle cx="${cx}" cy="${cy}" r="${r - 1.5}" class="ev${tier[0]}"/><text x="${cx}" y="${cy}" class="evnum" font-size="${fs}">${num}</text>`;
}

function fnGlyph(tier, num, fs, G, inner) {
  const c = G / 2;
  if (tier === 'key')
    return `<polygon points="${starPoints(c, c + 1, c, inner)}" class="evk"/><text x="${c}" y="${c + 2.5}" class="evnum" font-size="${fs}">${num}</text>`;
  return `<circle cx="${c}" cy="${c}" r="${c - 6}" class="ev${tier[0]}"/><text x="${c}" y="${c}" class="evnum" font-size="${fs}">${num}</text>`;
}

function gapMark(bx, ly) {
  let out = '';
  for (const cls of ['slash-bg', 'slash'])
    for (const dx of [-8, 8]) out += `<line x1="${r1(bx + dx - 7)}" y1="${ly + 19}" x2="${r1(bx + dx + 7)}" y2="${ly - 19}" class="${cls}"/>`;
  return out;
}

function wedgeFill(poly, yCard, yLine, col, ops, f0, f1, fade0, fade1, gid, S) {
  const defs = [], out = [], cache = new Map(), steps = S.beam_fade_steps, floor = S.beam_fade_floor;
  const grad = m => {
    const k = Math.round(m * 1000) / 1000;
    if (!cache.has(k)) {
      const id = `${gid}-${cache.size}`;
      cache.set(k, id);
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${yCard}" x2="0" y2="${yLine}">` +
        `<stop offset="0" style="stop-color:${col}" stop-opacity="${(ops[0] * m).toFixed(3)}"/>` +
        `<stop offset=".7" style="stop-color:${col}" stop-opacity="${(ops[1] * m).toFixed(3)}"/>` +
        `<stop offset="1" style="stop-color:${col}" stop-opacity="${(ops[2] * m).toFixed(3)}"/></linearGradient>`);
    }
    return cache.get(k);
  };
  let cuts = [[-1e18, 1]];
  if (fade0 > 0) {
    cuts = [];
    for (let k = 0; k < steps; k++) cuts.push([k === 0 ? -1e18 : f0 + fade0 * k / steps, floor + (1 - floor) * (k + 0.5) / steps]);
    cuts.push([f0 + fade0, 1]);
  }
  if (fade1 > 0) {
    cuts = cuts.filter(c => c[0] < f1 - fade1);
    for (let k = 0; k < steps; k++) cuts.push([f1 - fade1 + fade1 * k / steps, 1 - (1 - floor) * (k + 0.5) / steps]);
  }
  cuts.forEach(([a, m], j) => {
    const b = j + 1 < cuts.length ? cuts[j + 1][0] : 1e18;
    const piece = clipX(poly, a, b);
    if (piece.length >= 3) out.push(`<polygon points="${piece.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" fill="url(#${grad(m)})"/>`);
  });
  return { defs, svg: out.join('') };
}

function nebulae(W, H, cols, defs) {
  const rnd = seeded(3), out = [];
  const n = Math.floor(W / 1800) + 2;
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = (0.1 + 0.8 * rnd()) * H, r = 900 + 900 * rnd();
    const c = cols[Math.floor(rnd() * cols.length)];
    defs.push(`<radialGradient id="neb${i}"><stop offset="0" stop-color="rgb(${c})" stop-opacity="0.15"/><stop offset="0.7" stop-color="rgb(${c})" stop-opacity="0"/></radialGradient>`);
    out.push(`<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${r.toFixed(0)}" ry="${(r * 0.6).toFixed(0)}" fill="url(#neb${i})"/>`);
  }
  return out.join('');
}

function keepOut(data) {   // where the big "+" sparkles would read as marks (as build.py's stars_svg)
  const S = data.sizes, ko = [[0, 0, S.panel_x + S.panel_w + 60, data.H]];
  for (const b of data.brackets) ko.push([b.lo, b.y - 20, b.hi, b.y + 20]);
  for (const ln of data.lines) ko.push([ln.x0, ln.y - 30, ln.end + 30, ln.y + 30]);
  for (const e of data.episodes) ko.push([e.L, e.top, e.L + S.card_w, e.top + e.h]);
  if (data.band) {
    ko.push([0, data.band.top - 20, data.W, data.band.top + 20]);
    for (const ev of data.events) if (ev.fn) ko.push([ev.fn.L, ev.fn.y, ev.fn.L + S.fn_w, ev.fn.y + ev.fn.h]);
  }
  for (const m of data.majors) ko.push([m.lo, m.y - m.h / 2, m.lo + m.w, m.y + m.h / 2]);
  return ko;
}

function stars(W, H, cols, ko) {   // one path per colour and opacity step, so 10,000+ stars stay cheap to draw
  const rnd = seeded(7), n = Math.floor(W * H / 8000), groups = new Map();
  for (let i = 0; i < n; i++) {
    const x = Math.round(rnd() * W), y = Math.round(rnd() * H), s = [2, 2, 2, 3, 3, 4][Math.floor(rnd() * 6)];
    const o = Math.round((0.25 + 0.6 * rnd()) * 10) / 10, c = cols[Math.floor(rnd() * cols.length)];
    const k = c + '|' + o;
    groups.set(k, (groups.get(k) || '') + `M${x} ${y}h${s}v${s}h-${s}z`);
  }
  let out = '';
  for (const [k, d] of groups) { const [c, o] = k.split('|'); out += `<path d="${d}" fill="${c}" opacity="${o}"/>`; }
  let sp = '';
  for (let i = 0; i < Math.floor(n / 120); i++) {
    const x = Math.round(rnd() * W), y = Math.round(rnd() * H);
    if (ko.some(b => b[0] - 24 < x && x < b[2] + 24 && b[1] - 24 < y && y < b[3] + 24)) continue;
    sp += `M${x - 2} ${y - 9}h4v18h-4zM${x - 9} ${y - 2}h18v4h-18z`;
  }
  return out + `<path d="${sp}" fill="var(--c-sparkle)" opacity=".8"/>`;
}

function panel(data, theme, S, sp, TF, PF, live) {
  const x0 = S.panel_x, y0 = S.page_top, w = S.panel_w, padX = 70, inner = w - 2 * padX;
  const out = [];
  let y = y0 + 64;
  const X = x0 + padX;
  for (const [k, word] of ['UNSTABLE', 'UNIVERSE'].entries()) {
    const cy = y + 59 + k * 118;
    out.push(`<text x="${X + 12}" y="${cy}" class="logo" style="fill:var(--c-logo_shadow2)" dominant-baseline="central">${word}</text>`,
      `<text x="${X + 6}" y="${cy - 6}" class="logo" style="fill:var(--c-logo_shadow1)" dominant-baseline="central">${word}</text>`,
      `<text x="${X}" y="${cy - 12}" class="logo" dominant-baseline="central">${word}</text>`);
  }
  y += 236 + 40;
  out.push(`<text x="${X}" y="${y + 13}" class="sub" dominant-baseline="central">STORY TIMELINE · EPISODES ${data.ep_first}–${data.ep_last}</text>`);
  y += 26 + 50;
  if (live) return `<g class="panel"><rect x="${x0 + 1.5}" y="${y0 + 1.5}" width="${w - 3}" height="${y - y0 - 3}" class="panel-box"/>${out.join('')}</g>`;
  const h3 = t => { y += 46; out.push(`<text x="${X}" y="${y + 12}" class="lg-h" dominant-baseline="central">${t}</text>`); y += 24 + 22; };
  const para = (t, x, width, cls, fs, lh) => {
    const lines = wrapText(t, `${fs}px '${TF}'`, width);
    lines.forEach((s, k) => out.push(`<text x="${x}" y="${y + k * lh + lh / 2}" class="${cls}" dominant-baseline="central">${esc(s)}</text>`));
    return lines.length * lh;
  };
  h3('READING THE MAP');
  y += para(data.legend.intro, X, inner, 'lg-text', 28, 40) + 26;
  for (const [svg, text] of data.legend.rows) {
    if (svg == null) { y += 8; y += para(text, X + 150, inner - 150, 'lg-text', 28, 40) + 20; continue; }
    const sh = +(svg.match(/height="(\d+)"/) || [0, 44])[1];
    const lines = wrapText(text, `30px '${TF}'`, inner - 150);
    const rh = Math.max(sh, lines.length * 38);
    y += 20;
    out.push(`<g transform="translate(${X} ${y + (rh - sh) / 2})">${svg}</g>`);
    lines.forEach((s, k) => out.push(`<text x="${X + 150}" y="${y + (rh - lines.length * 38) / 2 + k * 38 + 19}" class="lg-row" dominant-baseline="central">${esc(s)}</text>`));
    y += rh;
  }
  y += 20;
  const visibleArcs = new Set(data.brackets.filter(b => b.members.some(([n]) => !sp.later(n))).map(b => b.arc));
  const arcRow = a => {
    const col = arcVar(a);
    y += 16;
    out.push(`<g transform="translate(${X} ${y})"><g style="stroke:${col}" stroke-width="6"><line x1="3" y1="15" x2="117" y2="15"/>` +
      `<line x1="3" y1="3" x2="3" y2="27"/><line x1="117" y1="3" x2="117" y2="27"/></g>` +
      `<text x="150" y="16" class="lg-arc" style="fill:${col}">${esc(data.arcs[a].short.toUpperCase())}</text></g>`);
    y += 30;
  };
  h3('ARCS');
  data.legend.arcs.filter(a => sp.N == null || visibleArcs.has(a)).forEach(arcRow);
  if (data.legend.sagas.length) { h3('SAGAS (ABOVE THE LINE)'); data.legend.sagas.forEach(arcRow); }
  y += 16 + 50;
  return `<g class="panel"><rect x="${x0 + 1.5}" y="${y0 + 1.5}" width="${w - 3}" height="${y - y0 - 3}" class="panel-box"/>${out.join('')}</g>`;
}
