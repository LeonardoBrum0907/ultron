// The soul's stage, without a browser:  node --test proto/soul/stage.test.js

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dustCloud, rollCurrents } from './currents.js'
import { frameSoul, makeSoulUniforms, setCurrents } from './stage.js'
import { CURRENTS, seededRandom } from './swarm.js'

test('frameSoul fits the frame to the box, as large as it allows, and leaves the renderer alone', () => {
  const uniforms = makeSoulUniforms()
  const view = { pxPerUnit: 1, vw: 1, vh: 1 }
  frameSoul(uniforms, view, { bottom: -3, top: 9, minWidth: 6.5 }, { width: 800, height: 600, dpr: 1.5 })
  assert.deepEqual(view, { pxPerUnit: 50, vw: 800, vh: 600 }) // 600 px over 12 units; the width has room
  assert.deepEqual(uniforms.uView.value.toArray(), [100 / 800, 100 / 600])
  assert.equal(uniforms.uYMid.value, 3)
  assert.equal(uniforms.uPx.value, 75)
})

test('the dust reaches past the window, round the middle of the frame', () => {
  const cloud = dustCloud({ pxPerUnit: 50, vw: 800, vh: 600 }, { bottom: -3, top: 9 })
  assert.deepEqual(cloud, { cx: 0, cy: 3, R: 12, reach: 20 }) // the window is 16 x 12 units
})

test('setCurrents hands the shader every current of a summons', () => {
  const uniforms = makeSoulUniforms()
  const currents = rollCurrents(seededRandom(3), { cx: 0, cy: 3, R: 13, reach: 22 })
  setCurrents(uniforms, currents)
  assert.equal(uniforms.uWedge.value, currents.wedges)
  for (let k = 0; k < CURRENTS; k++) {
    assert.deepEqual(uniforms.uCurEnds.value[k].toArray(), currents.ends[k])
    assert.deepEqual(uniforms.uCurMids.value[k].toArray(), currents.mids[k])
  }
})
