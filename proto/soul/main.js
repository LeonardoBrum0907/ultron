// The soul eater's page (soul.html): the soul and its controls. It starts as dust: a click
// summons it, and once formed a click flares the fire. The cursor pushes aside the particles
// it passes, D dissolves it (or summons it), R dissolves and summons it again with new
// currents, P changes its colour, M lets the microphone feed it, H hides the text and U
// goes back to Ultron's own demo.

import { createHearing } from '../hearing.js'
import { nextPalette } from './palettes.js'
import { createSoul } from './soul.js'

const $ = (id) => document.getElementById(id)
const hearing = createHearing()
const hears = (dt, clock) => (hearing.micOn ? hearing.update(dt, clock, false).level : 0)

const soul = startSoul()
window.__soul = soul // dev: drive it from the console
if (soul) wireControls(soul)

function startSoul() {
  try {
    return createSoul({ canvas: $('gl'), hears })
  } catch (err) {
    $('err').style.display = 'grid'
    $('err').textContent = 'WebGL is unavailable in this browser.'
    console.error(err)
    return null
  }
}

function wireControls(soul) {
  let palette = 'blue'
  $('count').textContent = `${soul.particles.toLocaleString('en')} particles`
  showMode(soul)
  window.addEventListener('pointermove', (e) => soul.pointer(e.clientX, e.clientY))
  window.addEventListener('pointerdown', () => soul.click())
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase()
    if (key === 'd') (soul.mode() === 'up' ? soul.dissolve : soul.click)()
    if (key === 'r') soul.replay()
    if (key === 'p') palette = showPalette(soul, nextPalette(palette))
    if (key === 'm') toggleMic()
    if (key === 'h') document.body.classList.toggle('bare')
    if (key === 'u') location.assign('./index.html')
  })
}

// The status line follows what the soul is doing, and the summons hint shows only in the dust.
function showMode(soul) {
  const words = { rest: 'dust', up: 'summoned', down: 'dissolving' }
  $('mode').textContent = words[soul.mode()]
  $('summon').style.opacity = soul.mode() === 'rest' ? '' : '0'
  requestAnimationFrame(() => showMode(soul))
}

function showPalette(soul, name) {
  soul.setPalette(name)
  $('palette').textContent = name
  return name
}

async function toggleMic() {
  try {
    $('mic').textContent = (await hearing.toggleMic()) ? 'on' : 'off'
  } catch (err) {
    $('mic').textContent = 'blocked'
    console.warn('microphone:', err)
  }
}
