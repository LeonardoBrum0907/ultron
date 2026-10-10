import type { Mind } from '../mind/index.ts'

/** A loudness the figure reads every frame: dBFS off a microphone, or already 0..1. */
export type Loudness = { db: number } | { level: number } | null

/**
 * A part of the HUD the figure answers to, in CSS px (a DOMRect will do). calm 0..1: the text
 * over it must read, so the dust clears out and the figure behind dims. rim 0..1: the dust is
 * drawn onto its border.
 */
export type Zone = { left: number; top: number; right: number; bottom: number; calm?: number; rim?: number }

/** How much the dust is moving this frame, each 0..1 (see MOTION in figure.js). */
export type Motion = { assembly: number; cursor: number; crumble: number; rebuild: number }

export interface FigureOptions {
  canvas: HTMLCanvasElement
  mind: Mind
  controls?: boolean
  tickMind?: boolean
  hears?: () => Loudness
  says?: () => Loudness
  onIgnite?: () => void
  /** Where the HUD is this frame, one slot per zone (null: that zone fades out). */
  zones?: () => (Zone | null)[]
  /** Called every frame with the dust's motion (the same object each time). */
  motion?: (m: Motion) => void
  /** A stressed syllable sent a wave of dust out from the mouth. */
  onWave?: (strength: number) => void
}

export interface Figure {
  /** The app's phase, which the figure follows. */
  setPhase(phase: string): void
  dispose(): void
}

export function createFigure(options: FigureOptions): Promise<Figure>
