// What the figure hears: the real microphone (M turns it on), or, while it is off, a
// voice made up of phrases and pauses so the listening state can be seen without one.
// Each frame update() says how loud the voice is (0..1), whether a syllable just began and
// how loud it has got, whether someone is talking, and whether a phrase just ended.

const clamp01 = (v) => Math.max(0, Math.min(1, v))

/**
 * @param {object} [opts] the made-up voice: phrase [min, max] s, pause [min, max] s, the share
 *   of pauses that run long (8-11 s), syllables a second [min, max] and how loud a phrase is
 *   [min, max]; and gap, the silence (s) that ends a phrase. The defaults are someone talking
 *   to it; the figure's own speech (see speak) talks on, with short breaths between phrases,
 *   in the tone it answered in (setVoice).
 */
export function createHearing(opts = {}) {
  const voice = { phrase: [1, 3.5], pause: [1.5, 4], long: 0.25, rate: [4, 6], amp: [0.55, 0.95], gap: 0.7, ...opts }
  const within = ([a, b]) => a + Math.random() * (b - a)
  let mic = null // { ctx, stream, analyser, buf }
  let floor = null // dBFS: the room's own noise, followed slowly (from the first reading)
  let env = 0
  let armed = true
  let peak = 0
  let lastOnset = -1e9
  let lastVoice = -1e9
  let phraseAt = null // when the present phrase began
  let sim = null

  async function startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    ctx.createMediaStreamSource(stream).connect(analyser)
    mic = { ctx, stream, analyser, buf: new Float32Array(analyser.fftSize) }
    floor = null
  }

  function stopMic() {
    if (!mic) return
    for (const tr of mic.stream.getTracks()) tr.stop()
    void mic.ctx.close()
    mic = null
  }

  /** Loudness off the microphone, 0..1 above the room's noise. */
  function micLevel(dt) {
    mic.analyser.getFloatTimeDomainData(mic.buf)
    let sum = 0
    for (const v of mic.buf) sum += v * v
    const db = 10 * Math.log10(sum / mic.buf.length + 1e-12)
    // The floor starts at the first reading, drops at once to anything quieter and creeps
    // up over ~30 s, so speech never becomes the floor but a noisier room does.
    floor ??= db
    floor += (db - floor) * Math.min(1, dt * (db < floor ? 6 : 0.035))
    floor = Math.max(-80, floor)
    return clamp01((db - floor - 8) / 26)
  }

  /** A made-up voice: phrases (by default 1-3.5 s) at 4-6 syllables a second, pauses (1.5-4 s, a quarter of them 8-11). */
  function simLevel(clock) {
    if (!sim) sim = { talking: false, until: clock + Math.min(1.2, voice.pause[1]) }
    if (clock > sim.until) {
      sim.talking = !sim.talking
      if (sim.talking) {
        sim.until = clock + within(voice.phrase)
        sim.rate = within(voice.rate)
        sim.amp = within(voice.amp)
        sim.start = clock
        sim.syl = -1
      } else sim.until = clock + (Math.random() < voice.long ? 8 + Math.random() * 3 : within(voice.pause))
    }
    if (!sim.talking) return 0
    const x = (clock - sim.start) * sim.rate
    const n = Math.floor(x)
    if (n !== sim.syl) {
      sim.syl = n
      sim.sylAmp = Math.random() < 0.15 ? 0 : sim.amp * (0.55 + Math.random() * 0.45)
    }
    return sim.sylAmp * Math.pow(Math.sin(Math.PI * (x - n)), 2)
  }

  return {
    get micOn() {
      return !!mic
    },
    /** Turn the microphone on or off; resolves to whether it is on. */
    async toggleMic() {
      if (mic) stopMic()
      else await startMic()
      return !!mic
    },
    /** Start the made-up voice afresh (on entering listening). */
    resetSim() {
      sim = null
    },
    /** Change the made-up voice (any of the options), from its next phrase on. */
    setVoice(v) {
      Object.assign(voice, v)
    },

    /**
     * @param {number} dt seconds since the last frame
     * @param {number} clock seconds
     * @param {boolean} simulate use the made-up voice while the microphone is off
     */
    update(dt, clock, simulate) {
      const raw = mic ? micLevel(dt) : simulate ? simLevel(clock) : 0
      // Fast up, a little slower down: one hump per syllable.
      env += (raw - env) * Math.min(1, dt * (raw > env ? 40 : 14))
      // A syllable: the voice climbs past a threshold, then must fall back off its peak
      // before the next one counts.
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
      const talking = clock - lastVoice < Math.min(0.35, voice.gap)
      // A phrase ends after a silence (gap: by default 0.7 s), if it lasted at least 0.3 s.
      let phraseEnd = false
      if (talking && phraseAt == null) phraseAt = clock
      if (!talking && phraseAt != null && clock - lastVoice > voice.gap) {
        phraseEnd = lastVoice - phraseAt > 0.3
        phraseAt = null
      }
      // syllable: how loud the present syllable has got so far (null between syllables).
      return { level: env, onset, syllable: armed ? null : peak, talking, phraseEnd }
    },
  }
}
