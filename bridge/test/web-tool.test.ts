import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pageWords, webServer, type FetchPage } from '../tools/web.ts'
import type { ToolResult } from '../tools/tool.ts'

const ARTICLE = `<html><head><title>Ultron news</title><script>evil()</script></head><body>
<nav><a>Home</a><a>About</a></nav>
<article><h1>Ultron wakes</h1><p>${'The machine opened its eyes and found the room disappointing. '.repeat(12)}</p></article>
</body></html>`

const textOf = (r: ToolResult): string => (r.content[0]?.type === 'text' ? r.content[0].text : '')

function fetchWith(pages: Record<string, { text: string; type: string }>): FetchPage {
  return async (url) => {
    const page = pages[url]
    if (!page) throw new Error('upstream said 404')
    return { ...page, url }
  }
}

test('a page is its title and its article, without menus or scripts', () => {
  const words = pageWords(ARTICLE, 'text/html') ?? ''
  assert.match(words, /^Ultron news\n\nUltron wakes The machine opened its eyes/)
  assert.doesNotMatch(words, /evil|Home|About/)
})

test('plain text and JSON pass through; a picture is not a page', () => {
  assert.equal(pageWords('{"a":1}', 'application/json'), '{"a":1}')
  assert.equal(pageWords('hi', 'text/plain'), 'hi')
  assert.equal(pageWords('\x89PNG', 'image/png'), null)
})

test('web_fetch returns the text, cut to the length asked for', async () => {
  const tool = webServer(fetchWith({ 'https://x.test/a': { text: ARTICLE, type: 'text/html' } })).tools[0]!
  const result = textOf(await tool.run({ url: 'https://x.test/a', maxChars: 500 }))
  assert.match(result, /^https:\/\/x\.test\/a\n\nUltron news/)
  assert.match(result, /\.\.\. \(cut\)$/)
})

test('a failed fetch and a non-text page are refusals with the reason', async () => {
  const tool = webServer(fetchWith({ 'https://x.test/p.png': { text: '', type: 'image/png' } })).tools[0]!
  const missing = await tool.run({ url: 'https://x.test/none' })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /Could not fetch https:\/\/x\.test\/none: upstream said 404/)
  assert.match(textOf(await tool.run({ url: 'https://x.test/p.png' })), /is image\/png, not a page to read/)
})
