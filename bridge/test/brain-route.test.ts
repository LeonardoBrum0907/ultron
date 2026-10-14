/**
 * The L panel's `model`, `effort` and `heavy` commands, end to end: the real
 * bridge against the fake Agent SDK, so a switch is seen the way the SDK sees it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BridgeProcess, FakeFace } from './support/bridge-process.ts'

const PAGE = 'http://localhost:5173'

const queries = (bridge: BridgeProcess) => bridge.fakeLog().filter((e) => e.event === 'query')

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

async function connected(bridge: BridgeProcess): Promise<FakeFace> {
  const face = new FakeFace(bridge.port)
  await face.opened()
  return face
}

test('any app reads the models; only a page on this machine changes them', async (t) => {
  const bridge = new BridgeProcess()
  await bridge.start()
  t.after(() => bridge.stop())

  const read = await bridge.http('GET', '/brain')
  assert.deepEqual(read.body, {
    voice: { model: 'claude-sonnet-5-5', effort: 'low' },
    heavy: { model: 'claude-opus-5-5', effort: 'high' },
    saved: false,
  })
  const scripted = await bridge.http('POST', '/brain', { body: { voice: { model: 'opus' } } })
  assert.deepEqual(scripted, { status: 403, body: { error: 'the brain only changes from this machine' } })
  const wrong = await bridge.http('POST', '/brain', { body: { voice: { model: 'gpt-5' } }, origin: PAGE })
  assert.equal(wrong.status, 400)
  assert.match(String((wrong.body as { error: string }).error), /gpt-5/)
})

test('a switch carries the conversation on with the new model, and survives a restart', async (t) => {
  const bridge = new BridgeProcess()
  await bridge.start()
  t.after(() => bridge.stop())
  const face = await connected(bridge)
  t.after(() => face.close())
  face.send({ type: 'ask', text: 'hello', id: 'a1' })
  await face.turnEnded('a1')

  const switched = await bridge.http('POST', '/brain', { body: { voice: { model: 'opus', effort: 'max' }, heavy: 'off' }, origin: PAGE })
  assert.deepEqual(switched.body, {
    voice: { model: 'claude-opus-5-5', effort: 'max' },
    heavy: null,
    changed: true,
    waiting: false,
  })
  const told = await face.waitFor((f) => f.type === 'brain', 'brain frame')
  assert.deepEqual(told, { type: 'brain', voice: { model: 'claude-opus-5-5', effort: 'max' }, heavy: null })
  await until(() => queries(bridge).length === 2, 'the new session')
  const [before, after] = queries(bridge)
  assert.equal(before?.model, 'claude-sonnet-5-5')
  assert.deepEqual([after?.model, after?.effort, after?.resume, after?.agents], ['claude-opus-5-5', 'max', 'sess-new', null])
  // Without the subagent the persona no longer tells the voice to delegate.
  assert.notEqual(after?.systemPrompt, before?.systemPrompt)
  assert.ok(existsSync(join(bridge.home, '.ultron', 'cerebro.json')))

  face.close()
  await bridge.stop()
  await bridge.start()
  const again = await connected(bridge)
  t.after(() => again.close())
  await until(() => queries(bridge).length === 3, 'the session after the restart')
  assert.equal(queries(bridge)[2]?.model, 'claude-opus-5-5')

  const reset = await bridge.http('POST', '/brain', { body: { reset: true }, origin: PAGE })
  assert.equal((reset.body as { voice: { model: string } }).voice.model, 'claude-sonnet-5-5')
  assert.ok(!existsSync(join(bridge.home, '.ultron', 'cerebro.json')))
  await until(() => queries(bridge).length === 4, 'the session after the reset')
  assert.equal(queries(bridge)[3]?.model, 'claude-sonnet-5-5')
  assert.ok(readFileSync(join(bridge.home, '.ultron', 'conversa.json'), 'utf8').includes('sess-new'))
})
