// The soul's stage, without a browser:  node --test proto/soul/stage.test.js

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frameSoul, makeSoulUniforms } from './stage.js'

test('frameSoul fits the frame to the box, as large as it allows, and leaves the renderer alone', () => {
  const uniforms = makeSoulUniforms()
  const view = { pxPerUnit: 1, vw: 1, vh: 1 }
  frameSoul(uniforms, view, { bottom: -3, top: 9, minWidth: 6.5 }, { width: 800, height: 600, dpr: 1.5 })
  assert.deepEqual(view, { pxPerUnit: 50, vw: 800, vh: 600 }) // 600 px over 12 units; the width has room
  assert.deepEqual(uniforms.uView.value.toArray(), [100 / 800, 100 / 600])
  assert.equal(uniforms.uYMid.value, 3)
  assert.equal(uniforms.uPx.value, 75)
})
