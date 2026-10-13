import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeChoice, nextChoice, parseBrainChange, type BrainChoice } from '../brain-choice.ts'
import { brainChoiceFile } from '../brain-choice-file.ts'

const env: BrainChoice = {
  voice: { model: 'claude-sonnet-5-5', effort: 'low' },
  heavy: { model: 'claude-opus-5-5', effort: 'high' },
}

const change = (body: unknown, from: BrainChoice = env) => nextChoice(from, parseBrainChange(body), env)

test('a short name is the full model id', () => {
  assert.deepEqual(parseBrainChange({ voice: { model: 'Opus' } }), { voice: { model: 'claude-opus-5-5' } })
  assert.deepEqual(parseBrainChange({ heavy: { model: 'haiku' } }), { heavy: { model: 'claude-haiku-5-5' } })
})

test('a full Claude id is taken as written', () => {
  assert.equal(change({ voice: { model: 'claude-opus-5-5[1m]' } }).voice.model, 'claude-opus-5-5[1m]')
})

test('a model that is not Claude is refused, naming it and the short names', () => {
  assert.throws(() => parseBrainChange({ voice: { model: 'gpt-5' } }), {
    message: 'voice.model: model "gpt-5" is not a Claude model id (claude-...) nor one of: sonnet, opus, haiku',
  })
})

test('an effort that does not exist is refused, naming the choices', () => {
  assert.throws(() => parseBrainChange({ voice: { effort: 'turbo' } }), {
    message: 'voice.effort: effort "turbo" must be one of: low, medium, high, xhigh, max',
  })
})

test('unknown fields are refused', () => {
  assert.throws(() => parseBrainChange({ voice: { modle: 'opus' } }), /voice/)
  assert.throws(() => parseBrainChange('opus'))
})

test('changing the effort keeps the model, and the subagent stays as it was', () => {
  assert.deepEqual(change({ voice: { effort: 'high' } }), {
    voice: { model: 'claude-sonnet-5-5', effort: 'high' },
    heavy: env.heavy,
  })
})

test('the subagent turns off, and back on with the effort .env.local gives it', () => {
  const off = change({ heavy: 'off' })
  assert.equal(off.heavy, null)
  assert.deepEqual(change({ heavy: { model: 'sonnet' } }, off).heavy, { model: 'claude-sonnet-5-5', effort: 'high' })
})

test('the effort of a subagent that is off cannot be set', () => {
  assert.throws(() => change({ heavy: { effort: 'max' } }, { ...env, heavy: null }), /heavy is off: name a model/)
})

test('reset goes back to what .env.local says', () => {
  const opus = change({ voice: { model: 'opus', effort: 'max' }, heavy: 'off' })
  assert.deepEqual(change({ reset: true }, opus), env)
})

test('a choice reads as one short line', () => {
  assert.equal(describeChoice(env), 'sonnet-5-5 low · heavy opus-5-5 high')
  assert.equal(describeChoice({ ...env, heavy: null }), 'sonnet-5-5 low · heavy off')
})

test('a saved choice is read back, and cleared', () => {
  const file = brainChoiceFile(mkdtempSync(join(tmpdir(), 'ultron-choice-')))
  assert.equal(file.saved(), null)
  file.save({ ...env, heavy: null })
  assert.deepEqual(file.saved(), { ...env, heavy: null })
  file.clear()
  assert.equal(file.saved(), null)
})

test('a saved choice that no longer reads is ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ultron-choice-'))
  writeFileSync(join(dir, 'cerebro.json'), JSON.stringify({ voice: { model: 'gpt-5', effort: 'low' }, heavy: null }))
  assert.equal(brainChoiceFile(dir).saved(), null)
})
