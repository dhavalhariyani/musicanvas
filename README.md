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

Adjust color mode, symmetry, sensitivity, trail fade, and detail level from the right-hand panel, then export the artwork as a PNG.

## Tech

Vanilla JavaScript, the Web Audio API, and Canvas 2D — no build step, no dependencies.

- `pitch.js` — autocorrelation-based monophonic pitch detector
- `patterns.js` — the 12 note → geometric layer drawing functions
- `app.js` — audio input, note segmentation, and the render loop

## Run locally

Serve the folder with any static file server, e.g.:

```bash
npx serve .
```

Then open the printed local URL in a browser.
