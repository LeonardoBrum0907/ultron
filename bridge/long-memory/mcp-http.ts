/**
 * The smallest MCP client that can call one tool on a Streamable HTTP server.
 *
 * Enough for a server whose transport is stateless (ai-memory's default): every
 * request stands alone, so there is no initialize handshake and no session to
 * keep. Written by hand rather than pulling in the MCP SDK, because this is
 * all of it: one JSON-RPC POST and one way to read its answer.
 */

export interface McpEndpoint {
  /** The server's MCP URL, ending in /mcp. */
  url: string
  /** Sent as a bearer token when set. Never logged. */
  token: string | null
  timeoutMs: number
}

/** A tool's answer: the text of its content blocks, joined. */
export interface McpToolText {
  text: string
  isError: boolean
}

/** The server refused the call: a JSON-RPC error, with its code. */
export class McpError extends Error {
  readonly code: number | null

  constructor(name: string, code: number | null, message: string) {
    super(`MCP ${name} failed (${code ?? 'no code'}): ${message}`)
    this.code = code
  }
}

type RpcReply = {
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
  error?: { code?: number; message?: string }
}

function headersFor(endpoint: McpEndpoint): Record<string, string> {
  return {
    'content-type': 'application/json',
    // Both, as the Streamable HTTP spec asks: the server picks plain JSON or SSE.
    accept: 'application/json, text/event-stream',
    ...(endpoint.token ? { authorization: `Bearer ${endpoint.token}` } : {}),
  }
}

/** An SSE reply carries the JSON-RPC answer on its last `data:` line. */
function rpcBody(contentType: string, raw: string): RpcReply {
  if (!contentType.includes('text/event-stream')) return JSON.parse(raw) as RpcReply
  const data = raw.split('\n').filter((line) => line.startsWith('data:')).pop()
  if (!data) throw new Error(`MCP reply had no data line: ${raw.slice(0, 200)}`)
  return JSON.parse(data.slice(5)) as RpcReply
}

function toolText(reply: RpcReply, name: string): McpToolText {
  if (reply.error) throw new McpError(name, reply.error.code ?? null, reply.error.message ?? '')
  const blocks = reply.result?.content ?? []
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
  return { text, isError: reply.result?.isError === true }
}

/** fetch() says only "fetch failed"; the cause (ECONNREFUSED, a timeout) is what tells you why. */
async function post(endpoint: McpEndpoint, body: object): Promise<Response> {
  try {
    return await fetch(endpoint.url, {
      method: 'POST',
      headers: headersFor(endpoint),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    })
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause
    throw new Error(`cannot reach ${endpoint.url}: ${cause?.code ?? cause?.message ?? (err as Error).message}`)
  }
}

/**
 * @example
 *   const { text } = await callMcpTool(endpoint, 'memory_query', { query: 'coffee' })
 */
export async function callMcpTool(endpoint: McpEndpoint, name: string, args: object): Promise<McpToolText> {
  const res = await post(endpoint, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  const raw = await res.text()
  if (!res.ok) throw new Error(`MCP ${name} got HTTP ${res.status} from ${endpoint.url}: ${raw.slice(0, 200)}`)
  return toolText(rpcBody(res.headers.get('content-type') ?? '', raw), name)
}
