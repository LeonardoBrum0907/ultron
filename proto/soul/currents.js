// The five currents that carry the dust into the soul, drawn anew for every summons so no
// two look the same: which wedge of the dust each gathers from, and the path it takes.
// One to three of them are strong enough to sweep out of the window and come back round
// another side; the others swing across it in wide arcs. Ported from Ultron's own
// (figure.js: rollWedges, rollRoutes, setGuides), in the soul's world units.

import { CURRENTS } from './swarm.js'

/** Where each current delivers: the middle of what it carries (swarm.js routeOf), world units. */
export const DESTINATIONS = [
  [0, 0], // the orb and its glow
  [-0.8, 0.4], // the flames born on the orb's left ..
  [0, 1.0], // .. on its top ..
  [0.8, 0.4], // .. and on its right
  [0, 2.8], // the smoke and the embers, at the flame's tip
]

/**
 * @typedef {object} DustCloud the dust at rest, world units
 * @property {number} cx its middle
 * @property {number} cy
 * @property {number} R its radius
 * @property {number} reach how far a current may swing: past any edge of the window
 */

/**
 * @typedef {object} Currents what the shader needs (uWedge, uCurEnds, uCurMids)
 * @property {number[]} wedges per current, the angle of the wedge of dust it gathers from
 * @property {number[][]} ends per current, [gather x, gather y, deliver x, deliver y]
 * @property {number[][]} mids per current, its path's two middle points [x1, y1, x2, y2]
 */

/**
 * Draws the currents for one summons.
 * @param {() => number} rand where the random numbers come from
 * @param {DustCloud} cloud
 * @returns {Currents}
 * @example const currents = rollCurrents(seededRandom(3), { cx: 0, cy: 3, R: 13, reach: 22 })
 */
export function rollCurrents(rand, cloud) {
  const wedges = rollWedges(rand)
  const strong = shuffle([...Array(CURRENTS).keys()], rand).slice(0, rand() < 0.5 ? 2 : rand() < 0.5 ? 1 : 3)
  const ends = []
  const mids = []
  for (let k = 0; k < CURRENTS; k++) {
    const from = [cloud.cx + Math.cos(wedges[k]) * 0.52 * cloud.R, cloud.cy + Math.sin(wedges[k]) * 0.52 * cloud.R * 0.85]
    const to = DESTINATIONS[k]
    ends.push([...from, ...to])
    mids.push(strong.includes(k) ? sweepOut(from, to, cloud, rand) : arcAcross(from, to, rand))
  }
  return { wedges, ends, mids }
}

// The five wedges always tile the cloud; the summons turns them and deals them out anew.
function rollWedges(rand) {
  const slot = (Math.PI * 2) / CURRENTS
  const phase = rand() * Math.PI * 2
  return shuffle([...Array(CURRENTS).keys()], rand).map((place) => phase + place * slot)
}

// Its middle points sit far beyond the edge, further out along the way it came, and it
// comes back round another side.
function sweepOut(from, to, cloud, rand) {
  const side = rand() < 0.5 ? -1 : 1
  const turn = (0.6 + rand() * 0.8) * side
  const ox = from[0] - cloud.cx
  const oy = from[1] - cloud.cy
  const ol = Math.hypot(ox, oy) || 1
  const [ux, uy] = [ox / ol, oy / ol]
  const [bx, by] = [ux * Math.cos(turn) - uy * Math.sin(turn), ux * Math.sin(turn) + uy * Math.cos(turn)]
  const far1 = cloud.reach * (0.7 + rand() * 0.25)
  const far2 = cloud.reach * (0.55 + rand() * 0.3)
  return [from[0] + ux * far1, from[1] + uy * far1, to[0] + bx * far2, to[1] + by * far2]
}

// A wide, swirling arc across the window.
function arcAcross(from, to, rand) {
  const side = rand() < 0.5 ? -1 : 1
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]]
  const len = Math.hypot(dx, dy) || 1
  const [nx, ny] = [(-dy / len) * side, (dx / len) * side]
  const sag1 = len * (0.35 + rand() * 0.3)
  const sag2 = len * (0.25 + rand() * 0.25)
  return [from[0] + dx * 0.3 + nx * sag1, from[1] + dy * 0.3 + ny * sag1, to[0] - dx * 0.3 + nx * sag2, to[1] - dy * 0.3 + ny * sag2]
}

function shuffle(a, rand) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
