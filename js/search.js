// Search: episodes (number, title), events, major events, arcs, protagonists' lines and the characters named in
// episode titles, summaries and event texts (data.characters, from kb/ at build time). Later items are left out in
// spoiler mode. Picking a result hands it to ctx.go, which flies there and opens its popup.
import { esc } from './render.js';

const norm = s => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const epNo = n => 'E' + String(n).padStart(3, '0');

export class Search {
  // ctx: {data, sp(), thumbs, glyph(kind, tier, num) -> svg, go(result), arcName(id), faces}
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
        meta: `Event ${ev.num} · ${ev.protags.join(', ')}` });
    }
    data.majors.forEach((m, i) => {
      if (st.later(m.first)) return;
      out.push({ kind: 'major', i, order: m.x, title: m.full, keys: [norm(m.full), norm(m.name)], meta: `Major event · ${m.protags.join(', ')}` });
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
    this.chars = (data.characters || []).map(c => ({ ...c, keys: [c.name, ...c.aliases].map(norm) }));
    this.epById = epById;
    this.cacheKey = key; this.cache = out;
    return out;
  }

  run() {
    const q = norm(this.input.value.trim());
    const items = this.items(), st = this.ctx.sp();
    let res = [];
    if (q) {
      const num = q.match(/^(?:e|ep|episode)?\s*0*(\d{1,3})$/), evn = q.match(/^#\s*(\d{1,3})$/);
      const wre = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      const score = keys => {
        let best = 0;
        for (const k of keys) {
          if (k === q) best = Math.max(best, 100);
          else if (k.startsWith(q)) best = Math.max(best, 80);
          else if (wre.test(k)) best = Math.max(best, 60);
          else if (q.length >= 3 && k.includes(q)) best = Math.max(best, 30);
        }
        return best;
      };
      const kindW = { line: 6, arc: 5, major: 4, ev: 2, ep: 3 };
      for (const it of items) {
        let s = score(it.keys);
        if (num && it.kind === 'ep' && it.n === +num[1]) s = 200;
        if ((num || evn) && it.kind === 'ev' && it.num === +(evn || num)[1]) s = evn ? 200 : Math.max(s, 50);
        if (s) res.push({ ...it, s: s + kindW[it.kind] });
      }
      // characters: every episode and event that names them, in story order
      for (const c of this.chars) {
        const s = score(c.keys);
        if (s < 60) continue;
        const why = `mentions ${c.name}`;
        for (const id of c.eps) {
          const e = this.epById[id];
          if (!e || st.later(e.n) || res.some(r => r.kind === 'ep' && r.id === id)) continue;
          const base = items.find(it => it.kind === 'ep' && it.id === id);
          if (base) res.push({ ...base, s: s - 40, why });
        }
        for (const num of c.evs) {
          const base = items.find(it => it.kind === 'ev' && it.num === num);
          if (base && !res.some(r => r.kind === 'ev' && r.num === num)) res.push({ ...base, s: s - 41, why });
        }
        for (const i of c.majors) {
          const base = items.find(it => it.kind === 'major' && it.i === i);
          if (base && !res.some(r => r.kind === 'major' && r.i === i)) res.push({ ...base, s: s - 39, why });
        }
      }
      res.sort((a, b) => b.s - a.s || a.order - b.order);
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
