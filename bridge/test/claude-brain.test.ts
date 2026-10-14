import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { sdkEvents } from '../brain/claude.ts'

/** Builds an SDK message from the fields that matter; the rest of the shape is not read. */
const sdk = (msg: Record<string, unknown>) => msg as unknown as SDKMessage

const delta = (text: string, parent: string | null = null) =>
  sdk({ type: 'stream_event', parent_tool_use_id: parent, event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } })

const toolBlock = (id: string, name: string, parent: string | null = null) =>
  sdk({ type: 'stream_event', parent_tool_use_id: parent, event: { type: 'content_block_start', content_block: { type: 'tool_use', id, name } } })

test("only the voice's words are speech, not the subagent's", () => {
  const seen = new Set<string>()
  assert.deepEqual(sdkEvents(delta('Hi.'), seen), [{ type: 'text', delta: 'Hi.' }])
  assert.deepEqual(sdkEvents(delta('report', 'tu-agent'), seen), [])
})

test('a tool seen on the stream and again on the whole message is one call', () => {
  const seen = new Set<string>()
  const whole = sdk({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent' }] } })
  assert.deepEqual(sdkEvents(toolBlock('t1', 'Agent'), seen), [
    { type: 'tool_start', id: 't1', name: 'Agent', bySubagent: false, delegates: true },
  ])
  assert.deepEqual(sdkEvents(whole, seen), [])
})

test("the subagent's tools are marked as its own", () => {
  const [event] = sdkEvents(toolBlock('t2', 'mcp__exa__search', 'tu-agent'), new Set())
  assert.deepEqual(event, { type: 'tool_start', id: 't2', name: 'mcp__exa__search', bySubagent: true, delegates: false })
})

test('tool results end their calls, refusals as failures', () => {
  const results = sdk({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }, { type: 'tool_result', tool_use_id: 't2' }] },
  })
  assert.deepEqual(sdkEvents(results, new Set()), [
    { type: 'tool_end', id: 't1', failed: true },
    { type: 'tool_end', id: 't2', failed: false },
  ])
})

test('a successful result ends the turn with its cost and usage, and forgets its tool ids', () => {
  const seen = new Set(['t1'])
  const result = sdk({
    type: 'result', subtype: 'success', session_id: 's1', result: 'Done.', total_cost_usd: 0.01,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    duration_ms: 42, num_turns: 2,
  })
  assert.deepEqual(sdkEvents(result, seen), [{
    type: 'turn_end', sessionId: 's1', text: 'Done.', costUsd: 0.01,
    usage: { in: 10, out: 5, cacheRead: 3, cacheWrite: 2 }, durationMs: 42, turns: 2,
  }])
  assert.equal(seen.size, 0)
})

test('an error result fails the turn with a sentence to speak', () => {
  const result = sdk({ type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.02 })
  assert.deepEqual(sdkEvents(result, new Set()), [
    { type: 'turn_failed', reason: 'error_max_turns', message: 'The turn ran too long and was stopped.', costUsd: 0.02 },
  ])
  const unknown = sdk({ type: 'result', subtype: 'error_new_kind' })
  const [failed] = sdkEvents(unknown, new Set())
  assert.equal(failed?.type === 'turn_failed' ? failed.message : null, 'The turn ended without an answer.')
})

test('an API error the SDK reports as a success fails the turn, with the error to show', () => {
  // How the API refusing a model came back on SDK 0.3.220: subtype success,
  // flagged is_error, no streamed text. Read as a finished turn, Ultron went mute.
  const refused = 'API Error: 400 Claude Code 2.1.220 does not support this model; version 2.1.280 or newer is required.'
  const result = sdk({ type: 'result', subtype: 'success', is_error: true, session_id: 's1', result: refused, total_cost_usd: 0 })
  assert.deepEqual(sdkEvents(result, new Set()), [{ type: 'turn_failed', reason: 'api_error', message: refused, costUsd: 0 }])
  const blank = sdk({ type: 'result', subtype: 'success', is_error: true, result: '' })
  const [failed] = sdkEvents(blank, new Set())
  assert.equal(failed?.type === 'turn_failed' ? failed.message : null, 'The turn ended without an answer.')
})

test('init starts the session with the servers that can be used', () => {
  const init = sdk({
    type: 'system', subtype: 'init', session_id: 's1',
    mcp_servers: [{ name: 'a', status: 'connected' }, { name: 'b', status: 'pending' }, { name: 'c', status: 'needs-auth' }, { name: 'd', status: 'failed' }],
  })
  assert.deepEqual(sdkEvents(init, new Set()), [{ type: 'started', sessionId: 's1', servers: ['a', 'b'] }])
})
