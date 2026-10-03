// How one emotion moves. It has two parts. The value of the moment is what drives and
// stimuli move; it always settles back toward its rest. The background (mood) slowly
// follows how far the value sits above rest and fades over hours, and it adds on top:
// a grudge raises the floor, and today's flare comes on top of it. The background
// follows the value, never itself, so a steady push can not wind it up without end.
import type { Effect, EmotionConfig } from './types.ts'

export interface EmotionState {
  value: number
  mood: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const halve = (dt: number, halfLife: number) => (halfLife > 0 ? Math.pow(0.5, dt / halfLife) : 0)

/** Advance one emotion by dt seconds under a per-second push. */
export function stepEmotion(conf: EmotionConfig, st: EmotionState, dt: number, push: number) {
  st.value = clamp01(st.value + push * dt)
  st.value = clamp01(conf.rest + (st.value - conf.rest) * halve(dt, conf.halfLife))
  if (conf.memory) {
    st.mood += (conf.memory.share / 60) * Math.max(0, st.value - conf.rest - st.mood) * dt
    st.mood = clamp01(st.mood * halve(dt, conf.memory.halfLife))
  } else st.mood = 0
}

/** Time passing with nothing happening (used for the time away between sessions). */
export function fadeEmotion(conf: EmotionConfig, st: EmotionState, seconds: number) {
  if (conf.memory) st.mood *= halve(seconds, conf.memory.halfLife)
  st.value = clamp01(conf.rest + (st.value - conf.rest) * halve(seconds, conf.halfLife))
}

/** +x adds (scaled), '*x' multiplies the value of the moment. */
export function applyEffect(st: EmotionState, effect: Effect, scale: number) {
  if (typeof effect === 'number') st.value = clamp01(st.value + effect * scale)
  else st.value = clamp01(st.value * Number(effect.slice(1)))
}

/** What shows: the moment and the background together, at the emotion's volume. */
export const visible = (conf: EmotionConfig, st: EmotionState, intensity: number) => clamp01((st.value + st.mood) * conf.gain * intensity)
