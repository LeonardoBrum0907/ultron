/**
 * Long-term memory kept by ai-memory (github.com/akitaonrails/ai-memory): a
 * local server that stores notes as a git-versioned markdown wiki, searched
 * with SQLite full-text search. No LLM and no API key involved.
 *
 * Reached over its MCP endpoint, but called by the bridge rather than handed
 * to the model as a server of its own. That keeps the workspace and project
 * out of the model's hands (every call must name both), turns a natural
 * question into a query its search can match, and means any brain gets the
 * same memory through Ultron's own tools (tools/memory.ts).
 */
import type { LongMemory, MemoryHit, MemoryNote } from './long-memory.ts'
import { callMcpTool, McpError, type McpEndpoint } from './mcp-http.ts'

export interface AiMemorySettings extends McpEndpoint {
  /** Where Ultron's notes live in ai-memory: a workspace and a project inside it. */
  workspace: string
  project: string
}

type RawHit = { path?: string; title?: string; snippet?: string }

/**
 * A spoken question as an FTS5 query: any of its words, best match first.
 *
 * FTS5 reads a bare phrase as "every one of these words", so "o que eu bebo de
 * manhã" finds nothing unless one note holds all six; and its syntax chokes on
 * stray punctuation (a "?" is an error, not a character). Words of three letters
 * or more, quoted, joined with OR, is a query that can neither fail nor demand
 * too much.
 *
 * @example
 *   ftsQuery('café, sem açúcar?')  // '"café" OR "sem" OR "açúcar"'
 */
export function ftsQuery(words: string): string {
  const terms = words.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []
  return [...new Set(terms)].map((t) => `"${t}"`).join(' OR ')
}

/** ai-memory marks matches with <mark> tags; spoken text has no use for them. */
const plain = (snippet: string): string => snippet.replace(/<\/?mark>/g, '').replace(/\s+/g, ' ').trim()

function hitsOf(text: string): MemoryHit[] {
  const parsed = JSON.parse(text) as { hits?: RawHit[] }
  return (parsed.hits ?? []).map((h) => ({ path: h.path ?? '', title: h.title ?? '', snippet: plain(h.snippet ?? '') }))
}

/**
 * A read of something that is not there yet, as `none` rather than an error.
 *
 * ai-memory answers both a missing page and a scope nothing was ever written to
 * ("workspace 'ultron' not found", on a fresh server) with a JSON-RPC error,
 * told apart only by its message. Either is an empty memory, not a broken one.
 */
async function orNone<T>(reading: Promise<string>, none: T): Promise<string | T> {
  try {
    return await reading
  } catch (err) {
    if (err instanceof McpError && /not found/i.test(err.message)) return none
    throw err
  }
}

/**
 * @example
 *   const memory = aiMemory({ url: 'http://127.0.0.1:49374/mcp', token, timeoutMs: 8000, workspace: 'ultron', project: 'memoria' })
 *   await memory.search('café', 5)
 */
export function aiMemory(settings: AiMemorySettings): LongMemory {
  const scope = { workspace: settings.workspace, project: settings.project }
  const call = async (name: string, args: object): Promise<string> => {
    const { text, isError } = await callMcpTool(settings, name, { ...scope, ...args })
    if (isError) throw new Error(`ai-memory ${name} failed: ${text.slice(0, 200)}`)
    return text
  }
  return {
    async search(words, limit) {
      const query = ftsQuery(words)
      return query ? hitsOf(await orNone(call('memory_query', { query, limit }), '{}')) : []
    },
    async recent(limit) {
      return hitsOf(await orNone(call('memory_recent', { limit }), '{}'))
    },
    async read(path) {
      const raw = await orNone(call('memory_read_page', { path }), null)
      if (raw == null) return null
      const page = JSON.parse(raw) as Partial<MemoryNote>
      return { path: page.path ?? path, title: page.title ?? '', body: page.body ?? '' }
    },
    async save(note, { pinned }) {
      await call('memory_write_page', { path: note.path, body: note.body, pinned })
    },
  }
}

/**
 * The startup line about long-term memory: off, ready, or why not.
 *
 * @example
 *   void memoryBanner(memory, config.memory).then(console.log)
 */
export async function memoryBanner(memory: LongMemory | null, settings: AiMemorySettings | null): Promise<string> {
  if (!memory || !settings) {
    return '[ultron] memory off — set ULTRON_MEMORY_URL to an ai-memory server to keep long-term notes'
  }
  const where = `${settings.url} (${settings.workspace}/${settings.project})`
  try {
    await memory.recent(1)
    return `[ultron] memory ready at ${where}`
  } catch (err) {
    return `[ultron] memory unavailable at ${where}: ${(err as Error).message}`
  }
}
