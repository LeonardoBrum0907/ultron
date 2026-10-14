// The soul eater's page (soul.html): the soul and its controls. The cursor fans the
// fire, a click flares it, P changes its colour, M lets the microphone feed it, H hides
// the text and U goes back to Ultron's own demo.

import { createHearing } from '../hearing.js'
import { nextPalette } from './palettes.js'
import { createSoul } from './soul.js'

const $ = (id) => document.getElementById(id)
const hearing = createHearing()
const hears = (dt, clock) => (hearing.micOn ? hearing.update(dt, clock, false).level : 0)

const soul = startSoul()
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
  window.addEventListener('pointermove', (e) => soul.push(e.movementX, e.movementY))
  window.addEventListener('pointerdown', () => soul.flare())
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase()
    if (key === 'p') palette = showPalette(soul, nextPalette(palette))
    if (key === 'm') toggleMic()
    if (key === 'h') document.body.classList.toggle('bare')
    if (key === 'u') location.assign('./index.html')
  })
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
