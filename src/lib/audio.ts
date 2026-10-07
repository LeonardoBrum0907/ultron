/**
 * A single shared microphone stream plus an analyser, so the reactor can pulse
 * with the user's voice. Opening the mic more than once causes Chrome to drop
 * the earlier stream, so everything that needs audio goes through here.
 */

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let buf: Uint8Array | null = null
let wave: Float32Array | null = null

const MIC_KEY = 'ultron.mic'

/**
 * Mic off: he hears nothing, not even his name, and the conversation happens
 * through the text box. Separate from his voice being off — typing to him and
 * hearing him answer aloud is a combination worth having. Kept across reloads.
 */
let micOn = (() => {
  try {
    return localStorage.getItem(MIC_KEY) !== '0'
  } catch {
    return true
  }
})()

export const isMicOn = () => micOn

export function setMicOn(on: boolean): void {
  micOn = on
  // The voice loop is stopped separately; this silences the shared stream so
  // the analyser and the figure stop reacting to the room as well.
  stream?.getAudioTracks().forEach((t) => (t.enabled = on))
  try {
    localStorage.setItem(MIC_KEY, on ? '1' : '0')
  } catch {
    // Private mode: off for this page only.
  }
}

export async function getMic(): Promise<MediaStream> {
  if (stream) return stream
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  stream.getAudioTracks().forEach((t) => (t.enabled = micOn))
  return stream
}

export async function startAnalyser(): Promise<void> {
  if (analyser) return
  const s = await getMic()
  ctx = new AudioContext()
  const src = ctx.createMediaStreamSource(s)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  src.connect(analyser)
  buf = new Uint8Array(analyser.frequencyBinCount)
  wave = new Float32Array(analyser.fftSize)
  // A second, longer window for the voice's pitch: 512 samples is shorter than one
  // period of a low voice. Unsmoothed, since prosody.ts reads raw waveform.
  voice = ctx.createAnalyser()
  voice.fftSize = 2048
  src.connect(voice)
  voiceWave = new Float32Array(voice.fftSize)
}

let voice: AnalyserNode | null = null
let voiceWave: Float32Array | null = null

/** The latest ~43 ms of microphone waveform and its sample rate, or null before the analyser is up. */
export function voiceFrame(): { samples: Float32Array; sampleRate: number } | null {
  if (!voice || !voiceWave || !ctx) return null
  voice.getFloatTimeDomainData(voiceWave as Float32Array<ArrayBuffer>)
  return { samples: voiceWave, sampleRate: ctx.sampleRate }
}

/** The microphone's loudness in dBFS, or null before the analyser is up. */
export function micDb(): number | null {
  if (!analyser || !wave) return null
  analyser.getFloatTimeDomainData(wave as Float32Array<ArrayBuffer>)
  let sum = 0
  for (const v of wave) sum += v * v
  return 10 * Math.log10(sum / wave.length + 1e-12)
}

/** 0..1 loudness. Returns 0 before the analyser is up. */
export function micLevel(): number {
  if (!analyser || !buf) return 0
  analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>)
  let sum = 0
  // Skip the lowest bins — they're mostly rumble and mains hum.
  for (let i = 4; i < buf.length; i++) sum += buf[i]
  const avg = sum / (buf.length - 4) / 255
  // Voice sits low in this range; stretch it so the visuals actually move.
  return Math.min(1, avg * 3.2)
}

/** Analyser fed from an <audio> element, so the orb reacts while ULTRON talks. */
export function attachOutputAnalyser(el: HTMLAudioElement): () => number {
  const c = new AudioContext()
  const src = c.createMediaElementSource(el)
  const a = c.createAnalyser()
  a.fftSize = 512
  a.smoothingTimeConstant = 0.7
  src.connect(a)
  a.connect(c.destination)
  const b = new Uint8Array(a.frequencyBinCount)
  return () => {
    a.getByteFrequencyData(b as Uint8Array<ArrayBuffer>)
    let sum = 0
    for (let i = 2; i < b.length; i++) sum += b[i]
    return Math.min(1, sum / (b.length - 2) / 255 * 3)
  }
}
