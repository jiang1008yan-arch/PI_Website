# Project instructions

## Where to save generated documents (IMPORTANT)
- Write **every** plan, design note, spec, or Markdown document into **this repository**
  (the current project folder), never into the Claude config dir.
- Default location: `./docs/` — create it if it does not exist. Use a clear filename,
  e.g. `docs/plans/<topic>.md` or `docs/<topic>.md`.
- Do **not** rely on `~/.claude` (`C:\Users\…\.claude`) for any document the team needs;
  that folder is Claude's private per-user store and is not part of the repo.
- When you finish a plan in plan mode, also persist it as a Markdown file under `./docs/`
  so it lives with the code and is committed alongside it.
