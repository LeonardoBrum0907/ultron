/**
 * Ultron's long-term memory: what it knows about the user across every
 * conversation and every model, as the bridge sees it.
 *
 * The conversation itself (turn by turn) belongs to the brain; this is the
 * layer above it, kept as readable notes. ai-memory serves it today
 * (long-memory/ai-memory.ts); the port is here so a test, or another store
 * one day, can stand in for it.
 */

/** One note that matched a search, or one of the latest notes. */
export interface MemoryHit {
  /** Where the note lives, e.g. `notes/cafe.md`. The id to read or rewrite it by. */
  path: string
  title: string
  /** A plain-text extract around the match. */
  snippet: string
}

/** One whole note. */
export interface MemoryNote {
  path: string
  title: string
  /** Markdown, starting with a `# Title` line. */
  body: string
}

export interface LongMemory {
  /** Notes about any of these words, best first. */
  search(words: string, limit: number): Promise<MemoryHit[]>
  /** The notes changed most recently, newest first. */
  recent(limit: number): Promise<MemoryHit[]>
  /** One note, or null when there is none at that path. */
  read(path: string): Promise<MemoryNote | null>
  /** Writes a note, replacing whatever was at that path. */
  save(note: MemoryNote, options: { pinned: boolean }): Promise<void>
}
