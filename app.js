// Stage 1 orchestrator. Wires the UI to Api/Canvas/Synth and owns the two
// seam functions Stage 2 will redefine:
//
//   onContourInput(points)  -- called whenever a contour becomes available.
//                              Stage 1: Canvas calls it after each drawn
//                              stroke. Stage 2: bridge/hand-tracking code
//                              calls it with points derived from VR input.
//   emitNotes(notes, meta)  -- called whenever generation produces notes.
//                              Stage 1: renders the piano roll + arms Synth
//                              for playback. Stage 2: serializes notes into
//                              bridge text messages instead (see
//                              API_Reference.md's interfaceMessageOut).
//
// No other module (canvas.js, api.js, synth.js) knows where input comes
// from or where notes go -- only this file's wiring does.

const generateBtn = document.getElementById("generate-btn");
const regenerateBtn = document.getElementById("regenerate-btn");
const playBtn = document.getElementById("play-btn");
const stopBtn = document.getElementById("stop-btn");
const clearBtn = document.getElementById("clear-btn");
const conditionSelector = document.getElementById("condition-selector");
const statusEl = document.getElementById("status");
const sessionInfoEl = document.getElementById("session-info");
// No visible seed display (removed 2026-07-30, user request) -- the seed is
// still returned by the server and still logged in telemetry every call
// (see callGenerate below), it's just not shown in the UI anymore.

const qs = new URLSearchParams(window.location.search);
const sessionId = qs.get("session") || crypto.randomUUID();
const participant = qs.get("participant") || null;
let trialCounter = 0;
let selectedCondition = null;
let currentPoints = [];
let hasResult = false;

sessionInfoEl.textContent = `session: ${sessionId}${participant ? " · participant: " + participant : ""}`;

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function updateGenerateEnabled() {
  generateBtn.disabled = !(Canvas.hasGuidedSpan() && selectedCondition !== null);
}

// ---- THE INPUT SEAM ---------------------------------------------------------
function onContourInput(points) {
  currentPoints = points;
  updateGenerateEnabled();
}

// ---- THE OUTPUT SEAM ---------------------------------------------------------
function emitNotes(notes, meta) {
  Canvas.drawRoll(notes, meta.contourUsed);
  Synth.setNotes(notes);
  hasResult = true;
  playBtn.disabled = false;
  regenerateBtn.disabled = false;
}

// ---- condition selector -----------------------------------------------------
conditionSelector.querySelectorAll(".cond-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    selectedCondition = btn.dataset.cond;
    conditionSelector.querySelectorAll(".cond-btn").forEach((b) =>
      b.classList.toggle("selected", b === btn));
    updateGenerateEnabled();
  });
});

clearBtn.addEventListener("click", () => {
  Canvas.clear();   // also calls onContourInput([]) internally
  hasResult = false;
  playBtn.disabled = true;
  regenerateBtn.disabled = true;
  setStatus("", "");
});

// ---- generate / regenerate -----------------------------------------------------
// Generate is DETERMINISTIC: the server derives the seed from the drawn
// contour + condition, so redrawing the identical line and generating again
// reproduces the identical result (T2's directed-drawing task needs this).
// Regenerate asks the server for a fresh random seed -- same line, new
// rendition ("not happy with this rendition" vs Generate-after-redrawing's
// "not happy with this line" -- these mean different things for RQ3's
// adaptation analysis, so `action` is sent through to telemetry both ways;
// neither this file nor api.js generates its own randomness for this.
async function callGenerate(action) {
  setStatus("Generating…", "");
  generateBtn.disabled = true;
  regenerateBtn.disabled = true;
  playBtn.disabled = true;
  stopBtn.disabled = true;
  try {
    const data = await Api.generate({
      points: currentPoints,
      condition: selectedCondition,
      sessionId,
      participant,
      trial: trialCounter,
      action,
    });
    trialCounter += 1;
    emitNotes(data.notes, { contourUsed: data.contour_used, corr: data.corr,
                            dtw: data.dtw, mad: data.mad,
                            seed: data.seed, genMs: data.gen_ms });
    const corrStr = data.corr === null ? "n/a" : data.corr.toFixed(2);
    setStatus(`Done — ${data.gen_ms} ms, following corr = ${corrStr}`, "ok");
  } catch (e) {
    setStatus(`Error: ${e.message}`, "error");
  } finally {
    updateGenerateEnabled();
  }
}

generateBtn.addEventListener("click", () => callGenerate("generate"));
regenerateBtn.addEventListener("click", () => callGenerate("regenerate"));

// ---- playback ------------------------------------------------------------------
// Playhead (2026-08-04, chat_notes/2026-08-04_1_*.md): driven by
// requestAnimationFrame reading Synth.getElapsed() (the Web Audio clock),
// not setInterval -- a JS timer's drift would be visible over a 10s clip.
// Lives here, not in canvas.js or synth.js, so neither module needs to know
// about the other (canvas.js stays Web-Audio-agnostic, synth.js stays DOM-
// agnostic -- see canvas.js's header comment).
let playheadRAF = null;

function playheadTick() {
  const elapsed = Synth.getElapsed();
  if (elapsed === null) {
    Canvas.setPlayhead(null);
    playheadRAF = null;
    return;
  }
  Canvas.setPlayhead(elapsed / CROP_SEC);
  playheadRAF = requestAnimationFrame(playheadTick);
}

function stopPlayheadLoop() {
  if (playheadRAF !== null) {
    cancelAnimationFrame(playheadRAF);
    playheadRAF = null;
  }
  Canvas.setPlayhead(null);   // reset to start / hide, whether stopped or finished
}

function play() {
  if (!hasResult) return;
  playBtn.disabled = true;
  stopBtn.disabled = false;
  Synth.play(() => { playBtn.disabled = false; stopBtn.disabled = true; stopPlayheadLoop(); });
  playheadRAF = requestAnimationFrame(playheadTick);
}
function stop() {
  Synth.stop();
  stopPlayheadLoop();
  playBtn.disabled = !hasResult;
  stopBtn.disabled = true;
}
playBtn.addEventListener("click", play);
stopBtn.addEventListener("click", stop);

// ---- startup: ping the server -------------------------------------------------
updateGenerateEnabled();
// Exact wording lives in config.js's DRAWING_INSTRUCTIONS so it can be
// revised for the study without touching code (chat_notes/2026-08-04_1_*.md).
document.getElementById("drawing-instructions").textContent = DRAWING_INSTRUCTIONS;
// Label matches whichever curve canvas.js actually renders in drawRoll --
// see its STUDY_MODE comment for why the two must never both claim to show
// "contour received" (that curve is intentionally not the conditioning
// signal in study mode).
document.getElementById("contour-line-label").textContent =
  STUDY_MODE ? "your drawing" : "contour received";
(async function checkHealth() {
  try {
    const data = await Api.health();
    const pending = Object.entries(data.verified || {})
      .filter(([k, v]) => (k === "smoothing_parity" || k === "device_parity") && v !== "pass")
      .map(([k]) => k);
    if (pending.length) {
      setStatus(`Server up (${data.device}). NOTE: ${pending.join(", ")} not verified -- not study-ready.`, "");
    } else {
      setStatus(`Server up (${data.device}).`, "ok");
    }
  } catch (e) {
    setStatus(`Cannot reach server at ${API_BASE_URL} -- is it running?`, "error");
  }
})();
