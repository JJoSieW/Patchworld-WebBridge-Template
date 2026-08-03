// ---------------------------------------------------------------------------
// Sampled piano (2026-07-29, wired in once eval_results/webapp_assets/
// landed from HPC): 30 real piano notes, one every 3 semitones (MIDI 21..108),
// rendered with the SAME soundfont/FluidSynth path as the project's own
// audio renders (see ../ATTRIBUTION.md for full provenance + license). Gaps
// between sampled pitches (<=1.5 semitones) are filled by pitch-shifting the
// nearest sample via AudioBufferSourceNode.playbackRate. Self-contained (no
// CDN) -- files live in assets/piano/ alongside this client.
//
// Samples load asynchronously at page load; PianoSynth.scheduleNote falls
// back to the original oscillator synth for any note scheduled before its
// nearest sample has finished loading/decoding (or if loading fails), so
// playback is never silent while waiting on the network. This is the
// intended fallback path from the Stage 1 report, not a removed feature.
// ---------------------------------------------------------------------------

const PIANO_SAMPLE_PITCHES = [
  21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75,
  78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108,
];
const PIANO_ASSET_BASE = "assets/piano/";

class PianoSynth {
  constructor() {
    this.ctx = null;
    this.melodyGain = null;
    this.accompGain = null;
    this._scheduled = [];
    this._buffers = {};       // pitch -> AudioBuffer, filled in as loads complete
    this._loadPromise = null;
  }

  _ensureContext() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.melodyGain = this.ctx.createGain();
    this.accompGain = this.ctx.createGain();
    this.melodyGain.gain.value = 0.9;
    this.accompGain.gain.value = 0.6;   // accompaniment sits under the melody
    this.melodyGain.connect(this.ctx.destination);
    this.accompGain.connect(this.ctx.destination);
  }

  // Kicks off loading immediately (called once at the bottom of this file)
  // so samples are ready well before the user's first Play. Safe to call
  // before a user gesture: decoding doesn't require a running context, only
  // an existing one -- actual playback naturally waits for the context to
  // resume, which happens on the same click that triggers Play/Generate.
  loadSamples() {
    this._ensureContext();
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = Promise.all(PIANO_SAMPLE_PITCHES.map(async (p) => {
      try {
        const res = await fetch(`${PIANO_ASSET_BASE}${p}.ogg`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arrBuf = await res.arrayBuffer();
        this._buffers[p] = await this.ctx.decodeAudioData(arrBuf);
      } catch (e) {
        console.warn(`PianoSynth: sample for pitch ${p} failed to load, ` +
          `will use the oscillator fallback for it`, e);
      }
    }));
    return this._loadPromise;
  }

  static _nearestSamplePitch(pitch) {
    let best = PIANO_SAMPLE_PITCHES[0], bestDist = Infinity;
    for (const p of PIANO_SAMPLE_PITCHES) {
      const d = Math.abs(p - pitch);
      if (d < bestDist) { bestDist = d; best = p; }
    }
    return best;
  }

  static pitchToFreq(pitch) {
    return 440 * Math.pow(2, (pitch - 69) / 12);
  }

  // Schedules one note. track: "melody" | "accomp". startSec/durSec are
  // relative to `originTime` (an AudioContext time).
  scheduleNote(track, pitch, startSec, durSec, velocity, originTime) {
    this._ensureContext();
    const bus = track === "melody" ? this.melodyGain : this.accompGain;
    const t0 = originTime + startSec;
    const samplePitch = PianoSynth._nearestSamplePitch(pitch);
    const buffer = this._buffers[samplePitch];
    if (buffer) {
      this._scheduleSample(buffer, samplePitch, pitch, bus, t0, velocity);
    } else {
      this._scheduleOscillator(bus, pitch, t0, Math.max(durSec, 0.05), velocity);
    }
  }

  _scheduleSample(buffer, samplePitch, pitch, bus, t0, velocity) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    // gaps between sampled pitches are <=1.5 semitones, so the pitch shift
    // needed is always small
    src.playbackRate.value = Math.pow(2, (pitch - samplePitch) / 12);
    const g = this.ctx.createGain();
    // samples are already peak-normalized (-3dBFS) at a fixed render
    // velocity (80); scale by the note's own velocity for some dynamic
    // range even though the timbre itself doesn't change with it.
    g.gain.value = 0.3 + 0.7 * (velocity / 127);
    src.connect(g);
    g.connect(bus);
    src.start(t0);
    // No explicit stop tied to note duration -- let the sample's own
    // natural piano decay ring out (it's a real recording with its own
    // release, not a synthetic envelope to cut short); stopAll() below can
    // still cut it off early (e.g. the global Stop button).
    this._scheduled.push(src);
  }

  _scheduleOscillator(bus, pitch, t0, dur, velocity) {
    const freq = PianoSynth.pitchToFreq(pitch);
    const peak = 0.15 + 0.5 * (velocity / 127);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(Math.max(peak * 0.25, 0.001), t0 + dur * 0.6);
    env.gain.exponentialRampToValueAtTime(0.0005, t0 + dur + 0.15);
    env.connect(bus);

    const filt = this.ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = Math.min(freq * 6, 8000);
    filt.connect(env);

    // fundamental + two quiet harmonics, approximating a struck-string timbre
    [[1, 1.0], [2, 0.25], [3, 0.1]].forEach(([mult, amp]) => {
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq * mult;
      const g = this.ctx.createGain();
      g.gain.value = amp;
      osc.connect(g);
      g.connect(filt);
      osc.start(t0);
      osc.stop(t0 + dur + 0.2);
      this._scheduled.push(osc);
    });
  }

  stopAll() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    this._scheduled.forEach((node) => {
      try { node.stop(now); } catch (e) { /* already stopped */ }
    });
    this._scheduled = [];
  }

  get currentTime() {
    this._ensureContext();
    return this.ctx.currentTime;
  }
}

// Thin playback wrapper used by app.js's emitNotes/play/stop -- holds "the
// last generated notes" so Play can be pressed any time after generation,
// independent of when emitNotes was called.
const Synth = {
  _engine: new PianoSynth(),
  _notes: null,
  _stopTimeout: null,

  setNotes(notes) { this._notes = notes; },

  play(onDone) {
    if (!this._notes) return;
    this.stop();
    const t0 = this._engine.currentTime + 0.05;
    this._notes.forEach((n) =>
      this._engine.scheduleNote(n.track, n.pitch, n.start_sec, n.dur_sec, n.velocity, t0));
    this._stopTimeout = setTimeout(() => { this.stop(); if (onDone) onDone(); },
      (CROP_SEC + 0.5) * 1000);
  },

  stop() {
    this._engine.stopAll();
    clearTimeout(this._stopTimeout);
  },
};

// Start loading samples immediately -- see PianoSynth.loadSamples's comment.
Synth._engine.loadSamples();
