// Pure network layer -- no DOM, no canvas, no audio. Talks to the Stage 1
// FastAPI server (webapp/server/). Knows nothing about where points came
// from or what happens to the notes it returns (see app.js's onContourInput
// / emitNotes seam).
const Api = {
  async health() {
    const res = await fetch(`${API_BASE_URL}/health`, { headers: { "X-API-Key": API_KEY } });
    if (!res.ok) throw new Error(`health check failed: HTTP ${res.status}`);
    return res.json();
  },

  // points: [[x,y], ...] normalized. condition: "A"|"B"|"C"|"D".
  // action: "generate" (deterministic seed server-side, same line + same
  // condition -> same result) | "regenerate" (fresh random seed). The
  // server derives the seed from `action` when `seed` isn't given -- this
  // client never rolls its own randomness for it, so the deterministic
  // guarantee holds regardless of what runs in the browser.
  async generate({ points, condition, sessionId, participant, trial, action }) {
    const body = { points, condition, session_id: sessionId, trial, action: action || "generate" };
    if (participant) body.participant = participant;

    const res = await fetch(`${API_BASE_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch (e) { /* not json */ }
      throw new Error(detail);
    }
    return res.json();   // {notes, contour_used, corr, dtw, mad, seed, gen_ms}
  },
};
