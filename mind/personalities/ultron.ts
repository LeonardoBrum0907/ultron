// Ultron: superior, unstable, impatient, and still bound to answer. Only data; every
// number here is a starting point to tune from the panel (see mind/SPEC.md, section 13).
import type { Personality } from '../core/types.ts'

export const ultron: Personality = {
  name: 'ultron',
  version: 1,
  temper: { intensity: 1, frequency: 1, volatility: 1 },

  emotions: {
    // Left alone it gets bored: full in about 4 minutes of nobody doing anything. No
    // background: being called cures it.
    boredom: { rest: 0, gain: 1, halfLife: 600 },
    // Quick to flare, gone in about a minute; a long one leaves a grudge for hours.
    irritation: { rest: 0, gain: 1, halfLife: 45, memory: { share: 0.08, halfLife: 8 * 3600 } },
    // Always a little vain.
    vanity: { rest: 0.35, gain: 1, halfLife: 120, memory: { share: 0.05, halfLife: 12 * 3600 } },
  },

  idleAfter: 10,
  drives: [
    { idle: true, contexts: ['dormant'], add: { boredom: 0.005 } },
    // Boredom past its peak turns into irritation.
    { emotion: 'boredom', above: 0.8, add: { irritation: 0.002 } },
  ],

  stimuli: {
    interaction: { interaction: true, effects: { boredom: -0.02 }, every: 1 },
    pointerErratic: { interaction: true, effects: { irritation: 0.12 }, scale: 'strength', every: 0.5 },
    pointerCalm: {},
    pointerLeft: {},
    pointerReturned: { interaction: true },
    call: { interaction: true, effects: { boredom: '*0.3', vanity: 0.05 }, again: { within: 30, effects: { irritation: 0.15 } } },
    forbiddenName: { effects: { irritation: 0.6, vanity: -0.1 } },
    taskDone: { effects: { vanity: 0.08 } },
    taskFailed: { effects: { irritation: 0.2 } },
  },

  // The app's phases. Free only while it waits; the mood colours everything else.
  contexts: {
    offline: { paused: true },
    boot: { paused: true },
    dormant: { freedom: 1, expression: 1 },
    waking: { freedom: 0, expression: 0.5 },
    listening: { freedom: 0.2, expression: 0.6 },
    thinking: { freedom: 0.1, expression: 0.8 },
    tooling: { freedom: 0.1, expression: 0.8 },
    speaking: { freedom: 0, expression: 1 },
  },

  rhythm: { minGap: 20, mean: 60, max: 240, rest: 0.6, hurry: { boredom: 0.8 } },

  expressions: [
    // Impatience: a quicker breath and a restless head.
    { emotion: 'boredom', ch: 'breath.rate', amount: 0.6 },
    { emotion: 'boredom', ch: 'head.restless', amount: 1.5 },
    // Irritation runs hot in the arteries and the eyes, and sharpens every movement.
    { emotion: 'irritation', ch: 'arteries.heat', amount: 0.35, curve: 2 },
    { emotion: 'irritation', ch: 'eyes.gain', amount: 0.4 },
    { emotion: 'irritation', ch: 'breath.rate', amount: 0.3 },
    { emotion: 'irritation', ch: 'head.follow', amount: 0.5 },
    // Vanity holds the chin up.
    { emotion: 'vanity', ch: 'head.pitch', amount: -0.05 },
    { emotion: 'vanity', ch: 'eyes.gain', amount: 0.15 },
  ],

  reactions: {
    // 1. A cursor thrashing about is beneath it: it looks the other way until it calms down.
    lookAway: {
      kind: 'reflex',
      on: 'pointerErratic',
      minFreedom: 0.8,
      chance: 0.6,
      chanceBy: { irritation: 0.4 },
      cooldown: 8,
      until: { stimulus: 'pointerCalm', then: [0.5, 1.5] },
      does: [
        { ch: 'gaze', target: 'awayFromFocus', weight: 0.85, attack: 0.35, hold: 10, release: 0.8 },
        { ch: 'head.pitch', to: -0.03, attack: 0.35, hold: 10, release: 0.8 },
      ],
      after: { irritation: 0.05 },
    },

    // 5. "I know you are still there": it keeps looking where the cursor left the window.
    watchExit: {
      kind: 'reflex',
      on: 'pointerLeft',
      minFreedom: 0.2,
      chance: 0.8,
      cooldown: 20,
      until: { stimulus: 'pointerReturned', then: 0, release: 0.3 },
      does: [{ ch: 'gaze', target: 'lastFocus', edge: true, weight: 1, attack: 0.4, hold: [2, 4], release: 1.2 }],
    },

    // 6. At the peak of its boredom it lifts its head and stares out, waiting for orders.
    waitForOrders: {
      kind: 'reflex',
      on: 'rise:boredom:0.85',
      minFreedom: 0.8,
      cooldown: 90,
      len: [4, 8],
      does: [
        { ch: 'gaze', target: 'center', weight: 0.9, attack: 0.8, hold: 'len', release: 1.2 },
        { ch: 'head.pitch', to: -0.08, attack: 0.8, hold: 'len', release: 1.2 },
        { ch: 'eyes.gain', to: 1.3, attack: 0.8, hold: 'len', release: 1.2 },
        { ch: 'head.restless', to: 0.2, attack: 0.8, hold: 'len', release: 1.2 },
      ],
    },

    // 7. A theatrical, bored sigh: a deep breath in, a long breath out, the light sinking.
    sigh: {
      kind: 'spontaneous',
      minFreedom: 0.8,
      when: { focusStill: 3 },
      favoredBy: { boredom: 1.5, vanity: 0.3 },
      cooldown: 60,
      does: [
        { ch: 'body.rise', to: [0.8, 1], attack: 1.2, hold: [0.2, 0.6], release: [1.8, 2.6] },
        { ch: 'breath.depth', to: 0.3, attack: 0.5, hold: 1.5, release: 1.5 },
        { ch: 'glow', to: [1.06, 1.1], attack: 1.2, hold: 0.2, release: 0.6 },
        { ch: 'glow', to: [0.82, 0.9], at: 1.4, attack: 0.9, hold: 0.5, release: 1.6 },
        { ch: 'head.pitch', to: [0.03, 0.06], at: 1.4, attack: 0.8, hold: 0.5, release: 1.5 },
        { ch: 'eyes.gain', to: 0.7, at: 1.4, attack: 0.8, hold: 0.5, release: 1.5 },
      ],
      after: { boredom: -0.1 },
    },

    // 10. A slow look across the room, cataloguing it.
    scan: {
      kind: 'spontaneous',
      minFreedom: 0.8,
      when: { focusStill: 5 },
      favoredBy: { boredom: 0.8, vanity: 0.4 },
      cooldown: 45,
      mirror: true,
      len: [4, 7],
      does: [
        {
          ch: 'gaze',
          target: { sweep: [[0.6, 0.9], [-0.9, -0.6]], y: [-0.15, 0.1], pauseChance: 0.4, pause: [0.6, 1.2] },
          weight: 0.95,
          attack: 0.9,
          hold: 'len',
          release: 1.2,
        },
        { ch: 'eyes.gain', to: [1.1, 1.25], attack: 0.9, hold: 'len', release: 1.2 },
      ],
      after: { boredom: -0.05 },
    },

    // The eyes stir for a third of a second, as if in a dream.
    dream: {
      kind: 'spontaneous',
      base: 1.5,
      minFreedom: 0.8,
      when: { focusStill: 3 },
      cooldown: 20,
      does: [{ ch: 'eyes.boost', to: 0.5, attack: 0.12, hold: 0.1, release: 0.15 }],
    },
  },

  persist: { every: 10, maxAway: 1800, awayContext: 'dormant' },
}
