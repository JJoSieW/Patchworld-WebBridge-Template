// Drawing input (pointer events: mouse, touch, and the Quest browser's
// ray-to-pointer emulation) + piano-roll output rendering. This module knows
// nothing about the server or Web Audio -- it only ever calls the single
// global `onContourInput(points)` (defined in app.js) when the drawn line
// changes. In Stage 2 this whole file is replaced by bridge/hand-tracking
// code that calls the same `onContourInput`; nothing else needs to change.
const SPAN_TOL = 0.02;   // must match webapp/server/contour_live.py's DRAW_SPAN_TOL

// FIXED piano-roll pitch axis (2026-07-29 fix -- was autoscaled per
// generation, which is the bug this replaces; see drawRoll below for the
// full rationale). Derived from data/contours/*/meta.json's p_lo_pctile/
// p_hi_pctile (the melody's 2nd/98th-percentile MIDI pitch bounds used for
// contour normalization) across all 900 POP909 songs: median p_lo=64,
// median p_hi=79, padded +/-8 semitones. See scripts/compute_pitch_axis.py.
const PITCH_AXIS_LO = 56;   // MIDI (G#3)
const PITCH_AXIS_HI = 87;   // MIDI (D#6)

const Canvas = (() => {
  const drawCanvas = document.getElementById("draw-canvas");
  const rollCanvas = document.getElementById("roll-canvas");
  const spanWarning = document.getElementById("span-warning");

  let rawPoints = [];
  let isDrawing = false;

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  function canvasPoint(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp01((evt.clientX - rect.left) / rect.width);
    const y = clamp01(1 - (evt.clientY - rect.top) / rect.height);
    return [x, y];
  }

  function hasFullSpan(points) {
    if (points.length < 2) return false;
    const xs = points.map((p) => p[0]);
    return Math.min(...xs) <= SPAN_TOL && Math.max(...xs) >= 1 - SPAN_TOL;
  }

  function drawGrid(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "#22252e";
    ctx.lineWidth = 1;
    for (let s = 0; s <= 10; s++) {
      const x = (s / 10) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.strokeStyle = "#2c303b";
    ctx.stroke();
  }

  function redrawDrawCanvas() {
    const ctx = drawCanvas.getContext("2d");
    const w = drawCanvas.width, h = drawCanvas.height;
    drawGrid(ctx, w, h);
    if (rawPoints.length < 2) return;
    ctx.strokeStyle = "#5aa9ff";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    rawPoints.forEach(([x, y], i) => {
      const px = x * w, py = (1 - y) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  function updateSpanWarning() {
    spanWarning.hidden = rawPoints.length === 0 || hasFullSpan(rawPoints);
  }

  function pointerDown(evt) {
    isDrawing = true;
    rawPoints = [canvasPoint(drawCanvas, evt)];
    redrawDrawCanvas();
    drawCanvas.setPointerCapture(evt.pointerId);
  }
  function pointerMove(evt) {
    if (!isDrawing) return;
    rawPoints.push(canvasPoint(drawCanvas, evt));
    redrawDrawCanvas();
  }
  function pointerUp() {
    if (!isDrawing) return;
    isDrawing = false;
    updateSpanWarning();
    onContourInput(rawPoints.slice());   // THE SEAM -- see app.js
  }

  drawCanvas.addEventListener("pointerdown", pointerDown);
  drawCanvas.addEventListener("pointermove", pointerMove);
  drawCanvas.addEventListener("pointerup", pointerUp);
  drawCanvas.addEventListener("pointercancel", pointerUp);

  function clear() {
    rawPoints = [];
    redrawDrawCanvas();
    updateSpanWarning();
    drawGrid(rollCanvas.getContext("2d"), rollCanvas.width, rollCanvas.height);
    onContourInput([]);   // THE SEAM -- see app.js
  }

  // ---- piano roll (output rendering, called from emitNotes) --------------
  //
  // FIX (2026-07-29, first browser test): notes used to be plotted on a
  // PER-GENERATION autoscaled pitch axis (min/max of that clip's own
  // notes), while contour_used was plotted on its native [0,1] scale --
  // two DIFFERENT coordinate systems sharing one canvas. The result: notes
  // always filled the full vertical extent regardless of how narrow the
  // melody actually was, and the contour line looked unrelated to the
  // notes even when the model was following it closely. Fix: both the
  // notes AND the contour now go through the SAME fixed affine mapping
  // (PITCH_AXIS_LO..PITCH_AXIS_HI, a dataset-derived constant, see above)
  // -- contour_used's [0,1] is treated as a fraction of that fixed range
  // (matching what the model was trained to produce a shape within), and
  // note pitches are mapped into the same [0,1] fraction the same way.
  // Accompaniment can naturally sit outside this melody-derived range
  // (e.g. bass below PITCH_AXIS_LO); such notes clamp to the axis edge
  // rather than stretching the axis, so the axis stays a stable reference
  // and doesn't get distorted by the one track we don't need to measure
  // contour-adherence against.
  //
  // This isn't cosmetic: the CHI study asks participants to rate PERCEIVED
  // control. A piano roll that visually decorrelates the notes from the
  // line the participant just drew would systematically depress those
  // ratings regardless of how well the model actually followed the
  // contour -- i.e. a measurement confound on the exact effect (abstraction
  // level vs. perceived control) the study exists to measure.
  function normPitchFixed(p) {
    return clamp01((p - PITCH_AXIS_LO) / (PITCH_AXIS_HI - PITCH_AXIS_LO));
  }

  // MANIPULATION LEAK (2026-07-29 addendum -- read before touching this):
  // contour_used is the SMOOTHED CONDITIONING SIGNAL, and its shape is
  // visibly different per abstraction level (fine=jagged, coarse=few
  // straight segments, spline=smooth curve, ...). A participant reported
  // they could identify the blind A/B/C/D condition from the overlay shape
  // alone, without listening -- that unblinds a within-subject manipulation
  // and, worse, gives participants a VISUAL explanation for what they hear,
  // so perceived control (the primary DV) would be driven by the picture
  // instead of the audio. In STUDY_MODE (config.js) we therefore overlay
  // the participant's own RAW drawn line instead: it's identical in kind
  // across all four conditions (smoothing happens server-side, after the
  // points already left the browser), so it carries no condition
  // information, while still giving a visual reference to compare the
  // notes against. contour_used is still returned by the server and still
  // logged in telemetry for analysis -- it is only the RENDERING that's
  // gated. Do NOT restore the contour_used overlay in study mode "for
  // usability" -- that is exactly the leak this fixes.
  function drawRoll(notes, contourUsed) {
    const ctx = rollCanvas.getContext("2d");
    const w = rollCanvas.width, h = rollCanvas.height;
    drawGrid(ctx, w, h);

    // Both the conditioning contour (free-play/demo) and the raw drawn line
    // (study mode) are already in [0,1] -- same fraction-of-PITCH_AXIS_LO..HI
    // mapping as the notes below either way, so this line and the melody
    // bars stay directly, visually comparable.
    ctx.strokeStyle = "#7be08a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (STUDY_MODE) {
      rawPoints.forEach(([x, v], i) => {
        const px = x * w, py = (1 - clamp01(v)) * h;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
    } else {
      contourUsed.forEach((v, i) => {
        const x = (i / (contourUsed.length - 1)) * w;
        const y = (1 - clamp01(v)) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
    }
    ctx.stroke();

    // Accompaniment first (so melody draws on top), thin/muted/its own lane
    // feel; melody last, taller and fully opaque -- melody<->contour
    // legibility is the thing that has to read at a glance.
    const accH = 4, melH = 9;
    notes.filter((n) => n.track === "accomp").forEach((n) => {
      const x0 = (n.start_sec / CROP_SEC) * w;
      const x1 = ((n.start_sec + n.dur_sec) / CROP_SEC) * w;
      const y = (1 - normPitchFixed(n.pitch)) * h;
      ctx.fillStyle = "#ffb35a";
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x0, y - accH / 2, Math.max(x1 - x0, 2), accH);
    });
    ctx.globalAlpha = 1;
    notes.filter((n) => n.track === "melody").forEach((n) => {
      const x0 = (n.start_sec / CROP_SEC) * w;
      const x1 = ((n.start_sec + n.dur_sec) / CROP_SEC) * w;
      const y = (1 - normPitchFixed(n.pitch)) * h;
      ctx.fillStyle = "#5aa9ff";
      ctx.fillRect(x0, y - melH / 2, Math.max(x1 - x0, 2), melH);
    });
  }

  // initial paint
  redrawDrawCanvas();
  drawGrid(rollCanvas.getContext("2d"), rollCanvas.width, rollCanvas.height);

  return { clear, drawRoll, hasFullSpan: () => hasFullSpan(rawPoints), getPoints: () => rawPoints.slice() };
})();
