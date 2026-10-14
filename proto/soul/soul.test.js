// The soul's CPU side, without a browser:  node --test proto/soul/soul.test.js
// (the shader itself is checked by eye, in soul.html).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextPalette, SOUL_PALETTES } from './palettes.js'
import { buildSwarm, PART, seededRandom, SOUL_BUDGET } from './swarm.js'

test('a seed always builds the same soul', () => {
  const a = buildSwarm({ core: 3, flame: 5 }, seededRandom(42))
  const b = buildSwarm({ core: 3, flame: 5 }, seededRandom(42))
  assert.deepEqual(a.rand, b.rand)
  assert.deepEqual(a.meta, b.meta)
})

test('every part gets its budget, in PART order, with random numbers in [0, 1)', () => {
  const swarm = buildSwarm(SOUL_BUDGET, seededRandom(1))
  const total = Object.values(SOUL_BUDGET).reduce((n, k) => n + k, 0)
  assert.equal(swarm.count, total)
  const parts = Array.from({ length: swarm.count }, (_, i) => swarm.meta[i * 2])
  for (const [name, n] of Object.entries(SOUL_BUDGET)) assert.equal(parts.filter((p) => p === PART[name]).length, n, name)
  assert.ok(swarm.rand.every((v) => v >= 0 && v < 1))
})

test('an unknown part is refused, naming the parts there are', () => {
  assert.throws(() => buildSwarm({ wings: 1 }, seededRandom(1)), /unknown soul part "wings", expected one of core/)
})

test('the palettes go round', () => {
  const names = Object.keys(SOUL_PALETTES)
  let name = names[0]
  for (let i = 0; i < names.length; i++) name = nextPalette(name)
  assert.equal(name, names[0])
  assert.equal(nextPalette('blue'), 'red')
})
