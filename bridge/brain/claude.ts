/**
 * The Claude brain: the Claude Agent SDK — Claude Code as a library — behind
 * the Brain port.
 *
 * Two things this buys over calling the Claude API directly:
 *   1. No API key. It authenticates exactly the way `claude` does, off your
 *      existing login, and bills to that same account.
 *   2. Every MCP server in your Claude Code config is available, including the
 *      local stdio ones a browser could never reach — higgsfield, elevenlabs,
 *      android, playwright, palmier-pro and the rest.
 */
import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { BrainChoice } from '../brain-choice.ts'
import type { BrainSettings, ModelChoice } from '../config.ts'
import type { PersonaPrompts } from '../persona.ts'
import { isDelegation, type ToolPolicy } from '../policy.ts'
import type { ToolServer } from '../tools/tool.ts'
import type { Brain, BrainEvent, BrainSession, OpenOptions, Usage } from './brain.ts'
import { toSdkServer } from './claude-tools.ts'

type ExternalServers = NonNullable<Options['mcpServers']>

/**
 * Every MCP server Claude Code has configured, read out of its own config.
 *
 * This does two jobs. The HUD wants the names while the boot animation plays,
 * and the agent doesn't emit its init message — and therefore its server
 * list — until the first user message flows through, which is far too late.
 * More importantly, this bridge turns filesystem settings off (see
 * settingSources below) and the SDK stops discovering these servers on its
 * own, so handing them over explicitly is what keeps the local stdio ones —
 * the whole reason the bridge exists — in play.
 *
 * Only the global block and the home-directory project scope, because
 * homedir() is our cwd. That makes the list a close but not exact match for
 * the agent's own: the 'ready' sent on connect comes from here and the second
 * one, sent from the init message a turn later, carries live status. Expect
 * the two to differ, and treat the later one as authoritative.
 */
function configuredServers(): ExternalServers {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
    return {
      ...(cfg.mcpServers ?? {}),
      // Servers scoped to the home directory apply too, since that's our cwd.
      ...(cfg.projects?.[homedir()]?.mcpServers ?? {}),
    }
  } catch {
    return {}
  }
}

/**
 * What to tell the browser when a turn ends badly. Plain sentences, because
 * whatever reaches the client is liable to be spoken.
 */
const RESULT_FAILURES: Record<string, string> = {
  error_during_execution: 'The turn failed part way through.',
  error_max_turns: 'The turn ran too long and was stopped.',
  error_max_budget_usd: 'The budget for this turn ran out.',
  error_max_structured_output_retries: 'The answer could not be assembled.',
  default: 'The turn ended without an answer.',
}

type Block = { type?: string; id?: string; name?: string; tool_use_id?: string; is_error?: boolean }

/**
 * A tool_use block surfaces twice — as a partial stream event and again on
 * the completed assistant message — so ids are remembered for the turn and
 * the second sighting dropped.
 */
function toolStart(seen: Set<string>, id: string | undefined, name: string | undefined, parent: string | null): BrainEvent[] {
  if (!name || (id && seen.has(id))) return []
  if (id) seen.add(id)
  return [{ type: 'tool_start', id: id ?? '', name, bySubagent: parent != null, delegates: isDelegation(name) }]
}

// Raw Anthropic stream events, surfaced by includePartialMessages. This is the
// ONLY place spoken text arrives: there is no top-level text_delta message in
// the SDK union and the 'assistant' message carries no deltas either. Turn
// includePartialMessages off and ULTRON goes completely mute.
function fromStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>, seen: Set<string>): BrainEvent[] {
  const ev = msg.event
  // A subagent's words are its report to the voice, not speech. Only the main
  // thread's text goes to the speaker; its tools still light the HUD, since
  // that is work being done.
  if (msg.parent_tool_use_id == null && ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
    return [{ type: 'text', delta: ev.delta.text }]
  }
  if (ev.type === 'content_block_start' && ev.content_block.type === 'tool_use') {
    return toolStart(seen, ev.content_block.id, ev.content_block.name, msg.parent_tool_use_id)
  }
  return []
}

// Fallback for builds that emit whole assistant messages rather than partial
// events. Deduped against the stream_event path. Older builds put the blocks
// at the top level of the message, hence the first read.
function fromAssistant(msg: Extract<SDKMessage, { type: 'assistant' }>, seen: Set<string>): BrainEvent[] {
  const legacy = (msg as { content?: Block[] }).content
  const blocks: Block[] = legacy ?? (msg.message?.content as Block[] | undefined) ?? []
  return blocks.flatMap((b) => (b.type === 'tool_use' ? toolStart(seen, b.id, b.name, msg.parent_tool_use_id) : []))
}

// Tool results come back as a user message. A refused tool arrives with
// is_error set.
function fromUser(msg: Extract<SDKMessage, { type: 'user' }>): BrainEvent[] {
  const blocks = msg.message?.content
  if (!Array.isArray(blocks)) return []
  return (blocks as Block[])
    .filter((b) => b?.type === 'tool_result')
    .map((b) => ({ type: 'tool_end', id: b.tool_use_id ?? '', failed: b.is_error === true }))
}

function usageOf(usage: Record<string, number | null | undefined> | undefined): Usage | null {
  if (!usage) return null
  return {
    in: usage.input_tokens ?? 0,
    out: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
  }
}

// A result is not automatically a success. The error subtypes carry no
// `result` field at all, so reporting them as a finished turn with empty text
// is indistinguishable from a turn that simply had nothing to say — the HUD
// stops spinning and ULTRON stands there silent. Say what happened instead.
function failedResult(msg: Extract<SDKMessage, { type: 'result' }>): BrainEvent | null {
  const fallback = RESULT_FAILURES.default ?? ''
  const costUsd = msg.total_cost_usd ?? null
  if (msg.subtype !== 'success') {
    return { type: 'turn_failed', reason: msg.subtype, message: RESULT_FAILURES[msg.subtype] ?? fallback, costUsd }
  }
  // The API refusing the request (a model this Claude Code is too old for, an
  // overload) still arrives as 'success', flagged is_error, with the error as
  // the result and nothing streamed. Its own words are what tells you why.
  if (msg.is_error) return { type: 'turn_failed', reason: 'api_error', message: msg.result || fallback, costUsd }
  return null
}

function fromResult(msg: Extract<SDKMessage, { type: 'result' }>, seen: Set<string>): BrainEvent[] {
  // One turn's tool ids are never referred to again.
  seen.clear()
  const failed = failedResult(msg)
  if (failed) return [failed]
  // Only narrows the type: failedResult already took every other subtype.
  if (msg.subtype !== 'success') return []
  return [{
    type: 'turn_end',
    sessionId: msg.session_id || null,
    text: msg.result ?? '',
    costUsd: msg.total_cost_usd ?? null,
    usage: usageOf(msg.usage as unknown as Record<string, number> | undefined),
    durationMs: msg.duration_ms ?? null,
    turns: msg.num_turns ?? null,
  }]
}

function fromSystem(msg: Extract<SDKMessage, { type: 'system' }>): BrainEvent[] {
  if (msg.subtype !== 'init') return []
  // Servers report 'pending' until first use — they connect lazily — so only
  // drop the ones that are actually unusable.
  const servers = (msg.mcp_servers ?? [])
    .filter((s) => s.status !== 'needs-auth' && s.status !== 'failed')
    .map((s) => s.name)
  return [{ type: 'started', sessionId: msg.session_id || null, servers }]
}

/**
 * The SDK's messages as brain events. `seen` carries the tool ids of the
 * turn in flight, for deduplication.
 *
 * @example
 *   for await (const msg of query) for (const e of sdkEvents(msg, seen)) handle(e)
 */
export function sdkEvents(msg: SDKMessage, seen: Set<string>): BrainEvent[] {
  switch (msg.type) {
    case 'stream_event': return fromStreamEvent(msg, seen)
    case 'assistant': return fromAssistant(msg, seen)
    case 'user': return fromUser(msg)
    case 'result': return fromResult(msg, seen)
    case 'system': return fromSystem(msg)
    default: return []
  }
}

/** One conversation with the Agent SDK, fed one user message at a time. */
class ClaudeSession implements BrainSession {
  readonly events: AsyncIterable<BrainEvent>
  private readonly inbox: string[] = []
  /** Resolves the pending user message into the SDK's input generator. */
  private deliver: ((text: string | null) => void) | null = null
  private closed = false
  private readonly seen = new Set<string>()
  private readonly debug: boolean
  private readonly query: Query

  constructor(options: Options, debug: boolean) {
    this.debug = debug
    this.query = query({ prompt: this.userMessages(), options })
    this.events = this.translate()
  }

  send(text: string): void {
    if (!this.deliver) {
      this.inbox.push(text)
      return
    }
    const resolve = this.deliver
    this.deliver = null
    resolve(text)
  }

  async interrupt(): Promise<void> {
    await this.query.interrupt?.()
  }

  close(): void {
    this.closed = true
    this.deliver?.(null)
    this.query.close?.()
  }

  private nextText(): Promise<string | null> {
    const queued = this.inbox.shift()
    if (queued != null) return Promise.resolve(queued)
    return new Promise((resolve) => {
      this.deliver = resolve
    })
  }

  private async *userMessages(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const text = await this.nextText()
      if (this.closed || text == null) return
      yield { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    }
  }

  private async *translate(): AsyncGenerator<BrainEvent> {
    for await (const msg of this.query) {
      if (this.debug) console.log('[msg]', msg.type, msg.type === 'stream_event' ? msg.event.type : '')
      if (msg.type === 'result' && msg.subtype !== 'success') {
        console.error(`[ultron] turn failed: ${msg.subtype}`, msg.errors ?? '')
      }
      if (msg.type === 'result' && msg.subtype === 'success' && msg.is_error) {
        console.error(`[ultron] turn failed: ${msg.result}`)
      }
      yield* sdkEvents(msg, this.seen)
    }
  }
}

// Signature is (toolName, input, options) and it must return a
// PermissionResult object. Returning a bare boolean silently denies
// everything, with the tool name arriving undefined.
//
// Worth knowing: this is a last gate, not the only one. Calls the CLI has
// already settled never arrive here — its own classifier waves through a
// `Bash: echo hello` without asking, and only reaches us for something with
// a consequence, like a `touch`. So a deny here is reliable; an absence of a
// call here is not proof nothing ran.
function permissionGate(policy: ToolPolicy): NonNullable<Options['canUseTool']> {
  return async (toolName) => {
    const ok = policy.permits(toolName)
    console.log(`[ultron] tool ${toolName} -> ${ok ? 'allow' : 'deny'}`)
    if (ok) return { behavior: 'allow' }
    return {
      behavior: 'deny',
      // Every word of this can end up spoken, so it carries no command to read
      // out — the persona is forbidden from saying one aloud.
      message:
        'Blocked: ULTRON is running in read-only mode and cannot take' +
        ' actions that change anything. Tell the user this action is' +
        ' unavailable until they enable write access on the machine.',
    }
  }
}

/** The heavy subagent. Its tool calls go through canUseTool like any other, so the write gate holds for it too. */
function heavyAgent(heavy: ModelChoice | null, prompts: PersonaPrompts): Options['agents'] {
  if (!heavy) return undefined
  return {
    heavy: {
      description:
        'Long or multi-step work: several tools in a row, research, ' +
        'browser tasks, files. Not for conversation or one quick action.',
      prompt: prompts.heavy,
      model: heavy.model,
      effort: heavy.effort,
    },
  }
}

/**
 * Claude Code's built-ins that Ultron's own tools stand in for, by the server
 * that replaces them. Switched off only when that server is present, so the
 * model never holds two tools for one job and every brain reads the same way.
 * Bash, Write, Edit and WebSearch stay Claude's until they have stand-ins.
 */
const REPLACED_BUILTINS: Record<string, string[]> = {
  ultron_files: ['Read', 'Glob', 'Grep'],
  ultron_web: ['WebFetch'],
}

/** @example replacedBuiltins({ ultron_web: webServer() })  // ['WebFetch'] */
export function replacedBuiltins(tools: Record<string, ToolServer>): string[] {
  return Object.keys(tools).flatMap((key) => REPLACED_BUILTINS[key] ?? [])
}

function sdkServers(external: ExternalServers, tools: Record<string, ToolServer>): ExternalServers {
  const own = Object.fromEntries(Object.entries(tools).map(([key, server]) => [key, toSdkServer(server)]))
  return { ...external, ...own }
}

interface SessionInputs extends OpenOptions {
  choice: BrainChoice
  prompts: PersonaPrompts
  external: ExternalServers
}

function sessionOptions({ choice, prompts, external, resume, tools, policy }: SessionInputs): Options {
  const agents = heavyAgent(choice.heavy, prompts)
  return {
    // Everything Claude Code has configured, plus Ultron's own tools as
    // in-process servers.
    mcpServers: sdkServers(external, tools),
    disallowedTools: replacedBuiltins(tools),
    // A plain system prompt, not the claude_code preset. The preset is
    // tuned for a coding agent — verbose, file-oriented, and a large chunk
    // of input tokens on every turn. Replacing it makes the persona stick,
    // keeps answers short enough to speak, and cuts cost per turn.
    systemPrompt: prompts.voice,
    // Run from the home directory so project-scoped MCP servers don't shadow
    // the global ones, and so file tools have a sane root.
    cwd: homedir(),
    // No filesystem settings at all. Left to its default the SDK loads
    // ~/.claude/settings.json and settings.local.json exactly as the CLI
    // does — which on a working machine means a bypassPermissions default
    // and a pile of allow-rules for Bash. Allow-rules are matched before the
    // permission callback, so the bridge's policy would never even be asked
    // about the tools it most needs to refuse. Empty makes this bridge the
    // only authority. It also stops the global CLAUDE.md riding along on
    // every voice turn, carrying instructions written for a coding agent
    // into a conversation that is meant to be two sentences long.
    //
    // The cost is that MCP servers stop being discovered too, which is why
    // mcpServers above passes them in by hand.
    settingSources: [],
    // Stated explicitly, and it has to be.
    //
    // With no `model` here the SDK falls back to its own default, which on
    // this machine resolved to claude-opus-4-8[1m] — not what src/config.ts
    // declares for the browser-direct path, and not anything anyone chose.
    // Normally your own `/model` preference would decide, but that lives in
    // the settings files `settingSources: []` deliberately stops loading, so
    // without this line nothing in the project has a say at all.
    model: choice.voice.model,
    effort: choice.voice.effort,
    // Carry on the saved conversation. The SDK keeps the transcript on disk
    // (persistSession is its default); this only names which one.
    ...(resume ? { resume } : {}),
    ...(agents ? { agents } : {}),
    maxTurns: 24,
    permissionMode: 'default',
    // Without this the SDK only emits whole assistant messages, and ULTRON
    // would sit silent until the entire answer was written. Partial events
    // are what let speech start on the first finished sentence.
    includePartialMessages: true,
    canUseTool: permissionGate(policy),
  }
}

export interface ClaudeBrainOptions {
  /** Where to start: settings.voice and settings.heavy, until choose() says otherwise. */
  settings: BrainSettings
  /** The persona's prompts, which name the heavy subagent only when there is one. */
  persona: (withHeavy: boolean) => PersonaPrompts
  /** ULTRON_DEBUG=1: log every SDK message's type. */
  debug: boolean
}

/**
 * @example
 *   const brain = claudeAgentBrain({ settings: config.brain, persona, debug: false })
 *   const session = brain.open({ resume: null, tools, policy })
 *   session.send('hello')
 */
export function claudeAgentBrain({ settings, persona, debug }: ClaudeBrainOptions): Brain {
  const external = configuredServers()
  let choice: BrainChoice = { voice: settings.voice, heavy: settings.heavy }
  return {
    get voice() {
      return choice.voice
    },
    get heavy() {
      return choice.heavy
    },
    knownServers: () => Object.keys(external),
    open: (options) => {
      const prompts = persona(choice.heavy !== null)
      return new ClaudeSession(sessionOptions({ ...options, choice, prompts, external }), debug)
    },
    choose: (next) => {
      choice = next
    },
  }
}
