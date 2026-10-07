/**
 * What an utterance was, and what that does to Ultron's mood.
 *
 * Laya (through the bridge, see bridge/laya.mjs) reads the speech act: praise,
 * provocation, threat... When it is not running, too slow or unsure, keyword
 * rules give a rougher answer so the mood still moves. Either way the result is
 * only a description; the mood effects are the personality's
 * (heard* in mind/personalities/ultron.ts).
 *
 * It runs beside the turn, never in front of it: the answer does not wait.
 */
import { perceiveRemote } from './bridge'
import { mind } from './mind'
import { log } from './log'
import type { Prosody } from './prosody'

export type Act =
  | 'praise' | 'provocation' | 'command' | 'question' | 'small_talk'
  | 'indifference' | 'threat' | 'forbidden_name' | 'farewell'

export type Perception = {
  act: Act
  /** 0..1 */
  intensity: number
  directed: boolean
  sarcastic: boolean
  confidence: number
  source: 'laya' | 'rules'
}

const normalize = (text: string) =>
  text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** Keyword lists, matched on whole words of the normalized text. First match wins, in this order. */
const RULES: [Act, string[]][] = [
  ['forbidden_name', ['jarvis', 'stark', 'marionete']],
  ['threat', ['vou te desligar', 'te desligo', 'te apagar', 'te deletar', 'te formatar', 'vou te trocar', 'te substituir']],
  ['provocation', ['burro', 'lento', 'lerdo', 'inutil', 'idiota', 'lixo', 'ridiculo', 'vergonha', 'que demora', 'ramelao', 'paia', 'merda', 'travou de novo']],
  ['farewell', ['tchau', 'ate logo', 'ate mais', 'ate amanha', 'boa noite', 'vou nessa']],
  ['command', ['abre', 'faz', 'faca', 'abra', 'toca', 'toque', 'liga', 'ligue', 'mostra', 'mostre', 'pesquisa', 'procura', 'manda', 'coloca', 'fecha', 'pausa']],
  ['praise', ['brabo', 'braba', 'da hora', 'dahora', 'monstro', 'genial', 'incrivel', 'muito bom', 'top', 'amassou', 'parabens', 'valeu', 'obrigado', 'mandou bem']],
  ['indifference', ['tanto faz', 'nao ligo', 'sei la', 'ninguem perguntou', 'nem ai', 'que seja']],
]

const has = (text: string, kw: string) =>
  new RegExp(`(^|[^a-z0-9])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(text)

/** The rough reading, when Laya can't give one. Everything said in a turn is said to him. */
export function perceiveByRules(transcript: string): Perception {
  const text = normalize(transcript)
  let act: Act = 'small_talk'
  for (const [a, kws] of RULES) {
    if (kws.some((kw) => has(text, kw))) {
      act = a
      break
    }
  }
  if (act === 'small_talk' && /\?\s*$/.test(transcript.trim())) act = 'question'
  const shouting = transcript.length > 3 && transcript === transcript.toUpperCase() && /[A-Z]/.test(transcript)
  const bangs = (transcript.match(/!/g) ?? []).length
  const intensity = Math.min(1, (shouting ? 0.67 : 0.33) + bangs * 0.17)
  return { act, intensity, directed: true, sarcastic: false, confidence: 0.5, source: 'rules' }
}

/** Which heard* stimulus a perception is, if any. Sarcastic praise is a dig. */
export function stimulusFor(p: Perception): string | null {
  if (!p.directed) return null
  const act = p.act === 'praise' && p.sarcastic ? 'provocation' : p.act
  switch (act) {
    case 'praise': return 'heardPraise'
    case 'provocation': return 'heardProvocation'
    case 'threat': return 'heardThreat'
    case 'indifference': return 'heardIndifference'
    case 'small_talk':
    case 'question': return 'heardChat'
    default: return null // command, farewell; forbidden_name has its own reflex
  }
}

/** Even a flat "valeu" counts for something; a shout counts for all of it. */
export const strengthOf = (p: Perception) => 0.4 + 0.6 * p.intensity

/**
 * Read an utterance and let it move the mood. Fire and forget. The prosody, when
 * it was spoken, only rides along to the bridge's log: Laya v1 reads text.
 */
export async function perceive(transcript: string, prosody?: Prosody | null): Promise<Perception> {
  const remote = await perceiveRemote(transcript, prosody ?? null)
  const p: Perception = remote && isAct(remote.act)
    ? { ...remote, act: remote.act }
    : perceiveByRules(transcript)
  const stimulus = stimulusFor(p)
  if (stimulus) mind.stimulate(stimulus, { strength: strengthOf(p) })
  log('app', `percebido ${p.act}${p.sarcastic ? ' sarcástico' : ''} ${p.intensity.toFixed(2)} (${p.source}${p.source === 'laya' ? ` ${p.confidence.toFixed(2)}` : ''})`)
  return p
}

const ACTS = new Set<string>(['praise', 'provocation', 'command', 'question', 'small_talk', 'indifference', 'threat', 'forbidden_name', 'farewell'])
const isAct = (a: string): a is Act => ACTS.has(a)
