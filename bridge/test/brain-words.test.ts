/**
 * The L panel's words for a brain switch (src/lib/brain-words.ts). Tested
 * here because it is plain TypeScript the bridge's test runner can load, and
 * because what it builds is exactly what bridge/brain-choice.ts reads.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brainAsk, brainLines } from '../../src/lib/brain-words.ts'
import { parseBrainChange } from '../brain-choice.ts'

test('no words after a command shows the models', () => {
  for (const command of ['model', 'effort', 'heavy'] as const) assert.deepEqual(brainAsk(command, []), { show: true })
})

test('each line becomes the change the bridge reads', () => {
  const lines: Array<[Parameters<typeof brainAsk>, unknown]> = [
    [['model', ['Opus']], { voice: { model: 'claude-opus-5-5' } }],
    [['model', ['opus', 'high']], { voice: { model: 'claude-opus-5-5', effort: 'high' } }],
    [['model', ['reset']], { reset: true }],
    [['effort', ['max']], { voice: { effort: 'max' } }],
    [['heavy', ['off']], { heavy: 'off' }],
    [['heavy', ['sonnet', 'medium']], { heavy: { model: 'claude-sonnet-5-5', effort: 'medium' } }],
    [['heavy', ['effort', 'xhigh']], { heavy: { effort: 'xhigh' } }],
  ]
  for (const [[command, args], expected] of lines) {
    const ask = brainAsk(command, args)
    assert.ok('change' in ask, `${command} ${args.join(' ')}`)
    assert.deepEqual(parseBrainChange(ask.change), expected)
  }
})

test('too many words gives the usage, not a request', () => {
  assert.ok('usage' in brainAsk('model', ['opus', 'high', 'now']))
  assert.ok('usage' in brainAsk('effort', ['high', 'low']))
  assert.ok('usage' in brainAsk('heavy', ['effort']))
})

test('the models read as one line each', () => {
  const voice = { model: 'claude-sonnet-5-5', effort: 'low' }
  assert.deepEqual(brainLines({ voice, heavy: null }), ['voice  sonnet-5-5 low', 'heavy  off'])
})
