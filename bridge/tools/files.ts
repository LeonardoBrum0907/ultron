/**
 * Reading the machine's files: one file, a listing by pattern, a text search.
 *
 * Neutral stand-ins for Claude Code's Read, Glob and Grep, so the file work
 * Ultron does is the same whichever brain runs it. Reading changes nothing,
 * which is why the policy lets these run without ULTRON_ALLOW_WRITES, exactly
 * as it did the built-ins they replace.
 */
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { globRegex, walkFiles } from './file-walk.ts'
import { defineTool, toolServer, type ToolResult, type ToolServer } from './tool.ts'

const MAX_LINES = 2000
const MAX_LINE_CHARS = 2000
/** Bigger than this and a search skips the file: it is a log or a dump, not something to grep. */
const MAX_SEARCH_BYTES = 1_000_000
const MAX_IMAGE_BYTES = 5_000_000
const MAX_WALK = 20_000
const MAX_LISTED = 200
const MAX_MATCHES = 100

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
}

const text = (body: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: body }], isError })

/** Failures are sentences for the model (a missing file is an answer, not a crash). */
async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run()
  } catch (err) {
    return text((err as Error).message, true)
  }
}

/**
 * Where a path the model gave points. `~` and relative paths start at the
 * home directory, the brain's working directory.
 *
 * @example
 *   resolveFrom('/home/leo', '~/notes.md')  // '/home/leo/notes.md'
 */
export function resolveFrom(home: string, path: string): string {
  if (path === '~') return home
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(home, path.slice(2))
  return isAbsolute(path) ? path : resolve(home, path)
}

/** Lines numbered from 1 like `cat -n`, so the model can point at one. */
function numbered(lines: string[], first: number): string {
  return lines.map((line, i) => `${String(first + i).padStart(6)}\t${line.slice(0, MAX_LINE_CHARS)}`).join('\n')
}

async function readText(file: string, offset: number, limit: number): Promise<ToolResult> {
  const raw = await readFile(file)
  if (raw.includes(0)) return text(`${file} is a binary file.`, true)
  const lines = raw.toString('utf8').split(/\r?\n/)
  const slice = lines.slice(offset - 1, offset - 1 + limit)
  const rest = lines.length - (offset - 1 + slice.length)
  return text(numbered(slice, offset) + (rest > 0 ? `\n... ${rest} more lines; read on with offset ${offset + slice.length}` : ''))
}

async function readImage(file: string, mimeType: string): Promise<ToolResult> {
  const { size } = await stat(file)
  if (size > MAX_IMAGE_BYTES) return text(`${file} is ${size} bytes, over the ${MAX_IMAGE_BYTES} an image may be.`, true)
  return { content: [{ type: 'image', data: (await readFile(file)).toString('base64'), mimeType }] }
}

function readTool(home: string) {
  return defineTool(
    'files_read',
    'Reads a file on this machine: text with numbered lines, or an image you can see. ' +
      'Paths may be absolute or start with ~.',
    {
      path: z.string().min(1),
      offset: z.number().int().min(1).optional().describe('First line to read, from 1'),
      limit: z.number().int().min(1).max(MAX_LINES).optional().describe(`Lines to read, at most ${MAX_LINES}`),
    },
    ({ path, offset, limit }) => guarded(() => {
      const file = resolveFrom(home, path)
      const image = IMAGE_TYPES[extname(file).toLowerCase()]
      return image ? readImage(file, image) : readText(file, offset ?? 1, limit ?? MAX_LINES)
    }),
  )
}

async function listFiles(dir: string, pattern: string): Promise<string[]> {
  const match = globRegex(pattern)
  const found: string[] = []
  for await (const file of walkFiles(dir, { maxFiles: MAX_WALK })) {
    if (match.test(file)) found.push(file)
    if (found.length >= MAX_LISTED) break
  }
  return found
}

function listTool(home: string) {
  return defineTool(
    'files_list',
    'Lists files under a directory whose paths match a glob (`*.md`, `src/**/*.ts`, `*.{jpg,png}`). ' +
      'Dependency and cache folders are skipped.',
    {
      pattern: z.string().min(1),
      dir: z.string().optional().describe('Where to look; the home directory when left out'),
    },
    ({ pattern, dir }) => guarded(async () => {
      const root = resolveFrom(home, dir ?? '~')
      const found = await listFiles(root, pattern)
      return text(found.length ? `${root}\n${found.join('\n')}` : `No files under ${root} match ${pattern}.`)
    }),
  )
}

/** The lines of one file that match, as `path:line: text`. */
async function matchesIn(root: string, file: string, regex: RegExp): Promise<string[]> {
  const full = join(root, file)
  if ((await stat(full)).size > MAX_SEARCH_BYTES) return []
  const raw = await readFile(full)
  if (raw.includes(0)) return []
  return raw.toString('utf8').split(/\r?\n/).flatMap((line, i) =>
    regex.test(line) ? [`${file}:${i + 1}: ${line.trim().slice(0, 300)}`] : [])
}

async function searchFiles(root: string, regex: RegExp, only: RegExp | null): Promise<string[]> {
  const found: string[] = []
  for await (const file of walkFiles(root, { maxFiles: MAX_WALK })) {
    if (only && !only.test(file)) continue
    found.push(...(await matchesIn(root, file, regex).catch(() => [])))
    if (found.length >= MAX_MATCHES) return found.slice(0, MAX_MATCHES)
  }
  return found
}

function searchTool(home: string) {
  return defineTool(
    'files_search',
    'Searches the text of files under a directory for a regular expression, and returns the matching lines. ' +
      'Narrow it with a glob: searching the whole home directory is slow.',
    {
      regex: z.string().min(1).describe('A JavaScript regular expression, e.g. "TODO|FIXME"'),
      dir: z.string().optional().describe('Where to look; the home directory when left out'),
      glob: z.string().optional().describe('Only files matching this, e.g. "*.ts"'),
      ignoreCase: z.boolean().optional(),
    },
    ({ regex, dir, glob, ignoreCase }) => guarded(async () => {
      const root = resolveFrom(home, dir ?? '~')
      const found = await searchFiles(root, new RegExp(regex, ignoreCase ? 'i' : ''), glob ? globRegex(glob) : null)
      return text(found.length ? `${root}\n${found.join('\n')}` : `Nothing under ${root} matches /${regex}/.`)
    }),
  )
}

/**
 * @example
 *   const servers = { ultron_files: filesServer(homedir()) }
 */
export function filesServer(home: string): ToolServer {
  return toolServer({
    name: 'ultron_files',
    version: '1.0.0',
    instructions: 'Reading files on this machine. Nothing here changes a file.',
    // Loaded up front like the built-ins they replace: a tool the model has
    // to go looking for is a tool it does not use.
    alwaysLoad: true,
    tools: [readTool(home), listTool(home), searchTool(home)],
  })
}
