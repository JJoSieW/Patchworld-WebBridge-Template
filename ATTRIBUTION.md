# Attribution — piano samples (`assets/piano/`)

The 30 piano note samples in `assets/piano/*.ogg` are not original recordings.
They are rendered MIDI notes played through a third-party soundfont.

## Soundfont

- **Name**: GeneralUser GS
- **Version**: v1.471
- **Author**: S. Christian Collins
- **md5 (of the .sf2 file used to render these samples)**: `775b5767a1f699030ad8f94c901508ed`
- **License**: the GeneralUser GS license, which permits use in software
  projects and distribution of audio rendered with it.

**Gap, flagged rather than guessed**: the soundfont's own `LICENSE.txt` was
not available in this working copy when this file was written (only the
binary `.sf2` was transferred locally) — its exact text is *not* reproduced
here, and no URL to the author's site is included, since that would mean
either fabricating license text or guessing a URL, neither of which is safe
to do on your behalf. **Before this repo is made public**, please either:
1. paste the actual `LICENSE.txt` contents into this file (it should be
   bundled alongside the original GeneralUser GS download), replacing this
   note, or
2. give me the correct URL to the author's site and I'll add it as a link
   (per the license, we must link out rather than hotlink the author's own
   download files).

## Render settings

Rendered with the exact same code path as this project's other audio
outputs (`src/data/render.py::_render_midi_to_array`, via
`pretty_midi.PrettyMIDI.fluidsynth`), so the listening-test stimuli and
these web-app samples share the same timbre:

| setting | value |
|---|---|
| engine | `pretty_midi` + FluidSynth (pyfluidsynth) |
| sample rate | 44100 Hz |
| channels | 1 (mono — left channel of FluidSynth's interleaved stereo output) |
| synth gain | 0.2 |
| reverb | on |
| chorus | on |
| polyphony | 256 |
| bank / preset | 0 / 0 ("Acoustic Grand Piano") |
| render velocity | 80 (fixed — the app scales perceived loudness by gain, not by re-rendering at different velocities) |
| note hold / decay / total | 1.5 s / 1.0 s / 2.5 s (the 1.0 s tail is the soundfont's own release, not a synthetic envelope) |

Post-processing: leading silence trimmed (abs threshold 1e-4), peak-normalized
to −3 dBFS, 20 ms raised-cosine fade-out. Encoded to OGG/Vorbis (quality 0.5,
≈ `oggenc -q5`) via `soundfile` 0.13.1.

## Pitch coverage

One sample every 3 semitones, MIDI 21 (A0) – 108 (C8), 30 files total.
`synth.js`'s `PianoSynth` fills the gaps (≤ 1.5 semitones) by pitch-shifting
the nearest sample via `AudioBufferSourceNode.playbackRate`.
