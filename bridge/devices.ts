/**
 * Every app connected right now: the Chrome tab on this PC, the desktop
 * window, a phone. They all share one conversation, so what one asks and what
 * Ultron answers reaches every one of them.
 */

/** A message to or from an app, one JSON object per WebSocket message. */
export type Frame = Record<string, unknown>

/** The part of a WebSocket the bridge uses; `ws` sockets fit it, and so do test fakes. */
export interface DeviceSocket {
  readonly readyState: number
  readonly OPEN: number
  send(data: string): void
}

export class Devices {
  private readonly sockets = new Set<DeviceSocket>()

  get size(): number {
    return this.sockets.size
  }

  add(socket: DeviceSocket): void {
    this.sockets.add(socket)
  }

  remove(socket: DeviceSocket): void {
    this.sockets.delete(socket)
  }

  /** To every open app. An arrow, so it can be handed around as a callback. */
  readonly broadcast = (frame: Frame): void => {
    this.sendWhere(frame, () => true)
  }

  /** To every open app but one: the others show what that one asked. */
  sendExcept(skip: DeviceSocket, frame: Frame): void {
    this.sendWhere(frame, (s) => s !== skip)
  }

  private sendWhere(frame: Frame, pick: (s: DeviceSocket) => boolean): void {
    const raw = JSON.stringify(frame)
    for (const s of this.sockets) if (pick(s) && s.readyState === s.OPEN) s.send(raw)
  }
}
