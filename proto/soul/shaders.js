// The soul's shaders. One vertex shader places every particle from its random numbers and
// the clocks: resting in the dust, flying on a current, or in its place in the soul
// (parts.glsl.js), where it keeps moving. The CPU only moves uniforms.

import { FLIGHT } from './flight.glsl.js'
import { SIMPLEX } from './noise.glsl.js'
import { PARTS } from './parts.glsl.js'

const UNIFORMS = /* glsl */ `
  attribute vec4 aRand;   // four random numbers 0..1
  attribute vec4 aMeta;   // x which part (swarm.js PART), y one more random number, z its current, w its lane 0..1
  attribute vec4 aFly;    // x when it sets off (s after the summons), y how long it flies, zw where in the dust it rests (0..1)
  uniform float uTime;    // real seconds: the clock everything sways and drifts on
  uniform float uFire;    // the fire's own clock: s since the summons, faster while it flares
  uniform float uAsm;     // s since the summons (-1 at rest); runs back as it dissolves
  uniform float uBootAt;  // uTime when the summons came (huge at rest)
  uniform float uLive;    // 1 = dissolving: fall back to where the dust is now
  uniform vec3  uCloud;   // the dust at rest: xy its middle, z its radius
  uniform float uWedge[5];   // per current: the angle of the wedge of dust it gathers from
  uniform vec4  uCurEnds[5]; // per current: xy where it gathers, zw where it delivers
  uniform vec4  uCurMids[5]; // per current: the two middle points of its path
  uniform vec4  uTrail[8];  // the cursor's recent path, newest first: xy where, zw its velocity faded by age (touch.js)
  uniform float uFlare;   // a click's flare: 1 just now, fading to 0
  uniform float uLevel;   // the microphone, 0..1
  uniform vec3  uHot;     // the palette: white-hot core ..
  uniform vec3  uMid;     // .. the flame's own colour ..
  uniform vec3  uCool;    // .. and its cooling edges, the smoke and the dust
  uniform vec2  uView;    // clip units per world unit, x and y
  uniform float uYMid;    // world y at the middle of the screen
  uniform float uPx;      // device px per world unit
  varying vec3  vColor;
  varying float vAlpha;
`

export const SOUL_VERTEX = /* glsl */ `
  ${UNIFORMS}
  ${SIMPLEX}
  ${PARTS}
  ${FLIGHT}
  Spark place(float part, vec4 r, float w) {
    if (part < 0.5) return core(r, w);
    if (part < 1.5) return halo(r, w);
    if (part < 2.5) return flame(r, w);
    if (part < 3.5) return smoke(r, w);
    if (part < 4.5) return ember(r, w);
    return mote(w); // the loose dust never leaves the cloud
  }
  void main() {
    float w = aMeta.y;
    Spark s = place(aMeta.x, aRand, w);
    Spark m = mote(w);
    // Each particle rests until the wind reaches it (the summons + its delay), then is
    // carried from exactly where it is; dissolving, it falls back to where the dust is now.
    float t = clamp((uAsm - aFly.x) / aFly.y, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    vec2 rest = loose(restHome(), mix(min(uTime, uBootAt + aFly.x), uTime, uLive), w);
    vec2 p = fly(rest, s.xy, e);
    p += stir(p, w);
    vColor = heatColor(mix(m.heat, s.heat, e));
    // A stream in flight glows brighter than the dust it left.
    vAlpha = mix(m.alpha * (1.0 + 1.2 * sin(PI * e)), s.alpha * (1.0 + 0.6 * uFlare + 0.5 * uLevel), e);
    gl_Position = vec4(p.x * uView.x, (p.y - uYMid) * uView.y, 0.0, 1.0);
    // It only swells to its size in the soul as it lands (the glow's sprites are big).
    gl_PointSize = max(1.0, mix(m.size, s.size, e * e * e) * uPx);
  }
`

export const SOUL_FRAGMENT = /* glsl */ `
  varying vec3  vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c) * 4.0;
    if (d2 > 1.0) discard;
    gl_FragColor = vec4(vColor, exp(-d2 * 3.0) * (1.0 - d2) * vAlpha);
  }
`
