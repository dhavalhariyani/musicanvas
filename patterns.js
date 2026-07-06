/*
 * MusiCanvas pattern engine — concentric-layer style.
 * Each of the 12 chromatic notes owns one fixed geometric LAYER. Layers are
 * all drawn centered at the same point at different radii, so a performance
 * weaves one unified sacred-geometry figure instead of scattered stamps.
 * Every drawing function renders centered at (0,0) into a unit radius of 1;
 * callers control size/rotation/stroke purely via canvas transforms.
 * `detail` (0..1) scales internal complexity; the base shape never changes,
 * keeping the note→pattern mapping deterministic.
 */
(function () {
  const TAU = Math.PI * 2;

  function circle(ctx, r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
  }

  // Regular polygon with corners on radius r, first corner at angle rot
  function poly(ctx, sides, r, rot) {
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = rot + (i / sides) * TAU;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Pointed petals from the center out to radius len (vesica-like, curved)
  function petals(ctx, count, len, width, rot) {
    const cr = len * 0.55;
    for (let i = 0; i < count; i++) {
      const a = rot + (i / count) * TAU;
      const tx = Math.cos(a) * len, ty = Math.sin(a) * len;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(Math.cos(a + width) * cr, Math.sin(a + width) * cr, tx, ty);
      ctx.quadraticCurveTo(Math.cos(a - width) * cr, Math.sin(a - width) * cr, 0, 0);
      ctx.stroke();
    }
  }

  // Straight spokes from inner radius r0 to outer radius r1
  function spokes(ctx, count, r0, r1, rot) {
    for (let i = 0; i < count; i++) {
      const a = rot + (i / count) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
  }

  // Star polygon web: chords connecting every point to the point `skip` ahead
  function starWeb(ctx, points, skip, r, rot) {
    for (let i = 0; i < points; i++) {
      const a0 = rot + (i / points) * TAU;
      const a1 = rot + (((i + skip) % points) / points) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
      ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      ctx.stroke();
    }
  }

  // C — the great circle
  function drawC(ctx, d) {
    circle(ctx, 1);
    if (d > 0.6) circle(ctx, 0.93);
  }

  // C# — diamond (square standing on its corner)
  function drawCs(ctx, d) {
    poly(ctx, 4, 1, 0);
    if (d > 0.6) poly(ctx, 4, 0.7, 0);
  }

  // D — square (axis-aligned)
  function drawD(ctx, d) {
    poly(ctx, 4, 1, TAU / 8);
    if (d > 0.6) poly(ctx, 4, 0.7, TAU / 8);
  }

  // D# — eight-petal bloom
  function drawDs(ctx, d) {
    petals(ctx, 4 + Math.round(d * 4), 1, 0.42, 0);
  }

  // E — nested square pair with inner circle
  function drawE(ctx, d) {
    poly(ctx, 4, 1, TAU / 8);
    poly(ctx, 4, 0.72, 0);
    if (d > 0.55) circle(ctx, 0.5);
  }

  // F — eight-point star (two squares 45° apart)
  function drawF(ctx, d) {
    poly(ctx, 4, 1, 0);
    poly(ctx, 4, 1, TAU / 8);
    if (d > 0.7) circle(ctx, 0.41);
  }

  // F# — flower of four circles overlapping through the center
  function drawFs(ctx, d) {
    const n = 4 + (d > 0.6 ? 4 : 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.5, 0, TAU);
      ctx.stroke();
    }
  }

  // G — radiating spokes
  function drawG(ctx, d) {
    spokes(ctx, 8 + Math.round(d * 8), 0.06, 1, 0);
    circle(ctx, 0.06);
  }

  // G# — twin rings
  function drawGs(ctx, d) {
    circle(ctx, 1);
    circle(ctx, 0.82);
    if (d > 0.7) circle(ctx, 0.64);
  }

  // A — star web {8/3}: chords weaving an eight-point lattice
  function drawA(ctx, d) {
    starWeb(ctx, 8, 3, 1, 0);
    if (d > 0.65) starWeb(ctx, 8, 2, 1, TAU / 16);
  }

  // A# — four grand petals (a pointed cross)
  function drawAs(ctx, d) {
    petals(ctx, 4, 1, 0.55, TAU / 8);
    if (d > 0.6) circle(ctx, 0.35);
  }

  // B — halo of asterisk nodes on the rim
  function drawB(ctx, d) {
    const n = 8;
    circle(ctx, 1);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.cos(a), y = Math.sin(a);
      for (let k = 0; k < 4; k++) {
        const b = (k / 4) * TAU + TAU / 8;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(b) * 0.07, y - Math.sin(b) * 0.07);
        ctx.lineTo(x + Math.cos(b) * 0.07, y + Math.sin(b) * 0.07);
        ctx.stroke();
      }
    }
    if (d > 0.6) circle(ctx, 0.85);
  }

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const DRAWERS = [drawC, drawCs, drawD, drawDs, drawE, drawF, drawFs, drawG, drawGs, drawA, drawAs, drawB];

  /**
   * Draw the layer for a chromatic note index (0=C … 11=B).
   * @param ctx    canvas context (already colored/stroked by caller)
   * @param note   0..11
   * @param x,y    center position in canvas pixels
   * @param size   radius in pixels
   * @param rot    rotation in radians
   * @param detail 0..1 complexity
   */
  function drawPattern(ctx, note, x, y, size, rot, detail) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(size, size);
    ctx.lineWidth = ctx.lineWidth / size; // keep stroke width in screen px
    DRAWERS[note % 12](ctx, detail);
    ctx.restore();
  }

  window.MusiPatterns = { NOTE_NAMES, drawPattern };
})();
