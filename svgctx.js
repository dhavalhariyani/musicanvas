/*
 * SVGContext — a minimal CanvasRenderingContext2D stand-in that records
 * vector shapes instead of rasterizing. It implements exactly the subset of
 * the canvas API that MusiCanvas's drawing code uses (paths, full circles,
 * ellipses, transforms), so the same stampNote/drawPattern code can render
 * a performance straight to crisp, print-ready SVG.
 *
 * Assumptions matching the app's usage: transforms are uniform-scale
 * (translate/rotate/scale(k)), arc() is only ever a full circle, and
 * fillRect/clearRect/drawImage are never needed for artwork layers.
 */
(function () {
  const fmt = (n) => Math.round(n * 100) / 100;

  class SVGContext {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.els = [];
      this.m = new DOMMatrix();
      this.stack = [];
      this.strokeStyle = "#fff";
      this.fillStyle = "#fff";
      this.lineWidth = 1;
      this.globalAlpha = 1;
      this.shadowBlur = 0;          // ignored — vector output stays crisp
      this.shadowColor = "";
      this.globalCompositeOperation = "source-over"; // approximated via blend mode
      this._path = [];
      this._circles = [];
      this._ellipses = [];
    }

    save() {
      this.stack.push({
        m: DOMMatrix.fromMatrix(this.m),
        lw: this.lineWidth, ss: this.strokeStyle,
        fs: this.fillStyle, ga: this.globalAlpha,
      });
    }
    restore() {
      const s = this.stack.pop();
      if (!s) return;
      this.m = s.m; this.lineWidth = s.lw;
      this.strokeStyle = s.ss; this.fillStyle = s.fs; this.globalAlpha = s.ga;
    }
    translate(x, y) { this.m.translateSelf(x, y); }
    rotate(a) { this.m.rotateSelf((a * 180) / Math.PI); }
    scale(x, y) { this.m.scaleSelf(x, y == null ? x : y); }

    _pt(x, y) {
      const p = this.m.transformPoint(new DOMPoint(x, y));
      return [p.x, p.y];
    }
    _k() { return Math.hypot(this.m.a, this.m.b); } // uniform scale factor
    _rot() { return Math.atan2(this.m.b, this.m.a); }

    beginPath() { this._path = []; this._circles = []; this._ellipses = []; }
    moveTo(x, y) {
      const [a, b] = this._pt(x, y);
      this._path.push(`M${fmt(a)} ${fmt(b)}`);
    }
    lineTo(x, y) {
      const [a, b] = this._pt(x, y);
      this._path.push(`L${fmt(a)} ${fmt(b)}`);
    }
    quadraticCurveTo(cx, cy, x, y) {
      const [a, b] = this._pt(cx, cy);
      const [c, d] = this._pt(x, y);
      this._path.push(`Q${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)}`);
    }
    arc(x, y, r) { // app only draws full circles
      const [cx, cy] = this._pt(x, y);
      this._circles.push({ cx, cy, r: r * this._k() });
    }
    ellipse(x, y, rx, ry, rot) {
      const [cx, cy] = this._pt(x, y);
      const k = this._k();
      this._ellipses.push({
        cx, cy, rx: rx * k, ry: ry * k,
        deg: ((rot + this._rot()) * 180) / Math.PI,
      });
    }

    stroke() { this._flush(false); }
    fill() { this._flush(true); }
    _flush(isFill) {
      const col = isFill ? this.fillStyle : this.strokeStyle;
      const paint = isFill
        ? `fill="${col}" stroke="none"`
        : `fill="none" stroke="${col}" stroke-width="${fmt(this.lineWidth * this._k())}" stroke-linecap="round"`;
      const common = `${paint} opacity="${fmt(this.globalAlpha)}" style="mix-blend-mode:screen"`;
      if (this._path.length)
        this.els.push(`<path d="${this._path.join(" ")}" ${common}/>`);
      for (const c of this._circles)
        this.els.push(`<circle cx="${fmt(c.cx)}" cy="${fmt(c.cy)}" r="${fmt(c.r)}" ${common}/>`);
      for (const e of this._ellipses)
        this.els.push(
          `<ellipse cx="${fmt(e.cx)}" cy="${fmt(e.cy)}" rx="${fmt(e.rx)}" ry="${fmt(e.ry)}" transform="rotate(${fmt(e.deg)} ${fmt(e.cx)} ${fmt(e.cy)})" ${common}/>`
        );
      this.beginPath();
    }

    // No-ops for API compatibility
    fillRect() {} strokeRect() {} clearRect() {} drawImage() {}

    toSVG(background) {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}">\n` +
        `<rect width="100%" height="100%" fill="${background}"/>\n` +
        this.els.join("\n") + `\n</svg>`;
    }
  }

  window.SVGContext = SVGContext;
})();
