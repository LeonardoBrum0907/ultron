// <soul-avatar>: the soul as a web component, for any page or framework. It fills its
// own box (240x320 unless styled), on a see-through background, and follows its
// attributes:
//   state="calm"        one of its states (avatar-states.js, or its own: el.states = {...})
//   quality="lite"      fewer particles, for small or many avatars (default full)
//   interactive         the cursor pushes its particles aside
// and, from script, el.level = 0..1 (a voice, say) and el.flare().

import { createSoulAvatar } from './avatar.js'
import { AVATAR_STATES, stateOf } from './avatar-states.js'

const STYLE = `
  :host { display: inline-block; position: relative; width: 240px; height: 320px; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
`
const MAX_DPR = 2

/** The <soul-avatar> element. Register it with defineSoulAvatar(). */
export class SoulAvatarElement extends HTMLElement {
  static observedAttributes = ['state', 'quality', 'interactive']
  #canvas
  #avatar = null
  #states = AVATAR_STATES
  #level = 0
  #unwatch = []

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${STYLE}</style><canvas part="canvas"></canvas>`
    this.#canvas = root.querySelector('canvas')
  }

  connectedCallback() {
    this.#mount()
  }

  disconnectedCallback() {
    this.#unmount()
  }

  attributeChangedCallback(name, was, now) {
    if (!this.#avatar || was === now) return
    if (name === 'state') this.#tryState(now)
    else this.#remount() // the particles or the cursor change: start it again
  }

  /** @type {string} */
  get state() {
    return this.getAttribute('state') ?? 'calm'
  }
  set state(name) {
    this.setAttribute('state', name)
  }

  /** @type {Record<string, import('./avatar-states.js').AvatarState>} its own states, replacing the built-in ones */
  get states() {
    return this.#states
  }
  set states(map) {
    Object.keys(map).forEach((name) => stateOf(name, map))
    this.#states = map
    if (this.#avatar) this.#remount()
  }

  /** @type {number} 0..1, lifts the fire while it lasts */
  get level() {
    return this.#level
  }
  set level(value) {
    this.#level = Number(value) || 0
    this.#avatar?.setLevel(this.#level)
  }

  /** @type {number} how many particles it draws (0 until it is on a page) */
  get particles() {
    return this.#avatar?.particles ?? 0
  }

  /** The fire flares up for a moment. */
  flare() {
    this.#avatar?.flare()
  }

  #mount() {
    const quality = this.getAttribute('quality') ?? 'full'
    this.#avatar = createSoulAvatar({ canvas: this.#canvas, quality, states: this.#states, state: this.#firstState() })
    this.#avatar.setLevel(this.#level)
    this.#unwatch = [watchSize(this, this.#avatar), watchVisible(this, this.#avatar)]
    if (this.hasAttribute('interactive')) this.#unwatch.push(watchCursor(this, this.#avatar))
  }

  #unmount() {
    this.#unwatch.forEach((stop) => stop())
    this.#unwatch = []
    this.#avatar?.dispose()
    this.#avatar = null
  }

  #remount() {
    this.#unmount()
    this.#mount()
  }

  // The state it was given, or its first one if that is not one of its states.
  #firstState() {
    if (this.#states[this.state]) return this.state
    console.warn(`soul-avatar: unknown state "${this.state}", expected one of ${Object.keys(this.#states).join(', ')}`)
    return Object.keys(this.#states)[0]
  }

  #tryState(name) {
    try {
      this.#avatar.setState(name)
    } catch (err) {
      console.warn(`soul-avatar: ${err.message}`)
    }
  }
}

/**
 * Registers <soul-avatar> (once; again is a no-op).
 * @param {string} [tag] another name for it, if soul-avatar is taken
 * @example defineSoulAvatar(); document.body.append(Object.assign(document.createElement('soul-avatar'), { state: 'angry' }))
 */
export function defineSoulAvatar(tag = 'soul-avatar') {
  if (!customElements.get(tag)) customElements.define(tag, class extends SoulAvatarElement {})
}

function watchSize(el, avatar) {
  const fit = () => avatar.resize(el.clientWidth || 1, el.clientHeight || 1, Math.min(window.devicePixelRatio || 1, MAX_DPR))
  const observer = new ResizeObserver(fit)
  observer.observe(el)
  fit()
  return () => observer.disconnect()
}

// It only draws while some of it is on screen.
function watchVisible(el, avatar) {
  const observer = new IntersectionObserver(([entry]) => (entry.isIntersecting ? avatar.start() : avatar.stop()))
  observer.observe(el)
  return () => observer.disconnect()
}

function watchCursor(el, avatar) {
  const move = (e) => {
    const box = el.getBoundingClientRect()
    avatar.pointer(e.clientX - box.left, e.clientY - box.top)
  }
  window.addEventListener('pointermove', move)
  return () => window.removeEventListener('pointermove', move)
}
