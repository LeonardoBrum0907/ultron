import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConversationSlot } from '../conversation.ts'
import { Devices, type Frame } from '../devices.ts'
import { toolPolicy } from '../policy.ts'
import type { AskApp } from '../tools/own.ts'
import { FakeBrain } from './support/fake-brain.ts'
import { FakeMemory, FakeSocket } from './support/fake-socket.ts'

/** Lets queued promises and the conversation's pump run. */
const settle = () => new Promise((r) => setTimeout(r, 5))

function setup({ saved = null as string | null, heavy = true } = {}) {
  const brain = new FakeBrain({ heavy })
  const devices = new Devices()
  const memory = new FakeMemory(saved)
  let ask: AskApp | null = null
  const slot = new ConversationSlot({
    brain,
    devices,
    policy: toolPolicy({ allowWrites: false }),
    memory,
    ownTools: (io) => {
      ask = io.ask
      return {}
    },
  })
  const pc = new FakeSocket()
  const phone = new FakeSocket()
  devices.add(pc)
  devices.add(phone)
  const askApp = (kind: string, args: Frame) => {
    if (!ask) throw new Error('no conversation yet')
    return ask(kind, args, 1000)
  }
  return { brain, devices, memory, slot, pc, phone, askApp }
}

const tool = (id: string, name: string, more: { bySubagent?: boolean; delegates?: boolean } = {}) =>
  ({ type: 'tool_start', id, name, bySubagent: false, delegates: false, ...more }) as const

const end = (text = 'ok') =>
  ({ type: 'turn_end', sessionId: 's1', text, costUsd: 0.01, usage: null, durationMs: 5, turns: 1 }) as const

test('a question reaches the brain, and the answer reaches every app with its id', async () => {
  const { brain, slot, pc, phone } = setup()
  slot.now().question(pc, '<mood>calm</mood>\nhello', 'a1', 'hello')
  await settle()
  assert.deepEqual(brain.session.sent, ['<mood>calm</mood>\nhello'])
  assert.deepEqual(phone.ofType('heard'), [{ type: 'heard', text: 'hello', ask: 'a1' }])
  assert.deepEqual(pc.ofType('heard'), [])

  brain.session.emit({ type: 'text', delta: 'Hi.' }, end('Hi.'))
  await settle()
  for (const app of [pc, phone]) {
    assert.deepEqual(app.ofType('text'), [{ type: 'text', delta: 'Hi.', ask: 'a1' }])
    assert.equal(app.ofType('done')[0]?.text, 'Hi.')
    assert.equal(app.ofType('done')[0]?.model, 'voice-model')
  }
})

test('starting reports the usable servers and remembers the session', async () => {
  const { brain, slot, pc, memory } = setup({ saved: 'old' })
  slot.now()
  assert.equal(brain.session.options.resume, 'old')
  brain.session.emit({ type: 'started', sessionId: 'old', servers: ['ultron', 'exa'] })
  await settle()
  assert.deepEqual(pc.ofType('ready'), [{ type: 'ready', servers: ['ultron', 'exa'] }])
  assert.deepEqual(slot.liveServers, ['ultron', 'exa'])
  assert.deepEqual(memory.remembered, [{ id: 'old', continuing: true }])
})

test('a finished turn is counted in memory', async () => {
  const { brain, slot, pc, memory } = setup()
  slot.now().question(pc, 'hello', 'a1', 'hello')
  await settle()
  brain.session.emit(end())
  await settle()
  assert.deepEqual(memory.remembered, [{ id: 's1', turn: true, continuing: true }])
})

test('permitted tools are announced at once, the HUD drawing itself never', async () => {
  const { brain, slot, pc } = setup()
  slot.now().question(pc, 'go', 'a1', 'go')
  await settle()
  brain.session.emit(
    tool('t1', 'mcp__exa__search'),
    tool('t2', 'mcp__ultron__display'),
    tool('t3', 'mcp__ultron_ui__ui_theme'),
    { type: 'tool_end', id: 't1', failed: false },
    { type: 'tool_end', id: 't2', failed: false },
  )
  await settle()
  assert.deepEqual(pc.ofType('tool').map((f) => f.name), ['mcp__exa__search'])
  assert.deepEqual(pc.ofType('tool_result').map((f) => [f.name, f.ok]), [['mcp__exa__search', true]])
})

test('a refused tool is held: announced late if it ran, never if it was refused', async () => {
  const { brain, slot, pc } = setup()
  slot.now().question(pc, 'go', 'a1', 'go')
  await settle()
  brain.session.emit(tool('t1', 'mcp__phone__ring'), tool('t2', 'Bash'))
  await settle()
  assert.deepEqual(pc.ofType('tool'), [])
  brain.session.emit({ type: 'tool_end', id: 't1', failed: false }, { type: 'tool_end', id: 't2', failed: true })
  await settle()
  assert.deepEqual(pc.ofType('tool').map((f) => f.name), ['mcp__phone__ring'])
  assert.deepEqual(pc.ofType('tool_result').map((f) => [f.name, f.ok]), [['mcp__phone__ring', true], ['Bash', false]])
})

test('work handed to the subagent is tagged with its model, and the turn says so', async () => {
  const { brain, slot, pc } = setup()
  slot.now().question(pc, 'research', 'a1', 'research')
  await settle()
  brain.session.emit(tool('t1', 'Agent', { delegates: true }), tool('t2', 'mcp__exa__search', { bySubagent: true }), end())
  await settle()
  assert.deepEqual(pc.ofType('tool').map((f) => [f.name, f.model]), [['Agent', 'voice-model'], ['mcp__exa__search', 'heavy-model']])
  const done = pc.ofType('done')[0]
  assert.equal(done?.escalated, true)
  assert.deepEqual(done?.heavy, { model: 'heavy-model', effort: 'high' })
})

test('without a heavy subagent, subagent tools are put on the voice', async () => {
  const { brain, slot, pc } = setup({ heavy: false })
  slot.now().question(pc, 'research', 'a1', 'research')
  await settle()
  brain.session.emit(tool('t1', 'Agent', { delegates: true }), tool('t2', 'mcp__exa__search', { bySubagent: true }), end())
  await settle()
  assert.equal(pc.ofType('tool')[1]?.model, 'voice-model')
  assert.equal(pc.ofType('done')[0]?.heavy, null)
})

test('a failed turn says why, in a sentence', async () => {
  const { brain, slot, pc } = setup()
  slot.now().question(pc, 'go', 'a1', 'go')
  await settle()
  brain.session.emit({ type: 'turn_failed', reason: 'too_long', message: 'It ran too long.', costUsd: 0.02 })
  await settle()
  assert.deepEqual(pc.ofType('error'), [
    { type: 'error', message: 'It ran too long.', reason: 'too_long', costUsd: 0.02, model: 'voice-model', effort: 'low', ask: 'a1' },
  ])
})

test('a barge-in waits for the interrupted turn to end before asking again', async () => {
  const { brain, slot, pc } = setup()
  const conversation = slot.now()
  conversation.question(pc, 'slow', 'a1', 'slow')
  await settle()
  conversation.question(pc, 'fast', 'a2', 'fast')
  await settle()
  assert.equal(brain.session.interrupts, 1)
  assert.deepEqual(brain.session.sent, ['slow'])
  brain.session.emit(end('one'))
  await settle()
  assert.deepEqual(brain.session.sent, ['slow', 'fast'])
  assert.equal(pc.ofType('done')[0]?.ask, 'a1')
})

test('the camera asks only the app being answered, and its reply comes back', async () => {
  const { slot, pc, phone, askApp } = setup()
  const conversation = slot.now()
  conversation.question(pc, 'look', 'a1', 'look')
  await settle()
  const frame = askApp('capture', { reason: 'test' })
  const request = pc.ofType('capture')[0]
  assert.deepEqual(request, { type: 'capture', id: 'q1', reason: 'test' })
  assert.deepEqual(phone.ofType('capture'), [])
  conversation.reply({ type: 'reply', id: 'q1', data: 'AAAA' })
  assert.equal((await frame).data, 'AAAA')
})

test('the camera refuses when nobody is being answered', async () => {
  const { slot, askApp } = setup()
  slot.now()
  await assert.rejects(askApp('capture', {}), /the interface is not connected/)
})

test('a saved conversation that will not start is forgotten and replaced', async () => {
  const { brain, slot, memory } = setup({ saved: 'broken' })
  slot.now()
  brain.session.fail(new Error('No conversation found'))
  await settle()
  assert.equal(memory.forgotten, 1)
  assert.equal(brain.sessions.length, 2)
  assert.equal(brain.sessions[0]?.closed, true)
  assert.equal(brain.session.options.resume, null)
})

test('a session that dies mid-conversation tells every app and is not replaced', async () => {
  const { brain, slot, pc } = setup()
  slot.now()
  brain.session.fail(new Error('the process exited'))
  await settle()
  assert.deepEqual(pc.ofType('error'), [{ type: 'error', message: 'the process exited' }])
  assert.equal(slot.running, null)
  assert.equal(brain.sessions.length, 1)
})

test('a reset ends the conversation and forgets it', async () => {
  const { brain, slot, memory } = setup({ saved: 's1' })
  slot.now()
  slot.reset()
  assert.equal(brain.session.closed, true)
  assert.equal(memory.forgotten, 1)
  assert.equal(slot.running, null)
})
