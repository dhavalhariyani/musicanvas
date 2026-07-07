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

  /**
   * Chromagram for polyphonic (chord) detection: folds FFT magnitudes into
   * the 12 pitch classes. Also reports spectral flatness, which separates
   * tonal content (low) from percussion/noise (high).
   * @param freqData Float32Array of dB values from AnalyserNode
   * @returns { chroma[12], strongest[12] (peak freq per class), flatness }
   */
  function chromagram(freqData, sampleRate, fftSize) {
    const chroma = new Float32Array(12);
    const strongest = new Array(12).fill(null);
    const binHz = sampleRate / fftSize;
    const lo = Math.max(1, Math.ceil(60 / binHz));
    const hi = Math.min(freqData.length - 1, Math.floor(2200 / binHz));
    let sum = 0, logSum = 0, count = 0;
    for (let i = lo; i <= hi; i++) {
      const mag = Math.pow(10, freqData[i] / 20);
      const f = i * binHz;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      chroma[pc] += mag;
      if (!strongest[pc] || mag > strongest[pc].mag) strongest[pc] = { mag, freq: f };
      sum += mag; logSum += Math.log(mag + 1e-12); count++;
    }
    const flatness = Math.exp(logSum / count) / (sum / count + 1e-12);
    return { chroma, strongest, flatness };
  }

  window.MusiPitch = { detectPitch, freqToNote, chromagram };
})();
