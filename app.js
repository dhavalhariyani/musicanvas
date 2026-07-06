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
    current: null,           // active note segment {note, octave, rot, startedAt, level, lastGrow}
    history: [],
    demoTimer: null, demoOsc: null, demoGain: null,
  };
  const timeBuf = new Float32Array(2048);

  // Radii of the faint construction rings drawn beneath the artwork.
  // (Declared before resizeCanvas() runs below.)
  const SCAFFOLD_RINGS = [0.18, 0.34, 0.5, 0.66, 0.82];

  // ---------- Canvas sizing ----------
  let art = null;      // offscreen canvas holding the accumulated artwork
  let scaffold = null; // faint construction geometry rendered beneath the art
  function buildScaffold(w, h) {
    scaffold = document.createElement("canvas");
    scaffold.width = w; scaffold.height = h;
    const s = scaffold.getContext("2d");
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
    buildScaffold(w, h);
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
  function stampNote(seg, durationSec) {
    const a = art.getContext("2d");
    const w = art.width, h = art.height;
    const dpr = window.devicePixelRatio || 1;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.47;

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

    a.save();
    a.globalCompositeOperation = "lighter";
    a.shadowColor = color;
    a.shadowBlur = 6 * dpr;
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
      a.shadowBlur = 3 * dpr;
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
      a.shadowBlur = 6 * dpr;
    }
    a.restore();

    pushHistory(NOTE_NAMES[seg.note] + seg.octave, color);
    els.canvasEmpty.classList.add("hidden");
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
  function processPitch(now) {
    if (!state.analyser || state.paused) return;
    state.analyser.getFloatTimeDomainData(timeBuf);
    const sens = els.sensitivity.value / 100;
    const res = detectPitch(timeBuf, state.audioCtx.sampleRate);
    const minClarity = 0.93 - sens * 0.25;
    const minRms = 0.02 - sens * 0.017;

    els.levelMeter.style.width = Math.min(100, res.rms * 900) + "%";

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
        const dur = now - cur.startedAt;
        if (dur >= MIN_SEG_MS) stampNote(cur, dur / 1000);
        state.current = null;
      }
    }
    if (!state.current && heard) {
      state.stampCount++;
      // Repeats of the same note+octave cycle through a small family of
      // layer variants (rotation × radius). Beyond MAX_VARIANTS the layer
      // set is complete — further repeats only shimmer the nodes, so the
      // artwork converges instead of growing denser forever.
      const R_SCALES = [1.3, 0.75, 1.05, 0.5, 1.2, 0.62, 0.9];
      const MAX_VARIANTS = 6;
      const key = info.note + ":" + info.octave;
      const n = state.noteCounts[key] || 0;
      state.noteCounts[key] = n + 1;
      state.current = {
        note: info.note, octave: info.octave,
        variant: Math.min(n, MAX_VARIANTS),
        echo: n >= MAX_VARIANTS,
        rot: (n % 4) * (TAU / 16),        // deterministic per-repeat rotation
        rScale: R_SCALES[n % 7],          // deterministic radius spread
        startedAt: now, lastGrow: now, level: res.rms,
      };
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
  function frame() {
    requestAnimationFrame(frame);
    resizeCanvas();
    ctx.fillStyle = "#050509";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (scaffold) ctx.drawImage(scaffold, 0, 0);
    ctx.drawImage(art, 0, 0);
  }
  requestAnimationFrame(frame);

  // ---------- Audio setup ----------
  function ensureAudio() {
    if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.audioCtx.state === "suspended") state.audioCtx.resume();
    if (!state.analyser) {
      state.analyser = state.audioCtx.createAnalyser();
      state.analyser.fftSize = 2048;
    }
    return state.audioCtx;
  }

  function stopInput() {
    if (state.micStream) { state.micStream.getTracks().forEach((t) => t.stop()); state.micStream = null; }
    if (state.sourceNode) { try { state.sourceNode.disconnect(); } catch (e) {} state.sourceNode = null; }
    if (state.demoTimer) { clearTimeout(state.demoTimer); state.demoTimer = null; }
    if (state.demoOsc) { try { state.demoOsc.stop(); } catch (e) {} state.demoOsc = null; }
    state.mode = "idle";
    state.current = null;
    setLive(false);
    els.btnMic.textContent = "● Start Mic";
    els.btnMic.classList.remove("recording");
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

  els.btnClear.addEventListener("click", () => {
    art.getContext("2d").clearRect(0, 0, art.width, art.height);
    state.stampCount = 0;
    state.noteCounts = {};
    state.history = [];
    els.noteHistory.innerHTML = "";
    els.canvasEmpty.classList.remove("hidden");
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
})();
