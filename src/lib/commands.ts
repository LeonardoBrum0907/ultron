/**
 * The L panel's terminal: typed commands that drive Ultron directly.
 *
 * The text box talks to him (a Claude turn, which costs); this talks to the
 * app. Every command is local and instant, answers in the log as `cmd` lines,
 * and whatever it changes is kept across reloads by the module that owns it
 * (the voice id in tts, the switches in audio and tts, the dust level in dust).
 *
 * One registry feeds the runner, `help` and Tab completion, so a command added
 * here shows up in all three by itself.
 */
import { BRIDGE_HTTP_URL } from '../config'
import { useStore, type Phase } from '../store'
import { clearLog, log } from './log'
import { dustLevel, setDustLevel } from './dust'
import { elevenVoiceId, setElevenVoiceId } from './tts'
import { mind } from './mind'
import { toneNote } from './tone'

/** What only the app's conversation machinery can do; bound by App. */
export type Actions = {
  powerOn: () => void
  powerOff: () => void
  sleep: () => void
  wake: () => void
  stop: () => void
  setMic: (on: boolean) => void
  setVoice: (on: boolean) => void
  say: (text: string) => void
}

let actions: Actions | null = null
export function bindActions(a: Actions): void {
  actions = a
}

const PHASES: Phase[] = ['offline', 'boot', 'dormant', 'waking', 'listening', 'thinking', 'tooling', 'speaking']

const PHASE_NOTE: Record<Phase, string> = {
  offline: 'dust, before power on',
  boot: 'assembling out of the dust',
  dormant: 'asleep, waiting for "hey ultron"',
  waking: 'answering his name',
  listening: 'mic open',
  thinking: 'the model is working',
  tooling: 'a tool is running',
  speaking: 'answering aloud',
}

/** 0..1 as a ten-step bar and a percentage, for the mood readout. */
const bar = (v: number) => {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 10)
  return `${'█'.repeat(n)}${'·'.repeat(10 - n)} ${String(Math.round(v * 100)).padStart(3)}%`
}

const TEST_LINE = 'Teste de voz. Se você está me ouvindo, a voz está funcionando.'

type Command = {
  name: string
  usage: string
  summary: string
  /** Extra lines for `help <name>`. */
  details?: string[]
  /** Candidates for the argument at `index` (0 = first after the name). */
  complete?: (index: number, args: string[]) => string[]
  run: (args: string[]) => void | Promise<void>
}

const out = (text: string, level: 'info' | 'warn' | 'error' = 'info') => log('cmd', text, level)

const need = (): Actions | null => {
  if (!actions) out('the app is not ready yet', 'error')
  return actions
}

const onOff = (arg: string | undefined): boolean | null =>
  arg === 'on' ? true : arg === 'off' ? false : null

/** The voices from the last `voice list`, so `voice id <name>` can use a name. */
let knownVoices: { id: string; name: string }[] = []

type VoicesReply = {
  default?: string
  voices?: { id: string; name: string; category: string; labels: string[] }[]
  error?: string
}

async function fetchVoices(): Promise<VoicesReply> {
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}/voices`)
    return (await res.json()) as VoicesReply
  } catch {
    return { error: 'bridge unreachable' }
  }
}

const COMMANDS: Command[] = [
  {
    name: 'help',
    usage: 'help [command]',
    summary: 'list the commands, or explain one',
    complete: (i) => (i === 0 ? COMMANDS.map((c) => c.name) : []),
    run: ([name]) => {
      if (name) {
        const c = COMMANDS.find((x) => x.name === name)
        if (!c) return out(`unknown command: ${name}`, 'warn')
        out(c.usage)
        out(`  ${c.summary}`)
        for (const d of c.details ?? []) out(`  ${d}`)
        return
      }
      const w = Math.max(...COMMANDS.map((c) => c.usage.length))
      for (const c of COMMANDS) out(`${c.usage.padEnd(w)}  ${c.summary}`)
      out('↑↓ history · Tab completes · help <command> for details')
    },
  },
  {
    name: 'status',
    usage: 'status',
    summary: 'what he is doing and how he is set',
    run: () => {
      const s = useStore.getState()
      out(`state   ${s.phase}${s.heldPhase ? ` (figure held in ${s.heldPhase})` : ''}`)
      out(`mic     ${s.mic ? 'on' : 'off'}`)
      out(`voice   ${s.muted ? 'off' : 'on'} · ${elevenVoiceId() ?? 'bridge default'}`)
      out(`dust    ${Math.round(dustLevel() * 100)}%`)
      out(`systems ${[...s.connected, 'web'].join(' · ')}`)
    },
  },
  {
    name: 'state',
    usage: 'state [name|auto]',
    summary: 'show the state, hold the figure in one, or let it follow again',
    details: [
      'Holding only changes the figure: no mic, no Claude. Good for tuning a state.',
      ...PHASES.map((p) => `${p.padEnd(9)} ${PHASE_NOTE[p]}`),
      'auto      the figure follows the conversation again',
    ],
    complete: (i) => (i === 0 ? [...PHASES, 'auto'] : []),
    run: ([name]) => {
      const s = useStore.getState()
      if (!name) {
        out(`${s.phase} · ${PHASE_NOTE[s.phase]}`)
        if (s.heldPhase) out(`figure held in ${s.heldPhase} (state auto releases it)`)
        return
      }
      if (name === 'auto') {
        s.holdPhase(null)
        return out(`figure follows the conversation (${s.phase})`)
      }
      if (!PHASES.includes(name as Phase)) return out(`unknown state: ${name} (help state)`, 'warn')
      s.holdPhase(name as Phase)
      out(`figure held in ${name} · state auto releases it`)
    },
  },
  {
    name: 'on',
    usage: 'on',
    summary: 'power on: he assembles and goes to sleep waiting for his name',
    run: () => {
      if (useStore.getState().phase !== 'offline') return out('already on')
      need()?.powerOn()
      out('powering on')
    },
  },
  {
    name: 'off',
    usage: 'off',
    summary: 'power off: he comes apart into the dust',
    run: () => {
      if (useStore.getState().phase === 'offline') return out('already off')
      need()?.powerOff()
      out('powered off')
    },
  },
  {
    name: 'sleep',
    usage: 'sleep',
    summary: 'back to dormant, waiting for "hey ultron"',
    run: () => {
      const p = useStore.getState().phase
      if (p === 'offline' || p === 'boot') return out('he is not on yet', 'warn')
      need()?.sleep()
      out('dormant')
    },
  },
  {
    name: 'wake',
    usage: 'wake',
    summary: 'call him, as if you said his name',
    run: () => {
      const p = useStore.getState().phase
      if (p === 'offline' || p === 'boot') return out('he is not on yet', 'warn')
      need()?.wake()
      out('called')
    },
  },
  {
    name: 'stop',
    usage: 'stop',
    summary: 'cut off what he is saying or working on',
    run: () => {
      need()?.stop()
      out('stopped')
    },
  },
  {
    name: 'mic',
    usage: 'mic [on|off]',
    summary: 'the microphone',
    complete: (i) => (i === 0 ? ['on', 'off'] : []),
    run: ([arg]) => {
      const on = onOff(arg)
      if (on === null) {
        if (arg) return out('usage: mic on|off', 'warn')
        return out(`mic ${useStore.getState().mic ? 'on' : 'off'}`)
      }
      need()?.setMic(on)
      out(`mic ${on ? 'on' : 'off'}`)
    },
  },
  {
    name: 'voice',
    usage: 'voice [on|off|id|list|test]',
    summary: 'his voice: switch it, pick the ElevenLabs voice, hear it',
    details: [
      'voice on|off        speak aloud, or answer on screen only',
      'voice id            the voice in use',
      'voice id <id|name>  use this ElevenLabs voice (a name from voice list works)',
      'voice id reset      back to the bridge default (ULTRON_VOICE_ID)',
      'voice list          the voices on the ElevenLabs account',
      'voice test [text]   say a line with it, without Claude',
    ],
    complete: (i, args) => {
      if (i === 0) return ['on', 'off', 'id', 'list', 'test']
      if (i === 1 && args[0] === 'id') return ['reset', ...knownVoices.map((v) => v.id)]
      return []
    },
    run: async ([sub, ...rest]) => {
      const on = onOff(sub)
      if (on !== null) {
        need()?.setVoice(on)
        return out(`voice ${on ? 'on' : 'off'}`)
      }
      if (!sub) {
        const s = useStore.getState()
        return out(`voice ${s.muted ? 'off' : 'on'} · ${elevenVoiceId() ?? 'bridge default'}`)
      }
      if (sub === 'id') {
        const arg = rest.join(' ').trim()
        if (!arg) return out(elevenVoiceId() ?? 'bridge default (ULTRON_VOICE_ID)')
        if (arg === 'reset') {
          setElevenVoiceId(null)
          return out('voice: bridge default')
        }
        const byName = knownVoices.find((v) => v.name.toLowerCase() === arg.toLowerCase())
        const id = byName?.id ?? arg
        if (!/^[A-Za-z0-9]{8,40}$/.test(id)) {
          return out(`not a voice id: ${arg} (voice list shows them)`, 'warn')
        }
        setElevenVoiceId(id)
        return out(`voice: ${byName ? `${byName.name} · ` : ''}${id} · voice test to hear it`)
      }
      if (sub === 'list') {
        out('asking ElevenLabs…')
        const r = await fetchVoices()
        if (r.error || !r.voices) return out(`voices unavailable: ${r.error ?? 'no answer'}`, 'error')
        knownVoices = r.voices.map(({ id, name }) => ({ id, name }))
        const current = elevenVoiceId() ?? r.default
        for (const v of r.voices) {
          const mark = v.id === current ? '*' : ' '
          const tags = [v.category, ...v.labels].filter(Boolean).join(', ')
          out(`${mark} ${v.name} · ${v.id}${tags ? ` · ${tags}` : ''}`)
        }
        return out(`${r.voices.length} voices · * in use`)
      }
      if (sub === 'test') {
        const a = need()
        if (!a) return
        if (useStore.getState().muted) out('voice is off: voice on to hear it', 'warn')
        a.say(rest.join(' ').trim() || TEST_LINE)
        return out('speaking')
      }
      out(`unknown: voice ${sub} (help voice)`, 'warn')
    },
  },
  {
    name: 'mood',
    usage: 'mood [set|reset]',
    summary: 'his emotions, his temper and the note the next answer carries',
    details: [
      'mood                     each emotion as it shows now, and what lingers from before',
      'mood set <emotion> <0-100>  push an emotion to see the figure and voice follow',
      'mood reset               every emotion back to its rest',
      'shows = what the figure and voice show now (value + lingering, times temper)',
      'lingers = the background left by earlier sessions, fading over hours',
    ],
    complete: (i) =>
      i === 0 ? ['set', 'reset'] : i === 1 ? Object.keys(mind.config.emotions) : [],
    run: ([sub, name, value]) => {
      const emotions = Object.keys(mind.config.emotions)
      if (sub === 'reset') {
        mind.resetMood()
        return out('mood reset: every emotion at rest')
      }
      if (sub === 'set') {
        const n = Number(value?.replace('%', ''))
        if (!name || !emotions.includes(name) || !Number.isFinite(n) || n < 0 || n > 100) {
          return out(`usage: mood set <${emotions.join('|')}> <0-100>`, 'warn')
        }
        mind.setEmotion(name, n / 100)
        return out(`${name} set to ${Math.round(n)}% · it settles back on its own`)
      }
      if (sub) return out(`unknown: mood ${sub} (help mood)`, 'warn')
      const o = mind.output()
      const w = Math.max(...emotions.map((e) => e.length))
      out(`${''.padEnd(w)}  shows            lingers`)
      for (const e of emotions) {
        out(`${e.padEnd(w)}  ${bar(o.mood[e] ?? 0)}  ${bar(o.background[e] ?? 0)}`)
      }
      out(`dominant  ${o.dominant}`)
      const t = mind.config.temper
      out(`temper    intensity ${t.intensity} · frequency ${t.frequency} · volatility ${t.volatility}`)
      out(`next turn ${toneNote() || 'no mood note (nothing stands out)'}`)
    },
  },
  {
    name: 'dust',
    usage: 'dust [0-100]',
    summary: 'volume of the particle sound',
    run: ([arg]) => {
      if (!arg) return out(`dust ${Math.round(dustLevel() * 100)}%`)
      const n = Number(arg.replace('%', ''))
      if (!Number.isFinite(n) || n < 0 || n > 100) return out('usage: dust 0-100', 'warn')
      setDustLevel(n / 100)
      out(`dust ${Math.round(n)}%`)
    },
  },
  {
    name: 'clear',
    usage: 'clear',
    summary: 'empty the log',
    run: () => clearLog(),
  },
]

const split = (line: string) => line.trim().split(/\s+/).filter(Boolean)

/** Run one typed line. The line itself is echoed first, as a shell would. */
export async function runCommand(line: string): Promise<void> {
  const words = split(line)
  if (!words.length) return
  out(`› ${line.trim()}`)
  const [name, ...args] = words
  const c = COMMANDS.find((x) => x.name === name.toLowerCase())
  if (!c) return out(`unknown command: ${name} · type help`, 'warn')
  try {
    await c.run(args)
  } catch (err) {
    out(`${name} failed: ${err instanceof Error ? err.message : err}`, 'error')
  }
}

/**
 * Tab completion: the line with its last word completed as far as the
 * candidates agree, and the candidates when more than one is left.
 */
export function completeLine(line: string): { line: string; options: string[] } {
  const words = line.split(/\s+/)
  const last = words.pop() ?? ''
  const before = words.filter(Boolean)
  let pool: string[]
  if (!before.length) pool = COMMANDS.map((c) => c.name)
  else {
    const c = COMMANDS.find((x) => x.name === before[0].toLowerCase())
    pool = c?.complete?.(before.length - 1, before.slice(1)) ?? []
  }
  const hits = pool.filter((p) => p.toLowerCase().startsWith(last.toLowerCase()))
  if (!hits.length) return { line, options: [] }
  let common = hits[0]
  for (const h of hits) while (!h.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1)
  const head = before.length ? `${before.join(' ')} ` : ''
  if (hits.length === 1) return { line: `${head}${hits[0]} `, options: [] }
  return { line: `${head}${common.length > last.length ? common : last}`, options: hits }
}

const HISTORY_KEY = 'ultron.cmdHistory'
const HISTORY_MAX = 100

export function loadHistory(): string[] {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveHistory(h: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_MAX)))
  } catch {
    // Private mode: history for this page only.
  }
}
