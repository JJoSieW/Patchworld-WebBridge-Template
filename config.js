// ---------------------------------------------------------------------------
// Server config -- the ONLY place this needs to change to point at a
// different server (local dev, a cloudflared/ngrok tunnel, a future stable
// host). See README.md ("deployment notes") for why a public tunnel is
// required once this page is served from GitHub Pages (HTTPS).
//
// PLACEHOLDER VALUES BELOW -- this file is in the PUBLIC repo (served as
// static files, world-readable by URL from GitHub Pages). Fill in the real
// values at deploy time, in your own local checkout, and do not commit that
// change. Even the real key is not a security boundary once shipped here --
// see README.md's "Security note" -- so this is obfuscation (keeps casual
// scraping/curl-ing out) plus telemetry hygiene, not an access-control
// mechanism. The actual protections are an unguessable tunnel URL and
// server-side rate limiting.
// ---------------------------------------------------------------------------
const API_BASE_URL = "https://shops-fragrance-globe-sand.trycloudflare.com";  // e.g. a cloudflared/ngrok https URL
const API_KEY = "devkey123";       // must match the server's PATCH_API_KEY
// ---------------------------------------------------------------------------

const CROP_SEC = 10.0;              // fixed 10s window, matches the server

// ---------------------------------------------------------------------------
// STUDY_MODE (2026-07-29, manipulation-leak fix). Controls whether the piano
// roll overlays contour_used (the smoothed CONDITIONING signal, which is
// visibly different per abstraction level -- a participant reported they
// could identify the blind condition from the overlay shape alone, without
// listening) or the participant's own raw drawn line (identical in kind
// across all four conditions, since smoothing happens server-side AFTER the
// points are sent).
//
//   false (default, free-play/demo): show contour_used -- useful for
//     debugging/demoing what the model actually received.
//   true  (REQUIRED for any real CHI study session): show only the raw
//     drawn line + generated notes. contour_used is still returned by the
//     server and still logged in telemetry (needed for analysis) -- it is
//     simply not rendered.
//
// This MUST be a hardcoded constant the experimenter sets before deploying
// for a study, NOT a URL query param, cookie, or in-page toggle -- anything
// a participant could read or flip themselves reintroduces the same leak.
// Do NOT "restore" contour_used display in study mode for usability -- an
// unblinded/visually-explained condition defeats the within-subject
// manipulation and confounds perceived control (the primary DV) with the
// picture rather than the audio. See
// chat_notes/2026-07-29_stage1_manipulation_leak_fix_report.md.
const STUDY_MODE = false;  // true = hide contour_used, false = show contour_used

// ---------------------------------------------------------------------------
// Drawing instructions (2026-08-04, chat_notes/2026-08-04_1_*.md). Exact
// wording lives here (not hardcoded in app.js/index.html) so it can be
// revised for the study without touching code. Shown above the draw canvas,
// before any drawing. Keep it to one or two sentences.
// ---------------------------------------------------------------------------
const DRAWING_INSTRUCTIONS =
  "Draw a melody contour — the shape of the pitch over time. Draw left to right, " +
  "from the start line to the end line.";
