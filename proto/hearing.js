// What the figure hears: a source the host feeds it (the app's microphone, or its own voice),
// the real microphone (M turns it on), or, while neither is there, a voice made up of phrases
// and pauses so the listening state can be seen without one.
// Each frame update() says how loud the voice is (0..1), whether a syllable just began and
// how loud it has got, whether someone is talking, and whether a phrase just ended.

const clamp01 = (v) => Math.max(0, Math.min(1, v))

/**
 * @param {object} [opts] the made-up voice: phrase [min, max] s, pause [min, max] s, the share
 *   of pauses that run long (8-11 s), syllables a second [min, max] and how loud a phrase is
 *   [min, max]; and gap, the silence (s) that ends a phrase. The defaults are someone talking
 *   to it; the figure's own speech (see speak) talks on, with short breaths between phrases,
 *   in the tone it answered in (setVoice). source, when given, is read every frame: { db } a
 *   microphone's loudness in dBFS (read against the room's noise, as the page's own is),
 *   { level } a loudness already 0..1, or null for none (the page's microphone or the made-up
 *   voice then).
 */
export function createHearing({ source, ...opts } = {}) {
  const voice = { phrase: [1, 3.5], pause: [1.5, 4], long: 0.25, rate: [4, 6], amp: [0.55, 0.95], gap: 0.7, ...opts }
  const within = ([a, b]) => a + Math.random() * (b - a)
  let mic = null // { ctx, stream, analyser, buf }
  let floor = null // dBFS: the room's own noise, followed slowly (from the first reading)
  let env = 0
  let armed = true
  let peak = 0
  let lastOnset = -1e9
  let lastVoice = -1e9
  let inWord = false
  let wordPeak = 0
  let downSince = -1e9
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
    return aboveFloor(10 * Math.log10(sum / mic.buf.length + 1e-12), dt)
  }

  /** A reading in dBFS, 0..1 above the room's noise. */
  function aboveFloor(db, dt) {
    // The floor starts at the first reading, drops at once to anything quieter and creeps
    // up over ~30 s, so speech never becomes the floor but a noisier room does.
    floor ??= db
    floor += (db - floor) * Math.min(1, dt * (db < floor ? 6 : 0.035))
    floor = Math.max(-80, floor)
    return clamp01((db - floor - 8) / 26)
  }

  /**
   * A made-up voice: phrases (by default 1-3.5 s) of words of 1-3 syllables at 4-6 syllables a
   * second, a short break (0.1-0.18 s) between words, each word as loud as its stress (the voice
   * dipping between its syllables but not dying away), and
   * pauses (1.5-4 s, a quarter of them 8-11).
   */
  function simLevel(clock) {
    if (!sim) sim = { talking: false, until: clock + Math.min(1.2, voice.pause[1]) }
    if (clock > sim.until) {
      sim.talking = !sim.talking
      if (sim.talking) {
        sim.until = clock + within(voice.phrase)
        sim.rate = within(voice.rate)
        sim.amp = within(voice.amp)
        sim.cur = null
        sim.left = 0
      } else sim.until = clock + (Math.random() < voice.long ? 8 + Math.random() * 3 : within(voice.pause))
    }
    if (!sim.talking) return 0
    // The next piece: a break after a word's last syllable, otherwise a syllable (a new word
    // drawing how many it has and how loud it is).
    if (!sim.cur || clock > sim.cur.end) {
      const from = sim.cur ? sim.cur.end : clock
      if (sim.cur && sim.cur.syl && sim.left === 0) sim.cur = { syl: false, start: from, end: from + 0.1 + Math.random() * 0.08 }
      else {
        if (sim.left === 0) {
          sim.left = 1 + Math.floor(Math.random() * 3)
          sim.wordAmp = sim.amp * (0.55 + Math.random() * 0.45)
          sim.first = true
        } else sim.first = false
        sim.left--
        sim.cur = { syl: true, start: from, end: from + 1 / sim.rate, amp: sim.wordAmp * (0.8 + Math.random() * 0.2), first: sim.first, last: sim.left === 0 }
      }
    }
    const c = sim.cur
    if (!c.syl) return 0
    const x = (clock - c.start) / (c.end - c.start)
    const s = Math.pow(Math.sin(Math.PI * x), 2)
    // Inside a word the voice only dips to 45% between syllables; it rises from nothing at the
    // word's start and falls to nothing at its end.
    return c.amp * ((x < 0.5 && c.first) || (x >= 0.5 && c.last) ? s : 0.45 + 0.55 * s)
  }

  return {
    get micOn() {
      return !!mic
    },
    stopMic,
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
      const fed = source?.()
      const raw = fed?.db != null ? aboveFloor(fed.db, dt) : fed?.level != null ? clamp01(fed.level) : mic ? micLevel(dt) : simulate ? simLevel(clock) : 0
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
      // A word: syllables run together, and the voice drops away between words. It begins
      // with a syllable after the voice has been down (under 30% of the last word's peak)
      // for 0.04 s, and lasts until it is down that long again.
      let wordOnset = false
      if (env < Math.max(0.08, wordPeak * 0.3)) {
        if (clock - downSince > 0.04) inWord = false
      } else downSince = clock
      if (onset && !inWord) {
        inWord = true
        wordOnset = true
        wordPeak = env
      }
      if (inWord) wordPeak = Math.max(wordPeak, env)
      if (env > 0.12) lastVoice = clock
      const talking = clock - lastVoice < Math.min(0.35, voice.gap)
      // A phrase ends after a silence (gap: by default 0.7 s), if it lasted at least 0.3 s.
      let phraseEnd = false
      if (talking && phraseAt == null) phraseAt = clock
      if (!talking && phraseAt != null && clock - lastVoice > voice.gap) {
        phraseEnd = lastVoice - phraseAt > 0.3
        phraseAt = null
      }
      // syllable: how loud the present syllable has got so far (null between syllables); word:
      // the same for the present word (null between words).
      return { level: env, onset, syllable: armed ? null : peak, wordOnset, word: inWord ? wordPeak : null, talking, phraseEnd }
    },
  }
}
