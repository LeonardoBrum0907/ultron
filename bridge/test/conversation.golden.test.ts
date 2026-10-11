/**
 * Characterization of the bridge's conversation, recorded before the brain
 * was split out of server.mjs: every frame two apps receive, and everything
 * the Agent SDK is handed, for a script of questions. Any refactor of the
 * bridge must leave these recordings unchanged.
 */
import { after, test } from 'node:test'
import { BridgeProcess, FakeFace } from './support/bridge-process.ts'
import { matchesGolden } from './support/golden.ts'

const running: BridgeProcess[] = []
after(async () => Promise.all(running.map((b) => b.stop())))

async function bridgeWith(saved?: { id: string; turns: number }): Promise<BridgeProcess> {
  const bridge = new BridgeProcess()
  running.push(bridge)
  if (saved) bridge.saveConversation(saved.id, saved.turns)
  await bridge.start()
  return bridge
}

/** /health without the shell's path and program, which differ per machine. */
async function health(bridge: BridgeProcess) {
  const res = await bridge.http('GET', '/health')
  const body = res.body as { shell?: { enabled?: boolean } }
  return { ...res, body: { ...body, shell: { enabled: body.shell?.enabled } } }
}

async function connect(bridge: BridgeProcess): Promise<FakeFace> {
  const face = new FakeFace(bridge.port)
  await face.opened()
  return face
}

/** The camera answering from the app that asked. */
function answerCamera(face: FakeFace): void {
  face.react((f) => {
    if (f.type === 'capture') face.send({ type: 'reply', id: f.id, data: 'AAAA', mimeType: 'image/jpeg' })
  })
}

/** Barging in: as the slow answer starts, interrupt and ask again. */
function bargeIn(face: FakeFace): void {
  face.react((f) => {
    if (f.type !== 'text' || f.ask !== 'a3') return
    face.react(null)
    face.send({ type: 'interrupt' })
    face.send({ type: 'ask', text: 'hello', id: 'a4' })
  })
}

test('one conversation shared by two apps', async () => {
  const bridge = await bridgeWith()
  const status = await health(bridge)
  const pc = await connect(bridge)
  const phone = await connect(bridge)

  pc.send({ type: 'ask', text: 'hello', id: 'a1', tone: 'calm, a little bored' })
  await pc.turnEnded('a1')
  phone.send({ type: 'ask', text: 'tools', id: 'b1' })
  await phone.turnEnded('b1')
  answerCamera(pc)
  pc.send({ type: 'ask', text: 'look', id: 'a2' })
  await pc.turnEnded('a2')
  bargeIn(pc)
  pc.send({ type: 'ask', text: 'slow', id: 'a3' })
  await pc.turnEnded('a4')
  pc.send({ type: 'ask', text: 'fail', id: 'a5' })
  await pc.turnEnded('a5')
  const memory = await bridge.http('GET', '/memory')
  const saved = bridge.savedConversation()
  const reset = await bridge.http('POST', '/memory/reset')
  await phone.waitFor((f) => f.type === 'ui' && f.op === 'screen', 'transcript cleared')

  pc.close()
  phone.close()
  await bridge.stop()
  matchesGolden('shared-conversation', {
    health: status, memory, saved, reset, pc: pc.frames, phone: phone.frames, sdk: bridge.fakeLog(),
  })
})

test('a saved conversation is resumed', async () => {
  const bridge = await bridgeWith({ id: 'sess-old', turns: 4 })
  const pc = await connect(bridge)
  pc.send({ type: 'ask', text: 'hello', id: 'a1' })
  await pc.turnEnded('a1')
  const saved = bridge.savedConversation()
  pc.close()
  await bridge.stop()
  matchesGolden('resumed-conversation', { saved, pc: pc.frames, sdk: bridge.fakeLog() })
})

/** Resolves once the fake SDK has been asked to start `count` conversations. */
async function conversationsStarted(bridge: BridgeProcess, count: number): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (bridge.fakeLog().filter((e) => e.event === 'query').length >= count) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`the bridge never started conversation ${count}`)
}

// Recorded as it behaves, which is not as it should: the question that ran
// into the broken session is never answered (see docs/legacy-notes.md).
test('a saved conversation that will not resume is forgotten', async () => {
  const bridge = await bridgeWith({ id: 'broken', turns: 9 })
  const pc = await connect(bridge)
  pc.send({ type: 'ask', text: 'hello', id: 'a1' })
  await conversationsStarted(bridge, 2)
  pc.send({ type: 'ask', text: 'hello', id: 'a2' })
  await pc.turnEnded('a2')
  const saved = bridge.savedConversation()
  pc.close()
  await bridge.stop()
  matchesGolden('broken-resume', { saved, pc: pc.frames, sdk: bridge.fakeLog() })
})
