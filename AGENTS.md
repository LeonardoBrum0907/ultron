# AGENTS.md

Rules for any coding agent (Claude Code, Codex, Cursor...) working in this repo.
Based on Fabio Akita's clean code templates for AI agents
(akitaonrails.com/2026/04/20/clean-code-para-agentes-de-ia), adapted to how
Ultron is built today. `CLAUDE.md` points here.

## The repo in one paragraph

- `src/`: the face. React + Vite + TypeScript (`src/lib/` for logic, `src/ui/` for components).
- `bridge/`: the brain. Node, plain JavaScript ES modules (`.mjs`), runs the
  Claude Agent SDK, TTS, shell and the WebSocket to the face.
- `mind/`: the orchestrator (moods, states). TypeScript with `strict: true`, its own tests.
- `proto/`: the particle figure (`figure.js`). `scripts/`: setup and start.
- Long context in Portuguese: `docs/CONTEXTO.md`, `mind/SPEC.md`.

## Golden rule (this codebase predates these rules)

- Don't fix it all at once. Leave every file you touch a little cleaner than you found it.
- Refactor only code related to the current task. No drive-by rewrites.
- Never mix refactor and behavior change in the same commit.
- Stop and ask before touching auth (`bridge/auth.mjs`, password, cookies), the
  permission gate (`decideTool`, `ULTRON_ALLOW_WRITES`, `ULTRON_ALLOW_SHELL`),
  the WebSocket protocol between face and bridge, or anything that spends money
  (model choice, ElevenLabs, paid APIs).

## Small steps

- One refactor per commit: rename, extract, move or dedupe.
- Keep diffs small enough to review in a few minutes.
- Prefer mechanical, tool-assisted refactors over hand rewrites.

## Safety net first

- Before changing legacy code, write characterization tests that lock in its
  current behavior, even if that behavior looks wrong.
- If code can't be tested, add a seam first (extract a function or inject the
  dependency), then test, then refactor. The Claude Agent SDK, the WebSocket,
  ElevenLabs and the filesystem are the usual seams.
- Found a bug? Report it with a failing test. Don't silently fix it inside a refactor.
- Checks must pass before and after every step (see "Checks" below).

## Code style (new and changed code)

- Functions: 4-20 lines. Split if longer.
- Files: under 500 lines. Split by responsibility. `bridge/server.mjs`,
  `bridge/chrome.mjs`, `src/lib/hands.ts`, `src/lib/tts.ts` and
  `src/lib/voice.ts` are over that: don't grow them, move new logic out
  (strangler pattern: new small module, called from the old file).
- One thing per function, one responsibility per module.
- Names: specific and unique. Avoid `data`, `handler`, `Manager`, `utils`.
  Prefer names that return fewer than 5 grep hits in the codebase.
- Types: explicit. No `any` in new code; replace existing `any` when you touch it.
  - TypeScript (`src/`, `mind/`): no untyped exports.
  - JavaScript (`bridge/`): exported functions get JSDoc types
    (`@param`, `@returns`, `@typedef`). Validate external input with `zod`.
- No code duplication. Extract shared logic into a function or module.
- Early returns over nested ifs. Max 2 levels of indentation.
- Errors include the offending value and the expected shape.

## Dependencies

- Inject dependencies through parameters or factory functions, not module-level
  globals or hidden imports. Wiring happens in one composition root.
- Wrap third-party libs (Agent SDK, ElevenLabs, MediaPipe, three.js) behind a
  thin interface owned by this project, so they can be swapped and faked.
- Ask before adding a new npm dependency.

## Comments

- Keep existing comments. They carry intent and explain odd behavior.
- Write WHY, not WHAT. When you discover why odd code exists, write a WHY comment.
- TSDoc/JSDoc on exported functions: intent + one usage example.
- Reference the PR number or commit SHA when a line exists because of a
  specific bug or upstream constraint.

## Tests

- New functions get a test. Bug fixes get a regression test.
- Fake external I/O (LLM, API, WebSocket, filesystem) with named fake classes
  (`FakeBrain`, `FakeTts`), not inline stubs. Tests never spend credits.
- Tests are F.I.R.S.T: fast, independent, repeatable, self-validating, timely.
- `npm test` runs everything: `mind/test/run.ts` and every `*.test.ts` under
  `bridge/` (Node's test runner, through tsx).
- The bridge's conversation is pinned by golden masters
  (`bridge/test/conversation.golden.test.ts`): a fake Agent SDK, two fake apps,
  every frame recorded. A refactor must leave them unchanged. Re-record with
  `UPDATE_GOLDEN=1 npm test` only for an intended behavior change, and say so in the commit.

## Checks

Run on every change, and never add new warnings or errors:

- `npm run lint` (oxlint)
- `npx tsc -b` (typecheck `src/`, `mind/` and the bridge's `.ts` files)
- `npm test`

There is no formatter configured. Match the surrounding style: 2 spaces, single
quotes, no semicolons. Don't discuss style beyond that.

## Logging

- Structured JSON (one object per line) for debugging and observability in the bridge.
- Plain text only for messages people read (terminal, L panel).
- Never log secrets: `.env.local`, API keys, `ULTRON_PASSWORD`, cookies.

## Language

- Code, identifiers, commit messages and PR titles in English.
- Ultron speaks Brazilian Portuguese. User-facing text and persona stay in pt-BR.

## Preserve knowledge

- Log refactors in progress and known traps in `docs/legacy-notes.md`.
