/**
 * Syllables in a loudness signal.
 *
 * The same reading the particle prototype makes of its microphone
 * (proto/hearing.js), fed instead from the app's one shared stream: loudness
 * above the room's own noise, one hump per syllable, and the end of a phrase.
 * The mind wants a 'voice' stimulus per syllable while it listens, or it takes
 * the user for silent and grows impatient.
 */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export type Heard = {
  /** 0..1, how loud the voice is now. */
  level: number
  /** A syllable began this frame. */
  onset: boolean
  /** How loud the present syllable has got, null between syllables. */
  syllable: number | null
  talking: boolean
  /** A phrase of at least 0.3 s just ended. */
  phraseEnd: boolean
}

export function createSyllables() {
  let floor: number | null = null // dBFS of the room, followed slowly
  let env = 0
  let armed = true
  let peak = 0
  let lastOnset = -1e9
  let lastVoice = -1e9
  let phraseAt: number | null = null

  /** Loudness 0..1 above the room's noise, from a reading in dBFS. */
  function aboveFloor(db: number, dt: number) {
    // The floor starts at the first reading, drops at once to anything quieter and
    // creeps up over ~30 s, so speech never becomes the floor but a noisier room does.
    floor ??= db
    floor += (db - floor) * Math.min(1, dt * (db < floor ? 6 : 0.035))
    floor = Math.max(-80, floor)
    return clamp01((db - floor - 8) / 26)
  }

  return {
    /**
     * @param db the microphone's loudness this frame, in dBFS (null: no microphone)
     * @param dt seconds since the last frame
     * @param clock seconds
     */
    update(db: number | null, dt: number, clock: number): Heard {
      const raw = db == null ? 0 : aboveFloor(db, dt)
      // Fast up, a little slower down: one hump per syllable.
      env += (raw - env) * Math.min(1, dt * (raw > env ? 40 : 14))
      // A syllable: the voice climbs past a threshold, then must fall back off its
      // peak before the next one counts.
      let onset = false
      if (armed && env > 0.16 && clock - lastOnset > 0.09) {
        onset = true
        armed = false
        peak = env
        lastOnset = clock
      } else if (!armed) {
        peak = Math.max(peak, env)
        if (env < peak * 0.6 || env < 0.1) armed = true
      }
      if (env > 0.12) lastVoice = clock
      const talking = clock - lastVoice < 0.35
      // A phrase ends after 0.7 s without a voice, if it lasted at least 0.3 s.
      let phraseEnd = false
      if (talking && phraseAt == null) phraseAt = clock
      if (!talking && phraseAt != null && clock - lastVoice > 0.7) {
        phraseEnd = lastVoice - phraseAt > 0.3
        phraseAt = null
      }
      return { level: env, onset, syllable: armed ? null : peak, talking, phraseEnd }
    },
  }
}
