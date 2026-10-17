# Legacy notes

Refactors in progress and known traps. Add a line when you find one; remove it when it's gone.

## Traps

- `bridge/policy.ts` (`toolPolicy`): the read-only rule matches a verb at the start of
  the tool name, so MCP tools like `memory_query` are blocked without `ULTRON_ALLOW_WRITES`.
- The bridge only accepts WebSocket origins on localhost:5173-5199 and 4173-4199
  (see `.claude/launch.json`).

- A saved conversation that fails to resume loses the question that ran into it:
  the bridge forgets it and starts a new conversation, but the question is not
  re-asked there (pinned as-is in `bridge/test/golden/broken-resume.json`).
- Switching models (`/brain`, `bridge/brain-route.ts`) reopens the session with
  `resume` instead of the SDK's `Query.setModel()`: there is no setter for the
  effort, and whether `applyFlagSettings({ effortLevel })` beats the `effort`
  option a session started with could not be checked without a Claude login.
  One path for every change, at the cost of restarting the MCP servers.
- The Agent SDK bundles its own Claude Code, and a new model can need a newer
  one: on SDK 0.3.220 (Claude Code 2.1.220) the API refused Opus 5.5, which asks
  for 2.1.280+. Before offering a new model id, check the SDK is new enough.
  That refusal arrives as a `success` result flagged `is_error`, not an error.
- `bridge/brain-route.ts` and `bridge/shell.mjs` both decide "a page on this
  machine" (loopback via `isRemote`, plus an Origin). Make `shell.mjs` use the
  route's check once its characterization tests exist.
- Behind a reverse proxy (the VPS setup in `deploy/`) every request is remote, and
  the remote gate (`gate`/`sameOrigin` in `bridge/auth.mjs`) only accepts a page
  served from the bridge's own host. `ULTRON_ALLOWED_ORIGINS` is consulted only for
  local requests, so a page on another host (Vercel) gets 403 until auth learns it.

## Refactors in progress

- LLM-agnostic brain (PR #8). Done: the conversation (`bridge/conversation.ts`)
  talks only to the `Brain` port (`bridge/brain/brain.ts`); Claude sits behind it
  in `bridge/brain/claude.ts`; Ultron's tools are neutral `ToolServer`s
  (`bridge/tools/`). Still in `bridge/server.mjs`: the HTTP routes (speech,
  media proxies, files, memory) and the wiring; they move out as the bridge
  goes to TypeScript. Design in the project's `ultron-brain/arquitetura.md`.
- Bridge to TypeScript, a module at a time. `.mjs` files still left are
  imported by `.ts` ones unchecked (`allowJs` in `tsconfig.bridge.json`).
  Still `.mjs`: `server.mjs` (the HTTP routes), `chrome.mjs`, `page.mjs`,
  `net.mjs`, `shell.mjs`, `auth.mjs`. Each needs characterization tests of its
  routes first, and `auth.mjs` and `shell.mjs` need Léo's OK (AGENTS.md).
  `auth.mjs` and `shell.mjs` now have characterization tests
  (`bridge/test/auth.test.ts`, `bridge/test/shell.test.ts`; Léo OK'd the tests
  on 2026-10-13, changing their code still needs his word). The shell tests
  that run a command are skipped on Windows: Git Bash paths and taskkill are
  not pinned yet.
