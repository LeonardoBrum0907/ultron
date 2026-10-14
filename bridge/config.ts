/**
 * The bridge's settings, read once from the environment.
 *
 * A function rather than constants at import time, because .env.local is
 * loaded by the entry point after every import has already been evaluated:
 * a module that read process.env at the top would miss it.
 */
import type { AiMemorySettings } from './long-memory/ai-memory.ts'

/** How hard a model thinks before it answers. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Which model a frame came from, as the page's log panel shows it. */
export interface ModelChoice {
  model: string
  effort: Effort
}

/**
 * The brains the bridge can run. Only Claude for now; the setting exists so
 * another one (an OpenAI-compatible endpoint, a local Ollama) can be added
 * without changing how the bridge is configured.
 */
export type BrainKind = 'claude'

const BRAINS: readonly BrainKind[] = ['claude']

/** Who thinks, and with which models. */
export interface BrainSettings {
  kind: BrainKind
  /** Where the brain's API lives, for brains that are reached over HTTP. Unused by Claude. */
  url: string | null
  /** Its API key, when it needs one. Unused by Claude, which runs on the Claude Code login. Never logged. */
  key: string | null
  /** The voice: answers conversation and quick actions itself. */
  voice: ModelChoice
  /** The subagent the voice hands long work to, or null when ULTRON_HEAVY_MODEL=off. */
  heavy: ModelChoice | null
}

export interface BridgeConfig {
  port: number
  /** The language Ultron hears and speaks, as a BCP 47 tag. */
  lang: string
  /** Writes, shell and acting on the world (bridge/policy.ts). */
  allowWrites: boolean
  brain: BrainSettings
  /** Long-term memory in ai-memory, or null when ULTRON_MEMORY_URL is not set. */
  memory: AiMemorySettings | null
  /** ULTRON_DEBUG=1 logs every message the brain emits. */
  debug: boolean
}

type Env = Record<string, string | undefined>

/**
 * Two models, split by the size of the job.
 *
 * The voice is Sonnet at low effort: a greeting, a quick question or a simple
 * command is answered in the time a spoken conversation tolerates. Anything
 * that needs several tools or a long piece of work goes to the `heavy`
 * subagent, Opus at high effort, which Sonnet calls itself through the Agent
 * tool (see the DELEGATION rules in the system prompt).
 *
 * The model choosing is deliberate. Whether a request needs tools is visible
 * to the model that holds them, not to a classifier reading the transcript,
 * and the main conversation stays on one model so its prompt cache stays warm:
 * caches are per model, and switching every turn would re-read the whole
 * history at full price.
 *
 * Sonnet 5.5 cannot run with thinking switched off through this SDK, so low
 * effort is how it is kept quick. ULTRON_MODEL and ULTRON_EFFORT still
 * override the voice; ULTRON_HEAVY_MODEL=off removes the subagent and leaves
 * everything to the voice model.
 */
function readBrain(env: Env): BrainSettings {
  const heavyModel = env.ULTRON_HEAVY_MODEL ?? 'claude-opus-5-5'
  return {
    kind: oneOf('ULTRON_BRAIN', env.ULTRON_BRAIN ?? 'claude', BRAINS),
    url: env.ULTRON_BRAIN_URL || null,
    key: env.ULTRON_BRAIN_KEY || null,
    voice: {
      model: env.ULTRON_MODEL ?? 'claude-sonnet-5-5',
      effort: oneOf('ULTRON_EFFORT', env.ULTRON_EFFORT ?? 'low', EFFORTS),
    },
    heavy:
      heavyModel === 'off'
        ? null
        : { model: heavyModel, effort: oneOf('ULTRON_HEAVY_EFFORT', env.ULTRON_HEAVY_EFFORT ?? 'high', EFFORTS) },
  }
}

/** A setting that must be one of a few words, refused at startup with the choices named. */
function oneOf<T extends string>(name: string, value: string, allowed: readonly T[]): T {
  const found = allowed.find((a) => a === value)
  if (found) return found
  throw new Error(`${name} is "${value}", but it must be one of: ${allowed.join(', ')}`)
}

/**
 * Where ai-memory listens, if it is used at all.
 *
 * Off unless ULTRON_MEMORY_URL is set, because it is a separate server the
 * user has to run: a bridge pointed at one that is not there would fail every
 * memory call. The URL may be given with or without its /mcp path. The token is
 * the server's bearer token (ai-memory requires one by default).
 */
function readMemory(env: Env): AiMemorySettings | null {
  const base = env.ULTRON_MEMORY_URL?.trim().replace(/\/+$/, '')
  if (!base) return null
  return {
    url: base.endsWith('/mcp') ? base : `${base}/mcp`,
    token: env.ULTRON_MEMORY_TOKEN || null,
    timeoutMs: 8_000,
    workspace: env.ULTRON_MEMORY_WORKSPACE || 'ultron',
    project: env.ULTRON_MEMORY_PROJECT || 'memoria',
  }
}

/**
 * Reads every setting the bridge's core needs.
 *
 * @example
 *   process.loadEnvFile('.env.local')
 *   const config = readBridgeConfig(process.env)
 *   config.brain.voice.model  // 'claude-sonnet-5-5' unless ULTRON_MODEL says otherwise
 */
export function readBridgeConfig(env: Env): BridgeConfig {
  return {
    port: Number(env.ULTRON_BRIDGE_PORT ?? 8787),
    lang: env.ULTRON_LANG ?? 'pt-BR',
    allowWrites: env.ULTRON_ALLOW_WRITES === '1',
    brain: readBrain(env),
    memory: readMemory(env),
    debug: env.ULTRON_DEBUG === '1',
  }
}
