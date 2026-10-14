import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import type { LongMemory, MemoryHit, MemoryNote } from '../long-memory/long-memory.ts'
import { memoryServer, notePath } from '../tools/memory.ts'
import type { Tool, ToolResult } from '../tools/tool.ts'

/** A LongMemory held in a map, or one that is down. */
class FakeLongMemory implements LongMemory {
  readonly notes = new Map<string, { note: MemoryNote; pinned: boolean }>()
  down = false

  async search(words: string): Promise<MemoryHit[]> {
    this.check()
    return [...this.notes.values()]
      .filter(({ note }) => note.body.includes(words))
      .map(({ note }) => ({ path: note.path, title: note.title, snippet: note.body.slice(0, 20) }))
  }

  async recent(): Promise<MemoryHit[]> {
    return this.search('')
  }

  async read(path: string): Promise<MemoryNote | null> {
    this.check()
    return this.notes.get(path)?.note ?? null
  }

  async save(note: MemoryNote, { pinned }: { pinned: boolean }): Promise<void> {
    this.check()
    this.notes.set(note.path, { note, pinned })
  }

  private check(): void {
    if (this.down) throw new Error('connect ECONNREFUSED 127.0.0.1:49374')
  }
}

function toolsOf(memory: LongMemory): Record<string, Tool> {
  return Object.fromEntries(memoryServer(memory).tools.map((t) => [t.name, t]))
}

const textOf = (r: ToolResult): string => (r.content[0]?.type === 'text' ? r.content[0].text : '')

test('a topic becomes a stable note path, accents and punctuation gone', () => {
  assert.equal(notePath('Café da manhã'), 'notes/cafe-da-manha.md')
  assert.equal(notePath('Projeto Laya!'), 'notes/projeto-laya.md')
  assert.equal(notePath('???'), 'notes/note.md')
})

test('a note saved by topic can be found, read, and rewritten in place by its path', async () => {
  const memory = new FakeLongMemory()
  const tools = toolsOf(memory)
  assert.equal(textOf(await tools.memory_save!.run({ topic: 'Café', text: 'Sem açúcar.' })), 'Saved to notes/cafe.md.')
  assert.match(textOf(await tools.memory_search!.run({ words: 'açúcar' })), /^notes\/cafe\.md \| Café: /)
  assert.equal(textOf(await tools.memory_read!.run({ path: 'notes/cafe.md' })), '# Café\n\nSem açúcar.')
  await tools.memory_save!.run({ topic: 'Café preto', text: 'Sem açúcar, duas vezes ao dia.', path: 'notes/cafe.md', pinned: true })
  assert.deepEqual([...memory.notes.keys()], ['notes/cafe.md'])
  assert.equal(memory.notes.get('notes/cafe.md')?.pinned, true)
})

test('nothing found and no such note are answers, not failures of the store', async () => {
  const tools = toolsOf(new FakeLongMemory())
  assert.equal(textOf(await tools.memory_search!.run({ words: 'x' })), 'Nothing in memory about that.')
  const missing = await tools.memory_read!.run({ path: 'notes/x.md' })
  assert.equal(missing.isError, true)
})

test('a store that is down is a sentence for the model', async () => {
  const memory = new FakeLongMemory()
  memory.down = true
  const result = await toolsOf(memory).memory_search!.run({ words: 'x' })
  assert.equal(result.isError, true)
  assert.match(textOf(result), /^Memory is unreachable right now: connect ECONNREFUSED/)
})

test('a path that climbs out of the wiki is refused by the input schema', () => {
  const input = z.object(toolsOf(new FakeLongMemory()).memory_read!.input)
  assert.equal(input.safeParse({ path: 'notes/ok.md' }).success, true)
  assert.equal(input.safeParse({ path: '../etc/passwd.md' }).success, false)
  assert.equal(input.safeParse({ path: '/abs.md' }).success, false)
})
