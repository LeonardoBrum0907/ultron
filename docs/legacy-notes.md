# Legacy notes

Refactors in progress and known traps. Add a line when you find one; remove it when it's gone.

## Traps

- `bridge/server.mjs` `decideTool`: the read-only rule matches a verb at the start of
  the tool name, so MCP tools like `memory_query` are blocked without `ULTRON_ALLOW_WRITES`.
- The bridge only accepts WebSocket origins on localhost:5173-5199 and 4173-4199
  (see `.claude/launch.json`).

- A saved conversation that fails to resume loses the question that ran into it:
  the bridge forgets it and starts a new conversation, but the question is not
  re-asked there (pinned as-is in `bridge/test/golden/broken-resume.json`).

## Refactors in progress

- LLM-agnostic brain: split `bridge/server.mjs` into a core plus a `ClaudeAgentBrain`
  adapter, without changing behavior. Design in the project's `ultron-brain/arquitetura.md`.
