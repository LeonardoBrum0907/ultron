// The soul's colours, after Léo's reference sheet (four souls on a plinth): hot is the
// white-hot core, mid the flame itself, cool its edges and the smoke. Blue leads with
// Ultron's own cyan (#19ddff).

/** @typedef {{ hot: number[], mid: number[], cool: number[] }} SoulPalette */

/** @type {Record<string, SoulPalette>} */
export const SOUL_PALETTES = {
  blue: { hot: [0.86, 0.98, 1.0], mid: [0.1, 0.72, 1.0], cool: [0.08, 0.36, 0.95] },
  red: { hot: [1.0, 0.86, 0.72], mid: [1.0, 0.28, 0.18], cool: [0.55, 0.04, 0.08] },
  purple: { hot: [1.0, 0.86, 1.0], mid: [0.88, 0.3, 1.0], cool: [0.4, 0.08, 0.75] },
  white: { hot: [1.0, 1.0, 1.0], mid: [0.72, 0.9, 1.0], cool: [0.35, 0.55, 0.85] },
}

/** The palettes in order: the shader's table of them (stage.js) and every mix (tint.js) keep it. */
export const SOUL_PALETTE_NAMES = Object.keys(SOUL_PALETTES)

/**
 * The palette after this one, round the list.
 * @param {string} name a key of SOUL_PALETTES
 * @returns {string} the next key
 * @example nextPalette('blue') // 'red'
 */
export function nextPalette(name) {
  const names = SOUL_PALETTE_NAMES
  return names[(names.indexOf(name) + 1) % names.length]
}
