// Pan and zoom of one big element with a CSS transform: mouse drag, wheel, trackpad, pinch, double tap, keys.
// The camera is bounded: it never zooms out past the fit (fit-to-height on phones) and the poster's edges never
// come inside the view's edges, except for a short rubber-band while a finger or the mouse drags past them.
// During a gesture the element is a composited layer (will-change), so frames only move a texture; when the
// gesture settles the hint is dropped and the browser redraws the SVG sharp at the new scale.

export class Viewer {
  // opts: {maxScale, insets() -> {top, bottom, left?, right?}, fitHeight() -> bool, homeScale() -> scale or null,
  //        onTransform(viewer): called with each new transform, for what must move in step with the poster,
  //        rubberMax, rubberK, rubberMs, onChange(view), onSettle(view), onTap(target, event), onHover(event), onGestureStart()}
  constructor(stage, content, W, H, opts) {
    Object.assign(this, { stage, content, W, H, opts });
    this.s = 1; this.tx = 0; this.ty = 0;
    this.pointers = new Map();
    this.settleTimer = null;
    this.anim = null;
    this.frameQueued = false;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.bind();
  }

  get vw() { return this.stage.clientWidth; }
  get vh() { return this.stage.clientHeight; }

  // the area the poster may fill: under the toolbar band, above the dock (in landscape: beside the notch and the button column)
  area() { const i = this.opts.insets(); return { x0: i.left || 0, x1: this.vw - (i.right || 0), y0: i.top, y1: this.vh - i.bottom }; }

  get minScale() {
    const a = this.area();
    const fitH = (a.y1 - a.y0) / this.H;
    return this.opts.fitHeight() ? fitH : Math.min((a.x1 - a.x0) / this.W, fitH);
  }

  // allowed translation on one axis: [lo, hi]; equal when the poster is smaller than the area (centred)
  range(size, a0, a1) {
    if (size <= a1 - a0) { const c = a0 + (a1 - a0 - size) / 2; return [c, c]; }
    return [a1 - size, a0];
  }
  bounds(s) {
    const a = this.area();
    return { x: this.range(this.W * s, a.x0, a.x1), y: this.range(this.H * s, a.y0, a.y1) };
  }
  clampS(s) { return Math.min(this.opts.maxScale, Math.max(this.minScale, s)); }
  rubber(v, [lo, hi]) {   // past an edge, the offset grows with resistance and never beyond rubberMax
    const M = this.opts.rubberMax, k = this.opts.rubberK;
    if (v > hi) return hi + M * (1 - Math.exp(-(v - hi) * k / M));
    if (v < lo) return lo - M * (1 - Math.exp(-(lo - v) * k / M));
    return v;
  }
  outOfBounds() {
    const b = this.bounds(this.s);
    return this.tx < b.x[0] - 0.5 || this.tx > b.x[1] + 0.5 || this.ty < b.y[0] - 0.5 || this.ty > b.y[1] + 0.5;
  }

  home() {   // desktop: the whole poster; phone: its full height from the left edge (the title and the faces);
    // landscape phone: homeScale() from the top left corner
    const hs = this.opts.homeScale && this.opts.homeScale();
    const s = hs ? this.clampS(hs) : this.minScale, b = this.bounds(s);
    return { s, tx: b.x[1], ty: hs ? b.y[1] : (b.y[0] + b.y[1]) / 2 };
  }

  // mode 'clamp' (default) keeps inside the bounds; 'rubber' allows the rubber-band past them (while a pointer
  // drags); 'free' takes the position as given (a glide, which ends inside the bounds)
  set(s, tx, ty, settle = true, mode = 'clamp') {
    s = this.clampS(s);
    const b = this.bounds(s);
    if (mode === 'rubber') { tx = this.rubber(tx, b.x); ty = this.rubber(ty, b.y); } else if (mode === 'clamp') {
      tx = Math.min(b.x[1], Math.max(b.x[0], tx));
      ty = Math.min(b.y[1], Math.max(b.y[0], ty));
    }
    this.s = s; this.tx = tx; this.ty = ty;
    this.content.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    this.opts.onTransform && this.opts.onTransform(this);   // in step with the transform, not a frame later
    this.moving();
    this.queueFrame();
    if (settle) this.scheduleSettle();
  }

  queueFrame() {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => { this.frameQueued = false; this.opts.onChange && this.opts.onChange(this.view()); });
  }

  moving() {
    if (!this.isMoving) { this.isMoving = true; this.content.style.willChange = 'transform'; }
  }

  scheduleSettle() {
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (this.pointers.size || this.anim || this.fling) return this.scheduleSettle();
      this.isMoving = false;
      this.content.style.willChange = 'auto';
      this.opts.onSettle && this.opts.onSettle(this.view());
    }, 180);
  }

  view() {   // the viewport in poster px, the scale and translation
    return { x0: -this.tx / this.s, y0: -this.ty / this.s, x1: (this.vw - this.tx) / this.s, y1: (this.vh - this.ty) / this.s,
      s: this.s, tx: this.tx, ty: this.ty, vw: this.vw, vh: this.vh };
  }

  toPoster(cx, cy) { const r = this.stage.getBoundingClientRect(); return [(cx - r.left - this.tx) / this.s, (cy - r.top - this.ty) / this.s]; }
  toScreen(x, y) { return [this.tx + x * this.s, this.ty + y * this.s]; }

  zoomAt(f, cx, cy, animate = false) {
    const r = this.stage.getBoundingClientRect();
    const x = cx - r.left, y = cy - r.top;
    const s = this.clampS(this.s * f);
    const k = s / this.s;
    const t = { s, tx: x - (x - this.tx) * k, ty: y - (y - this.ty) * k };
    if (animate) this.animateTo(t, 200); else this.set(t.s, t.tx, t.ty);
  }

  // the camera that puts poster point (x, y) at screen point (cx, cy), by default the area's centre, at scale s
  centreOn(x, y, s = this.s, cy = null, cx = null) {
    s = this.clampS(s);
    const a = this.area();
    return { s, tx: (cx ?? (a.x0 + a.x1) / 2) - x * s, ty: (cy ?? (a.y0 + a.y1) / 2) - y * s };
  }

  stop() {
    cancelAnimationFrame(this.anim); this.anim = null;
    cancelAnimationFrame(this.fling); this.fling = null;
  }

  animateTo(t, ms = 450, ease = 'inout') {
    this.stop();
    if (this.reduced) ms = 0;
    const a = { s: this.s, tx: this.tx, ty: this.ty }, t0 = performance.now();
    // the target as the bounds allow, so the glide doesn't end in a jump
    const s1 = this.clampS(t.s), b = this.bounds(s1);
    const tx1 = Math.min(b.x[1], Math.max(b.x[0], t.tx)), ty1 = Math.min(b.y[1], Math.max(b.y[0], t.ty));
    const step = now => {
      const u = ms ? Math.min(1, (now - t0) / ms) : 1;
      const e = ease === 'out' ? 1 - Math.pow(1 - u, 3) : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      // interpolate scale geometrically, translation linearly; mid-glide positions may sit outside the bounds
      const s = a.s * Math.pow(s1 / a.s, e);
      this.set(s, a.tx + (tx1 - a.tx) * e, a.ty + (ty1 - a.ty) * e, true, 'free');
      this.anim = u < 1 ? requestAnimationFrame(step) : null;
      if (!this.anim) this.set(s1, tx1, ty1);
    };
    this.anim = requestAnimationFrame(step);
  }

  springBack() { if (this.outOfBounds()) this.animateTo({ s: this.s, tx: this.tx, ty: this.ty }, this.opts.rubberMs, 'out'); }

  focusBox(x0, y0, x1, y1, maxS = 0.9) {   // bring a poster box to the centre at a readable scale
    const a = this.area();
    const s = Math.min(maxS, 0.85 * Math.min((a.x1 - a.x0) / (x1 - x0), (a.y1 - a.y0) / (y1 - y0)));
    this.animateTo(this.centreOn((x0 + x1) / 2, (y0 + y1) / 2, s));
  }

  bind() {
    const st = this.stage;
    st.addEventListener('wheel', e => {
      e.preventDefault();
      this.stop();
      this.opts.onGestureStart && this.opts.onGestureStart();
      const line = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
      // ctrl or ⌘ held always zooms (a trackpad pinch comes as ctrl+wheel); otherwise a mouse wheel zooms and a
      // two-finger swipe pans in any direction. The mouse/trackpad guess only sets the zoom rate for ctrl/⌘: a pinch's
      // steps are scaled for 0.01, a ⌘ trackpad scroll's and a mouse's for the wheel rate.
      const kind = this.wheelKind(e), dy = (e.deltaY || (e.metaKey || e.ctrlKey ? e.deltaX : 0)) * line;
      if (e.ctrlKey || e.metaKey) this.zoomAt(Math.exp(-dy * (e.ctrlKey && !e.metaKey && kind === 'trackpad' ? 0.01 : 0.0018)), e.clientX, e.clientY);
      else if (kind === 'mouse' && !e.shiftKey) this.zoomAt(Math.exp(-e.deltaY * line * 0.0018), e.clientX, e.clientY);
      else this.set(this.s, this.tx - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * line, this.ty - (e.shiftKey ? 0 : e.deltaY) * line);
    }, { passive: false });

    st.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      this.stop();
      st.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) this.gesture = { x: e.clientX, y: e.clientY, t: performance.now(), tx: this.tx, ty: this.ty, moved: false, target: e.target, hist: [], type: e.pointerType };
      else this.startPinch();
    });
    st.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return this.opts.onHover && e.pointerType === 'mouse' && this.opts.onHover(e);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      if (this.pointers.size >= 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const p = this.pinch, s = this.clampS(p.s * d / p.d);
        const r = st.getBoundingClientRect();
        this.set(s, cx - r.left - p.px * s, cy - r.top - p.py * s, true, 'rubber');
        if (g) g.moved = true;
      } else if (g) {
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (!g.moved && Math.hypot(dx, dy) > 6) { g.moved = true; this.opts.onGestureStart && this.opts.onGestureStart(); }
        if (g.moved) {
          this.set(this.s, g.tx + dx, g.ty + dy, true, 'rubber');
          g.hist.push({ t: performance.now(), x: e.clientX, y: e.clientY });
          if (g.hist.length > 6) g.hist.shift();
        }
      }
    });
    const up = e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (this.pointers.size === 1) {   // pinch -> drag with the remaining finger
        const [p] = [...this.pointers.values()];
        this.pinch = null;
        this.gesture = { x: p.x, y: p.y, t: performance.now(), tx: this.tx, ty: this.ty, moved: true, hist: [] };
        return;
      }
      if (this.pointers.size) return;
      this.pinch = null; this.gesture = null;
      if (!g) return;
      if (!g.moved && e.type === 'pointerup') {
        const now = performance.now();
        if (this.lastTap && now - this.lastTap.t < 300 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30 && !this.lastTap.hit) {
          this.lastTap = null;
          this.zoomAt(2, e.clientX, e.clientY, true);
        } else {
          const hit = this.opts.onTap ? this.opts.onTap(g.target, e) : false;
          this.lastTap = { t: now, x: e.clientX, y: e.clientY, hit };
        }
      } else if (this.outOfBounds()) this.springBack();
      else if (g.hist.length >= 2) this.startFling(g.hist);
      this.scheduleSettle();
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', up);

    window.addEventListener('resize', () => this.set(this.s, this.tx, this.ty));
  }

  // 'mouse' or 'trackpad'. Browsers don't say, so: line or page units are a mouse wheel; sideways movement, small or
  // fractional steps and Chrome/Safari's wheelDelta = -3 x delta are a trackpad; whole steps that are multiples of a
  // notch are a mouse. A burst of events (under 120 ms apart) keeps the kind of its first decided event, so a fast
  // swipe's big steps or a wheel's sideways tilt don't flip it mid-gesture.
  wheelKind(e) {
    const now = performance.now(), w = this.wheel || (this.wheel = { t: -1e9, kind: null });
    const fresh = now - w.t > 120;
    w.t = now;
    if (!fresh && w.kind) return w.kind;
    let kind = null;
    const dy = Math.abs(e.deltaY), wd = e.wheelDeltaY;
    if (e.deltaMode !== 0) kind = 'mouse';
    else if (wd && Math.abs(wd) === 3 * dy) kind = 'trackpad';
    else if (e.deltaX !== 0) kind = 'trackpad';
    else if (wd && wd % 120 === 0 && dy >= 4) kind = 'mouse';
    else if (dy < 40 || (!Number.isInteger(e.deltaY) && dy < 100)) kind = 'trackpad';
    else kind = 'mouse';
    w.kind = kind;
    return kind;
  }

  key(e) {   // arrow keys pan, +/- zoom, 0 goes home; returns true when handled
    const c = { x: this.vw / 2, y: this.vh / 2 }, r = this.stage.getBoundingClientRect();
    const k = { '+': 1.4, '=': 1.4, '-': 1 / 1.4, '_': 1 / 1.4 }[e.key];
    if (k) this.zoomAt(k, r.left + c.x, r.top + c.y, true);
    else if (e.key === '0') this.animateTo(this.home());
    else if (e.key.startsWith('Arrow')) {
      const d = 0.25 * (e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? this.vw : this.vh);
      const dx = { ArrowLeft: d, ArrowRight: -d }[e.key] || 0, dy = { ArrowUp: d, ArrowDown: -d }[e.key] || 0;
      this.animateTo({ s: this.s, tx: this.tx + dx, ty: this.ty + dy }, 200);
    } else return false;
    return true;
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const [px, py] = this.toPoster(cx, cy);
    this.pinch = { d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), s: this.s, px, py };
    if (this.gesture) this.gesture.moved = true;
  }

  startFling(hist) {   // momentum that stops at the edges instead of sliding past them
    if (this.reduced) return;
    const a = hist[0], b = hist[hist.length - 1], dt = b.t - a.t;
    if (dt <= 0 || performance.now() - b.t > 80) return;
    let vx = (b.x - a.x) / dt * 16, vy = (b.y - a.y) / dt * 16;   // px per frame
    const step = () => {
      vx *= 0.92; vy *= 0.92;
      if (Math.hypot(vx, vy) < 0.5) { this.fling = null; return this.scheduleSettle(); }
      const bx = this.tx, by = this.ty;
      this.set(this.s, this.tx + vx, this.ty + vy);
      if (this.tx === bx) vx = 0;
      if (this.ty === by) vy = 0;
      this.fling = requestAnimationFrame(step);
    };
    this.fling = requestAnimationFrame(step);
  }
}
