// Search: episodes (number, title), events, major events, arcs, protagonists' lines and the characters involved in
// episodes and events (data.characters, by name only: timeline/scripts/characters.py load(), via build_site.py).
// Later items are left out in spoiler mode, and so is a disguised appearance until it is revealed (ctx.seen). Picking a
// result hands it to ctx.go, which flies there and opens its popup. With the characters feature on, a matching
// character also gets a row of their own, ranked like any other, which opens their card and starts their focus.
// Results go by match quality (score()), then by kind, then in story order; a one-typo match ranks below every exact one.
import { esc } from './render.js';

const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const epNo = n => 'E' + String(n).padStart(3, '0');
// w is within one edit (insert, delete, change, or swap of neighbours) of the start of word x: "wembu" ~ wemmbu, "parot" ~ parrotx2
function typo(w, x) {
  for (let n = w.length - 1; n <= w.length + 1; n++) if (n >= 3 && n <= x.length && ed1(w, x.slice(0, n))) return true;
  return false;
}
function ed1(a, b) {   // edit distance at most 1, a swap counting as one
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i >= a.length || i >= b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export class Search {
  // ctx: {data, sp(), thumbs, glyph(kind, tier, num) -> svg, go(result), faces, tierName(tier or 'major'),
  //       seen(character) -> {eps: [episodes], evs: [numbers], mjs: [indices]} the visitor may see,
  //       charRows() -> the characters feature is on, face(id) -> html or null}
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx;
    this.input = root.querySelector('input');
    this.list = root.querySelector('.u-results');
    this.sel = 0; this.results = [];
    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.select(this.sel + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter') { e.preventDefault(); this.pick(this.sel); }
    });
    this.list.addEventListener('click', e => { const r = e.target.closest('[data-k]'); if (r) this.pick(+r.dataset.k); });
    this.list.addEventListener('pointermove', e => { const r = e.target.closest('[data-k]'); if (r && +r.dataset.k !== this.sel) this.select(+r.dataset.k, false); });
  }

  open() { this.root.hidden = false; this.input.value = ''; this.run(); this.input.focus(); }
  close() { if (this.root.hidden) return; this.root.hidden = true; this.input.blur(); }

  // every searchable item, built once per spoiler state
  items() {
    const { data, sp } = this.ctx, st = sp(), key = `${st.N}`;
    if (this.cacheKey === key) return this.cache;
    const out = [];
    const arcOf = id => (id && data.arcs[id] ? data.arcs[id].short : '');
    const epById = Object.fromEntries(data.episodes.map(e => [e.id, e]));
    for (const e of data.episodes) {
      if (st.later(e.n)) continue;
      out.push({ kind: 'ep', id: e.id, n: e.n, order: e.x, title: e.title, keys: [norm(e.title)],
        meta: [epNo(e.n), e.creator, e.arc ? arcOf(e.arc) : ''].filter(Boolean).join(' · ') });
    }
    for (const ev of data.events) {
      if (st.later(ev.first)) continue;
      const x = (data.marks.find(m => m.num === ev.num) || {}).x || 0;
      out.push({ kind: 'ev', num: ev.num, tier: ev.tier, order: x, title: ev.name, keys: [norm(ev.name), norm(ev.short)],
        meta: `${this.ctx.tierName(ev.tier)} #${ev.num} · ${ev.protags.join(', ')}` });
    }
    data.majors.forEach((m, i) => {
      if (st.later(m.first)) return;
      out.push({ kind: 'major', i, order: m.x, title: m.full, keys: [norm(m.full), norm(m.name)], meta: `${this.ctx.tierName('major')} · ${m.protags.join(', ')}` });
    });
    const arcsSeen = new Set();
    for (const b of data.brackets) {
      if (arcsSeen.has(b.arc) || !b.members.some(([n]) => !st.later(n))) continue;
      arcsSeen.add(b.arc);
      const a = data.arcs[b.arc];
      out.push({ kind: 'arc', arc: b.arc, order: b.lo, title: a.name, keys: [norm(a.name), norm(a.short)],
        meta: `${a.kind === 'saga' ? 'Saga' : 'Arc'} · ${[...new Set(data.brackets.filter(x => x.arc === b.arc).map(x => x.p))].join(', ')}` });
    }
    for (const ln of data.lines) out.push({ kind: 'line', p: ln.p, order: -1, title: `${ln.p}'s line`, keys: [norm(ln.p)], meta: 'Protagonist' });
    this.chars = (data.characters || []).map(c => ({ ...c, keys: [norm(c.name)] }));
    for (const it of [...out, ...this.chars]) it.words = it.keys.map(k => k.split(/[^a-z0-9]+/).filter(Boolean));
    this.epById = epById;
    this.evByNum = Object.fromEntries(data.events.map(e => [e.num, e]));
    this.cacheKey = key; this.cache = out;
    return out;
  }

  run() {
    const q = norm(this.input.value.trim());
    const items = this.items(), st = this.ctx.sp();
    let res = [];
    if (q) {
      const num = q.match(/^(?:e|ep|episode)?\s*0*(\d{1,3})$/), evn = q.match(/^#\s*(\d{1,3})$/);
      const wre = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), qw = q.split(/\s+/);
      // match quality: 4 the whole title, 3 its start, 2 a word's start, 1 anywhere (3+ letters); with one typo per word
      // of 4+ letters, 0.6 the whole title, 0.5 some of its words
      const score = it => {
        let best = 0;
        for (const k of it.keys) best = Math.max(best, k === q ? 4 : k.startsWith(q) ? 3 : wre.test(k) ? 2 : q.length >= 3 && k.includes(q) ? 1 : 0);
        if (best || !qw.some(w => w.length >= 4)) return best;
        const near = ws => qw.every(w => ws.some(x => x.startsWith(w) || (w.length >= 4 && typo(w, x))));
        return it.words.some(ws => ws.length === qw.length && near(ws)) ? 0.6 : it.words.some(near) ? 0.5 : 0;   // the whole name, or some of its words
      };
      const kindW = { ep: 0, ev: 1, major: 1, arc: 2, line: 3, char: 4 };   // ties: episodes, events, arcs, lines, characters
      for (const it of items) {
        let s = score(it);
        if (num && it.kind === 'ep' && it.n === +num[1]) s = 5;
        if ((num || evn) && it.kind === 'ev' && it.num === +(evn || num)[1]) s = evn ? 5 : Math.max(s, 1.5);
        if (s) res.push({ ...it, s });
      }
      // characters: a row each (the feature on), ranked like any result; then the episodes and events the visitor may
      // see them in, below every direct match
      for (const c of this.chars) {
        const s = score(c);
        if (s < 2 && !(s > 0 && s < 1)) continue;
        const seen = this.ctx.seen(c), why = `with ${c.name}`, sw = s < 1 ? 0.4 : 0.75;
        if (!seen.eps.length) continue;   // not introduced yet: names only, never a hint that a later match exists
        if (this.ctx.charRows()) res.push({ kind: 'char', id: c.id, name: c.name, order: 0, title: c.name,
          meta: `Character · ${seen.eps.length} ${st.N != null ? 'watched ' : ''}episode${seen.eps.length === 1 ? '' : 's'}`, s });
        const add = (kind, f) => { const base = items.find(f); if (base && !res.some(r => r.kind === kind && f(r))) res.push({ ...base, s: sw, why }); };
        for (const e of seen.eps) add('ep', it => it.kind === 'ep' && it.id === e.id);
        for (const n of seen.evs) add('ev', it => it.kind === 'ev' && it.num === n);
        for (const i of seen.mjs) add('major', it => it.kind === 'major' && it.i === i);
      }
      res.sort((a, b) => b.s - a.s || kindW[a.kind] - kindW[b.kind] || a.order - b.order);
      res = res.slice(0, 60);
    }
    this.results = res;
    this.sel = 0;
    const { thumbs, glyph, faces } = this.ctx;
    this.list.innerHTML = res.length ? res.map((r, k) => {
      let pic;
      if (r.kind === 'ep') pic = `<img src="${thumbs[r.id] || ''}" alt="">`;
      else if (r.kind === 'line') pic = `<img class="u-face-pic" src="${faces[r.p]}" alt="">`;
      else if (r.kind === 'arc') pic = `<span class="u-arcpic" style="color:var(--a-${r.arc})"></span>`;
      else if (r.kind === 'char') pic = this.ctx.face(r.id)
        || '<svg class="u-charpic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>';
      else pic = glyph(r.kind, r.tier, r.num);
      return `<button class="u-res${k === 0 ? ' sel' : ''}" data-k="${k}" role="option"><span class="u-pic">${pic}</span>` +
        `<span class="u-rtxt"><span class="u-rt">${esc(r.title)}</span><span class="u-rm">${esc(r.meta)}${r.why ? ` · <em>${esc(r.why)}</em>` : ''}</span></span></button>`;
    }).join('') : (q ? '<p class="u-hint">Nothing found.</p>' : '');
  }

  select(k, scroll = true) {
    if (!this.results.length) return;
    this.sel = (k + this.results.length) % this.results.length;
    [...this.list.children].forEach((c, i) => c.classList.toggle('sel', i === this.sel));
    if (scroll) this.list.children[this.sel].scrollIntoView({ block: 'nearest' });
  }

  pick(k) {
    const r = this.results[k];
    if (!r) return;
    this.close();
    this.ctx.go(r);
  }
}
