/**
 * What one L panel command is, and how it answers. Shared by the registry in
 * commands.ts and the modules that hold groups of commands (brain-commands.ts).
 */
import { log } from './log'

export type Command = {
  name: string
  usage: string
  summary: string
  /** Extra lines for `help <name>`. */
  details?: string[]
  /** Candidates for the argument at `index` (0 = first after the name). */
  complete?: (index: number, args: string[]) => string[]
  run: (args: string[]) => void | Promise<void>
}

/** One answer line in the log, as a `cmd` entry. */
export const out = (text: string, level: 'info' | 'warn' | 'error' = 'info') => log('cmd', text, level)
