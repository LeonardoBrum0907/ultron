import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brainChoiceSchema, type BrainChoice } from './brain-choice.ts'

/**
 * The models chosen in the terminal, kept in <dir>/cerebro.json so a restart
 * starts on them rather than on .env.local.
 */
export interface BrainChoiceFile {
  /** The saved choice, or null when there is none or it no longer reads. */
  saved(): BrainChoice | null
  save(choice: BrainChoice): void
  /** Back to .env.local on the next start. */
  clear(): void
}

/**
 * @example
 *   const file = brainChoiceFile(ULTRON_DIR)
 *   const start = file.saved() ?? fromEnv
 */
export function brainChoiceFile(dir: string): BrainChoiceFile {
  const path = join(dir, 'cerebro.json')
  return {
    saved: () => readChoice(path),
    save: (choice) => {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, JSON.stringify(choice, null, 2))
    },
    clear: () => rmSync(path, { force: true }),
  }
}

// A file someone edited by hand into something unreadable is ignored, with a
// warning, rather than stopping the bridge: .env.local still says where to start.
function readChoice(path: string): BrainChoice | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  try {
    return brainChoiceSchema.parse(JSON.parse(raw))
  } catch (err) {
    console.warn(`[ultron] ignoring ${path}: ${(err as Error).message}`)
    return null
  }
}
