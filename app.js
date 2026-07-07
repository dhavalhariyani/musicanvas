/*
 * MusiCanvas — live geometric artwork from music.
 * Pipeline: audio input → pitch detection → note segmentation → visual mapping → canvas.
 * Placement is deterministic: the Nth note of a performance always lands at the
 * same golden-angle spiral slot, so the same melody reproduces the same artwork.
 */
(function () {
  const { NOTE_NAMES, drawPattern } = MusiPatterns;
  const { detectPitch, freqToNote } = MusiPitch;
  const TAU = Math.PI * 2;

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("artCanvas");
  const ctx = canvas.getContext("2d");
  const els = {
    livePill: $("livePill"), liveLabel: $("liveLabel"), timer: $("timer"),
    canvasEmpty: $("canvasEmpty"), noteHistory: $("noteHistory"),
    curNote: $("curNote"), curFreq: $("curFreq"), levelMeter: $("levelMeter"),
    detectNote: $("detectNote"), patternPreview: $("patternPreview"),
    btnMic: $("btnMic"), btnDemo: $("btnDemo"), fileInput: $("fileInput"),
    btnPause: $("btnPause"), btnClear: $("btnClear"), btnSave: $("btnSave"),
    detection: $("detection"),
    btnReplay: $("btnReplay"), btnShare: $("btnShare"),
    btnSvg: $("btnSvg"), btnHiRes: $("btnHiRes"), btnVideo: $("btnVideo"),
    btnFx: $("btnFx"), btnFull: $("btnFull"),
    colorMode: $("colorMode"), symmetry: $("symmetry"),
    sensitivity: $("sensitivity"), trail: $("trail"), detail: $("detail"),
    sensVal: $("sensVal"), trailVal: $("trailVal"), detailVal: $("detailVal"),
    legend: $("legend"),
  };

  // ---------- Color palettes ----------
  // Rainbow blends the note's chromatic hue with the stamp's angular position,
  // so color flows as a gradient across the mandala (like light through a prism)
  // while the same note still reads as the same family of hues.
  const PALETTES = {
    rainbow: (note, posHue) => {
      const noteHue = note * 30;
      const hue = posHue == null ? noteHue : (posHue * 0.65 + noteHue * 0.35) % 360;
      return `hsl(${hue}, 95%, 66%)`;
    },
    harmonic: (note, posHue) =>
      `hsl(${200 + ((posHue == null ? note * 30 : posHue) % 360) * 0.35}, 80%, ${58 + (note % 3) * 7}%)`,
    moss: (note) => {
      const set = ["#8a9a5b", "#a3b18a", "#d4c8a8", "#c9ada7", "#84a98c", "#b08968"];
      return set[note % set.length];
    },
    mono: () => "#c9d2ff",
  };

  // ---------- State ----------
  const state = {
    audioCtx: null, analyser: null, micStream: null, sourceNode: null,
    mode: "idle",            // idle | mic | demo | file
    paused: false,
    startTime: 0,
    stampCount: 0,           // total stamps this performance
    noteCounts: {},          // per note+octave repeat counter, bounds density
    current: null,           // active note segment (melody mode)
    chordSegs: new Map(),    // active segments per pitch class (music mode)
    pcOn: new Array(12).fill(0), pcOff: new Array(12).fill(0),
    perf: [],                // recorded performance: {t, n, o, d, l} events
    perfOffset: 0,           // time offset when resuming after a stop
    smoothLevel: 0,          // smoothed audio level for motion FX
    fxOn: true,              // motion FX (breathing / rotation / bloom)
    history: [],
    demoTimer: null, demoOsc: null, demoGain: null,
  };
  const timeBuf = new Float32Array(2048);
  let freqBuf = null; // allocated once the analyser exists

  // Density bounds: repeats of a note+octave cycle through a small variant
  // family, then become node-only echoes (see stampNote).
  const R_SCALES = [1.3, 0.75, 1.05, 0.5, 1.2, 0.62, 0.9];
  const MAX_VARIANTS = 6;

  // Radii of the faint construction rings drawn beneath the artwork.
  // (Declared before resizeCanvas() runs below.)
  const SCAFFOLD_RINGS = [0.18, 0.34, 0.5, 0.66, 0.82];

  // ---------- Canvas sizing ----------
  let art = null;        // offscreen canvas holding the accumulated artwork
  let scaffold = null;   // faint construction geometry rendered beneath the art
  let bloomSmall = null; // low-res copy of `art`; upscaling it back is the bloom
  function buildScaffoldCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const s = c.getContext("2d");
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.46;
    s.strokeStyle = "rgba(130, 140, 210, 0.07)";
    s.lineWidth = 1;
    // Construction rings
    for (const r of SCAFFOLD_RINGS) {
      s.beginPath();
      s.arc(cx, cy, r * maxR, 0, TAU);
      s.stroke();
    }
    // Spokes
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      s.beginPath();
      s.moveTo(cx, cy);
      s.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
      s.stroke();
    }
    // Two rotated squares inscribed in the outer ring
    for (const rot of [0, TAU / 8]) {
      s.beginPath();
      for (let i = 0; i <= 4; i++) {
        const a = rot + TAU / 8 + (i / 4) * TAU;
        const x = cx + Math.cos(a) * maxR, y = cy + Math.sin(a) * maxR;
        i === 0 ? s.moveTo(x, y) : s.lineTo(x, y);
      }
      s.stroke();
    }
    return c;
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width === w && canvas.height === h) return;
    const old = art;
    canvas.width = w; canvas.height = h;
    art = document.createElement("canvas");
    art.width = w; art.height = h;
    if (old) {
      // Uniform, centered rescale — stretching would deform the mandala
      const k = Math.min(w / old.width, h / old.height);
      const dw = old.width * k, dh = old.height * k;
      art.getContext("2d").drawImage(old, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    scaffold = buildScaffoldCanvas(w, h);
    bloomSmall = document.createElement("canvas");
    bloomSmall.width = Math.max(48, Math.round(w / 8));
    bloomSmall.height = Math.max(48, Math.round(h / 8));
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // ---------- Legend ----------
  const legendCells = [];
  NOTE_NAMES.forEach((name, i) => {
    const cell = document.createElement("div");
    cell.className = "legend-cell";
    const cv = document.createElement("canvas");
    cv.width = 56; cv.height = 56;
    const c2 = cv.getContext("2d");
    c2.strokeStyle = PALETTES.rainbow(i);
    c2.lineWidth = 1.2;
    drawPattern(c2, i, 28, 28, 22, 0, 0.8);
    const label = document.createElement("div");
    label.className = "ln";
    label.textContent = name;
    cell.append(cv, label);
    els.legend.appendChild(cell);
    legendCells.push(cell);
  });

  // ---------- Visual mapping ----------
  // Color flows warm-at-center → cool-at-edge (orange → magenta → violet →
  // blue), blended by the palette with the note's own chromatic hue so a
  // note keeps a recognizable color family.
  const HUE_STOPS = [35, 330, 275, 215];
  function radialHue(t) {
    const seg = Math.min(2.999, Math.max(0, t) * 3);
    const i = Math.floor(seg), f = seg - i;
    let dh = HUE_STOPS[i + 1] - HUE_STOPS[i];
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return (HUE_STOPS[i] + dh * f + 360) % 360;
  }
  function noteColor(note, rFrac) {
    // Layers mostly live between rFrac 0.25 and 1.0 — remap so the full
    // warm→cool ramp is spent on radii that actually occur
    const posHue = rFrac == null ? null : radialHue((rFrac - 0.25) / 0.75);
    return PALETTES[els.colorMode.value](note, posHue);
  }

  // Every note is a concentric LAYER centered on the canvas: octave sets its
  // radius, the stamp index sets its rotation, and the Symmetry control adds
  // slightly-rotated copies so layers interweave into one dense figure.
  // `target` lets the same drawing code render to the live canvas (default),
  // an offscreen high-res canvas, or an SVGContext. Each target carries its
  // own variant counters so exports replay deterministically.
  function stampNote(seg, durationSec, target) {
    const live = !target;
    const t = target || {
      ctx: art.getContext("2d"), w: art.width, h: art.height,
      dpr: window.devicePixelRatio || 1, counters: state.noteCounts,
    };
    const a = t.ctx;
    const w = t.w, h = t.h;
    const dpr = t.dpr;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.47;

    // Variant bookkeeping happens at first stamp (not at segment creation) so
    // recorded replays reproduce the exact same variant order as the live run.
    if (seg.variant == null) {
      const key = seg.note + ":" + seg.octave;
      const n = t.counters[key] || 0;
      t.counters[key] = n + 1;
      seg.variant = Math.min(n, MAX_VARIANTS);
      seg.echo = n >= MAX_VARIANTS;
      seg.rot = (n % 4) * (TAU / 16);
      seg.rScale = R_SCALES[n % 7];
    }

    // Octave → layer radius (low notes inside, high notes outside), spread by
    // a deterministic per-stamp scale so single-octave melodies still fill
    // the figure from center to rim instead of piling onto one ring.
    const oct = Math.max(2, Math.min(6, seg.octave));
    const rFrac = Math.min(1.02, (0.22 + ((oct - 2) / 4) * 0.78) * (seg.rScale || 1));
    const radius = maxR * rFrac;

    // Duration → detail; capped by the Detail Level control
    const userDetail = els.detail.value / 100;
    const detail = Math.min(userDetail, 0.25 + Math.min(durationSec / 1.2, 1) * 0.75);

    // Loudness → stroke weight & opacity. Hairline strokes + additive
    // compositing + glow give the luminous interference-web look. Re-stamps
    // of sustained notes and extra symmetry copies are attenuated so the
    // additive glow never blows out to white.
    const level = Math.min(1, seg.level * 6);
    const color = noteColor(seg.note, rFrac);
    const copies = Math.max(1, Math.round(parseInt(els.symmetry.value, 10) / 2));
    // Later variants of an already-drawn note fade progressively, and echo
    // stamps (variants exhausted) skip the geometry entirely below.
    const atten = 1 / (1 + (seg.restamps || 0)) / Math.sqrt(copies)
      / (1 + (seg.variant || 0) * 0.25);

    // Per-shape shadowBlur is fine for incremental live drawing (a handful of
    // stamps per tick), but is O(blur²) per call and would take minutes over
    // a whole performance at 4K. Bulk render targets (hi-res export) disable
    // it here and get one cheap full-canvas bloom pass afterward instead.
    const glow = t.glow !== false;

    a.save();
    a.globalCompositeOperation = "lighter";
    if (glow) { a.shadowColor = color; a.shadowBlur = 6 * dpr; }
    a.strokeStyle = color;
    a.fillStyle = color;
    a.lineWidth = (0.4 + level * 0.5) * dpr;

    for (let s = 0; s < copies; s++) {
      // Layers have eighth-turn symmetry, so copies fan across one eighth
      const rot = seg.rot + (s / copies) * (TAU / 8);
      if (!seg.echo) {
        a.globalAlpha = (0.32 + level * 0.35) * atten;
        drawPattern(a, seg.note, cx, cy, radius, rot, detail);
      }

      // Asterisk nodes with a bright dot at the layer's eight fold points
      a.globalAlpha = 0.75 * atten;
      if (glow) a.shadowBlur = 3 * dpr;
      const arm = 4 * dpr;
      for (let k = 0; k < 8; k++) {
        const va = rot + (k / 8) * TAU;
        const nx = cx + Math.cos(va) * radius, ny = cy + Math.sin(va) * radius;
        a.beginPath();
        a.arc(nx, ny, 1.1 * dpr, 0, TAU);
        a.fill();
        for (let m = 0; m < 4; m++) {
          const ba = va + (m / 4) * TAU + TAU / 8;
          a.beginPath();
          a.moveTo(nx - Math.cos(ba) * arm, ny - Math.sin(ba) * arm);
          a.lineTo(nx + Math.cos(ba) * arm, ny + Math.sin(ba) * arm);
          a.stroke();
        }
      }
      if (glow) a.shadowBlur = 6 * dpr;
    }
    a.restore();

    if (live) {
      pushHistory(NOTE_NAMES[seg.note] + seg.octave, color);
      els.canvasEmpty.classList.add("hidden");
    }
  }

  function pushHistory(label, color) {
    state.history.push({ label, color });
    if (state.history.length > 12) state.history.shift();
    els.noteHistory.innerHTML = state.history
      .map((n) => `<span style="color:${n.color}">${n.label}</span>`)
      .join("");
  }

  // ---------- Note segmentation ----------
  // A segment begins when a confident stable pitch appears, and ends when the
  // pitch changes note or the signal drops. Its duration drives complexity.
  const MIN_SEG_MS = 90;

  // Stamp a finished segment and record it for replay / share / export
  function closeSegment(seg, now) {
    const dur = now - seg.startedAt;
    if (dur < MIN_SEG_MS) return;
    stampNote(seg, dur / 1000);
    state.perf.push({
      t: Math.round(seg.startedAt - state.startTime + state.perfOffset),
      n: seg.note, o: seg.octave, d: Math.round(dur),
      l: Math.round(seg.level * 1000) / 1000,
    });
  }

  function processPitch(now) {
    if (!state.analyser || state.paused || state.mode === "replay") return;
    if (els.detection.value === "music") return processChords(now);
    state.analyser.getFloatTimeDomainData(timeBuf);
    const sens = els.sensitivity.value / 100;
    const res = detectPitch(timeBuf, state.audioCtx.sampleRate);
    const minClarity = 0.93 - sens * 0.25;
    const minRms = 0.02 - sens * 0.017;

    els.levelMeter.style.width = Math.min(100, res.rms * 900) + "%";
    state.smoothLevel += (Math.min(1, res.rms * 6) - state.smoothLevel) * 0.25;

    const heard = res.freq > 0 && res.clarity >= minClarity && res.rms >= minRms;
    let info = null;
    if (heard) {
      info = freqToNote(res.freq);
      els.curNote.textContent = info.name;
      els.curFreq.textContent = res.freq.toFixed(1) + " Hz";
      els.detectNote.textContent = info.name;
      updatePreview(info.note);
      highlightLegend(info.note);
    } else {
      highlightLegend(-1);
    }

    const cur = state.current;
    if (cur) {
      if (heard && info.note === cur.note && info.octave === cur.octave) {
        cur.level = Math.max(cur.level, res.rms);
        // Long sustained notes re-stamp with growing detail every 700ms
        if (now - cur.lastGrow > 700) {
          cur.lastGrow = now;
          cur.restamps = (cur.restamps || 0) + 1;
          stampNote(cur, (now - cur.startedAt) / 1000);
        }
      } else {
        closeSegment(cur, now);
        state.current = null;
      }
    }
    if (!state.current && heard) {
      state.stampCount++;
      state.current = {
        note: info.note, octave: info.octave,
        startedAt: now, lastGrow: now, level: res.rms,
      };
    }
  }

  // Music mode: chromagram-based polyphonic detection. Up to three stable
  // pitch classes are tracked as concurrent segments, so chords stamp
  // composite layers. High spectral flatness (percussion / noise) is ignored.
  function processChords(now) {
    state.analyser.getFloatTimeDomainData(timeBuf);
    if (!freqBuf) freqBuf = new Float32Array(state.analyser.frequencyBinCount);
    state.analyser.getFloatFrequencyData(freqBuf);

    let rms = 0;
    for (let i = 0; i < timeBuf.length; i++) rms += timeBuf[i] * timeBuf[i];
    rms = Math.sqrt(rms / timeBuf.length);
    els.levelMeter.style.width = Math.min(100, rms * 900) + "%";
    state.smoothLevel += (Math.min(1, rms * 6) - state.smoothLevel) * 0.25;

    const sens = els.sensitivity.value / 100;
    const minRms = 0.02 - sens * 0.017;
    const { chroma, strongest, flatness } = MusiPitch.chromagram(
      freqBuf, state.audioCtx.sampleRate, state.analyser.fftSize
    );

    const active = new Set();
    if (rms >= minRms && flatness < 0.5) {
      let max = 0;
      for (let pc = 0; pc < 12; pc++) max = Math.max(max, chroma[pc]);
      if (max > 0) {
        const ranked = [];
        for (let pc = 0; pc < 12; pc++)
          if (chroma[pc] >= max * (0.65 - sens * 0.25)) ranked.push([chroma[pc], pc]);
        ranked.sort((a, b) => b[0] - a[0]);
        for (const [, pc] of ranked.slice(0, 3)) active.add(pc);
      }
      if (active.size) {
        const top = [...active][0];
        const octv = strongest[top] ? freqToNote(strongest[top].freq).octave : 4;
        const label = NOTE_NAMES[top] + octv;
        els.curNote.textContent = label;
        els.detectNote.textContent = label;
        els.curFreq.textContent = strongest[top] ? strongest[top].freq.toFixed(1) + " Hz" : "— Hz";
        updatePreview(top);
        highlightLegend(top);
      }
    } else {
      highlightLegend(-1);
    }

    // Debounced per-pitch-class segment tracking (~3 ticks on, ~5 ticks off)
    for (let pc = 0; pc < 12; pc++) {
      const present = active.has(pc);
      state.pcOn[pc] = present ? state.pcOn[pc] + 1 : 0;
      state.pcOff[pc] = present ? 0 : state.pcOff[pc] + 1;
      const seg = state.chordSegs.get(pc);
      if (seg) {
        if (present) {
          seg.level = Math.max(seg.level, rms);
          if (now - seg.lastGrow > 700) {
            seg.lastGrow = now;
            seg.restamps = (seg.restamps || 0) + 1;
            stampNote(seg, (now - seg.startedAt) / 1000);
          }
        } else if (state.pcOff[pc] >= 5) {
          closeSegment(seg, now);
          state.chordSegs.delete(pc);
        }
      } else if (present && state.pcOn[pc] >= 3) {
        state.stampCount++;
        const octv = strongest[pc] ? freqToNote(strongest[pc].freq).octave : 4;
        state.chordSegs.set(pc, {
          note: pc, octave: Math.max(2, Math.min(6, octv)),
          startedAt: now, lastGrow: now, level: rms,
        });
      }
    }
  }

  let lastPreviewNote = -1;
  function updatePreview(note) {
    if (note === lastPreviewNote) return;
    lastPreviewNote = note;
    const p = els.patternPreview.getContext("2d");
    p.clearRect(0, 0, 88, 88);
    p.strokeStyle = noteColor(note);
    p.lineWidth = 1.4;
    drawPattern(p, note, 44, 44, 34, 0, 0.8);
  }

  let lastLegend = -1;
  function highlightLegend(note) {
    if (note === lastLegend) return;
    if (lastLegend >= 0) legendCells[lastLegend].classList.remove("active");
    if (note >= 0) legendCells[note].classList.add("active");
    lastLegend = note;
  }

  // ---------- Processing tick ----------
  // Pitch detection runs on a timer, not requestAnimationFrame: rAF stops
  // entirely when the tab is hidden, which would silently freeze listening.
  setInterval(() => {
    const now = performance.now();
    processPitch(now);

    // Trail fade slowly dissolves the accumulated artwork
    const fade = els.trail.value / 100;
    if (fade > 0 && !state.paused && state.mode !== "idle" && art) {
      const a = art.getContext("2d");
      a.save();
      a.globalCompositeOperation = "destination-out";
      a.fillStyle = `rgba(0,0,0,${fade * 0.02})`;
      a.fillRect(0, 0, art.width, art.height);
      a.restore();
    }

    if (state.mode !== "idle" && !state.paused) {
      const t = Math.floor((now - state.startTime) / 1000);
      els.timer.textContent =
        String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
    }
  }, 33);

  // ---------- Render loop (painting only) ----------
  // With Motion FX on, the artwork breathes with the audio level, rotates
  // slowly, and gets a soft bloom pass — the underlying art stays untouched.
  function frame() {
    requestAnimationFrame(frame);
    resizeCanvas();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#050509";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (scaffold) ctx.drawImage(scaffold, 0, 0);
    if (state.fxOn) {
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const rot = (performance.now() * 0.00002) % TAU; // one turn ≈ 5 minutes
      const breath = 1 + state.smoothLevel * 0.03;
      // Bloom without a per-frame blur convolution: downscale `art` into a
      // small canvas (cheap blit), then draw it back upscaled — the resample
      // itself supplies the soft glow, at a fraction of ctx.filter's cost.
      const bctx = bloomSmall.getContext("2d");
      bctx.clearRect(0, 0, bloomSmall.width, bloomSmall.height);
      bctx.drawImage(art, 0, 0, bloomSmall.width, bloomSmall.height);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(breath, breath);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55;
      ctx.drawImage(bloomSmall, -cx, -cy, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.drawImage(art, -cx, -cy);
      ctx.restore();
      ctx.globalCompositeOperation = "source-over";
    } else {
      ctx.drawImage(art, 0, 0);
    }
  }
  requestAnimationFrame(frame);

  // ---------- Audio setup ----------
  function ensureAudio() {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
    if (!state.analyser) {
      state.analyser = state.audioCtx.createAnalyser();
      // Large FFT gives the chromagram enough frequency resolution; melody
      // mode still reads only the first 2048 time-domain samples.
      state.analyser.fftSize = 8192;
    }
    return state.audioCtx;
  }

  function stopInput() {
    const now = performance.now();
    // Flush in-flight segments so they're drawn and recorded before teardown
    if (state.mode !== "idle" && state.mode !== "replay") {
      if (state.current) { closeSegment(state.current, now); state.current = null; }
      for (const seg of state.chordSegs.values()) closeSegment(seg, now);
      state.chordSegs.clear();
      if (state.perf.length) {
        const last = state.perf[state.perf.length - 1];
        state.perfOffset = last.t + last.d + 800; // gap before the next session
      }
    }
    if (replayTimer) {
      clearInterval(replayTimer);
      replayTimer = null;
      els.btnReplay.textContent = "⟲ Replay";
    }
    if (state.micStream) { state.micStream.getTracks().forEach((t) => t.stop()); state.micStream = null; }
    if (state.sourceNode) { try { state.sourceNode.disconnect(); } catch (e) {} state.sourceNode = null; }
    if (state.demoTimer) { clearTimeout(state.demoTimer); state.demoTimer = null; }
    if (state.demoOsc) { try { state.demoOsc.stop(); } catch (e) {} state.demoOsc = null; }
    state.mode = "idle";
    state.current = null;
    setLive(false);
    els.btnMic.textContent = "● Start Mic";
    els.btnMic.classList.remove("recording");
    els.btnDemo.textContent = "▶ Demo Melody";
  }

  function setLive(on, label) {
    els.livePill.classList.toggle("on", on);
    els.liveLabel.textContent = on ? (label || "LIVE") : "IDLE";
  }

  function beginSession(mode, label) {
    state.mode = mode;
    state.startTime = performance.now();
    state.paused = false;
    els.btnPause.textContent = "⏸ Pause";
    setLive(true, label);
  }

  // --- Mic ---
  els.btnMic.addEventListener("click", async () => {
    if (state.mode === "mic") { stopInput(); return; }
    stopInput();
    try {
      const ac = ensureAudio();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      state.micStream = stream;
      state.sourceNode = ac.createMediaStreamSource(stream);
      state.sourceNode.connect(state.analyser);
      beginSession("mic", "LIVE · MIC");
      els.btnMic.textContent = "■ Stop Mic";
      els.btnMic.classList.add("recording");
    } catch (err) {
      setLive(false);
      alert("Microphone unavailable: " + err.message + "\nTry the Demo Melody instead.");
    }
  });

  // --- Audio file ---
  els.fileInput.addEventListener("change", async () => {
    const file = els.fileInput.files[0];
    if (!file) return;
    stopInput();
    const ac = ensureAudio();
    const buf = await ac.decodeAudioData(await file.arrayBuffer());
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(state.analyser);
    src.connect(ac.destination);
    src.onended = () => { if (state.mode === "file") stopInput(); };
    state.sourceNode = src;
    beginSession("file", "LIVE · FILE");
    src.start();
    els.fileInput.value = "";
  });

  // --- Demo melody: a synthesized tune routed through the same pipeline ---
  const DEMO = [ // [midi, beats] — Twinkle Twinkle in C major
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [67,1],[67,1],[65,1],[65,1],[64,1],[64,1],[62,2],
    [60,1],[60,1],[67,1],[67,1],[69,1],[69,1],[67,2],
    [65,1],[65,1],[64,1],[64,1],[62,1],[62,1],[60,2],
  ];
  els.btnDemo.addEventListener("click", () => {
    if (state.mode === "demo") { stopInput(); return; }
    stopInput();
    const ac = ensureAudio();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle";
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(state.analyser);
    gain.connect(ac.destination);
    osc.start();
    state.demoOsc = osc;
    state.demoGain = gain;
    beginSession("demo", "LIVE · DEMO");
    els.btnDemo.textContent = "■ Stop Demo";

    const beat = 0.38;
    let i = 0;
    function step() {
      if (state.mode !== "demo") return;
      if (i >= DEMO.length) { stopInput(); els.btnDemo.textContent = "▶ Demo Melody"; return; }
      const [midi, beats] = DEMO[i++];
      const dur = beats * beat;
      const t = ac.currentTime;
      osc.frequency.setValueAtTime(440 * Math.pow(2, (midi - 69) / 12), t);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.02);
      gain.gain.setValueAtTime(0.28, t + dur - 0.08);
      gain.gain.linearRampToValueAtTime(0, t + dur - 0.01);
      state.demoTimer = setTimeout(step, dur * 1000);
    }
    step();
  });

  // ---------- Controls ----------
  els.btnPause.addEventListener("click", () => {
    state.paused = !state.paused;
    els.btnPause.textContent = state.paused ? "▶ Resume" : "⏸ Pause";
  });

  function clearArt() {
    art.getContext("2d").clearRect(0, 0, art.width, art.height);
    state.stampCount = 0;
    state.noteCounts = {};
    state.history = [];
    els.noteHistory.innerHTML = "";
    els.canvasEmpty.classList.remove("hidden");
  }
  els.btnClear.addEventListener("click", () => {
    clearArt();
    state.perf = [];
    state.perfOffset = 0;
  });

  els.btnSave.addEventListener("click", () => {
    const out = document.createElement("canvas");
    out.width = art.width; out.height = art.height;
    const o = out.getContext("2d");
    o.fillStyle = "#050509";
    o.fillRect(0, 0, out.width, out.height);
    if (scaffold) o.drawImage(scaffold, 0, 0);
    o.drawImage(art, 0, 0);
    const link = document.createElement("a");
    link.download = "musicanvas-artwork.png";
    link.href = out.toDataURL("image/png");
    link.click();
  });

  function bindSliderLabel(input, label, suffix) {
    const update = () => (label.textContent = input.value + suffix);
    input.addEventListener("input", update);
    update();
  }
  bindSliderLabel(els.sensitivity, els.sensVal, "%");
  bindSliderLabel(els.trail, els.trailVal, "%");
  bindSliderLabel(els.detail, els.detailVal, "%");

  els.colorMode.addEventListener("change", () => { lastPreviewNote = -1; });

  // ---------- Replay ----------
  // A performance is just its note events; replaying clears the canvas and
  // re-runs them through the exact same stamping code, reproducing the
  // artwork stroke by stroke (with the current style settings).
  let replayTimer = null;

  function buildTimeline(events) {
    const items = [];
    for (const ev of events) {
      const seg = { note: ev.n, octave: ev.o, level: ev.l };
      items.push({ at: ev.t, run: () => {
        const label = NOTE_NAMES[ev.n] + ev.o;
        els.curNote.textContent = label;
        els.detectNote.textContent = label;
        updatePreview(ev.n);
        highlightLegend(ev.n);
      } });
      const holds = Math.floor(ev.d / 700);
      for (let i = 1; i <= holds; i++) {
        const hold = i;
        items.push({ at: ev.t + hold * 700, run: () => {
          seg.restamps = hold;
          stampNote(seg, (hold * 700) / 1000);
        } });
      }
      items.push({ at: ev.t + ev.d, run: () => { stampNote(seg, ev.d / 1000); } });
    }
    items.sort((a, b) => a.at - b.at);
    return items;
  }

  function startReplay(events, onDone) {
    if (!events || !events.length) {
      alert("Nothing to replay yet — play or load a performance first.");
      return;
    }
    stopInput();
    clearArt();
    state.mode = "replay";
    state.startTime = performance.now();
    setLive(true, "REPLAY");
    els.btnReplay.textContent = "■ Stop Replay";
    const items = buildTimeline(events);
    let idx = 0;
    const t0 = performance.now();
    replayTimer = setInterval(() => {
      const elapsed = performance.now() - t0;
      while (idx < items.length && items[idx].at <= elapsed) items[idx++].run();
      if (idx >= items.length) {
        clearInterval(replayTimer);
        replayTimer = null;
        state.mode = "idle";
        setLive(false);
        els.btnReplay.textContent = "⟲ Replay";
        highlightLegend(-1);
        if (onDone) onDone();
      }
    }, 30);
  }

  els.btnReplay.addEventListener("click", () => {
    if (replayTimer) { stopInput(); return; }
    startReplay(state.perf.slice());
  });

  // ---------- Share links ----------
  // The whole performance is compressed into the URL hash — no server, the
  // link itself is the artwork.
  function b64url(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64url(str) {
    const b = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }

  async function encodePerf(events) {
    const bytes = new TextEncoder().encode(
      JSON.stringify(events.map((e) => [e.t, e.n, e.o, e.d, Math.round(e.l * 1000)]))
    );
    if (window.CompressionStream) {
      const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return "d" + b64url(new Uint8Array(await new Response(cs).arrayBuffer()));
    }
    return "j" + b64url(bytes);
  }

  async function decodePerf(s) {
    const bytes = unb64url(s.slice(1));
    let json;
    if (s[0] === "d") {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      json = await new Response(ds).text();
    } else {
      json = new TextDecoder().decode(bytes);
    }
    return JSON.parse(json).map((a) => ({ t: a[0], n: a[1], o: a[2], d: a[3], l: a[4] / 1000 }));
  }

  els.btnShare.addEventListener("click", async () => {
    if (!state.perf.length) { alert("Play something first — then share it."); return; }
    const url = location.origin + location.pathname + "#p=" + (await encodePerf(state.perf));
    try {
      await navigator.clipboard.writeText(url);
      els.btnShare.textContent = "✓ Copied!";
    } catch (e) {
      window.prompt("Copy your share link:", url);
    }
    setTimeout(() => (els.btnShare.textContent = "🔗 Share Link"), 1800);
  });

  // Opening a share link redraws the performance automatically
  if (location.hash.startsWith("#p=")) {
    decodePerf(location.hash.slice(3))
      .then((events) => {
        state.perf = events;
        setTimeout(() => startReplay(events), 600);
      })
      .catch(() => {});
  }

  // ---------- Exports ----------
  // Exports re-render the recorded performance from scratch into the target
  // (fresh variant counters), so output is deterministic at any resolution.
  function renderPerfTo(target, events) {
    for (const ev of events) {
      const seg = { note: ev.n, octave: ev.o, level: ev.l };
      const holds = Math.floor(ev.d / 700);
      for (let i = 1; i <= holds; i++) {
        seg.restamps = i;
        stampNote(seg, (i * 700) / 1000, target);
      }
      stampNote(seg, ev.d / 1000, target);
    }
  }

  // One cheap downscale-then-upscale bloom pass, standing in for the
  // per-shape shadowBlur glow (too slow) and for ctx.filter blur (a full-res
  // convolution — measured 30+s at 4K) across a whole bulk render.
  function applyBloom(ctx, w, h) {
    const sw = Math.max(48, Math.round(w / 8)), sh = Math.max(48, Math.round(h / 8));
    const small = document.createElement("canvas");
    small.width = sw; small.height = sh;
    small.getContext("2d").drawImage(ctx.canvas, 0, 0, sw, sh);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(small, 0, 0, w, h);
    ctx.restore();
  }

  function downloadBlob(blob, name) {
    const link = document.createElement("a");
    link.download = name;
    link.href = URL.createObjectURL(blob);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  els.btnSvg.addEventListener("click", () => {
    if (!state.perf.length) { alert("Play something first."); return; }
    const svgCtx = new SVGContext(art.width, art.height);
    renderPerfTo(
      { ctx: svgCtx, w: art.width, h: art.height, dpr: window.devicePixelRatio || 1, counters: {} },
      state.perf
    );
    downloadBlob(new Blob([svgCtx.toSVG("#050509")], { type: "image/svg+xml" }), "musicanvas-artwork.svg");
  });

  els.btnHiRes.addEventListener("click", () => {
    if (!state.perf.length) { alert("Play something first."); return; }
    if (els.btnHiRes.disabled) return;
    els.btnHiRes.disabled = true;
    els.btnHiRes.textContent = "⬇ Rendering…";
    // Deferred via setTimeout (not requestAnimationFrame) so the "Rendering…"
    // label update flushes even in a backgrounded/hidden tab, where rAF never
    // fires at all — the same pitfall the pitch-detection loop hit earlier.
    setTimeout(() => {
      // `art` is already devicePixelRatio-scaled physical pixels, so `k` alone
      // (not re-multiplied by dpr) is the correct scale. Target the short edge
      // at 2400px rather than a full 4096: PNG-encoding a ~20MP RGBA canvas
      // measured minutes on constrained hardware, vs. seconds at this size,
      // while still comfortably exceeding the on-screen canvas resolution.
      const k = 2400 / Math.min(art.width, art.height);
      const w = Math.round(art.width * k), h = Math.round(art.height * k);
      const big = document.createElement("canvas");
      big.width = w; big.height = h;
      const bctx = big.getContext("2d");
      bctx.fillStyle = "#050509";
      bctx.fillRect(0, 0, w, h);
      bctx.drawImage(buildScaffoldCanvas(w, h), 0, 0);
      // glow:false — per-shape shadowBlur at this resolution would take far
      // too long; a single bloom pass afterward gives the same look cheaply.
      renderPerfTo({ ctx: bctx, w, h, dpr: k, counters: {}, glow: false }, state.perf);
      applyBloom(bctx, w, h);
      big.toBlob((blob) => {
        downloadBlob(blob, "musicanvas-hires.png");
        els.btnHiRes.textContent = "⬇ Hi-Res";
        els.btnHiRes.disabled = false;
      }, "image/png");
    }, 20);
  });

  els.btnVideo.addEventListener("click", () => {
    if (!state.perf.length) { alert("Play something first."); return; }
    if (state.recorder) return;
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      downloadBlob(new Blob(chunks, { type: "video/webm" }), "musicanvas-timelapse.webm");
      state.recorder = null;
      els.btnVideo.textContent = "⏺ Record Timelapse Video";
    };
    state.recorder = rec;
    rec.start();
    els.btnVideo.textContent = "⏺ Recording…";
    startReplay(state.perf.slice(), () => setTimeout(() => rec.stop(), 600));
  });

  // ---------- Performance mode ----------
  els.btnFx.classList.add("on");
  els.btnFx.addEventListener("click", () => {
    state.fxOn = !state.fxOn;
    els.btnFx.classList.toggle("on", state.fxOn);
  });

  els.btnFull.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else canvas.parentElement.requestFullscreen();
  });

  // Debug / power-user hooks
  window.MusiCanvas = {
    getPerf: () => state.perf.slice(),
    encodePerf, decodePerf, startReplay,
    buildSVG: () => {
      const s = new SVGContext(art.width, art.height);
      renderPerfTo({ ctx: s, w: art.width, h: art.height, dpr: 1, counters: {} }, state.perf);
      return s.toSVG("#050509");
    },
  };
})();
