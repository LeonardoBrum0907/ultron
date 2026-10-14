import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aiMemory, ftsQuery, memoryBanner } from '../long-memory/ai-memory.ts'
import { FakeAiMemory } from './support/fake-ai-memory.ts'

const TOKEN = 'secret-token'

async function withServer(run: (fake: FakeAiMemory, url: string) => Promise<void>, sse = false): Promise<void> {
  const fake = new FakeAiMemory({ token: TOKEN, sse })
  const url = await fake.start()
  try {
    await run(fake, url)
  } finally {
    await fake.stop()
  }
}

const settings = (url: string, token = TOKEN) => ({ url, token, timeoutMs: 2000, workspace: 'ultron', project: 'memoria' })

test('a spoken question becomes an OR of its words, so it can neither fail nor demand too much', () => {
  assert.equal(ftsQuery('O que eu bebo de manhã?'), '"que" OR "bebo" OR "manhã"')
  assert.equal(ftsQuery('café, café'), '"café"')
  assert.equal(ftsQuery('? !'), '')
})

test('a note saved is found by any of its words and read back whole, inside the configured scope', async () => {
  await withServer(async (fake, url) => {
    const memory = aiMemory(settings(url))
    await memory.save({ path: 'notes/cafe.md', title: 'Café', body: '# Café\n\nSem açúcar.' }, { pinned: true })
    const hits = await memory.search('quanto açúcar', 5)
    assert.deepEqual(hits, [{ path: 'notes/cafe.md', title: 'Café', snippet: 'Café' }])
    assert.deepEqual(await memory.read('notes/cafe.md'), { path: 'notes/cafe.md', title: 'Café', body: '# Café\n\nSem açúcar.' })
    assert.equal(fake.pages.get('notes/cafe.md')?.pinned, true)
    for (const call of fake.calls) assert.equal(`${call.args.workspace}/${call.args.project}`, 'ultron/memoria')
    assert.deepEqual(fake.calls.find((c) => c.name === 'memory_query')?.args.query, '"quanto" OR "açúcar"')
  })
})

test('a note that is not there reads as null, not as an error', async () => {
  await withServer(async (_fake, url) => {
    const memory = aiMemory(settings(url))
    await memory.save({ path: 'notes/a.md', title: 'A', body: '# A' }, { pinned: false })
    assert.equal(await memory.read('notes/nada.md'), null)
  })
})

test('a fresh server, which knows no scope until the first note, reads as an empty memory', async () => {
  await withServer(async (_fake, url) => {
    const memory = aiMemory(settings(url))
    assert.deepEqual(await memory.recent(5), [])
    assert.deepEqual(await memory.search('café', 5), [])
    assert.equal(await memory.read('notes/a.md'), null)
  })
})

test('a search with no usable words asks the server nothing', async () => {
  await withServer(async (fake, url) => {
    assert.deepEqual(await aiMemory(settings(url)).search('?', 5), [])
    assert.equal(fake.calls.length, 0)
  })
})

test('an answer sent as a server-sent event is read the same', async () => {
  await withServer(async (_fake, url) => {
    const memory = aiMemory(settings(url))
    await memory.save({ path: 'notes/a.md', title: 'A', body: '# A\n\nalpha' }, { pinned: false })
    assert.equal((await memory.recent(5))[0]?.path, 'notes/a.md')
  }, true)
})

test('a wrong token fails with the status and the server it came from', async () => {
  await withServer(async (_fake, url) => {
    await assert.rejects(aiMemory(settings(url, 'wrong')).recent(1), /HTTP 401 from http:\/\/127\.0\.0\.1/)
  })
})

test('a server that is not running says so, with the reason', async () => {
  const fake = new FakeAiMemory({ token: TOKEN })
  const url = await fake.start()
  await fake.stop()
  await assert.rejects(aiMemory(settings(url)).recent(1), /cannot reach http:\/\/127\.0\.0\.1:\d+\/mcp: ECONNREFUSED/)
})

test('the startup line says whether memory is off, ready, or why it is not', async () => {
  assert.match(await memoryBanner(null, null), /^\[ultron\] memory off/)
  await withServer(async (_fake, url) => {
    assert.equal(await memoryBanner(aiMemory(settings(url)), settings(url)), `[ultron] memory ready at ${url} (ultron/memoria)`)
    const wrong = settings(url, 'wrong')
    assert.match(await memoryBanner(aiMemory(wrong), wrong), /memory unavailable at .*HTTP 401/)
  })
})
