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

const DIR = process.env.ULTRON_HOME ?? join(homedir(), '.ultron')
const FILE = join(DIR, 'conversa.json')

/** @returns {{ id: string, since: string, turns: number } | null} */
export function savedConversation() {
  try {
    const saved = JSON.parse(readFileSync(FILE, 'utf8'))
    return typeof saved?.id === 'string' && saved.id ? saved : null
  } catch {
    return null
  }
}

function write(data) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, JSON.stringify(data, null, 2))
}

/**
 * Called with the session id the SDK reports, and again after every turn.
 * `continuing` says this session resumed the saved one, which keeps its start
 * date and turn count even if the SDK handed out a new id for it.
 */
export function rememberConversation(id, { turn = false, continuing = false } = {}) {
  const saved = savedConversation()
  const same = saved != null && (saved.id === id || continuing)
  write({
    id,
    since: same ? saved.since : new Date().toISOString(),
    turns: (same ? saved.turns ?? 0 : 0) + (turn ? 1 : 0),
  })
}

export function forgetConversation() {
  rmSync(FILE, { force: true })
}
