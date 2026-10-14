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
      kind: 'claude',
      url: null,
      key: null,
      voice: { model: 'claude-sonnet-5-5', effort: 'low' },
      heavy: { model: 'claude-opus-5-5', effort: 'high' },
    },
    memory: null,
    debug: false,
  })
})

test('long-term memory is on once ULTRON_MEMORY_URL names a server, with or without /mcp', () => {
  const memory = readBridgeConfig({ ULTRON_MEMORY_URL: 'http://127.0.0.1:49374/', ULTRON_MEMORY_TOKEN: 'abc' }).memory
  assert.deepEqual(memory, {
    url: 'http://127.0.0.1:49374/mcp',
    token: 'abc',
    timeoutMs: 8000,
    workspace: 'ultron',
    project: 'memoria',
  })
  assert.equal(readBridgeConfig({ ULTRON_MEMORY_URL: 'http://h:1/mcp' }).memory?.url, 'http://h:1/mcp')
  assert.equal(readBridgeConfig({ ULTRON_MEMORY_URL: 'http://h:1', ULTRON_MEMORY_PROJECT: 'leo' }).memory?.project, 'leo')
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

test('ULTRON_BRAIN only knows claude for now, and says so', () => {
  assert.equal(readBridgeConfig({ ULTRON_BRAIN: 'claude' }).brain.kind, 'claude')
  assert.throws(
    () => readBridgeConfig({ ULTRON_BRAIN: 'ollama' }),
    { message: 'ULTRON_BRAIN is "ollama", but it must be one of: claude' },
  )
})

test('the URL and key for an HTTP brain are read but optional', () => {
  const config = readBridgeConfig({ ULTRON_BRAIN_URL: 'http://localhost:11434/v1', ULTRON_BRAIN_KEY: 'sk-test' })
  assert.equal(config.brain.url, 'http://localhost:11434/v1')
  assert.equal(config.brain.key, 'sk-test')
  assert.equal(readBridgeConfig({ ULTRON_BRAIN_KEY: '' }).brain.key, null)
})

test('an effort that is not a level is refused at startup', () => {
  assert.throws(
    () => readBridgeConfig({ ULTRON_EFFORT: 'fast' }),
    { message: 'ULTRON_EFFORT is "fast", but it must be one of: low, medium, high, xhigh, max' },
  )
  assert.throws(() => readBridgeConfig({ ULTRON_HEAVY_EFFORT: 'huge' }), /ULTRON_HEAVY_EFFORT is "huge"/)
  assert.equal(readBridgeConfig({ ULTRON_HEAVY_MODEL: 'off', ULTRON_HEAVY_EFFORT: 'huge' }).brain.heavy, null)
})
