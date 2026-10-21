# Local dev setup — restoring `config.js` after every pull/checkout/reset

**Symptom:** the page shows `Cannot reach server at REPLACE_ME -- is it running?`, or
`Error: invalid or missing X-API-Key`, right after you clone, pull, checkout, stash, or otherwise
reset this repo's working tree — even though your local generation server is running fine.

**Why this happens, every time:** `config.js` is a **tracked** file in this repo, and its committed
value at `HEAD` is the placeholder pair below — on purpose, since this repo is public (served as
static files over GitHub Pages) and a real key committed here would be world-readable by URL (see
the README's "Security note"):

```js
const API_BASE_URL = "REPLACE_ME";
const API_KEY = "REPLACE_ME";
```

Any git operation that resets tracked files to match a commit (`git pull`, `git checkout`,
`git stash`, `git reset --hard`, a fresh clone, ...) wipes out whatever local values you'd filled
in and puts these placeholders back. This is expected, not a bug — **do not "fix" it by committing
your real local values.**

## Restore steps (run every time you see the error)

1. Find your locally running server's port and confirm it's up:
   ```bash
   lsof -nP -iTCP -sTCP:LISTEN | grep -i python
   curl -s http://127.0.0.1:8420/health
   ```
2. Find the API key the running server actually expects (it reads `PATCH_API_KEY` from its own
   environment at startup — this is NOT written down anywhere else, so ask the running process,
   not a doc):
   ```bash
   ps eww -p <the uvicorn PID from step 1> | tr ' ' '\n' | grep PATCH_API_KEY
   ```
   If that comes back empty, the server was started without `PATCH_API_KEY` set, meaning
   `/generate` is unauthenticated — in that case any non-empty `API_KEY` string works client-side.
3. Edit `config.js` (this file only — nothing else needs to change):
   ```js
   const API_BASE_URL = "http://127.0.0.1:8420";   // or your tunnel URL
   const API_KEY = "<value from step 2>";
   ```
4. Reload the page. Do not `git add`/commit this edit.

## Making this a one-time annoyance instead of a recurring one

If you're tired of repeating this after every pull, tell git to stop tracking changes to your
working copy of `config.js` (your local edits stay, but routine git operations won't touch the
file or show it as modified):

```bash
git update-index --skip-worktree config.js
```

To undo that later (e.g. you actually need to commit a real change to `config.js`, like adding a
new constant):

```bash
git update-index --no-skip-worktree config.js
```

Note `--skip-worktree` only protects against routine operations that don't explicitly touch this
file; a `git stash` with `-u`/`--include-untracked` or an explicit `git checkout -- config.js` can
still overwrite it. If that happens, just repeat the restore steps above.
