/*
 * Lightweight monophonic pitch detector (autocorrelation, ACF2+ style).
 * Runs on the time-domain buffer from an AnalyserNode. No dependencies.
 * Returns { freq, clarity, rms } or null when no confident pitch is found.
 */
(function () {
  function detectPitch(buf, sampleRate) {
    const n = buf.length;

    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < 0.004) return { freq: 0, clarity: 0, rms };

    // Trim leading/trailing silence for a cleaner correlation
    let r1 = 0, r2 = n - 1;
    const thres = 0.2;
    for (let i = 0; i < n / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < n / 2; i++) if (Math.abs(buf[n - i]) < thres) { r2 = n - i; break; }
    const sub = buf.slice(r1, r2);
    const m = sub.length;
    if (m < 128) return { freq: 0, clarity: 0, rms };

    const c = new Float32Array(m);
    for (let lag = 0; lag < m; lag++) {
      let sum = 0;
      for (let i = 0; i < m - lag; i++) sum += sub[i] * sub[i + lag];
      c[lag] = sum;
    }

    // Skip the initial peak, find the first meaningful maximum after the dip
    let d = 0;
    while (d < m - 1 && c[d] > c[d + 1]) d++;
    let maxVal = -1, maxPos = -1;
    for (let i = d; i < m; i++) {
      if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
    }
    if (maxPos <= 0) return { freq: 0, clarity: 0, rms };

    // Parabolic interpolation around the peak for sub-sample accuracy
    let T0 = maxPos;
    if (maxPos > 0 && maxPos < m - 1) {
      const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = c[maxPos + 1];
      const a = (x1 + x3 - 2 * x2) / 2;
      const b = (x3 - x1) / 2;
      if (a) T0 = maxPos - b / (2 * a);
    }

    const freq = sampleRate / T0;
    const clarity = c[0] > 0 ? maxVal / c[0] : 0;
    if (freq < 60 || freq > 2200) return { freq: 0, clarity: 0, rms };
    return { freq, clarity, rms };
  }

  /** Convert a frequency in Hz to { note: 0..11, octave, name, midi }. */
  function freqToNote(freq) {
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    const note = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return { midi, note, octave, name: MusiPatterns.NOTE_NAMES[note] + octave };
  }

  window.MusiPitch = { detectPitch, freqToNote };
})();
