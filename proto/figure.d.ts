import type { Mind } from '../mind/index.ts'

/** A loudness the figure reads every frame: dBFS off a microphone, or already 0..1. */
export type Loudness = { db: number } | { level: number } | null

export interface FigureOptions {
  canvas: HTMLCanvasElement
  mind: Mind
  controls?: boolean
  tickMind?: boolean
  hears?: () => Loudness
  says?: () => Loudness
  onIgnite?: () => void
}

export interface Figure {
  /** The app's phase, which the figure follows. */
  setPhase(phase: string): void
  dispose(): void
}

export function createFigure(options: FigureOptions): Promise<Figure>
