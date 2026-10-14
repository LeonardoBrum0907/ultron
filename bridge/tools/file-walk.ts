/**
 * Walking a directory tree for the file tools: glob patterns and a bounded walk.
 *
 * Written here rather than with fs.glob, which is still experimental on the
 * Node versions the bridge supports (>= 20.6), and bounded because the file
 * tools start from the home directory, where an unbounded walk means minutes.
 */
import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Directories nobody means when they search: dependencies, history, caches. */
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.cache', '.venv', 'venv', '__pycache__', 'dist', 'build', 'AppData'])

/** One glob token as a regex fragment. */
function globToken(pattern: string, i: number): [string, number] {
  const c = pattern[i] ?? ''
  if (pattern.startsWith('**/', i)) return ['(?:.*/)?', 3]
  if (pattern.startsWith('**', i)) return ['.*', 2]
  if (c === '*') return ['[^/]*', 1]
  if (c === '?') return ['[^/]', 1]
  if (c === '{') {
    const end = pattern.indexOf('}', i)
    if (end > i) return [`(?:${pattern.slice(i + 1, end).split(',').map(escapeRegex).join('|')})`, end - i + 1]
  }
  return [escapeRegex(c), 1]
}

const escapeRegex = (s: string): string => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')

/**
 * A glob as a regex over `/`-separated relative paths. Supports `**`, `*`, `?`
 * and `{a,b}`. A pattern without a slash matches the file name at any depth,
 * the way people mean `*.md`.
 *
 * @example
 *   globRegex('src/**\/*.ts').test('src/lib/a.ts')  // true
 */
export function globRegex(pattern: string): RegExp {
  const full = pattern.includes('/') ? pattern : `**/${pattern}`
  let out = ''
  for (let i = 0; i < full.length;) {
    const [fragment, used] = globToken(full, i)
    out += fragment
    i += used
  }
  return new RegExp(`^${out}$`, process.platform === 'win32' ? 'i' : '')
}

export interface WalkLimits {
  /** Stop after this many files have been seen, matched or not. */
  maxFiles: number
}

/**
 * Every file under `root`, as paths relative to it with `/` separators,
 * skipping dependency and cache directories. Unreadable directories are passed over.
 *
 * @example
 *   for await (const file of walkFiles('/home/leo/proj', { maxFiles: 5000 })) console.log(file)
 */
export async function* walkFiles(root: string, limits: WalkLimits): AsyncGenerator<string> {
  const pending = [root]
  let seen = 0
  while (pending.length && seen < limits.maxFiles) {
    const dir = pending.shift() as string
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) pending.push(full)
      if (!entry.isFile()) continue
      if (++seen > limits.maxFiles) return
      yield relative(root, full).split(sep).join('/')
    }
  }
}
