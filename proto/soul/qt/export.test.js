// The Qt avatar's generated header must match the soul's JavaScript:  node --test proto/soul/qt/export.test.js
// (if this fails, run npm run export:qt and commit the header).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { desktopGlsl, HEADER_PATH, soulHeader } from './export.mjs'

test('soul_generated.h is up to date with the JavaScript', () => {
  assert.equal(readFileSync(HEADER_PATH, 'utf8'), soulHeader(), 'run npm run export:qt')
})

test('the shaders become desktop GLSL 3.30: in/out for attribute/varying, a named fragment output', () => {
  const vertex = desktopGlsl('attribute vec4 aRand; // four numbers\nvarying vec3 vColor;\n\nvoid main() {}', 'vertex')
  assert.equal(vertex, '#version 330 core\nin vec4 aRand;\nout vec3 vColor;\nvoid main() {}\n')
  const fragment = desktopGlsl('varying vec3 vColor;\nvoid main() { gl_FragColor = vec4(vColor, 1.0); }', 'fragment')
  assert.equal(fragment, '#version 330 core\nout vec4 soulFragColor;\nin vec3 vColor;\nvoid main() { soulFragColor = vec4(vColor, 1.0); }\n')
})
