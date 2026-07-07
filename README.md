# MusiCanvas

**Each Note. A Pattern. Every Song. A Masterpiece.**

MusiCanvas is a live generative art app that turns music into geometry. Each of the 12 chromatic notes (C through B) is mapped to a fixed geometric layer — a circle, a square, a star web, a flower of circles, and so on. As you sing, play, or stream audio, the app detects pitch in real time and draws each note's layer centered on the canvas, with:

- **Octave** → layer radius (low notes sit inside, high notes sit outside)
- **Loudness** → stroke weight and opacity
- **Duration** → detail and complexity
- **Timing** → rotation

The result is a single, deterministic mandala that grows as the performance plays — the same melody always reproduces the same artwork.

## Try it

- **● Start Mic** — sing or play an instrument and watch the art evolve live
- **▶ Demo Melody** — hear a synthesized tune drawn through the same pipeline (no mic needed)
- **♫ Play Audio File…** — drop in any audio file
- **Detection** — switch between Melody (voice / single instrument) and Music (chord-aware, for full songs)

Adjust color mode, symmetry, sensitivity, trail fade, and detail level from the right-hand panel. Toggle **🎇 Motion FX** for a breathing, slowly rotating bloom, or **⛶** for fullscreen.

### Share & replay

Every performance is recorded as a compact list of note events. That makes it possible to:

- **⟲ Replay** — redraw the artwork stroke by stroke, exactly as it was performed
- **🔗 Share Link** — compress the whole performance into a URL. Anyone who opens it watches your song paint itself — no server, no account, no upload.

### Export

- **⬇ PNG** — quick snapshot of the current canvas
- **⬇ SVG** — the recorded performance re-rendered as crisp, infinitely scalable vector artwork
- **⬇ Hi-Res** — a clean re-render at ~2400px, print-quality
- **⏺ Record Timelapse Video** — replays the performance while capturing it to a downloadable `.webm`

## Tech

Vanilla JavaScript, the Web Audio API, and Canvas 2D — no build step, no dependencies.

- `pitch.js` — autocorrelation-based monophonic pitch detector, plus a chromagram-based chord detector for Music mode
- `patterns.js` — the 12 note → geometric layer drawing functions
- `svgctx.js` — a minimal Canvas2D-compatible context that records vector output instead of rasterizing, powering SVG export
- `app.js` — audio input, note segmentation, performance recording/replay, share-link encoding, exports, and the render loop

All rendering (live, replay, and every export) runs through the same drawing code against a recorded performance, so the artwork is fully deterministic and reproducible at any resolution or in any format.

## Run locally

Serve the folder with any static file server, e.g.:

```bash
npx serve .
```

Then open the printed local URL in a browser.
