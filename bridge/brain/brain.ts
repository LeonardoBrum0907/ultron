/**
 * What the bridge knows about "a brain": the port every model adapter plugs into.
 *
 * The conversation (bridge/conversation.ts) only ever talks to these types.
 * Which model answers, how it calls tools and where it keeps its transcript
 * are the adapter's business: brain/claude.ts runs the Claude Agent SDK.
 */
import type { ModelChoice } from '../config.ts'
import type { ToolPolicy } from '../policy.ts'
import type { ToolServer } from '../tools/tool.ts'

/** What one turn cost in tokens, for the page's log panel. */
export interface Usage {
  in: number
  out: number
  cacheRead: number
  cacheWrite: number
}

export type BrainEvent =
  /** The session is up: its id (to resume it later) and the tool servers it can use. */
  | { type: 'started'; sessionId: string | null; servers: string[] }
  /** Words of the answer, as they are written. Only the voice's: a subagent's report is not speech. */
  | { type: 'text'; delta: string }
  /**
   * A tool call has begun. `bySubagent` says the heavy subagent made it;
   * `delegates` says this call hands the work to that subagent.
   */
  | { type: 'tool_start'; id: string; name: string; bySubagent: boolean; delegates: boolean }
  /** A tool call came back. `failed` includes a call that was refused. */
  | { type: 'tool_end'; id: string; failed: boolean }
  | {
      type: 'turn_end'
      sessionId: string | null
      text: string
      costUsd: number | null
      usage: Usage | null
      durationMs: number | null
      turns: number | null
    }
  /** The turn ended without an answer. `message` is a plain sentence, fit to be spoken. */
  | { type: 'turn_failed'; reason: string; message: string; costUsd: number | null }

/** One running conversation with a brain. */
export interface BrainSession {
  /** One user message; the answer arrives on `events`. */
  send(text: string): void
  /** Tells the turn in flight to stop. Resolves once told, not once stopped: wait for its turn_end. */
  interrupt(): Promise<void>
  /** Every event for as long as the session lives. Throws if the session dies. */
  readonly events: AsyncIterable<BrainEvent>
  close(): void
}

export interface OpenOptions {
  /** A conversation to carry on, by the id a 'started' event reported, or null for a new one. */
  resume: string | null
  /** Ultron's own tools for this session, by server name. */
  tools: Record<string, ToolServer>
  policy: ToolPolicy
}

export interface Brain {
  /** The model that speaks. */
  readonly voice: ModelChoice
  /** The subagent the voice hands long work to, or null when there is none. */
  readonly heavy: ModelChoice | null
  /** The external tool servers, known before any session starts (the HUD shows them at boot). */
  knownServers(): string[]
  open(options: OpenOptions): BrainSession
}
