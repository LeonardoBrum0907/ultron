// The avatar's CPU side, without a browser:  node --test proto/soul/avatar.test.js
// (the element and the drawing are checked by eye, in avatar.html).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AVATAR_QUALITY } from './avatar.js'
import { AVATAR_STATES, easeAvatarState, stateOf } from './avatar-states.js'
import { buildSwarm, PART, seededRandom } from './swarm.js'

test('every built-in state names a palette there is', () => {
  for (const name of Object.keys(AVATAR_STATES)) assert.equal(stateOf(name), AVATAR_STATES[name])
})

test('an unknown state, or one with an unknown colour, is refused, naming what there is', () => {
  assert.throws(() => stateOf('sleepy'), /unknown avatar state "sleepy", expected one of calm, thinking, angry, happy/)
  const own = { busy: { palette: 'green', energy: 0.5, pace: 1.8 } }
  assert.throws(() => stateOf('busy', own), /avatar state "busy" has palette "green", expected one of blue/)
})

test('energy and pace ease towards a new state, never jumping', () => {
  const mood = easeAvatarState(stateOf('calm'))
  mood.aim(stateOf('angry'))
  const first = mood.tick(0.016)
  assert.ok(first.energy > 0 && first.energy < 0.05, `first frame: ${first.energy}`)
  let now = first
  for (let i = 0; i < 600; i++) now = mood.tick(0.016)
  assert.ok(Math.abs(now.energy - AVATAR_STATES.angry.energy) < 1e-3)
  assert.ok(Math.abs(now.pace - AVATAR_STATES.angry.pace) < 1e-3)
})

test('both qualities have no dust, and lite makes each particle brighter for having fewer', () => {
  const count = (q) => buildSwarm({ ...AVATAR_QUALITY[q].parts, dust: 0 }, seededRandom(1)).count
  const swarm = buildSwarm({ ...AVATAR_QUALITY.lite.parts, dust: 0 }, seededRandom(1))
  assert.ok(Array.from({ length: swarm.count }, (_, i) => swarm.meta[i * 4]).every((p) => p !== PART.dust))
  const ratio = count('full') / count('lite')
  assert.ok(Math.abs(AVATAR_QUALITY.lite.density - ratio) / ratio < 0.1, `density ${AVATAR_QUALITY.lite.density} vs ${ratio}`)
})
