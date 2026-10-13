/**
 * A brain that thinks nothing: a test pushes the events it should emit and
 * reads back what it was sent. For testing the conversation without any model.
 */
import type { Brain, BrainEvent, BrainSession, OpenOptions } from '../../brain/brain.ts'
import type { BrainChoice } from '../../brain-choice.ts'
import type { ModelChoice } from '../../config.ts'

export class FakeBrainSession implements BrainSession {
  readonly sent: string[] = []
  readonly options: OpenOptions
  interrupts = 0
  closed = false
  private queue: Array<BrainEvent | Error> = []
  private wake: (() => void) | null = null

  constructor(options: OpenOptions) {
    this.options = options
  }

  readonly events: AsyncIterable<BrainEvent> = { [Symbol.asyncIterator]: () => this.iterate() }

  private async *iterate(): AsyncGenerator<BrainEvent> {
    while (!this.closed) {
      const next = this.queue.shift()
      if (next instanceof Error) throw next
      if (next) yield next
      else await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }

  /** Makes the brain emit these events, in order. */
  emit(...events: BrainEvent[]): void {
    this.queue.push(...events)
    this.wake?.()
  }

  /** Makes the session die. */
  fail(err: Error): void {
    this.queue.push(err)
    this.wake?.()
  }

  send(text: string): void {
    this.sent.push(text)
  }

  async interrupt(): Promise<void> {
    this.interrupts++
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }
}

export class FakeBrain implements Brain {
  voice: ModelChoice = { model: 'voice-model', effort: 'low' }
  heavy: ModelChoice | null
  readonly sessions: FakeBrainSession[] = []
  /** Every choice it was handed, in order. */
  readonly choices: BrainChoice[] = []

  constructor({ heavy = true }: { heavy?: boolean } = {}) {
    this.heavy = heavy ? { model: 'heavy-model', effort: 'high' } : null
  }

  knownServers(): string[] {
    return ['configured']
  }

  choose(choice: BrainChoice): void {
    this.choices.push(choice)
    this.voice = choice.voice
    this.heavy = choice.heavy
  }

  open(options: OpenOptions): FakeBrainSession {
    const session = new FakeBrainSession(options)
    this.sessions.push(session)
    return session
  }

  /** The session opened last. */
  get session(): FakeBrainSession {
    const last = this.sessions.at(-1)
    if (!last) throw new Error('no session was opened')
    return last
  }
}
