/**
 * Fetching a web page as text, for the model to read.
 *
 * The neutral stand-in for Claude Code's WebFetch. Through the bridge's own
 * fetcher (net.mjs), so it gets the same SSRF guard as the page proxy: no
 * localhost, no private network, every redirect vetted again. HTML is cut down
 * to the article the reading view would show (page.mjs), so a page costs its
 * words rather than its markup.
 */
import { z } from 'zod'
import { fetchText } from '../net.mjs'
import { articleBody, readableText, stripDangerous, titleOf } from '../page.mjs'
import { defineTool, toolServer, type ToolResult, type ToolServer } from './tool.ts'

const MAX_FETCH_BYTES = 4 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const DEFAULT_CHARS = 20_000

/** The fetcher, injected so a test can serve pages without a network. */
export type FetchPage = (url: string) => Promise<{ text: string; type: string; url: string }>

const fetchPage: FetchPage = (url) => fetchText(url, { maxBytes: MAX_FETCH_BYTES, timeoutMs: FETCH_TIMEOUT_MS, accept: undefined })

const text = (body: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: body }], isError })

/**
 * What a fetched document says, as plain text. Null for a type that is not text.
 *
 * @example
 *   pageWords('<title>Hi</title><p>...</p>', 'text/html')  // 'Hi\n\n...'
 */
export function pageWords(body: string, type: string): string | null {
  if (/^text\/html|^application\/xhtml/.test(type)) {
    const words = readableText(articleBody(stripDangerous(body)))
    return `${titleOf(body)}\n\n${words}`.trim()
  }
  if (/^text\/|json|xml/.test(type)) return body
  return null
}

function fetchTool(fetchDoc: FetchPage) {
  return defineTool(
    'web_fetch',
    'Fetches a public web page and returns its text (the article, without menus or markup). ' +
      'For reading a page you already have the address of; it does not search.',
    {
      url: z.string().url(),
      maxChars: z.number().int().min(500).max(100_000).optional().describe(`How much text to return; ${DEFAULT_CHARS} when left out`),
    },
    async ({ url, maxChars }) => {
      try {
        const page = await fetchDoc(url)
        const words = pageWords(page.text, page.type)
        if (words == null) return text(`${page.url} is ${page.type || 'of no stated type'}, not a page to read.`, true)
        const limit = maxChars ?? DEFAULT_CHARS
        return text(`${page.url}\n\n${words.slice(0, limit)}${words.length > limit ? '\n... (cut)' : ''}`)
      } catch (err) {
        return text(`Could not fetch ${url}: ${(err as Error).message}`, true)
      }
    },
  )
}

/**
 * @example
 *   const servers = { ultron_web: webServer() }
 */
export function webServer(fetchDoc: FetchPage = fetchPage): ToolServer {
  return toolServer({
    name: 'ultron_web',
    version: '1.0.0',
    instructions: 'Reading web pages by address.',
    alwaysLoad: true,
    tools: [fetchTool(fetchDoc)],
  })
}
