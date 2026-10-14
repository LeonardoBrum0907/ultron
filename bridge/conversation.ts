/**
 * The conversation: one, shared by every connected app, outliving any socket.
 *
 * It used to be built per connection and closed with it, so a reload or a
 * dropped Wi-Fi wiped Ultron's memory while the transcript still showed it.
 * Now it is built once, on first use, resumes the saved session from disk
 * (bridge/memory.ts) and is only ever replaced by `memory reset` or by the
 * brain itself failing.
 *
 * Nothing here knows which model is thinking: it talks to a Brain
 * (bridge/brain/brain.ts) and turns its events into the frames the apps read.
 */
import type { Brain, BrainEvent, BrainSession } from './brain/brain.ts'
import type { ModelChoice } from './config.ts'
import type { DeviceSocket, Devices, Frame } from './devices.ts'
import type { ToolPolicy } from './policy.ts'
import type { AskApp, OwnToolsIo } from './tools/own.ts'
import type { ToolServer } from './tools/tool.ts'

/** Which conversation to resume, kept across restarts (bridge/memory.ts). */
export interface ConversationMemory {
  saved(): { id: string } | null
  remember(id: string, how: { turn?: boolean; continuing?: boolean }): void
  forget(): void
}

/** What a conversation tells whoever holds it. */
interface ConversationHooks {
  /** It stopped; `restart` asks for a fresh one straight away (when an app is connected). */
  ended(restart: boolean): void
  /** The tool servers the brain reported as usable when it started. */
  serversKnown(servers: string[]): void
}

export interface ConversationDeps {
  brain: Brain
  devices: Devices
  policy: ToolPolicy
  memory: ConversationMemory
  ownTools: (io: Pick<OwnToolsIo, 'send' | 'ask'>) => Record<string, ToolServer>
}

/**
 * A brief pause so the abandoned turn's frames are tagged with the OLD id
 * before the new one is adopted. Short, because correctness now comes from
 * the tag rather than from the wait — this only has to cover the gap, not
 * outlast the whole turn.
 */
const SETTLE_CAP_MS = 400

/**
 * Tools that are the HUD drawing itself, not work being done. The display
 * tool would put "ultron · display" in the tool badge and trigger a "working
 * on it" filler for something already on screen; the ui_* tools are the same
 * case one step further: retinting the interface is the interface talking
 * about itself, and the badge would be describing the very thing they can see.
 */
const isHudTool = (name: string) => name === 'mcp__ultron__display' || name.startsWith('mcp__ultron_ui__')

/**
 * Announcing a tool on the HUD, once, and only if it actually runs.
 *
 * A refused tool that lights the badge, plays the sound and provokes a
 * "working on it" line, for work that never happens, reads as a bug on camera.
 *
 * With the Claude SDK the order is: the block starts streaming, then the
 * permission callback is asked, then the tool runs. So nothing is known when
 * the call starts. Announcing from inside the callback would know the verdict
 * but miss tools entirely — measured on that SDK, the callback is consulted
 * only for calls the CLI hasn't already settled, so a `Bash: echo` its own
 * classifier waves through never reaches us at all.
 *
 * So: announce immediately for anything the policy permits, since those run.
 * Hold the rest, and let the tool's end settle it — a refusal comes back
 * failed, anything else really did execute and has earned its badge, a beat
 * late. Nothing is ever announced for work that didn't happen.
 */
class TurnTools {
  private readonly held = new Map<string, string>()
  /**
   * Every tool that counts as work, by id, until its result comes back. The
   * face wants to know how each one ended — pleased with a task done, angry at
   * one that failed — so the result is reported for all of them, announced or
   * held, refusals included: a refused tool is work that did not get done.
   */
  private readonly work = new Map<string, string>()
  /** Every tool's id → whether the heavy subagent called it (else the voice). */
  private readonly bySubagent = new Map<string, boolean>()
  /** Whether this turn went to the heavy subagent, for the log panel. */
  escalated = false

  /** Returns true when the HUD should hear about this tool now. */
  started(e: Extract<BrainEvent, { type: 'tool_start' }>, permitted: boolean): boolean {
    if (e.id) this.bySubagent.set(e.id, e.bySubagent)
    if (isHudTool(e.name)) return false
    if (e.id) this.work.set(e.id, e.name)
    if (e.delegates) this.escalated = true
    if (permitted) return true
    if (e.id) this.held.set(e.id, e.name)
    return false
  }

  /** The name of a held tool that turned out to have run, if this was one. */
  settle(id: string, failed: boolean): string | null {
    const name = this.held.get(id)
    if (name === undefined) return null
    this.held.delete(id)
    return failed ? null : name
  }

  /** The name of a tool that counted as work, once, when it ends. */
  finish(id: string): string | null {
    const name = this.work.get(id)
    if (name === undefined) return null
    this.work.delete(id)
    return name
  }

  calledBySubagent(id: string): boolean {
    return this.bySubagent.get(id) === true
  }

  /** One turn's tool ids are never referred to again. */
  clear(): void {
    this.held.clear()
    this.bySubagent.clear()
    this.escalated = false
  }
}

/**
 * Asking the app for something and waiting for the answer.
 *
 * Every other tool pushes — a panel, a blade, a retint — and never needs a
 * reply. The camera is the exception: the hardware is over there and the
 * model is here, so a frame has to come back. Correlated by id because a turn
 * can have more than one request in flight, and timed out because a browser
 * that has been closed mid-question would otherwise hang the turn.
 */
class AppRequests {
  private readonly waiting = new Map<string, { resolve: (f: Frame) => void; timer: NodeJS.Timeout }>()
  private count = 0

  ask(socket: DeviceSocket | null, kind: string, args: object, timeoutMs: number): Promise<Frame> {
    return new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== socket.OPEN) {
        return reject(new Error('the interface is not connected'))
      }
      const id = `q${++this.count}`
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error('the interface did not answer in time'))
      }, timeoutMs)
      this.waiting.set(id, { resolve, timer })
      socket.send(JSON.stringify({ type: kind, id, ...args }))
    })
  }

  answered(frame: Frame): void {
    const slot = this.waiting.get(String(frame.id))
    if (!slot) return
    this.waiting.delete(String(frame.id))
    clearTimeout(slot.timer)
    slot.resolve(frame)
  }

  cancelAll(): void {
    for (const { timer } of this.waiting.values()) clearTimeout(timer)
    this.waiting.clear()
  }
}

export class Conversation {
  private readonly deps: ConversationDeps
  private readonly session: BrainSession
  private readonly resumeId: string | null
  private readonly tools = new TurnTools()
  private readonly requests = new AppRequests()
  private readonly hooks: ConversationHooks
  private started = false
  private closed = false
  /** The app whose question is being answered: the camera is on that one. */
  private asker: DeviceSocket | null = null
  /** Whether a turn is in flight, and whether it has already been told to stop. */
  private busy = false
  private stopping = false
  /** Questions accepted but not yet handed to the brain (waiting on an interrupt to settle). */
  private pending = 0
  /** Called whenever a turn ends or the conversation stops, to re-check idle(). */
  private idleWaiters: Array<() => void> = []
  /**
   * Which question the brain is currently answering.
   *
   * The stream carries no notion of a turn, so without this the client cannot
   * tell the tail of an abandoned answer from the start of the new one — it
   * attaches a listener and receives whatever is on the socket. Echoing the
   * id the client sent lets it ignore anything that is not its own, which is
   * the only reliable fix: no amount of waiting on this side changes what a
   * listener over there has already heard.
   */
  private answering: string | null = null
  /**
   * Resolves when the turn in flight has actually finished.
   *
   * Waiting on interrupt() alone is not enough. It resolves when the brain has
   * been *told* to stop, not when it has, so the last tokens of the abandoned
   * answer are still on their way — and since nothing on the wire identifies
   * which question a delta belongs to, they land on the next turn's listener.
   * Measured: ask for ALPHA, interrupt, ask for BRAVO, and BRAVO's answer
   * arrives as "ALPHA\nBRAVO".
   *
   * A turn ends exactly once, so that is the boundary worth waiting for.
   * Raced against a timeout because a turn that never reports its end must not
   * wedge the conversation for ever — a stray word is a blemish, a deadlocked
   * assistant is not.
   */
  private settling: Promise<unknown> = Promise.resolve()
  private finishTurn: (() => void) | null = null

  constructor(deps: ConversationDeps, hooks: ConversationHooks) {
    this.deps = deps
    this.hooks = hooks
    this.resumeId = deps.memory.saved()?.id ?? null
    const tools = deps.ownTools({ send: deps.devices.broadcast, ask: this.ask })
    this.session = deps.brain.open({ resume: this.resumeId, tools, policy: deps.policy })
    void this.pump()
  }

  private readonly ask: AskApp = (kind, args, timeoutMs = 20_000) =>
    this.requests.ask(this.asker, kind, args, timeoutMs)

  private sendTurn(frame: Frame): void {
    this.deps.devices.broadcast({ ...frame, ask: this.answering })
  }

  /** Which model and effort a frame came from: the voice, or the heavy subagent working under it. */
  private ranOn(bySubagent: boolean): ModelChoice {
    const { voice, heavy } = this.deps.brain
    return bySubagent && heavy ? heavy : voice
  }

  private onToolStart(e: Extract<BrainEvent, { type: 'tool_start' }>): void {
    const wasEscalated = this.tools.escalated
    const announce = this.tools.started(e, this.deps.policy.permits(e.name))
    if (!wasEscalated && this.tools.escalated) {
      console.log(`[ultron] handed to heavy (${this.deps.brain.heavy?.model ?? 'off'})`)
    }
    if (announce) this.sendTurn({ type: 'tool', name: e.name, ...this.ranOn(e.bySubagent) })
  }

  private onToolEnd(e: Extract<BrainEvent, { type: 'tool_end' }>): void {
    const bySubagent = this.tools.calledBySubagent(e.id)
    const late = this.tools.settle(e.id, e.failed)
    if (late) this.sendTurn({ type: 'tool', name: late, ...this.ranOn(bySubagent) })
    const work = this.tools.finish(e.id)
    if (work) this.sendTurn({ type: 'tool_result', name: work, ok: !e.failed, ...this.ranOn(bySubagent) })
  }

  private onTurnEnd(e: Extract<BrainEvent, { type: 'turn_end' }>): void {
    if (e.sessionId) this.deps.memory.remember(e.sessionId, { turn: true, continuing: true })
    const escalated = this.tools.escalated
    this.sendTurn({
      type: 'done',
      text: e.text,
      costUsd: e.costUsd,
      // What the turn used, for the page's log panel.
      usage: e.usage,
      durationMs: e.durationMs,
      turns: e.turns,
      escalated,
      ...this.ranOn(false),
      heavy: escalated && this.deps.brain.heavy ? this.ranOn(true) : null,
    })
    this.turnOver()
  }

  private onTurnFailed(e: Extract<BrainEvent, { type: 'turn_failed' }>): void {
    this.sendTurn({ type: 'error', message: e.message, reason: e.reason, costUsd: e.costUsd, ...this.ranOn(false) })
    this.turnOver()
  }

  /** Whatever was waiting on this turn to finish can go now. This is the only place a turn is genuinely over. */
  private turnOver(): void {
    this.busy = false
    this.stopping = false
    this.finishTurn?.()
    this.finishTurn = null
    this.tools.clear()
    this.wakeIdleWaiters()
  }

  private wakeIdleWaiters(): void {
    const waiters = this.idleWaiters
    this.idleWaiters = []
    for (const wake of waiters) wake()
  }

  /** No turn is running and no question is waiting to be asked. */
  get idle(): boolean {
    return !this.busy && this.pending === 0
  }

  /** Resolves when it may have become idle: a turn ended or it stopped. Check idle again. */
  whenIdle(): Promise<void> {
    if (this.idle || this.closed) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  private onStarted(e: Extract<BrainEvent, { type: 'started' }>): void {
    this.started = true
    if (e.sessionId) this.deps.memory.remember(e.sessionId, { continuing: Boolean(this.resumeId) })
    this.hooks.serversKnown(e.servers)
    this.deps.devices.broadcast({ type: 'ready', servers: e.servers })
    console.log(`[ultron] ${e.servers.length} MCP servers available`)
  }

  private onEvent(e: BrainEvent): void {
    switch (e.type) {
      case 'text': return this.sendTurn({ type: 'text', delta: e.delta })
      case 'tool_start': return this.onToolStart(e)
      case 'tool_end': return this.onToolEnd(e)
      case 'turn_end': return this.onTurnEnd(e)
      case 'turn_failed': return this.onTurnFailed(e)
      case 'started': return this.onStarted(e)
    }
  }

  /** Every event the brain emits goes out to the apps, for as long as the session lives. */
  private async pump(): Promise<void> {
    try {
      for await (const e of this.session.events) this.onEvent(e)
    } catch (err) {
      this.died(err)
    }
  }

  private died(err: unknown): void {
    console.error('[ultron] session error:', err)
    // A saved session that will not resume (deleted, or from an older brain)
    // would fail the same way on every retry. Forget it and the next question
    // starts a new conversation; nobody asked anything yet, so there is
    // nobody to tell.
    if (this.resumeId && !this.started) {
      console.warn('[ultron] could not resume the saved conversation; starting a new one')
      this.deps.memory.forget()
      this.stop(true)
      return
    }
    this.deps.devices.broadcast({ type: 'error', message: String((err as Error)?.message ?? err) })
    this.stop()
  }

  /** Ends this conversation. `restart` asks for a fresh one straight away (when an app is connected). */
  stop(restart = false): void {
    this.closed = true
    this.session.close()
    this.requests.cancelAll()
    this.wakeIdleWaiters()
    this.hooks.ended(restart)
  }

  /** Stop the turn in flight, and let the next question wait until it has. */
  interrupt(): void {
    if (!this.busy || this.stopping) return
    this.stopping = true
    // Held so the next question can wait for it rather than racing it.
    const stopped = new Promise<void>((resolve) => {
      this.finishTurn = resolve
    })
    this.settling = this.session
      .interrupt()
      .catch(() => {})
      .then(() => Promise.race([stopped, new Promise((r) => setTimeout(r, SETTLE_CAP_MS))]))
  }

  /**
   * A question from one of the apps.
   *
   * Queued behind any interrupt that is still settling. A barge-in is two
   * messages in quick succession — interrupt, then the new question — and
   * interrupt() is asynchronous. Delivering the question the instant it
   * arrives means the brain can still be winding down the previous turn, so
   * its last tokens are emitted after the new one has begun and land on the
   * new turn's listener. Measured: ask "one", interrupt, ask "two", and the
   * answer to "two" comes back as "One."
   *
   * A question from another app while a turn is running is the same thing as
   * a barge-in: say something and it becomes the turn, wherever it was said.
   */
  question(socket: DeviceSocket, text: string, id: string | null, said: string): void {
    this.interrupt()
    this.pending++
    void this.settling.then(() => {
      this.pending--
      if (this.closed) return
      this.answering = id
      this.asker = socket
      this.busy = true
      // The other apps show what was asked; the asker already has it.
      this.deps.devices.sendExcept(socket, { type: 'heard', text: said, ask: id })
      this.session.send(text)
    })
  }

  /** An app answering something it was asked (a camera frame). */
  reply(frame: Frame): void {
    this.requests.answered(frame)
  }

  /** An app went away. If it was the one being answered, the camera goes too. */
  leave(socket: DeviceSocket): void {
    if (this.asker === socket) this.asker = null
  }
}

/**
 * The one conversation, if there is one: started on first use, replaced
 * when it ends.
 */
export class ConversationSlot {
  private readonly deps: ConversationDeps
  private current: Conversation | null = null
  /**
   * The servers the latest conversation reported, so an app that connects
   * later gets them too. Kept across conversations: a reset does not make
   * the tools any less available.
   */
  liveServers: string[] | null = null

  constructor(deps: ConversationDeps) {
    this.deps = deps
  }

  /** The conversation, started now if there is none. */
  now(): Conversation {
    if (this.current) return this.current
    const started: Conversation = new Conversation(this.deps, {
      ended: (restart) => this.release(started, restart),
      serversKnown: (servers) => {
        this.liveServers = servers
      },
    })
    this.current = started
    return started
  }

  /** The conversation if one is running, without starting one. */
  get running(): Conversation | null {
    return this.current
  }

  /**
   * Switches models: waits for the turn in flight to end, calls `apply` (which
   * changes the brain), then carries the same conversation on in a new session.
   * With nothing running, `apply` is all there is to do.
   *
   * Waiting matters twice over: an answer cut off by a model change is an
   * answer lost, and a turn's frames say which model wrote them, so the brain
   * must not change under a turn that is still writing.
   */
  async reopen(apply: () => void): Promise<void> {
    // Checked again after every wait: a question can arrive in between, and
    // a reopen started earlier can already have replaced the conversation.
    while (this.current && !this.current.idle) await this.current.whenIdle()
    apply()
    this.current?.stop(true)
  }

  /** Ends the conversation and forgets it: the next one starts fresh. */
  reset(): void {
    this.current?.stop()
    this.current = null
    this.deps.memory.forget()
  }

  private release(ended: Conversation, restart: boolean): void {
    if (this.current === ended) this.current = null
    if (restart && this.deps.devices.size) this.now()
  }
}
