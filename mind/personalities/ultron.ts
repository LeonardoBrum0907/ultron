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
    // Called and then kept waiting in silence: it grows impatient.
    { quiet: { stimulus: 'voice', for: 6 }, contexts: ['listening'], add: { irritation: 0.025 } },
  ],

  stimuli: {
    interaction: { interaction: true, effects: { boredom: -0.02 }, every: 1 },
    pointerErratic: { interaction: true, effects: { irritation: 0.12 }, scale: 'strength', every: 0.5 },
    pointerCalm: {},
    pointerLeft: {},
    pointerReturned: { interaction: true },
    // The user speaking (the host sends it on each syllable while it listens).
    voice: { interaction: true, effects: { boredom: -0.03 }, every: 0.25 },
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

    // 8. Instability: the eyes stutter, then a part of the body crumbles to dust and is
    // yanked back into place, the arteries flaring with the effort.
    crumble: {
      kind: 'spontaneous',
      minFreedom: 0.8,
      requires: { irritation: [0.3, 1] },
      favoredBy: { irritation: 2 },
      cooldown: 180,
      len: [0.6, 1.2],
      warn: { for: [0.3, 0.6], does: [{ ch: 'eyes.flicker', to: 0.7, attack: 0.05, hold: 0.35, release: 0.1 }] },
      does: [
        { ch: 'crumble:*', pick: ['shoulderL', 'shoulderR', 'chestL', 'chestR', 'collarL', 'collarR'], to: [0.5, 0.9], attack: 0.15, hold: 'len', release: 0.35 },
        { ch: 'eyes.flicker', to: 0.5, attack: 0.1, hold: 'len', release: 0.2 },
        { ch: 'arteries.heat', to: 0.4, attack: 0.15, hold: 'len', release: 0.8 },
      ],
      after: { irritation: -0.2 },
    },

    // 9. Self-improvement: a plate lifts off, turns, and seats itself again, a little
    // better than before.
    selfImprove: {
      kind: 'spontaneous',
      minFreedom: 0.8,
      requires: { irritation: [0, 0.4] },
      favoredBy: { vanity: 1.5 },
      cooldown: 150,
      does: [
        {
          ch: 'rebuild:*',
          pick: ['shoulderL', 'shoulderR', 'chestL', 'chestR', 'collarL', 'collarR', 'abdomen'],
          to: 1,
          attack: [0.5, 0.8],
          hold: [0.3, 0.7],
          release: [0.6, 1],
        },
        { ch: 'eyes.gain', to: 1.15, attack: 0.5, hold: 0.5, release: 1 },
      ],
      after: { vanity: 0.1 },
    },

    // Listening and you say nothing: "well?" The chin goes up and the eyes blink twice, dry.
    impatient: {
      kind: 'reflex',
      on: 'quiet:voice:6',
      contexts: ['listening'],
      cooldown: 5,
      does: [
        { ch: 'head.pitch', to: [-0.06, -0.04], attack: 0.25, hold: [1.2, 1.8], release: 0.8 },
        { ch: 'eyes.gain', to: 0.1, attack: 0.04, hold: 0.07, release: 0.08 },
        { ch: 'eyes.gain', to: 0.1, at: 0.32, attack: 0.04, hold: 0.07, release: 0.08 },
        { ch: 'arteries.heat', to: 0.2, attack: 0.2, hold: 0.8, release: 0.8 },
      ],
    },

    // Still nothing: it looks away with a scornful breath, and back at you.
    scorn: {
      kind: 'reflex',
      on: 'quiet:voice:16',
      contexts: ['listening'],
      cooldown: 10,
      does: [
        { ch: 'gaze', target: 'awayFromFocus', weight: 0.7, attack: 0.5, hold: [1, 1.6], release: 0.9 },
        { ch: 'body.rise', to: [0.5, 0.7], attack: 0.6, hold: 0.1, release: 1.4 },
        { ch: 'glow', to: 0.85, at: 0.6, attack: 0.6, hold: 0.3, release: 1 },
      ],
      after: { irritation: 0.1 },
    },

    // A task done: pleased with itself, chin up, a flash in the eyes.
    pleased: {
      kind: 'reflex',
      on: 'taskDone',
      cooldown: 2,
      does: [
        { ch: 'head.pitch', to: [-0.07, -0.05], attack: 0.3, hold: [0.8, 1.2], release: 0.9 },
        { ch: 'eyes.boost', to: 0.8, attack: 0.08, hold: 0.1, release: 0.5 },
        { ch: 'glow', to: 1.1, attack: 0.3, hold: 0.4, release: 0.8 },
      ],
    },

    // A task failed: the eyes stutter and a part of it crumbles for a moment, hot with anger.
    failed: {
      kind: 'reflex',
      on: 'taskFailed',
      cooldown: 2,
      does: [
        { ch: 'eyes.flicker', to: 0.7, attack: 0.04, hold: 0.4, release: 0.2 },
        { ch: 'crumble:*', pick: ['shoulderL', 'shoulderR', 'chestL', 'chestR', 'collarL', 'collarR'], to: [0.35, 0.5], at: 0.1, attack: 0.08, hold: 0.3, release: 0.3 },
        { ch: 'arteries.heat', to: 0.5, attack: 0.1, hold: 0.6, release: 1 },
      ],
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

  // A call is always answered; how depends on the mood. The 'arteries.surge' cue sends one
  // strong pulse up all four arteries (speed px/s, strength), and the eye flash is timed
  // to when it reaches the cheeks.
  answer: {
    on: 'call',
    ack: [
      { ch: 'eyes.boost', to: 0.35, attack: 0.05, hold: 0.08, release: 0.2 },
      { ch: 'eyes.flicker', to: 0.6, attack: 0.03, hold: 0.12, release: 0.15 },
    ],
    maxDelay: 2,
    sharpness: 5,
    preludes: {
      // Bored: a short sigh first.
      sigh: {
        requires: { boredom: [0.5, 1] },
        chance: 0,
        chanceBy: { boredom: 1 },
        for: [0.6, 1],
        does: [
          { ch: 'body.rise', to: [0.6, 0.8], attack: 0.3, hold: 0.1, release: 0.6 },
          { ch: 'glow', to: 0.85, at: 0.3, attack: 0.3, hold: 0.1, release: 0.5 },
        ],
      },
      // Irritated: it heard you (the eyes flicker) and makes you wait, perfectly still.
      ignore: {
        requires: { irritation: [0.4, 1] },
        for: 0.6,
        forBy: { irritation: 1 },
        does: [
          { ch: 'head.follow', to: 0.05, attack: 0.05, hold: 'len', release: 0.1 },
          { ch: 'arteries.heat', to: 0.25, attack: 0.3, hold: 'len', release: 0.3 },
        ],
      },
    },
    styles: {
      // Neutral: up at once, the pulse runs up, the eyes flash as it arrives.
      eager: {
        base: 5,
        settle: 1.2,
        does: [
          { cue: 'arteries.surge', args: { speed: 1100, strength: 1 } },
          { ch: 'head.follow', to: 1.6, attack: 0.1, hold: 0.6, release: 0.5 },
          { ch: 'eyes.boost', to: 1.2, at: 0.4, attack: 0.06, hold: 0.08, release: 0.6 },
        ],
      },
      // Bored: slow to lift its head, the light and the eyes coming up gradually.
      weary: {
        favoredBy: { boredom: 1 },
        settle: 1.8,
        does: [
          { ch: 'head.follow', to: 0.35, attack: 0.1, hold: 1.4, release: 0.6 },
          { ch: 'glow', to: 0.75, attack: 0.05, hold: 0.2, release: 1.4 },
          { ch: 'eyes.gain', to: 0.4, attack: 0.05, hold: 0.2, release: 1.4 },
          { cue: 'arteries.surge', at: 0.3, args: { speed: 550, strength: 0.6 } },
        ],
      },
      // Irritated: a snap of the head toward you, hard eyes, the arteries running hot.
      curt: {
        favoredBy: { irritation: 1 },
        settle: 0.8,
        does: [
          { cue: 'arteries.surge', args: { speed: 1700, strength: 1.3 } },
          { ch: 'head.follow', to: 5, attack: 0.03, hold: 0.5, release: 0.6 },
          { ch: 'eyes.gain', to: 1.6, attack: 0.1, hold: 2.5, release: 1 },
          { ch: 'arteries.heat', to: 0.5, attack: 0.15, hold: 3, release: 1.5 },
        ],
      },
      // Vain: unhurried and majestic, chin up, the eyes lighting fully, as if granting an audience.
      regal: {
        favoredBy: { vanity: 1 },
        settle: 1.8,
        does: [
          { ch: 'head.follow', to: 0.5, attack: 0.1, hold: 1.4, release: 0.6 },
          { ch: 'head.pitch', to: -0.06, attack: 1, hold: 2.5, release: 1.5 },
          { ch: 'glow', to: 1.1, attack: 1, hold: 1, release: 1 },
          { ch: 'eyes.boost', to: 0.9, at: 0.5, attack: 0.5, hold: 0.4, release: 1 },
          { cue: 'arteries.surge', at: 0.2, args: { speed: 700, strength: 1.1 } },
        ],
      },
    },
  },

  persist: { every: 10, maxAway: 1800, awayContext: 'dormant' },
}
