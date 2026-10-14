// The soul as Ultron's form, and how his mood shows on it, without a browser:
//   npx tsx --test proto/soul/form.test.js   (tsx for the mind's .ts; npm test runs it)
// (how it looks inside the figure is checked by eye, in the demo and the app).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSoulForm, FADE, motionOf, SUMMON_AFTER } from './form.js'
import { SHOWS, SOUL_MOODS, soulLookOf, soulSharesOf } from './moods.js'
import { SOUL_PALETTE_NAMES, SOUL_PALETTES } from './palettes.js'
import { ASSEMBLY_END } from './swarm.js'

/** The mind's output as the figure reads it each frame (mind.output()), set by hand. */
class FakeMindOutput {
  constructor({ dominant = 'neutral', mood = {}, channels = {} } = {}) {
    Object.assign(this, { dominant, mood, channels })
  }
}

const calm = new FakeMindOutput()
/** All of one palette, as the shader gets it (uMix). */
const allOf = (name) => SOUL_PALETTE_NAMES.map((each) => (each === name ? 1 : 0))
const run = (soul, seconds, mind = calm, dt = 0.05) => {
  let frame = null
  for (let t = 0; t < seconds - 1e-9; t += dt) frame = soul.tick(dt, mind)
  return frame
}
const formWith = () => {
  const soul = createSoulForm()
  soul.resize(800, 600, 1)
  return soul
}

test('the form rests unseen until it is shown', () => {
  const soul = formWith()
  assert.deepEqual(run(soul, 1), { presence: 0, motion: 0 })
  assert.equal(soul.points.visible, false)
  assert.equal(soul.present(), false)
})

test('its dust is spread through the window it first meets, and stays put when the window changes', () => {
  const soul = formWith()
  const cloud = soul.points.material.uniforms.uCloud.value.toArray()
  assert.deepEqual(cloud, [0, 3, 12]) // 800 x 600 px: 16 x 12 units round the frame's middle
  soul.resize(400, 300, 1)
  assert.deepEqual(soul.points.material.uniforms.uCloud.value.toArray(), cloud)
})

test('shown, its dust fades in and it is summoned a moment later', () => {
  const soul = formWith()
  soul.show()
  run(soul, SUMMON_AFTER - 0.1)
  assert.equal(soul.formed(), false)
  run(soul, 0.2)
  assert.equal(soul.formed(), true)
  assert.equal(run(soul, FADE.in).presence, 1)
  assert.equal(soul.points.visible, true)
})

test('hidden, it goes back into the dust and only then fades out', () => {
  const soul = formWith()
  soul.show()
  run(soul, ASSEMBLY_END + 1)
  soul.hide()
  assert.equal(soul.formed(), false)
  assert.equal(run(soul, 1).presence, 1) // still dissolving
  run(soul, ASSEMBLY_END)
  assert.equal(run(soul, FADE.out).presence, 0)
  assert.equal(soul.points.visible, false)
})

test('shown again while it dissolves, it is summoned as soon as it rests, never fading out', () => {
  const soul = formWith()
  soul.show()
  run(soul, ASSEMBLY_END + 1)
  soul.hide()
  run(soul, 0.5)
  soul.show()
  let lowest = 1
  for (let t = 0; t < ASSEMBLY_END; t += 0.05) lowest = Math.min(lowest, soul.tick(0.05, calm).presence)
  assert.equal(lowest, 1)
  assert.equal(soul.formed(), true)
})

test('fresh from the dust it takes his mood as it is, then turns as the mood changes', () => {
  const soul = formWith()
  const u = soul.points.material.uniforms
  const irritated = new FakeMindOutput({ dominant: 'irritation', mood: { irritation: 0.8 } })
  soul.show()
  run(soul, 0.1, irritated)
  assert.deepEqual([u.uMixWas.value, u.uMix.value], [allOf('red'), allOf('red')])
  run(soul, 0.1, calm)
  assert.deepEqual([u.uMixWas.value, u.uMix.value], [allOf('red'), allOf('blue')])
})

test('a dream or a call makes it flare, and a sigh dims it', () => {
  const soul = formWith()
  const u = soul.points.material.uniforms
  soul.show()
  run(soul, 3)
  run(soul, 0.05, new FakeMindOutput({ channels: { 'eyes.boost': 0.5, glow: 0.8 } }))
  assert.equal(u.uFlare.value, 0.5)
  assert.ok(Math.abs(u.uDensity.value - 0.8) < 1e-9)
})

test('its motion swells while the currents carry it, and is still at rest and once formed', () => {
  assert.equal(motionOf('rest', -1), 0)
  assert.equal(motionOf('up', 4), 1)
  assert.equal(motionOf('up', ASSEMBLY_END + 1), 0)
  assert.ok(motionOf('down', 3) > 0.7)
})

test('with no emotion high he sleeps blue and slow, and his resting vanity shows no white', () => {
  const { neutral } = SOUL_MOODS
  assert.deepEqual(soulLookOf(calm), { mix: { blue: 1 }, energy: neutral.energy, pace: neutral.pace, glow: 1, boost: 0 })
  assert.deepEqual(soulLookOf(new FakeMindOutput({ mood: { vanity: 0.35 } })).mix, { blue: 1 })
})

test('a rising emotion shows in tongues before it stands out, leads once it does, and fills the fire when strong', () => {
  const red = (v) => soulLookOf(new FakeMindOutput({ mood: { irritation: v } })).mix.red ?? 0
  assert.equal(red(SHOWS.from), 0)
  assert.ok(red(0.2) > 0.1 && red(0.2) < 0.35, `${red(0.2)}`)
  assert.ok(red(0.36) > 0.5, `${red(0.36)}`)
  assert.equal(red(0.7), 1)
})

test('emotions high together share the fire by how strong they are', () => {
  const shares = soulSharesOf({ irritation: 0.6, boredom: 0.45 })
  assert.deepEqual(Object.keys(shares).sort(), ['boredom', 'irritation'])
  assert.ok(Math.abs(shares.irritation / shares.boredom - 0.6 / 0.45) < 1e-9)
  const look = soulLookOf(new FakeMindOutput({ mood: { irritation: 0.6, boredom: 0.45 } }))
  assert.deepEqual(look.mix, { red: shares.irritation, purple: shares.boredom })
})

test('a strong emotion shows more of its own look, and mixed ones blend theirs by share', () => {
  const { neutral, irritation, boredom } = SOUL_MOODS
  const at = (mood) => soulLookOf(new FakeMindOutput({ mood }))
  assert.equal(at({ irritation: 1 }).energy, irritation.energy)
  assert.equal(at({ irritation: 1 }).pace, irritation.pace)
  const half = (look) => neutral.pace + (look.pace - neutral.pace) * (0.5 + 0.5 * (0.6 - 0.35) / 0.65)
  const shares = soulSharesOf({ irritation: 0.6, boredom: 0.6 })
  assert.ok(Math.abs(at({ irritation: 0.6, boredom: 0.6 }).pace - (shares.irritation * half(irritation) + shares.boredom * half(boredom))) < 1e-9)
})

test('an emotion it has no look for shows as neutral', () => {
  assert.deepEqual(soulLookOf(new FakeMindOutput({ dominant: 'awe', mood: { awe: 0.9 } })).mix, { blue: 1 })
})

test('every look names a palette there is', () => {
  for (const look of Object.values(SOUL_MOODS)) assert.ok(SOUL_PALETTES[look.palette], look.palette)
})

test('mixed emotions reach the shader as a mix, and a small drift does not turn the fire', () => {
  const soul = formWith()
  const u = soul.points.material.uniforms
  const mixed = (irritation) => new FakeMindOutput({ mood: { irritation, boredom: 0.45 } })
  soul.show()
  run(soul, 0.1, mixed(0.6))
  const shares = soulSharesOf(mixed(0.6).mood)
  assert.deepEqual(u.uMix.value, SOUL_PALETTE_NAMES.map((name) => ({ red: shares.irritation, purple: shares.boredom })[name] ?? 0))
  run(soul, 0.1, mixed(0.62))
  assert.deepEqual(u.uMixWas.value, u.uMix.value)
  run(soul, 0.1, mixed(0.9))
  assert.notDeepEqual(u.uMixWas.value, u.uMix.value)
})
