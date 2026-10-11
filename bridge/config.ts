/**
 * The bridge's settings, read once from the environment.
 *
 * A function rather than constants at import time, because .env.local is
 * loaded by the entry point after every import has already been evaluated:
 * a module that read process.env at the top would miss it.
 */

/** Which model a frame came from, as the page's log panel shows it. */
export interface ModelChoice {
  model: string
  effort: string
}

/** Who thinks, and with which models. */
export interface BrainSettings {
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
    voice: { model: env.ULTRON_MODEL ?? 'claude-sonnet-5-5', effort: env.ULTRON_EFFORT ?? 'low' },
    heavy: heavyModel === 'off' ? null : { model: heavyModel, effort: env.ULTRON_HEAVY_EFFORT ?? 'high' },
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
    debug: env.ULTRON_DEBUG === '1',
  }
}
