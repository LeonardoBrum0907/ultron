/**
 * Just enough of Node's IncomingMessage and ServerResponse to call a route
 * handler directly, without a server or a socket.
 */

export interface FakeRequestInit {
  method?: string
  url?: string
  /** Where the request came from. Defaults to this machine. */
  remoteAddress?: string
  headers?: Record<string, string>
  /** The body, sent as one chunk. */
  body?: string
}

export class FakeRequest {
  readonly method: string
  readonly url: string
  readonly headers: Record<string, string>
  readonly socket: { remoteAddress: string }
  private readonly body: string

  constructor({ method = 'GET', url = '/', remoteAddress = '127.0.0.1', headers = {}, body = '' }: FakeRequestInit = {}) {
    this.method = method
    this.url = url
    this.headers = headers
    this.socket = { remoteAddress }
    this.body = body
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    if (this.body) yield this.body
  }
}

export class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  text = ''
  /** Resolves when the handler ends the response. */
  readonly ended: Promise<void>
  private finish: () => void = () => {}
  private readonly closeListeners: Array<() => void> = []

  constructor() {
    this.ended = new Promise((resolve) => (this.finish = resolve))
  }

  writeHead(status: number, headers: Record<string, string> = {}): this {
    this.status = status
    this.headers = headers
    return this
  }

  write(chunk: string): boolean {
    this.text += chunk
    return true
  }

  end(chunk = ''): this {
    this.text += chunk
    this.finish()
    return this
  }

  on(event: string, listener: () => void): this {
    if (event === 'close') this.closeListeners.push(listener)
    return this
  }

  /** The page went away (the panel's `kill`). */
  close(): void {
    for (const listener of this.closeListeners) listener()
  }

  json(): unknown {
    return JSON.parse(this.text)
  }

  /** One JSON object per line, as an NDJSON stream sends them. */
  lines(): unknown[] {
    return this.text.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  }
}
