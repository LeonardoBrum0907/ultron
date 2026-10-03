// The mind: an emotion orchestrator that any host can drive (see SPEC.md).
// Personalities live in ./personalities, optional host helpers in ./adapters and ./panel.
export { createMind, type Mind, type MindOptions } from './core/mind.ts'
export { CHANNELS, clone, diff, merge } from './core/config.ts'
export type * from './core/types.ts'
