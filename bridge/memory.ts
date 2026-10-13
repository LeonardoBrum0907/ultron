import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Which conversation Ultron is in, kept across restarts.
 *
 * The Agent SDK already writes every session to disk (under ~/.claude/projects)
 * and can pick one up again by id with `resume`. All this file adds is the id
 * to resume, so a reload, a bridge restart or a reboot carries on the same
 * conversation instead of starting a new one, and a few numbers for the L
 * panel's `memory` command.
 */

/** Where Ultron keeps what must survive a restart: ~/.ultron, or ULTRON_HOME. */
export const ULTRON_DIR = process.env.ULTRON_HOME ?? join(homedir(), '.ultron')
const FILE = join(ULTRON_DIR, 'conversa.json')

/** The conversation to resume, as kept in ~/.ultron/conversa.json. */
export interface SavedConversation {
  id: string
  /** When it began, as an ISO date. */
  since: string
  turns: number
}

export function savedConversation(): SavedConversation | null {
  try {
    const saved = JSON.parse(readFileSync(FILE, 'utf8'))
    return typeof saved?.id === 'string' && saved.id ? saved : null
  } catch {
    return null
  }
}

function write(data: SavedConversation): void {
  mkdirSync(ULTRON_DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(data, null, 2))
}

/**
 * Called with the session id the SDK reports, and again after every turn.
 * `continuing` says this session resumed the saved one, which keeps its start
 * date and turn count even if the SDK handed out a new id for it.
 */
export function rememberConversation(id: string, { turn = false, continuing = false } = {}): void {
  const saved = savedConversation()
  const same = saved != null && (saved.id === id || continuing)
  write({
    id,
    since: same ? saved.since : new Date().toISOString(),
    turns: (same ? saved.turns ?? 0 : 0) + (turn ? 1 : 0),
  })
}

export function forgetConversation(): void {
  rmSync(FILE, { force: true })
}
