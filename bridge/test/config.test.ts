import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBridgeConfig } from '../config.ts'

test('defaults: Sonnet voice at low effort, Opus heavy at high, read-only', () => {
  const config = readBridgeConfig({})
  assert.deepEqual(config, {
    port: 8787,
    lang: 'pt-BR',
    allowWrites: false,
    brain: {
      voice: { model: 'claude-sonnet-5-5', effort: 'low' },
      heavy: { model: 'claude-opus-5-5', effort: 'high' },
    },
    debug: false,
  })
})

test('every setting can be overridden', () => {
  const config = readBridgeConfig({
    ULTRON_BRIDGE_PORT: '9000',
    ULTRON_LANG: 'en-US',
    ULTRON_ALLOW_WRITES: '1',
    ULTRON_MODEL: 'claude-haiku-5-5',
    ULTRON_EFFORT: 'medium',
    ULTRON_HEAVY_MODEL: 'claude-fable-5-1',
    ULTRON_HEAVY_EFFORT: 'max',
    ULTRON_DEBUG: '1',
  })
  assert.equal(config.port, 9000)
  assert.equal(config.lang, 'en-US')
  assert.equal(config.allowWrites, true)
  assert.deepEqual(config.brain.voice, { model: 'claude-haiku-5-5', effort: 'medium' })
  assert.deepEqual(config.brain.heavy, { model: 'claude-fable-5-1', effort: 'max' })
  assert.equal(config.debug, true)
})

test('ULTRON_HEAVY_MODEL=off removes the subagent', () => {
  assert.equal(readBridgeConfig({ ULTRON_HEAVY_MODEL: 'off' }).brain.heavy, null)
})

test('only "1" turns a switch on', () => {
  assert.equal(readBridgeConfig({ ULTRON_ALLOW_WRITES: 'true' }).allowWrites, false)
})
