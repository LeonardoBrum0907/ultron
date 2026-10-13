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
- `bridge/brain-route.ts` and `bridge/shell.mjs` both decide "a page on this
  machine" (loopback via `isRemote`, plus an Origin). Make `shell.mjs` use the
  route's check once its characterization tests exist.

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
