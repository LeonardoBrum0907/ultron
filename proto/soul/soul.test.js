// The soul's CPU side, without a browser:  node --test proto/soul/soul.test.js
// (the shader itself is checked by eye, in soul.html; window.__soul.hold(s) freezes the summons).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextPalette, SOUL_PALETTES } from './palettes.js'
import { createAssembly } from './assembly.js'
import { DESTINATIONS, rollCurrents } from './currents.js'
import { ASSEMBLY_END, buildSwarm, CURRENTS, PART, routeOf, seededRandom, SOUL_BUDGET } from './swarm.js'
import { createTouch, TRAIL_N } from './touch.js'

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
  const parts = Array.from({ length: swarm.count }, (_, i) => swarm.meta[i * 4])
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

/** Each particle of a swarm as an object, for reading in tests. */
const particlesOf = (swarm) =>
  Array.from({ length: swarm.count }, (_, i) => ({
    part: swarm.meta[i * 4],
    current: swarm.meta[i * 4 + 2],
    lane: swarm.meta[i * 4 + 3],
    setOff: swarm.fly[i * 4],
    lands: swarm.fly[i * 4] + swarm.fly[i * 4 + 1],
  }))

test('the orb gathers first, the fire after it, the smoke last; the dust never leaves', () => {
  const ps = particlesOf(buildSwarm(SOUL_BUDGET, seededRandom(2)))
  const of = (name) => ps.filter((p) => p.part === PART[name])
  const first = (name) => Math.min(...of(name).map((p) => p.setOff))
  assert.ok(first('core') < first('flame') && first('flame') < first('smoke'))
  assert.ok(of('dust').every((p) => p.setOff > 1000))
  const flying = ps.filter((p) => p.part !== PART.dust)
  assert.ok(flying.every((p) => p.lands <= ASSEMBLY_END + 1e-4), 'all land by ASSEMBLY_END')
})

test('the five currents carry about as many particles each, lanes in [0, 1)', () => {
  const ps = particlesOf(buildSwarm({ ...SOUL_BUDGET, dust: 0 }, seededRandom(3)))
  const per = Array.from({ length: CURRENTS }, (_, k) => ps.filter((p) => p.current === k).length)
  assert.ok(Math.max(...per) / Math.min(...per) < 1.3, `per current: ${per}`)
  assert.ok(ps.every((p) => p.lane >= 0 && p.lane < 1))
})

test('the flames go by where they are born: left, top, right', () => {
  const rand = seededRandom(4)
  assert.deepEqual(routeOf('flame', [0, 0.1, 0, 0], rand)[0], 1)
  assert.deepEqual(routeOf('flame', [0, 0.5, 0, 0], rand)[0], 2)
  assert.deepEqual(routeOf('flame', [0, 0.95, 0, 0], rand)[0], 3)
})

const CLOUD = { cx: 0, cy: 3, R: 13, reach: 22 }

test('every current gathers from the dust and delivers to its part of the soul', () => {
  const { wedges, ends, mids } = rollCurrents(seededRandom(5), CLOUD)
  assert.equal(wedges.length, CURRENTS)
  assert.equal(mids.length, CURRENTS)
  ends.forEach((e, k) => {
    assert.ok(Math.abs(Math.hypot(e[0] - CLOUD.cx, (e[1] - CLOUD.cy) / 0.85) - 0.52 * CLOUD.R) < 1e-9, `current ${k} gathers on the ring`)
    assert.deepEqual(e.slice(2), DESTINATIONS[k])
  })
})

test('the wedges tile the cloud, and a seed always draws the same currents', () => {
  const a = rollCurrents(seededRandom(6), CLOUD)
  assert.deepEqual(a, rollCurrents(seededRandom(6), CLOUD))
  const slot = (Math.PI * 2) / CURRENTS
  const steps = a.wedges.map((w) => Math.round((w - a.wedges[0]) / slot))
  assert.deepEqual(new Set(steps.map((n) => ((n % CURRENTS) + CURRENTS) % CURRENTS)).size, CURRENTS)
})

test('one to three currents sweep out of the window', () => {
  for (let seed = 0; seed < 20; seed++) {
    const { mids } = rollCurrents(seededRandom(seed), CLOUD)
    const out = mids.filter((m) => Math.hypot(m[0] - CLOUD.cx, m[1] - CLOUD.cy) > CLOUD.R).length
    assert.ok(out >= 1 && out <= 3, `seed ${seed}: ${out} out`)
  }
})

test('summoned, it counts up; dissolving, it runs back faster, then rests in the dust', () => {
  const a = createAssembly(5)
  assert.equal(a.tick(0.1, 0).asm, -1)
  a.summon(10)
  const up = a.tick(0.5, 10.5)
  assert.deepEqual([a.mode, up.asm, up.bootAt, up.live], ['up', 0.5, 10, 0])
  a.dissolve()
  const down = a.tick(0.1, 10.6)
  assert.equal(a.mode, 'down')
  assert.ok(down.asm < 0.5 - 0.1 && down.live === 1)
  a.tick(1, 11.6)
  assert.equal(a.mode, 'rest')
})

test('it tells once when the last particle lands', () => {
  const a = createAssembly(1)
  a.summon(0)
  const landed = [0.6, 0.6, 0.6].map((dt, i) => a.tick(dt, i).landed)
  assert.deepEqual(landed, [false, true, false])
})

test('a dissolve runs back from the end of the assembly, however long it has been formed', () => {
  const a = createAssembly(2)
  a.summon(0)
  a.tick(60, 60)
  a.dissolve()
  assert.ok(a.tick(0.01, 60).asm <= 2)
})

test('summoned while it dissolves, or replayed, it comes back as soon as it rests', () => {
  const a = createAssembly(1)
  a.summon(0)
  a.tick(2, 2)
  a.replay(2)
  assert.equal(a.mode, 'down')
  a.tick(5, 7)
  assert.equal(a.mode, 'up')
  assert.equal(a.tick(0.1, 7.1).bootAt, 7)
})

test('the fire clock runs faster while it flares', () => {
  const a = createAssembly(1)
  a.summon(0)
  assert.equal(a.tick(1, 1, 1.5).fire, 1.5)
})

class FakeUniforms {
  constructor() {
    const v4 = () => ({ set(x, y, z, w) { Object.assign(this, { x, y, z, w }) } })
    this.uTrail = { value: Array.from({ length: TRAIL_N }, v4) }
    this.uWind = { value: { set(x, y) { Object.assign(this, { x, y }) } } }
  }
}

test('the cursor leaves a trail in world units, newest first, and a gust the way it went', () => {
  const view = { pxPerUnit: 100, vw: 1000, vh: 800 }
  const touch = createTouch(view, 3)
  const u = new FakeUniforms()
  touch.move(500, 400)
  touch.tick(0.1, u)
  touch.move(600, 400)
  touch.tick(0.1, u)
  const [now] = u.uTrail.value
  assert.deepEqual([now.x, now.y], [1, 3])
  assert.ok(now.z > 0 && Math.abs(now.w) < 1e-9, 'moving right')
  assert.ok(u.uWind.value.x > 0)
})
