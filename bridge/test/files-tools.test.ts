import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { globRegex } from '../tools/file-walk.ts'
import { filesServer, resolveFrom } from '../tools/files.ts'
import type { Tool, ToolResult } from '../tools/tool.ts'

/** A small home directory: notes, code, a dependency folder, an image and a binary. */
function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'ultron-files-'))
  mkdirSync(join(home, 'proj/src'), { recursive: true })
  mkdirSync(join(home, 'proj/node_modules/dep'), { recursive: true })
  writeFileSync(join(home, 'notes.md'), 'one\ntwo\nthree\n')
  writeFileSync(join(home, 'proj/src/a.ts'), 'const x = 1 // TODO tidy\n')
  writeFileSync(join(home, 'proj/README.md'), '# todo list\n')
  writeFileSync(join(home, 'proj/node_modules/dep/index.ts'), '// TODO not ours\n')
  writeFileSync(join(home, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(home, 'blob.bin'), Buffer.from([1, 0, 2]))
  return home
}

const home = fakeHome()
const tools: Record<string, Tool> = Object.fromEntries(filesServer(home).tools.map((t) => [t.name, t]))
const textOf = (r: ToolResult): string => (r.content[0]?.type === 'text' ? r.content[0].text : '')

test('globs read the way people mean them', () => {
  assert.equal(globRegex('*.md').test('deep/down/x.md'), true)
  assert.equal(globRegex('src/**/*.ts').test('src/a.ts'), true)
  assert.equal(globRegex('src/**/*.ts').test('src/lib/a.ts'), true)
  assert.equal(globRegex('src/*.ts').test('src/lib/a.ts'), false)
  assert.equal(globRegex('*.{png,jpg}').test('a.jpg'), true)
  assert.equal(globRegex('a?.txt').test('ab.txt'), true)
})

test('~ and relative paths start at home', () => {
  assert.equal(resolveFrom('/h', '~'), '/h')
  assert.equal(resolveFrom('/h', '~/a.md'), join('/h', 'a.md'))
  assert.equal(resolveFrom('/h', 'a/b.md'), join('/h', 'a/b.md'))
  assert.equal(resolveFrom('/h', '/etc/hosts'), '/etc/hosts')
})

test('a text file reads with numbered lines, from any line', async () => {
  assert.equal(textOf(await tools.files_read!.run({ path: '~/notes.md', offset: 2, limit: 1 })),
    '     2\ttwo\n... 2 more lines; read on with offset 3')
})

test('an image reads as an image; a binary file and a missing one are refusals', async () => {
  const image = await tools.files_read!.run({ path: 'pic.png' })
  assert.deepEqual(image.content[0], { type: 'image', data: 'iVBORw==', mimeType: 'image/png' })
  assert.equal((await tools.files_read!.run({ path: 'blob.bin' })).isError, true)
  const missing = await tools.files_read!.run({ path: 'nope.txt' })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /ENOENT/)
})

test('listing skips dependency folders', async () => {
  const listed = textOf(await tools.files_list!.run({ pattern: '*.ts' })).split('\n')
  assert.deepEqual(listed.slice(1), ['proj/src/a.ts'])
})

test('a search returns matching lines, narrowed by a glob and a case switch', async () => {
  const all = textOf(await tools.files_search!.run({ regex: 'todo', dir: '~/proj', ignoreCase: true })).split('\n').slice(1).sort()
  assert.deepEqual(all, ['README.md:1: # todo list', 'src/a.ts:1: const x = 1 // TODO tidy'])
  const onlyTs = textOf(await tools.files_search!.run({ regex: 'TODO', dir: 'proj', glob: '*.ts' }))
  assert.match(onlyTs, /src\/a\.ts:1:/)
  assert.doesNotMatch(onlyTs, /node_modules/)
  assert.match(textOf(await tools.files_search!.run({ regex: 'zebra', dir: 'proj' })), /^Nothing under /)
})
