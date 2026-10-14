// The avatar's demo page (avatar.html): one big <soul-avatar> driven by buttons, a level
// slider and a flare, and a gallery of small ones that change state by themselves, the
// way a project would drive them from what it is doing.

import { AVATAR_STATES } from './avatar-states.js'
import { defineSoulAvatar } from './soul-avatar.js'

const $ = (id) => document.getElementById(id)
const STATE_NAMES = Object.keys(AVATAR_STATES)
const GALLERY = [
  { card: 'dark', state: 'calm' },
  { card: 'dark', state: 'angry' },
  { card: 'mid', state: 'thinking' },
  { card: 'mid', state: 'happy' },
  { card: 'light', state: 'calm' },
  { card: 'light', state: 'angry' },
]
const USAGE = `<script type="module" src="soul-avatar.js"></script>

<soul-avatar state="calm" interactive></soul-avatar>

<script type="module">
  const soul = document.querySelector('soul-avatar')
  soul.state = 'thinking'   // calm | thinking | angry | happy, or your own:
  soul.states = { idle: { palette: 'blue', energy: 0, pace: 1 }, busy: { palette: 'red', energy: 0.5, pace: 1.8 } }
  soul.level = 0.6          // 0..1, a voice or any signal
  soul.flare()
</script>`

defineSoulAvatar()
const main = $('main')
wireStates(main)
wireLevel(main)
wireQuality(main)
$('flare').addEventListener('click', () => main.flare())
fillGallery($('gallery'))
$('usage').textContent = USAGE
window.addEventListener('keydown', (e) => onKey(main, e.key.toLowerCase()))
window.__avatar = main // dev: drive it from the console

function wireStates(el) {
  for (const name of STATE_NAMES) {
    const button = Object.assign(document.createElement('button'), { textContent: name })
    button.addEventListener('click', () => showState(el, name))
    $('states').append(button)
  }
  showState(el, el.state)
}

function showState(el, name) {
  el.state = name
  $('state').textContent = name
  for (const button of $('states').children) button.classList.toggle('on', button.textContent === name)
}

function wireLevel(el) {
  $('level').addEventListener('input', (e) => {
    el.level = Number(e.target.value)
    $('levelValue').textContent = el.level.toFixed(2)
  })
}

function wireQuality(el) {
  const buttons = document.querySelectorAll('[data-quality]')
  const show = () => ($('count').textContent = `${el.particles.toLocaleString('en')} particles`)
  buttons.forEach((button) =>
    button.addEventListener('click', () => {
      el.setAttribute('quality', button.dataset.quality)
      buttons.forEach((b) => b.classList.toggle('on', b === button))
      show()
    }),
  )
  show()
}

// Each small one moves on to another state every few seconds, at its own moment.
function fillGallery(gallery) {
  GALLERY.forEach(({ card, state }, i) => {
    const box = Object.assign(document.createElement('div'), { className: `card ${card}` })
    const el = Object.assign(document.createElement('soul-avatar'), { state })
    el.setAttribute('quality', 'lite')
    const label = Object.assign(document.createElement('div'), { textContent: state })
    box.append(el, label)
    gallery.append(box)
    setInterval(() => (label.textContent = el.state = nextState(el.state)), 5000 + i * 900)
  })
}

const nextState = (name) => STATE_NAMES[(STATE_NAMES.indexOf(name) + 1) % STATE_NAMES.length]

function onKey(el, key) {
  const n = Number(key)
  if (n >= 1 && n <= STATE_NAMES.length) showState(el, STATE_NAMES[n - 1])
  if (key === 'f') el.flare()
  if (key === 's') location.assign('./soul.html')
  if (key === 'u') location.assign('./index.html')
}
