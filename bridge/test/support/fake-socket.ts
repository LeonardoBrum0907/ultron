import type { DeviceSocket, Frame } from '../../devices.ts'

/** An app's socket that keeps every frame sent to it. */
export class FakeSocket implements DeviceSocket {
  readonly OPEN = 1
  readyState = 1
  readonly frames: Frame[] = []

  send(data: string): void {
    this.frames.push(JSON.parse(data) as Frame)
  }

  /** The frames of one type, in order. */
  ofType(type: string): Frame[] {
    return this.frames.filter((f) => f.type === type)
  }
}

/** Remembers which conversation to resume, in memory. */
export class FakeMemory {
  id: string | null
  readonly remembered: Array<{ id: string; turn?: boolean; continuing?: boolean }> = []
  forgotten = 0

  constructor(id: string | null = null) {
    this.id = id
  }

  saved(): { id: string } | null {
    return this.id ? { id: this.id } : null
  }

  remember(id: string, how: { turn?: boolean; continuing?: boolean }): void {
    this.id = id
    this.remembered.push({ id, ...how })
  }

  forget(): void {
    this.id = null
    this.forgotten++
  }
}
