/**
 * The tools Ultron remembers with: search, read and write notes about the
 * user that outlive the conversation and the model.
 *
 * Neutral tools over the LongMemory port, so every brain remembers the same
 * way and the store (ai-memory today) stays the bridge's business. The model
 * decides what is worth keeping: nothing here writes on its own.
 */
import { z } from 'zod'
import type { LongMemory, MemoryHit } from '../long-memory/long-memory.ts'
import { defineTool, toolServer, type ToolResult, type ToolServer } from './tool.ts'

const INSTRUCTIONS = `Your long-term memory. It outlives this conversation and
every model that ever speaks as you, so it is the only way you will know any of
this next week.

You decide what goes in. When you learn something about the user worth knowing
later (a preference, a person, a project, a decision, a problem that keeps
coming back), save it then, without being asked and without saying so. One
topic per note. Before saving, search: if a note on that topic exists, read it
and save the merged version to the same path, so a fact is never in two places.
Never save passwords, keys or anything they asked you to forget, and never
something said in passing that will not matter tomorrow.

Search before answering anything about their past, their preferences or their
projects that this conversation does not already show. When a conversation
starts and you know nothing about them yet, memory_recent shows what you wrote
down last.`

const text = (body: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: body }], isError })

const listed = (hits: MemoryHit[], none: string): ToolResult =>
  text(hits.length ? hits.map((h) => `${h.path} | ${h.title}: ${h.snippet}`).join('\n') : none)

/** A store that is down is a sentence for the model, not a crash in the bridge. */
async function guarded(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run()
  } catch (err) {
    console.error(JSON.stringify({ at: 'memory', error: String(err) }))
    return text(`Memory is unreachable right now: ${(err as Error).message}`, true)
  }
}

/**
 * A topic as a note path: `Café da manhã` is `notes/cafe-da-manha.md`.
 *
 * @example
 *   notePath('Projeto Laya!')  // 'notes/projeto-laya.md'
 */
export function notePath(topic: string): string {
  const slug = topic
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `notes/${slug || 'note'}.md`
}

/** A path the model may rewrite: relative, markdown, and never climbing out of the wiki. */
const NOTE_PATH = /^(?!\/)(?!.*\.\.)[\w\-/]+\.md$/

function searchTool(memory: LongMemory) {
  return defineTool(
    'memory_search',
    'Searches your long-term memory for notes about any of these words. Give the words that matter, not a sentence.',
    { words: z.string().min(1).describe('Keywords, e.g. "coffee breakfast"'), limit: z.number().int().min(1).max(20).optional() },
    ({ words, limit }) => guarded(async () => listed(await memory.search(words, limit ?? 8), 'Nothing in memory about that.')),
  )
}

function recentTool(memory: LongMemory) {
  return defineTool(
    'memory_recent',
    'The notes you changed most recently, newest first.',
    { limit: z.number().int().min(1).max(20).optional() },
    ({ limit }) => guarded(async () => listed(await memory.recent(limit ?? 10), 'Memory is empty.')),
  )
}

function readTool(memory: LongMemory) {
  return defineTool(
    'memory_read',
    'Reads one whole note, by the path a search or memory_recent gave.',
    { path: z.string().regex(NOTE_PATH, 'a relative .md path such as notes/coffee.md') },
    ({ path }) => guarded(async () => {
      const note = await memory.read(path)
      return note ? text(note.body) : text(`There is no note at ${path}.`, true)
    }),
  )
}

function saveTool(memory: LongMemory) {
  return defineTool(
    'memory_save',
    'Writes a note to your long-term memory, replacing any note at the same path. ' +
      'To update a note, read it first and save the merged text with its path.',
    {
      topic: z.string().min(1).describe('A short title, e.g. "Coffee"'),
      text: z.string().min(1).describe('The whole note, in plain sentences'),
      path: z.string().regex(NOTE_PATH).optional().describe('The existing note to replace; leave out for a new topic'),
      pinned: z.boolean().optional().describe('True for a fact that must never fade, e.g. a name'),
    },
    ({ topic, text: body, path, pinned }) => guarded(async () => {
      const where = path ?? notePath(topic)
      await memory.save({ path: where, title: topic, body: `# ${topic}\n\n${body}` }, { pinned: pinned ?? false })
      return text(`Saved to ${where}.`)
    }),
  )
}

/**
 * @example
 *   const servers = { ultron_memory: memoryServer(aiMemory(settings)) }
 */
export function memoryServer(memory: LongMemory): ToolServer {
  return toolServer({
    name: 'ultron_memory',
    version: '1.0.0',
    instructions: INSTRUCTIONS,
    alwaysLoad: true,
    tools: [searchTool(memory), recentTool(memory), readTool(memory), saveTool(memory)],
  })
}
