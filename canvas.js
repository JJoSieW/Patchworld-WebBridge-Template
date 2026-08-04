// Drawing input (pointer events: mouse, touch, and the Quest browser's
// ray-to-pointer emulation) + piano-roll output rendering. This module knows
// nothing about the server or Web Audio -- it only ever calls the single
// global `onContourInput(points)` (defined in app.js) when the drawn line
// changes. In Stage 2 this whole file is replaced by bridge/hand-tracking
// code that calls the same `onContourInput`; nothing else needs to change.
const SPAN_TOL = 0.02;   // must match webapp/server/contour_live.py's DRAW_SPAN_TOL

// GUIDED DRAWING REGION (2026-08-04, chat_notes/2026-08-04_1_*.md): the old
// behaviour rejected any stroke that didn't span the FULL canvas edge-to-
// edge -- friction that would inflate NASA-TLX effort in the study, and hard
// to satisfy exactly by hand. Fix: the canvas is wider than the 10s window
// it generates from, with a dim MARGIN on each side the participant can
// physically overshoot into. `MARGIN_FRAC` (~11%, within the requested
// 10-12% band) is a fraction of the canvas's TOTAL width; the middle
// `1 - 2*MARGIN_FRAC` is the "guided region" == the 10s window == x in
// [0,1] in every OTHER module's/the server's sense. `guidedX`/`guidedPxX`
// convert between the two coordinate systems; `rawPoints` (this module's
// internal drawing state) stays in canvas-fraction (0..1 across the WHOLE
// widened canvas, margins included) since that's what's needed to render
// pixel positions -- only at the `onContourInput` seam do points get
// remapped to guided-fraction, and NOT clipped: a point drawn into the left
// margin gets guided-x < 0, into the right margin > 1. This means the seam's
// payload (and therefore telemetry, unchanged server-side) already carries
// BOTH the full raw stroke (all points, nothing dropped) AND the in-bounds
// segment as a distinguishable subset (x in [0,1]) -- no server schema
// change needed; resample_drawn's existing query=[0,1] interpolation simply
// never asks for the margin points' out-of-[0,1] x values, matching "only
// the segment between the dashed lines is resampled" without this module
// needing to do that clipping itself.
const MARGIN_FRAC = 0.11;
const EDGE_TOL_PX = 2;    // acceptance tolerance for reaching the start/end lines (UX gate only;
                          // resample_drawn's own DRAW_SPAN_TOL=0.02 is the separate server-side backstop)

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

  let rawPoints = [];        // canvas-fraction (0..1 across the WHOLE widened canvas)
  let isDrawing = false;
  let lastNotes = null;
  let lastContourUsed = null;
  let playheadFrac = null;   // 0..1 over the GUIDED region, or null when hidden

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  // canvas-fraction (0..1, whole widened canvas) <-> guided-fraction (0..1,
  // the 10s window between the dashed lines). Guided-fraction is allowed to
  // go <0 or >1 for margin points -- see module header comment.
  function guidedX(cf) { return (cf - MARGIN_FRAC) / (1 - 2 * MARGIN_FRAC); }
  function guidedPxX(fracOfGuided, w) { return (MARGIN_FRAC + fracOfGuided * (1 - 2 * MARGIN_FRAC)) * w; }
  function isInGuidedRegion(cf) { return cf >= MARGIN_FRAC && cf <= 1 - MARGIN_FRAC; }

  function canvasPoint(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    const x = clamp01((evt.clientX - rect.left) / rect.width);
    const y = clamp01(1 - (evt.clientY - rect.top) / rect.height);
    return [x, y];
  }

  // Whether evt's raw client coords fall within canvas's on-screen rect
  // (unclamped -- used to detect the cursor leaving the canvas, see
  // pointerMove below). This is the WHOLE widened canvas including margins,
  // unaffected by MARGIN_FRAC -- the participant can draw anywhere in the
  // margins without the stroke ending; only leaving the canvas element
  // itself ends it (chat_notes/2026-07-31_1_*.md's fix, unchanged).
  function isInsideCanvas(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    return evt.clientX >= rect.left && evt.clientX <= rect.right &&
           evt.clientY >= rect.top && evt.clientY <= rect.bottom;
  }

  // Acceptance check: does the stroke's x-range cover from the start line to
  // the end line (within a ~2px tolerance, converted to a canvas-fraction at
  // the CURRENT rendered width)? Replaces the old edge-to-edge hasFullSpan.
  function hasGuidedSpan(points) {
    if (points.length < 2) return false;
    const rect = drawCanvas.getBoundingClientRect();
    const tolFrac = EDGE_TOL_PX / Math.max(rect.width, 1);
    const xs = points.map((p) => p[0]);
    return Math.min(...xs) <= MARGIN_FRAC + tolFrac &&
           Math.max(...xs) >= (1 - MARGIN_FRAC) - tolFrac;
  }

  function drawMarginsAndGrid(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);

    // dim margin bands -- reads as run-up/run-out, not part of the piece
    ctx.fillStyle = "#0a0b0e";
    ctx.fillRect(0, 0, MARGIN_FRAC * w, h);
    ctx.fillRect((1 - MARGIN_FRAC) * w, 0, MARGIN_FRAC * w, h);

    // 1s gridlines + center line, GUIDED region only (10 divisions = 1s
    // each of the 10s window -- was the whole canvas before margins existed)
    ctx.strokeStyle = "#22252e";
    ctx.lineWidth = 1;
    for (let s = 0; s <= 10; s++) {
      const x = guidedPxX(s / 10, w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(guidedPxX(0, w), h / 2);
    ctx.lineTo(guidedPxX(1, w), h / 2);
    ctx.strokeStyle = "#2c303b";
    ctx.stroke();

    // dashed start/end boundary lines + labels -- the region between them
    // is what actually gets resampled into the 250-frame contour
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#6b7080";
    ctx.lineWidth = 1.5;
    [0, 1].forEach((edge) => {
      const x = guidedPxX(edge, w);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    ctx.fillStyle = "#8b90a0";
    ctx.font = "11px -apple-system, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("start", guidedPxX(0, w) + 4, 4);
    ctx.textAlign = "right";
    ctx.fillText("end", guidedPxX(1, w) - 4, 4);
  }

  // In-bounds (between the dashed lines) segments are drawn solid; segments
  // that stay entirely within a margin are drawn dimmed/dashed instead of
  // being deleted -- silently erasing part of someone's stroke is
  // confusing, dimming communicates "this part won't be used" while the
  // FULL raw stroke is kept (both on screen and in what's sent onward, see
  // module header comment).
  function lerp(a, b, t) { return a + (b - a) * t; }

  // Fraction along (x0->x1) where the segment crosses x=boundary, or null if
  // it doesn't cross (both endpoints on the same side, or touching it).
  function crossingT(x0, x1, boundary) {
    if ((x0 - boundary) * (x1 - boundary) >= 0) return null;
    return (boundary - x0) / (x1 - x0);
  }

  function strokeRun(ctx, runVerts, w, h, solid) {
    if (runVerts.length < 2) return;
    ctx.beginPath();
    ctx.strokeStyle = solid ? "#5aa9ff" : "#3a4a5c";
    ctx.lineWidth = solid ? 2.5 : 1.8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(solid ? [] : [4, 3]);
    runVerts.forEach(([x, y], i) => {
      const px = x * w, py = (1 - y) * h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // A segment whose endpoints straddle a dashed boundary line must switch
  // from solid to dashed EXACTLY at that line, not at the next recorded
  // point, so first insert a synthetic vertex at every crossing.
  //
  // Each dashed/solid RUN (a maximal span of same-style vertices) is then
  // stroked as ONE continuous path, not one stroke() call per raw
  // point-to-point segment. That matters for the dash pattern specifically:
  // canvas resets a path's dash phase to 0 at the start of every stroke()
  // call, so a fresh call per tiny segment means fast drawing (points far
  // apart, long segments) shows the [4,3] pattern repeating within each
  // segment as expected, while slow drawing (points close together, short
  // segments) has each segment shorter than the 4px "on" phase -- every
  // segment then starts AND ends inside its own fresh "on" phase and never
  // reaches a gap, so it renders as an unbroken (looks-solid) line despite
  // setLineDash being set. One continuous stroke() per run paces the dash
  // pattern by cumulative path length instead of per-segment, so spacing is
  // uniform regardless of how fast or slow the stroke was drawn.
  function drawStroke(ctx, points, w, h) {
    const verts = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      [MARGIN_FRAC, 1 - MARGIN_FRAC]
        .map((b) => crossingT(x0, x1, b))
        .filter((t) => t !== null && t > 0 && t < 1)
        .sort((a, b) => a - b)
        .forEach((t) => verts.push([lerp(x0, x1, t), lerp(y0, y1, t)]));
      verts.push([x1, y1]);
    }
    if (verts.length < 2) return;

    const segSolid = [];
    for (let i = 1; i < verts.length; i++) {
      segSolid.push(isInGuidedRegion((verts[i - 1][0] + verts[i][0]) / 2));
    }

    let runStart = 0;
    for (let i = 1; i <= segSolid.length; i++) {
      if (i === segSolid.length || segSolid[i] !== segSolid[runStart]) {
        strokeRun(ctx, verts.slice(runStart, i + 1), w, h, segSolid[runStart]);
        runStart = i;
      }
    }
    ctx.setLineDash([]);
  }

  function drawPlayhead(ctx, w, h) {
    if (playheadFrac === null) return;
    const px = guidedPxX(playheadFrac, w);
    ctx.strokeStyle = "#ffe066";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();
  }

  function redrawDrawCanvas() {
    const ctx = drawCanvas.getContext("2d");
    const w = drawCanvas.width, h = drawCanvas.height;
    drawMarginsAndGrid(ctx, w, h);
    if (rawPoints.length >= 2) drawStroke(ctx, rawPoints, w, h);
    drawPlayhead(ctx, w, h);
  }

  function updateSpanWarning() {
    spanWarning.hidden = rawPoints.length === 0 || hasGuidedSpan(rawPoints);
  }

  function pointerDown(evt) {
    isDrawing = true;
    rawPoints = [canvasPoint(drawCanvas, evt)];
    redrawDrawCanvas();
    drawCanvas.setPointerCapture(evt.pointerId);
  }
  // FIX (2026-07-31, chat_notes/2026-07-31_1_*.md): setPointerCapture keeps
  // delivering pointermove for cursor positions OUTSIDE the canvas, and
  // (because the pointer is captured) pointerleave/pointerout do NOT fire on
  // exit the way they would for an uncaptured element -- so this is the only
  // place exit can be detected. The old code clamped those out-of-bounds
  // coords to the canvas edge and kept appending: a stroke that overshoots
  // past the edge (the common case -- users drag past x=1 finishing
  // left-to-right) recorded a long run of points pinned to one x with y
  // still tracking the real, off-canvas cursor. resample_drawn's x-based
  // interpolation then collapsed all of that drift into a single trailing
  // frame -- the "vertical ending line" bug. Fix: end the stroke the moment
  // the cursor leaves, instead of clamping and continuing. The margins added
  // 2026-08-04 give substantially more room before this triggers.
  function pointerMove(evt) {
    if (!isDrawing) return;
    if (!isInsideCanvas(drawCanvas, evt)) {
      finishStroke(evt.pointerId);
      return;
    }
    rawPoints.push(canvasPoint(drawCanvas, evt));
    redrawDrawCanvas();
  }
  function finishStroke(pointerId) {
    if (!isDrawing) return;
    isDrawing = false;
    if (pointerId !== undefined && drawCanvas.hasPointerCapture(pointerId)) {
      drawCanvas.releasePointerCapture(pointerId);
    }
    updateSpanWarning();
    // Remapped to guided-fraction, NOT clipped -- see module header comment.
    onContourInput(rawPoints.map(([x, y]) => [guidedX(x), y]));   // THE SEAM -- see app.js
  }
  function pointerUp(evt) {
    finishStroke(evt && evt.pointerId);
  }

  drawCanvas.addEventListener("pointerdown", pointerDown);
  drawCanvas.addEventListener("pointermove", pointerMove);
  drawCanvas.addEventListener("pointerup", pointerUp);
  drawCanvas.addEventListener("pointercancel", pointerUp);

  function clear() {
    rawPoints = [];
    lastNotes = null;
    lastContourUsed = null;
    playheadFrac = null;
    redrawDrawCanvas();
    updateSpanWarning();
    renderRoll();
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
  //
  // 2026-08-04: cached (lastNotes/lastContourUsed) so the playhead can
  // trigger a redraw every animation frame without needing fresh data --
  // drawRoll (called from emitNotes with new data) and setPlayhead (called
  // every frame during playback) both funnel through renderRoll. The piano
  // roll uses the SAME total width and the SAME guided-region mapping
  // (guidedPxX) as the draw canvas, so the drawn curve and the generated
  // notes stay visually comparable at a glance -- notes/contour positions
  // are no longer raw fractions of the canvas width, they're fractions of
  // the GUIDED region within it.
  function renderRoll() {
    const ctx = rollCanvas.getContext("2d");
    const w = rollCanvas.width, h = rollCanvas.height;
    drawMarginsAndGrid(ctx, w, h);

    if (lastNotes) {
      ctx.strokeStyle = "#7be08a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (STUDY_MODE) {
        // rawPoints is already canvas-fraction (whole widened canvas), same
        // coordinate system as this (equally widened) roll canvas -- plot
        // directly, no guided remapping (margin excursions show here too).
        rawPoints.forEach(([x, v], i) => {
          const px = x * w, py = (1 - clamp01(v)) * h;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
      } else {
        lastContourUsed.forEach((v, i) => {
          const px = guidedPxX(i / (lastContourUsed.length - 1), w);
          const py = (1 - clamp01(v)) * h;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
      }
      ctx.stroke();

      // Accompaniment first (so melody draws on top), thin/muted/its own
      // lane feel; melody last, taller and fully opaque -- melody<->contour
      // legibility is the thing that has to read at a glance.
      //
      // Notes are cut off at the end line, not shown extending into the
      // margin: a note can start before CROP_SEC and run past it (its
      // duration overshoots the 10s window), which without clamping drew
      // the bar's tail into the right margin -- clamp the rendered end to
      // CROP_SEC (and skip entirely if the note starts at/after it).
      const accH = 4, melH = 9;
      const drawNoteBar = (n, color, height) => {
        if (n.start_sec >= CROP_SEC) return;
        const x0 = guidedPxX(Math.max(n.start_sec / CROP_SEC, 0), w);
        const x1 = guidedPxX(Math.min((n.start_sec + n.dur_sec) / CROP_SEC, 1), w);
        const y = (1 - normPitchFixed(n.pitch)) * h;
        ctx.fillStyle = color;
        ctx.fillRect(x0, y - height / 2, Math.max(x1 - x0, 2), height);
      };
      ctx.globalAlpha = 0.35;
      lastNotes.filter((n) => n.track === "accomp").forEach((n) => drawNoteBar(n, "#ffb35a", accH));
      ctx.globalAlpha = 1;
      lastNotes.filter((n) => n.track === "melody").forEach((n) => drawNoteBar(n, "#5aa9ff", melH));
    }

    drawPlayhead(ctx, w, h);
  }

  function drawRoll(notes, contourUsed) {
    lastNotes = notes;
    lastContourUsed = contourUsed;
    renderRoll();
  }

  // Playhead (2026-08-04, point 1 of the interface task): app.js drives this
  // every requestAnimationFrame from the Web Audio clock (Synth.getElapsed),
  // NOT setInterval -- timer drift is visible over 10s. frac is 0..1 over
  // the GUIDED region (matching playback, which only covers the 10s window,
  // not the margins) or null to hide. Moves in sync on BOTH canvases since
  // both redraw functions call drawPlayhead with the same frac.
  function setPlayhead(frac) {
    playheadFrac = frac;
    redrawDrawCanvas();
    renderRoll();
  }

  // initial paint
  redrawDrawCanvas();
  renderRoll();

  return {
    clear, drawRoll, setPlayhead,
    hasGuidedSpan: () => hasGuidedSpan(rawPoints),
    getPoints: () => rawPoints.map(([x, y]) => [guidedX(x), y]),
  };
})();
