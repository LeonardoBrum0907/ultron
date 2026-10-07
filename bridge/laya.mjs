/**
 * Perception through a local Laya (github.com/LeonardoBrum0907/laya-setup).
 *
 * Laya only describes what was said: the speech act, how strong, whether it was
 * aimed at Ultron, whether it was sarcastic. What that does to his mood is the
 * personality's business (mind/personalities/ultron.ts), never Laya's, and the
 * mood is never sent to it.
 *
 * Returns null whenever Laya can't be trusted with this one: not running, slow,
 * malformed, or unsure. The app then falls back to its keyword rules.
 *
 *   ULTRON_LAYA_URL         default http://127.0.0.1:8000, 'off' to skip it
 *   ULTRON_LAYA_TIMEOUT_MS  default 4000 (a CPU answers in about 1.2 s)
 *   ULTRON_LAYA_MIN_CONF    default 0.6, below it the rules win
 *   LAYA_API_KEY            sent as a bearer token when set
 *   ULTRON_PERCEPTION_LOG   default logs/perception.jsonl, 'off' to keep nothing
 *
 * Each utterance is logged with its delivery (prosody) and what was read from
 * it, on this machine only: the raw material for labelling real speech later.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'

const URL_ = (process.env.ULTRON_LAYA_URL ?? 'http://127.0.0.1:8000').replace(/\/+$/, '')
const TIMEOUT_MS = Number(process.env.ULTRON_LAYA_TIMEOUT_MS ?? 4000)
const MIN_CONF = Number(process.env.ULTRON_LAYA_MIN_CONF ?? 0.6)
const API_KEY = process.env.LAYA_API_KEY || ''

const { questions } = JSON.parse(readFileSync(new URL('./laya-schema.json', import.meta.url), 'utf8'))

export const ACTS = new Set(Object.keys(questions.act_type.criteria))
export const layaEnabled = URL_ !== 'off'

/** Laya's answers onto the app's perception, or null if they don't hold up. */
export function fromAnswers(answers, minConfidence = MIN_CONF) {
  const act = answers?.act_type
  const intensity = answers?.intensity
  const directed = answers?.directed_at_ultron
  const sarcastic = answers?.is_sarcastic
  if (act?.type !== 'choice' || !ACTS.has(act.choice)) return null
  if (intensity?.type !== 'score' || directed?.type !== 'noul') return null
  const confidence = act.answer_confidence ?? act.confidence ?? 0
  if (!(confidence >= minConfidence)) return null
  const levels = Math.max(1, Object.keys(intensity.probabilities ?? intensity.legend ?? {}).length - 1)
  return {
    act: act.choice,
    intensity: Math.min(1, Math.max(0, Number(intensity.score) / levels)),
    directed: directed.noul >= 0.5,
    sarcastic: sarcastic?.type === 'noul' ? sarcastic.noul >= 0.5 : false,
    confidence,
    source: 'laya',
  }
}

/** One utterance in, a perception or null out. Never throws. */
export async function perceive(text) {
  if (!layaEnabled || typeof text !== 'string' || !text.trim()) return null
  const headers = { 'content-type': 'application/json' }
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`
  try {
    const res = await fetch(`${URL_}/v1/systemone`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        state: { transcript: text.slice(0, 2000), device: 'desktop', channel: 'voice' },
        questions,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    return fromAnswers((await res.json())?.answers)
  } catch {
    return null
  }
}

const LOG = process.env.ULTRON_PERCEPTION_LOG ?? 'logs/perception.jsonl'
const LOG_URL = LOG === 'off' ? null : new URL(`../${LOG}`, import.meta.url)
const PROSODY_KEYS = ['durationMs', 'rmsDb', 'peakDb', 'pitchHz', 'pitchRangeSt', 'voicedRatio', 'longestPauseMs', 'wordsPerSec']

/** Only the known numeric fields: this arrives over the socket like anything else. */
function cleanProsody(p) {
  if (!p || typeof p !== 'object') return null
  const out = {}
  for (const k of PROSODY_KEYS) out[k] = Number.isFinite(p[k]) ? p[k] : null
  return out
}

/** One line per utterance. Never throws: a full disk must not break a turn. */
export async function logPerception(text, prosody, perception) {
  if (!LOG_URL) return
  const line = JSON.stringify({
    at: new Date().toISOString(),
    transcript: String(text).slice(0, 2000),
    prosody: cleanProsody(prosody),
    perception,
  })
  try {
    await mkdir(new URL('.', LOG_URL), { recursive: true })
    await appendFile(LOG_URL, `${line}\n`, 'utf8')
  } catch {
    // nothing to do: the log is a convenience
  }
}
