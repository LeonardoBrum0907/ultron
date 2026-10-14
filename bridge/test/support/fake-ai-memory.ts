/**
 * A stand-in for an ai-memory server: the four MCP tools the bridge calls,
 * over real HTTP, keeping pages in a map. Strict where the real one is: the
 * bearer token, and a workspace and project on every call.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

type Args = Record<string, unknown>
type Page = { path: string; title: string; body: string; pinned: boolean }

export interface FakeAiMemoryOptions {
  token: string
  /** Answer as a server-sent event stream rather than plain JSON. */
  sse?: boolean
}

export class FakeAiMemory {
  readonly pages = new Map<string, Page>()
  /** Every tools/call received: the tool and its arguments. */
  readonly calls: Array<{ name: string; args: Args }> = []
  private readonly server: Server
  private readonly options: FakeAiMemoryOptions

  constructor(options: FakeAiMemoryOptions) {
    this.options = options
    this.server = createServer((req, res) => void this.handle(req, res))
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/mcp`
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${this.options.token}`) {
      res.writeHead(401).end('unauthorized')
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const rpc = JSON.parse(raw) as { id: number; params: { name: string; arguments: Args } }
    this.calls.push({ name: rpc.params.name, args: rpc.params.arguments })
    this.reply(res, { jsonrpc: '2.0', id: rpc.id, ...this.answer(rpc.params.name, rpc.params.arguments) })
  }

  private reply(res: ServerResponse, body: object): void {
    if (!this.options.sse) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify(body)}\n\n`)
  }

  private answer(name: string, args: Args): object {
    if (!args.workspace || !args.project) return { error: { code: -32602, message: 'workspace and project required' } }
    // A fresh server knows no scope until something is written to it.
    if (!this.pages.size && name !== 'memory_write_page') {
      return { error: { code: -32602, message: `workspace '${args.workspace}' not found` } }
    }
    const result = (value: object) => ({ result: { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false } })
    switch (name) {
      case 'memory_write_page': return result(this.write(args))
      case 'memory_read_page': return this.read(String(args.path), result)
      case 'memory_query': return result({ hits: this.matching(String(args.query)) })
      case 'memory_recent': return result({ hits: [...this.pages.values()].reverse().map(hitOf) })
      default: return { error: { code: -32601, message: `no tool ${name}` } }
    }
  }

  private write(args: Args): object {
    const body = String(args.body)
    const title = /^# (.+)/.exec(body)?.[1] ?? String(args.path)
    this.pages.set(String(args.path), { path: String(args.path), title, body, pinned: args.pinned === true })
    return { page_id: 'p1', path: args.path }
  }

  private read(path: string, result: (value: object) => object): object {
    const page = this.pages.get(path)
    if (!page) return { error: { code: -32603, message: `page ${path} not found in resolved scope` } }
    return result({ path, title: page.title, body: page.body })
  }

  /** Any quoted term of an OR query, as ai-memory's FTS5 would take it. */
  private matching(query: string): object[] {
    const terms = [...query.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '')
    return [...this.pages.values()]
      .filter((p) => terms.some((t) => p.body.toLowerCase().includes(t)))
      .map((p) => ({ ...hitOf(p), snippet: `<mark>${p.title}</mark>` }))
  }
}

const hitOf = (p: Page) => ({ path: p.path, title: p.title, snippet: p.body, rank: -1 })
