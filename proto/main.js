// Particle humanoid prototype.
//
// Everything on screen is a point sprite driven by one vertex shader. The art
// lives in ./img as ordinary PNGs (see art/generate.mjs); this file turns them
// into particles and animates them. Nothing is simulated on the CPU per frame
// except a handful of uniforms, which is the whole performance story: ~40k
// points is trivial for a GPU, and there is no post-processing pass at all.

import * as THREE from 'three'
import { createMind } from '../mind/index.ts'
import { browserStorage, saveOnHide } from '../mind/adapters/storage-browser.ts'
import { attachPointer } from '../mind/adapters/pointer.ts'
import { createPanel } from '../mind/panel/panel.ts'
import { ultron } from '../mind/personalities/ultron.ts'

const $ = (id) => document.getElementById(id)

// Ultron's emotions (../mind, see mind/SPEC.md): the mood, kept between sessions, and what
// it does on its own. The figure maps its body channels in the frame loop. E opens the
// tuning panel.
const mind = createMind(ultron, { seed: (Math.random() * 2 ** 32) >>> 0, storage: browserStorage('ultron.mind') })
await mind.restore()
saveOnHide(mind)
attachPointer(mind)
createPanel(mind, { key: 'e' })

/* ------------------------------------------------------------------ setup */

const canvas = $('gl')
let renderer
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
  })
} catch (e) {
  const err = $('err')
  err.style.display = 'grid'
  err.textContent = 'WebGL is unavailable in this browser.'
  throw e
}
renderer.setClearColor(0x000000, 1)

const scene = new THREE.Scene()
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)

let dprCap = Math.min(window.devicePixelRatio || 1, 1.5)
let vw = 0
let vh = 0
let scale = 1 // figure: image px -> CSS px

/* -------------------------------------------------------------- image IO */

// Which art to load: the layers derived from the AI render (art/from-image.mjs)
// or the procedural ones (art/generate.mjs, add ?art=procedural).
const ART = new URLSearchParams(location.search).get('art') === 'procedural' ? 'img' : 'img-v2'
const meta = await (await fetch(`./${ART}/meta.json`)).json()
const { W, H, BW, BH, face: FACE } = meta
const CX = W / 2
// Particles per layer. The art can override any of these in its meta.json.
const BUDGET = {
  lines: 30000,
  fill: 0,
  rim: 22000,
  dust: 4500,
  redrim: 4500,
  lights: 4200,
  veins: 5200,
  chin: 0, // the chin's outline (only the art made from the render has one)
  arteries: 0, // the four arteries from the core in the chest to the head (likewise)
  face: 5500,
  faceBars: 5500, // the voice-print frames, which are sparse
  backdrop: 17000,
  ...meta.budget,
}
// Dev: ?budget=0.1 draws a tenth of the particles (a software renderer can then keep up).
const budgetScale = Number(new URLSearchParams(location.search).get('budget')) || 1
if (budgetScale !== 1) for (const k of Object.keys(BUDGET)) BUDGET[k] = Math.round(BUDGET[k] * budgetScale)

const scratch = document.createElement('canvas')
const sctx = scratch.getContext('2d', { willReadFrequently: true })

async function pixels(name) {
  const img = new Image()
  img.src = `./${ART}/${name}`
  await img.decode()
  scratch.width = img.naturalWidth
  scratch.height = img.naturalHeight
  sctx.drawImage(img, 0, 0)
  return { data: sctx.getImageData(0, 0, scratch.width, scratch.height).data, w: scratch.width, h: scratch.height }
}

/** Seeded so a reload draws the same particles. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Pick ~count bright pixels, favouring the brighter ones, and describe each as
 * a particle: where it lives, its colour, how big it is.
 */
function sample(img, count, { floor = 0.1, bias = 0.9, seed = 1 } = {}) {
  const r = rng(seed)
  const { data, w, h } = img
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    const l = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255
    if (l > floor) sum += Math.pow(l, bias)
  }
  const k = count / Math.max(sum, 1)
  const out = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const l = Math.max(data[i], data[i + 1], data[i + 2]) / 255
      if (l <= floor) continue
      if (r() > Math.pow(l, bias) * k) continue
      out.push({ x: x + r(), y: y + r(), r: data[i] / 255, g: data[i + 1] / 255, b: data[i + 2] / 255, l })
    }
  }
  return out
}

/* ---------------------------------------------------------------- shaders */

const vert = /* glsl */ `
  attribute vec2 aTarget;
  attribute vec2 aStart;    // the middle of where it floats while it is loose
  attribute float aCur;     // which of the five currents carries this particle
  attribute vec2 aTime;     // x delay, y duration
  attribute float aSeed;
  attribute float aSize;
  attribute float aJit;     // how far this particle wanders at rest, in image px
  attribute float aFace;    // 0..1, how deep inside the face glow this sits
  attribute vec3 aColor;
  attribute vec3 aArt;      // arteries only: x px along the artery from where it starts, y 0 a source / 1 an inner artery / 2 an outer one, z how much plate lies over it (0..1)

  uniform float uTime;
  uniform float uAsm;       // seconds since the assembly began
  uniform vec2  uAnchor;    // image px that maps to uOffset
  uniform vec2  uOffset;    // CSS px
  uniform float uScale;
  uniform float uPix;
  uniform vec2  uView;
  uniform vec4  uTrail[32]; // the cursor's recent path: xy image px, zw wind vector (direction x strength, already faded by age). 32 = TRAIL_N
  uniform float uLane[32];  // per sample: how hard it parts loose dust now (builds up after the cursor has passed, then fades)
  uniform float uWind;      // px a full-strength gust moves a loose particle (0 = this layer's dust ignores the cursor)
  uniform float uYaw;       // how far the head is turned, radians (+ = towards the right of the screen)
  uniform float uPitch;     // radians (+ = looking down)
  uniform vec4  uHead;      // the head as an ellipse, image px: xy its centre, zw its radii
  uniform vec2  uNeck;      // image y where the neck starts to stiffen (just under the chin), and where it is fully still
  uniform float uBodyYaw;   // how far the trunk is turned, radians (+ = towards the right of the screen)
  uniform float uBodyPitch; // radians (+ = leaning forward / down)
  uniform vec4  uClick;     // the last click: xy image px, z strength 0..1, w seconds ago
  uniform vec2  uAttn;      // image px: where the cursor is pointing
  uniform float uAttnOn;    // 0..1: the figure is paying attention to it
  uniform float uLevel;
  uniform float uDim;       // how much the face glow takes over from the cyan
  uniform float uWave;      // 1 = energy runs up the particles (veins)
  uniform float uIsFace;    // 1 = this layer is the face glow
  uniform float uArt;       // 1 = this layer is the arteries
  uniform float uArtHeat;   // how hard the arteries work: 0 at rest .. 1 at high intensity
  uniform float uArtPhase;  // px the arteries' pulses have travelled
  uniform vec3  uArtBeat;   // the sleeping heartbeat: x px its front has gone from the ports, y how strong it is, z how much of the steady flow is left (0 asleep)
  uniform float uBreath;    // px the figure has risen as it breathes in (negative breathing out)
  uniform float uParallax;
  uniform float uRed;       // 0 cyan, 1 everything that was cyan goes red
  uniform float uLife;      // brightness of the layer: low when dormant
  uniform float uLoose;     // how far particles wander at rest, relative
  uniform float uPulse;     // image y of a band of light travelling over the figure
  uniform float uPulseW;    // its half-width, image px
  uniform float uPulseA;    // how much brighter the band makes things (0 = no band)
  uniform float uWaveRate;  // speed of the energy running up the veins
  uniform float uWaveDepth; // how deep its troughs go
  uniform float uFreeTime;  // real seconds: the clock the loose cloud drifts on
  uniform float uBootAt;    // real time the boot began (huge while offline)
  uniform float uLive;      // 1 = fall back toward where the cloud is NOW (offline again)
  uniform float uFloat;     // 1 = this layer is part of the loose cloud
  uniform float uRamp;      // 1 = fade in as it arrives (the backdrop) instead of showing from the start
  uniform vec2  uCloud;     // centre the cloud turns around, image px
  uniform vec4  uCurA[5];   // per current: xy where it gathers its particles, zw where it delivers them
  uniform vec4  uCurB[5];   // per current: the two middle points of its path, xy and zw
  uniform vec2  uWedge;     // middle of the loose cloud, image px (the wedges are cut around it)
  uniform vec4  uCurM[5];   // per current: the 2x2 turn that takes its wedge from where it was baked to where it sits this boot
  uniform vec2  uFlowOff;   // where in the swirling field this boot reads its turbulence

  varying vec3 vColor;
  varying float vAlpha;

  const float UNIT = ${(H * 0.5).toFixed(1)}; // half the figure's height: one unit of the space the click pulse is measured in

  // Where this particle is at free-time t while it is loose: its place in the
  // cloud, a slow wander of its own, a flutter, and the whole cloud turning.
  vec2 loose(vec2 home, float t) {
    t *= 0.18; // the cloud drifts at a fraction of real time: nearly at rest
    float s = aSeed;
    float ph = s * 6.2831;
    float amp = (70.0 + fract(s * 7.31) * 170.0) * uFloat;
    vec2 q = home;
    q += vec2(sin(t * (0.16 + fract(s * 3.7) * 0.34) + ph * 3.0), cos(t * (0.19 + fract(s * 5.3) * 0.31) + ph * 5.0)) * amp;
    q += vec2(sin(t * 0.9 + q.y * 0.012 + ph), cos(t * 0.8 + q.x * 0.012 + ph * 1.7)) * 16.0 * uFloat;
    float a = t * 0.03 * uFloat;
    vec2 c = q - uCloud;
    return uCloud + vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  }

  // A slow swirling field shared by neighbours, so particles near each other
  // are swept the same way and travel in streams.
  vec2 flowField(vec2 q, float tt) {
    return vec2(
      sin(q.y * 0.007 + tt * 0.9) + 0.6 * sin(q.y * 0.017 - q.x * 0.009 + tt * 1.3),
      cos(q.x * 0.007 - tt * 0.8) + 0.6 * cos(q.x * 0.015 + q.y * 0.011 + tt * 1.1)
    );
  }

  // Where the head ends (image y) at dx px across from its middle; see the head block.
  float jawLine(float dx) {
    float ax = abs(dx);
    return uNeck.x + 8.0 - 22.0 * smoothstep(24.0, 80.0, ax) - 16.0 * smoothstep(80.0, 100.0, ax);
  }

  void main() {
    float t = clamp((uAsm - aTime.x) / aTime.y, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);

    // Each particle floats until the wind reaches it (boot time + its delay),
    // then is carried from exactly where it is to the pixel it belongs to. Coming
    // back (offline) it falls toward wherever the cloud has got to.
    float tDep = uBootAt + aTime.x;

    // Where it floats while loose. The wedges are baked in one arrangement; this
    // boot's arrangement turns each part's wedge about the middle of the cloud (in
    // the cloud's own squashed circle) to wherever that part is fed from now.
    vec2 home = aStart;
    if (uFloat > 0.5) {
      vec4 m = uCurM[int(aCur + 0.5)];
      vec2 v = aStart - uWedge;
      v.y /= 0.85;
      v = vec2(m.x * v.x + m.y * v.y, m.z * v.x + m.w * v.y);
      v.y *= 0.85;
      home = uWedge + v;
    }
    vec2 s0 = loose(home, mix(min(uFreeTime, tDep), uFreeTime, uLive));

    // The currents. There are five, one for each part of the figure. A current
    // gathers its particles from one wedge of the cloud (ca.xy is the middle of
    // it) and carries them as a single stream to its part of the figure (ca.zw is
    // the middle of that), along a path of its own: a cubic from ca.xy to ca.zw by
    // way of cb.xy and cb.zw, which for some of them swings far out of the window
    // and back. Each particle keeps its place in the bundle, and the bundle's shape
    // melts from the wedge into the part of the figure on the way, narrowing to a
    // river in between. Particles set off a little apart (aTime.x), so the bundle
    // stretches along its path into a ribbon.
    float env = sin(3.14159 * e);
    vec2 p;
    if (uFloat > 0.5) {
      int k = int(aCur + 0.5);
      vec4 ca = uCurA[k];
      vec4 cb = uCurB[k];
      float ie = 1.0 - e;
      vec2 G = ie * ie * ie * ca.xy + 3.0 * ie * ie * e * cb.xy + 3.0 * ie * e * e * cb.zw + e * e * e * ca.zw;
      p = G + mix(s0 - ca.xy, aTarget - ca.zw, e) * (1.0 - 0.7 * env);
      // A little turbulence, so a stream is not a rigid thing.
      p += flowField(p + uFlowOff, uAsm * 0.8 + uFlowOff.y * 0.013) * env * 16.0;
    } else {
      p = mix(s0, aTarget, e); // the backdrop just rises into place
    }

    // Life at rest: everything wanders a little, the dust a lot.
    float ph = aSeed * 6.2831;
    p += vec2(sin(uTime * (0.4 + aSeed * 0.9) + ph * 3.0), cos(uTime * (0.5 + aSeed * 0.7) + ph * 5.0)) * aJit * uLoose * e;
    // The whole figure breathes.
    p.y -= uBreath * e;
    vec2 pRest = p; // before the head and the trunk turn

    // looseness: 1 while a particle is dust in the cloud, 0 once it is part of the figure.
    float looseness = (1.0 - e) * uFloat;

    // THE HEAD LOOKS AT THE CURSOR. The art is flat, so the turn is a parallax: every
    // particle of the head is given a depth (the face a little proud of it), and a turn
    // about the neck slides it sideways (yaw) or up and down (pitch) by that depth. The
    // depth is rounded at the sides (so the outline stays put) and does not close up at the
    // chin: the jaw sits as far forward as the cheeks, and turns with them. The face
    // therefore travels further than the outline, the lines bunch up on the side turning
    // away, and the eyes slide across the face. The side turning away dims, but only to
    // about 60%: it should read as shade, never as particles switched off.
    //
    // THE NECK'S TWO CABLES. Under the jaw the neck is two thick segmented cables, one each
    // side of the plate that hangs from the chin (read off the render: axes about 100 px
    // either side of the middle, ~66 px thick, from the jaw to where they meet the
    // shoulders). The neck turns by twisting them, not by sliding as a slab: their axes stay
    // with the trunk, and the surface of each rotates about its own axis, most under the
    // jaw and not at all where it meets the shoulders, so the rings slant like a twisted
    // rope (see the cable block below). The plate between them belongs to the neck
    // assembly, which is fixed to the trunk: the chin slides over its top edge. cab is 1 on
    // a cable and 0 elsewhere: it fades toward the plate over 40 px and stops short outside.
    float cdx = aTarget.x - uHead.x;
    float cabX = uHead.z * 0.53;
    float cabR = uHead.z * 0.175;
    float cabTop = uNeck.x - 25.0;
    float cabBot = uNeck.y + 65.0;
    float cabOff = abs(cdx) - cabX;
    float cab = (1.0 - smoothstep(cabR, cabR + (cabOff < 0.0 ? 40.0 : 8.0), abs(cabOff)))
      * smoothstep(cabTop - 6.0, cabTop + 10.0, aTarget.y)
      * (1.0 - smoothstep(cabBot - 10.0, cabBot + 6.0, aTarget.y));

    // THE TRAPEZIUS belongs to the trunk, whole. In the render the neck stands in front of
    // it and the plates close behind the neck: the two are not joined, so the neck's turn
    // must not reach the trapezius at all (nothing twisting, no muscle). trap is 0 in the
    // head and the neck and 1 on everything beside the cables, starting exactly at the
    // cable's outer edge with a changeover of only 10 px; under the jaw it takes over at
    // once, where the head's own sides hand over to the shoulders.
    float trap = smoothstep(cabX + cabR - 2.0, cabX + cabR + 8.0, abs(cdx)) * smoothstep(cabTop - 10.0, cabTop + 6.0, aTarget.y);

    // WHERE THE HEAD ENDS AND THE NECK BEGINS, measured off the render (canvas y). The tip
    // of the chin is a round emblem (centre y 487, outline ending at 504) set in a cup of
    // plate: the cup's lower edge is flat under the emblem (y 507.5) and rises on a diagonal
    // to its corners about 80 px out (y 486), and from there to the cheeks' lower edge, about
    // 471 from 100 px out, where the tops of the cables tuck in under them. Under the cup is
    // a dark gap (the throat) and then the neck plate. So the head, jaw and chin included,
    // is one rigid piece down to that curve (jawLine, the edge + 1.5 px so that the edge
    // stays whole), and everything below it belongs to the neck assembly or the trunk. The
    // changeover is 10 px, inside the dark gap. below: 0 in the head, 1 under it.
    float jawY = jawLine(cdx);
    float below = smoothstep(jawY, jawY + 10.0, aTarget.y);
    // In all four renders the cables run up BEHIND the jaw and the chin: where the two
    // overlap, it is the head. So there is no cable above the jaw line, and the jaw turns
    // whole with the rest of the head (it used to be held back, and twisted, by the cables).
    cab *= below;

    float headLight = 1.0;
    if (uFloat > 0.5 && abs(uYaw) + abs(uPitch) > 0.0005) {
      vec2 hn = (aTarget - uHead.xy) / uHead.zw;
      float hdepth = sqrt(max(0.0, 1.0 - hn.x * hn.x)) * (1.0 - 0.3 * smoothstep(0.3, 1.0, -hn.y));
      float hz = (hdepth + aFace * 0.3) * uHead.z * 0.7;
      float hw = (1.0 - below) * (1.0 - trap) * e;
      p.x += hz * sin(uYaw) * hw * (1.0 - cab);
      p.y += (hz * sin(uPitch) + (cos(uPitch) - 1.0) * (aTarget.y - uNeck.x)) * hw;
      float nx = clamp(hn.x, -1.0, 1.0);
      float nvz = -nx * sin(uYaw) + sqrt(1.0 - nx * nx) * cos(uYaw);
      float effK = smoothstep(0.06, 0.30, abs(uYaw) + abs(uPitch) * 1.2) * hw;
      float facing = 0.6 + 0.4 * smoothstep(-0.05, 0.45, nvz);
      float rim = 1.0 - smoothstep(0.04, 0.30, abs(nvz));
      headLight = mix(1.0, facing, effK) * (1.0 + rim * effK * 0.3);
    }

    // THE TRUNK TURNS A LITTLE TOO, later and softer than the head (see the frame loop), so
    // the figure is never a head on a statue. Same parallax: the chest is a cylinder as wide
    // as the shoulders, so the plates across the middle slide while the shoulder tips stay,
    // the far side dims a little (to about 80% at most), and the weight fades down to nothing
    // at the bottom edge so the figure stays planted. Everything under the jaw (below) is
    // the trunk's: the neck plate, the trapezius (trap), the shoulders.
    float bodyLight = 1.0;
    if (uFloat > 0.5 && abs(uBodyYaw) + abs(uBodyPitch) > 0.0004) {
      float bw = max(below, trap) * (1.0 - smoothstep(uNeck.y + 130.0, uNeck.y + 560.0, aTarget.y)) * e;
      float bx = clamp((aTarget.x - uHead.x) / (uHead.z * 2.5), -1.0, 1.0);
      float bz = sqrt(1.0 - bx * bx) * uHead.z * 1.1;
      p.x += bz * sin(uBodyYaw) * bw * (1.0 - cab);
      p.y += bz * sin(uBodyPitch) * bw;
      float bvz = -bx * sin(uBodyYaw) + sqrt(1.0 - bx * bx) * cos(uBodyYaw);
      float beffK = smoothstep(0.03, 0.16, abs(uBodyYaw)) * bw;
      bodyLight = mix(1.0, 0.7 + 0.3 * smoothstep(-0.2, 0.5, bvz), beffK * 0.7);
    }

    // The cables. Each moves with the trunk (so it abuts the trapezius beside it without a
    // gap or an overlap) and its surface rotates about its own axis by the head's turn
    // relative to the trunk, wound up along it (x3.5, so that it reads): the middle of the
    // cable moves across it, the edges stay, so the silhouette holds and nothing folds over.
    // cs: 0 under the jaw .. 1 at the shoulders.
    if (cab > 0.001 && uFloat > 0.5 && abs(uYaw) + abs(uBodyYaw) > 0.0004) {
      float cs = smoothstep(cabTop, cabBot, aTarget.y);
      float cu = clamp((cdx - (cdx < 0.0 ? -cabX : cabX)) / cabR, -1.0, 1.0);
      float cbz = sqrt(1.0 - min(1.0, (cdx * cdx) / (uHead.z * uHead.z * 6.25))) * uHead.z * 1.1;
      float sway = cbz * sin(uBodyYaw);
      float wind = 3.5 * (uYaw - uBodyYaw) * (1.0 - cs);
      float twist = cabR * 0.5 * sin(clamp(wind, -1.2, 1.2)) * (1.0 - cu * cu);
      p.x += (sway + twist) * cab * e;
    }

    // THE NECK PASSES BEHIND THE HEAD. When the head turns or nods, its jaw moves over the
    // tops of the cables and the plate, and whatever it now covers is hidden (dimmed: the
    // light is additive, so nothing would hide it otherwise). A particle of the neck is
    // tested against the head's lower edge where the head has moved to: lx is the place
    // across the head that has come to lie over it, found by undoing the jaw's own shift.
    float behind = 1.0;
    float nw = max(below, trap);
    if (nw > 0.001 && uFloat > 0.5 && abs(uYaw) + abs(uPitch) > 0.0005) {
      vec2 q = aTarget + (p - pRest) - uHead.xy;
      float lx = q.x;
      for (int i = 0; i < 2; i++) {
        float jn = clamp(lx / uHead.z, -1.0, 1.0);
        lx = q.x - sqrt(1.0 - jn * jn) * uHead.z * 0.7 * sin(uYaw);
      }
      float jn = clamp(lx / uHead.z, -1.0, 1.0);
      float jy = jawLine(lx) - uHead.y;
      jy += sqrt(1.0 - jn * jn) * uHead.z * 0.7 * sin(uPitch) + (cos(uPitch) - 1.0) * (jy + uHead.y - uNeck.x);
      float hidden = (1.0 - smoothstep(jy - 6.0, jy, q.y)) * (1.0 - smoothstep(122.0, 136.0, abs(lx)));
      behind = 1.0 - 0.85 * hidden * nw * e;
    }

    // THE CURSOR IN THE LOOSE DUST. The figure does not feel the cursor as a wind any
    // more (it looks at it, above); only dust does. It drags the dust a little along the
    // way it was going, and parts it: every sample of the path clears a small disc round
    // itself, a particle at distance d from it being pushed out to sqrt(d^2 + w^2), so
    // nothing is left inside w and the rest is nudged aside, more the closer it was. w
    // follows the sample's lane strength (uLane: the cursor's speed there, building up a
    // moment after it has passed and fading within a second), so a small gap opens just
    // behind the cursor and the dust drifts back in. Each particle has its own w and its
    // own slight sideways turn, so the edges are ragged.
    if (looseness > 0.01 && uWind > 0.0) {
      vec2 gust = vec2(0.0);
      for (int i = 0; i < 32; i++) {
        vec4 sm = uTrail[i];
        if (dot(sm.zw, sm.zw) < 0.000001) continue;
        vec2 dd = p - sm.xy;
        gust += sm.zw * exp(-dot(dd, dd) / 6400.0);
      }
      p += (gust + vec2(-gust.y, gust.x) * 0.35 * (aSeed - 0.5) * 2.0) * uWind * (0.35 + aSeed * 0.9) * 0.15 * looseness;

      float wv = 0.75 + 0.5 * fract(aSeed * 7.31);
      float turn = (fract(aSeed * 3.7) - 0.5) * 0.8;
      for (int i = 0; i < 32; i++) {
        vec4 sm = uTrail[i];
        float s = uLane[i];
        if (s < 0.01) continue;
        vec2 dd = p - sm.xy;
        float d = length(dd);
        vec2 away = d > 0.5 ? dd / d : vec2(cos(ph), sin(ph));
        float a = turn * min(1.0, s * 2.0);
        away = vec2(away.x * cos(a) - away.y * sin(a), away.x * sin(a) + away.y * cos(a));
        float lw = 36.0 * pow(s, 0.65) * wv * looseness;
        p += away * (sqrt(d * d + lw * lw) - d);
      }
    }

    // Where the cursor points, the veins glow: they are what the figure feels with.
    float attnLight = 1.0;
    if (uWave > 0.5 && uAttnOn > 0.001) {
      attnLight = 1.0 + 0.7 * uAttnOn * (1.0 - smoothstep(0.0, 140.0, distance(aTarget, uAttn)));
    }

    // THE CLICK IS LIGHT, hardly motion: a wavefront of brightness runs out from where it
    // landed through the whole body, strongest on the veins, fading as it goes. The
    // matter itself only leans toward the click by a hair.
    float clickLight = 1.0;
    if (uClick.z > 0.001 && uFloat > 0.5) {
      vec2 toC = uClick.xy - aTarget;
      float dC = length(toC) / UNIT;
      float wf = 1.0 - smoothstep(0.0, 0.34, abs(dC - 2.6 * uClick.w));
      clickLight = 1.0 + wf * uClick.z * (uWave > 0.5 ? 2.0 : 0.8) * e;
      p += (toC / max(length(toC), 1.0)) * uClick.z * exp(-6.0 * dC * dC) * UNIT * 0.01 * e;
    }

    // THE ARTERIES carry energy from the chest up to the head, UNDER the metal: where a
    // plate lies over them (aArt.z) they hardly show, so at rest they are seen only in the
    // seams, gaps and red channels, and dimly at that. The harder they work (uArtHeat) the
    // brighter they run and the more of their light gets through the plates, so they draw
    // the eye only at high intensity. Pulses leave the sources 260 px apart (uArtPhase runs
    // faster with heat, on the figure's own clock) and run up all four; the sources flare
    // as one sets off. Asleep the steady flow stops and only a weak heartbeat is left: one
    // pulse a breath, leaving the ports and dying out by the neck.
    float artLight = 1.0;
    if (uArt > 0.5) {
      float k = (aArt.x - uArtPhase) / 260.0;
      float band = pow(0.5 + 0.5 * cos(6.2831 * k), 8.0);
      float beat = pow(0.5 + 0.5 * cos(6.2831 * uArtPhase / 260.0), 6.0);
      float flow = mix(0.5, aArt.y < 0.5 ? 0.75 + 0.6 * beat : 0.5 + 1.1 * band, uArtBeat.z);
      float hz = (aArt.x - uArtBeat.x) / 26.0;
      flow += 2.4 * uArtBeat.y * exp(-hz * hz) * exp(-aArt.x / 120.0);
      float through = mix(0.06, 0.65, uArtHeat);
      artLight = flow * mix(1.0, through, aArt.z) * mix(0.5, 1.7, uArtHeat);
    }

    // Voice makes the face shiver.
    p.y += sin(p.x * 0.06 + uTime * 11.0 + ph) * uLevel * aFace * 2.6 * uIsFace;

    vec2 w = (p - uAnchor) * uScale;
    w.y = -w.y;
    w += uOffset;
    w.x += uParallax * (0.4 + aSeed * 0.6);
    gl_Position = vec4(w.x / (uView.x * 0.5), w.y / (uView.y * 0.5), 0.0, 1.0);

    // Cyan gives way under the orange; orange swells with the voice.
    float dim = 1.0 - uDim * aFace * (1.0 - uIsFace);
    float boost = 1.0 + uLevel * 0.55 * uIsFace;
    float wave = mix(1.0, (1.0 - uWaveDepth) + uWaveDepth * sin(uTime * uWaveRate - p.y * 0.012 + ph), uWave);

    // Brighter while in flight, so the assembly reads as a stream of light.
    float flight = 1.0 + (1.0 - abs(e * 2.0 - 1.0)) * (1.0 - step(0.999, t)) * 1.2;
    // A band of light sweeping over the figure (waking, tooling).
    float pz = (p.y - uPulse) / uPulseW;
    float pulse = uPulseA * exp(-pz * pz);
    float shown = mix(1.0, smoothstep(0.0, 0.12, t), uRamp);
    // Loose motes differ: a few bright, most dim, all twinkling slowly. That
    // fades out as each one becomes part of the figure.
    float mote = (0.25 + 1.5 * pow(fract(aSeed * 9.13), 3.0)) * (0.8 + 0.2 * sin(uFreeTime * (0.2 + aSeed * 0.5) + ph));
    vAlpha = shown * mix(1.0, mote, looseness) * dim * wave * boost * flight * uLife * (1.0 + pulse) * headLight * bodyLight * attnLight * clickLight * behind * artLight;
    // Palette swap: cyan (and its white highlights) becomes red, red stays red.
    float m = max(max(aColor.r, aColor.g), aColor.b);
    float whiteness = min(min(aColor.r, aColor.g), aColor.b) / max(m, 0.001);
    vec3 redC = mix(vec3(1.0, 0.13, 0.1), vec3(1.0, 0.72, 0.62), clamp(whiteness * 1.4, 0.0, 1.0)) * m;
    vColor = mix(aColor, redC, uRed);
    gl_PointSize = max(1.0, aSize * uPix * (1.0 + uLevel * 0.25 * uIsFace + pulse * 0.3) * mix(1.0, 0.7 + 0.8 * fract(aSeed * 5.7), looseness) * (1.0 + (clickLight - 1.0) * 0.1) * (1.0 + (artLight - 1.0) * 0.2));
  }
`

const frag = /* glsl */ `
  uniform float uFade;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vColor, a * vAlpha * uFade);
  }
`

// The cursor's path, shared by every layer: 32 samples, newest first. Each one
// is where the cursor was, which way it went and how hard (0..1), already faded
// by its age; the shader lets each drag the particles around it.
const TRAIL_N = 32
const trailU = { value: Array.from({ length: TRAIL_N }, () => new THREE.Vector4(-9999, -9999, 0, 0)) }
// How hard each sample parts loose dust right now (0..1): the cursor's speed there,
// shaped by the sample's age (see stirTrail).
const laneU = { value: new Array(TRAIL_N).fill(0) }
// The head as an ellipse, from the face the art says it has (for the art made from the
// AI render: centre (512, 290), radii (189, 195), the neck from 501 to 601), and the
// last click and the cursor's point, for the shader.
const headU = { value: new THREE.Vector4(FACE.cx, FACE.cy - 0.33 * FACE.sy, 1.8 * FACE.sx, 1.56 * FACE.sy) }
const neckU = { value: new THREE.Vector2(FACE.cy + 1.36 * FACE.sy, FACE.cy + 1.36 * FACE.sy + 100) }
const clickU = { value: new THREE.Vector4(0, 0, 0, 99) }
const attnU = { value: new THREE.Vector2(-9999, -9999) }

// The currents. Five of them, one per part of the figure; the figure is built
// bottom to top, a part at a time. Each current gathers its particles from one
// wedge of the loose cloud and carries them, as a single stream, to its part.
// Which wedge feeds which part, and the path each current takes, are drawn anew
// for every boot (rollWedges, rollRoutes), so no two boots look the same.
const K = 5
const SLOT = (Math.PI * 2) / K
// The wedges as they are baked into each particle's loose place (figureStart);
// the shader turns each part's wedge from here to where it sits now.
const HOME_ANGLE = [126, 54, 198, 342, 270].map((d) => (d * Math.PI) / 180)
const wedgeAngle = HOME_ANGLE.slice() // where each part's wedge is centred now
const wedgeM = { value: Array.from({ length: K }, () => new THREE.Vector4(1, 0, 0, 1)) }
const wedgeAt = { value: new THREE.Vector2() }
const flowOff = { value: new THREE.Vector2() }
const curA = { value: Array.from({ length: K }, () => new THREE.Vector4()) }
const curB = { value: Array.from({ length: K }, () => new THREE.Vector4()) }
const curSrc = [] // where each gathers
const curDst = [] // where each delivers
let routes = [] // how each current travels this boot
let reachNow = 2000 // how far a current can carry a particle: past any edge of the window
let yEdges = [] // boundaries between the parts, bottom to top (image y)
let figX0 = 0 // where the figure starts and ends across the image
let figX1 = 1
const xCdf = [] // per part: cumulative share of the figure's light to the left of each x
/** Which part of the figure (0 = bottom .. K-1 = head) a pixel at height y belongs to. */
const bandOf = (y) => {
  let k = 0
  while (k < K - 1 && y < yEdges[k]) k++
  return k
}
const bandIndex = (p) => bandOf(p.y)

// Seeds. Every roll takes a new one; ?seed=N makes the whole sequence repeatable
// (N, N+101, N+202 ...), and R replays the last boot with the seeds it used.
const pinned = new URLSearchParams(location.search).get('seed')
let seedCount = 0
const newSeed = () => (pinned != null ? (Number(pinned) + 101 * seedCount++) >>> 0 : Math.floor(Math.random() * 4294967296))
const plan = { wedge: 0, route: 0 } // the seeds in effect
let lastBoot = null // the seeds the last boot ran on

function shuffle(a, r) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Cut the figure into K parts of equal weight, bottom to top, so each current
 * carries the same number of particles (and the dust looks even before the boot),
 * and find the middle of each part and of the wedge of cloud that feeds it.
 */
function partitionFigure(img) {
  const { data, w, h } = img
  const lum = (i) => Math.max(data[i], data[i + 1], data[i + 2]) / 255
  const rows = new Float64Array(h)
  const cols = new Float64Array(w)
  let total = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = lum((y * w + x) * 4)
      if (l > 0.05) {
        rows[y] += l
        cols[x] += l
        total += l
      }
    }
  }
  // Where the figure starts and ends across the image (a hair in from the very
  // edge-most pixels), so the cyan sweep spends its whole time on the figure.
  let seen = 0
  figX0 = 0
  figX1 = w - 1
  for (let x = 0, got0 = false; x < w; x++) {
    seen += cols[x]
    if (!got0 && seen >= total * 0.015) {
      figX0 = x
      got0 = true
    }
    if (seen >= total * 0.985) {
      figX1 = x
      break
    }
  }
  yEdges = []
  let acc = 0
  let k = 1
  for (let y = h - 1; y >= 0 && k < K; y--) {
    acc += rows[y]
    if (acc >= (total * k) / K) {
      yEdges.push(y)
      k++
    }
  }
  const sx = new Float64Array(K)
  const sy = new Float64Array(K)
  const sm = new Float64Array(K)
  for (let y = 0; y < h; y++) {
    const b = bandOf(y)
    for (let x = 0; x < w; x++) {
      const l = lum((y * w + x) * 4)
      if (l > 0.05) {
        sx[b] += l * x
        sy[b] += l * y
        sm[b] += l
      }
    }
  }
  for (let b = 0; b < K; b++) {
    const col = new Float64Array(w)
    for (let y = 0; y < h; y++) {
      if (bandOf(y) !== b) continue
      for (let x = 0; x < w; x++) {
        const l = lum((y * w + x) * 4)
        if (l > 0.05) col[x] += l
      }
    }
    const cdf = new Float32Array(w)
    let run = 0
    for (let x = 0; x < w; x++) {
      run += col[x]
      cdf[x] = run / Math.max(sm[b], 1e-6)
    }
    xCdf[b] = cdf
    curDst[b] = [sx[b] / Math.max(sm[b], 1e-6), sy[b] / Math.max(sm[b], 1e-6)]
  }
}

/**
 * Which wedge of the cloud feeds which part of the figure. The five wedges always
 * tile the cloud; this deals them out again and turns the whole set by a random
 * amount, so the head can be fed from the left one boot and from below the next.
 * Only while the figure is whole (or before the cloud has been seen): the dust keeps
 * the place it was baked with and the shader turns it, which would be a jump to
 * anyone who could see it.
 */
function rollWedges(seed) {
  plan.wedge = seed
  const r = rng(seed)
  const order = shuffle(Array.from({ length: K }, (_, i) => i), r)
  const phase = r() * Math.PI * 2
  for (let b = 0; b < K; b++) wedgeAngle[b] = phase + order[b] * SLOT
  wedgeAt.value.set(CLOUD.x, CLOUD.y)
  for (let b = 0; b < K; b++) {
    const d = wedgeAngle[b] - HOME_ANGLE[b]
    wedgeM.value[b].set(Math.cos(d), -Math.sin(d), Math.sin(d), Math.cos(d))
    curSrc[b] = [CLOUD.x + Math.cos(wedgeAngle[b]) * 0.52 * CLOUD.R, CLOUD.y + Math.sin(wedgeAngle[b]) * 0.52 * CLOUD.R * 0.85]
  }
  setGuides()
}

/**
 * How each current travels. One to three of them are strong enough to carry their
 * particles out of the window and back (which ones, which way round and how far
 * out are drawn); the others swing across it in wide arcs of their own.
 */
function rollRoutes(seed) {
  plan.route = seed
  const r = rng(seed)
  const n = r() < 0.5 ? 2 : r() < 0.5 ? 1 : 3
  const out = shuffle(Array.from({ length: K }, (_, i) => i), r).slice(0, n)
  routes = Array.from({ length: K }, (_, b) => ({
    out: out.includes(b),
    side: r() < 0.5 ? -1 : 1,
    turn: 0.6 + r() * 0.8, // how far round it comes back, radians
    far1: 0.7 + r() * 0.25, // how far out it goes, as a share of the reach
    far2: 0.55 + r() * 0.3,
    sag1: 0.35 + r() * 0.3, // how wide the arc bows, as a share of its length
    sag2: 0.25 + r() * 0.25,
  }))
  flowOff.value.set(r() * 900, r() * 900)
  setGuides()
}

/** The path of each current: the cubic through its two middle points (needs the window's size, because some of them leave it). */
function setGuides() {
  if (!routes.length) return
  const reach = reachNow
  for (let b = 0; b < K; b++) {
    const S = curSrc[b]
    const T = curDst[b]
    if (!S || !T) return
    const R = routes[b]
    const dx = T[0] - S[0]
    const dy = T[1] - S[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    let c1
    let c2
    if (R.out) {
      // Its middle points sit far beyond the edge, further out along the way it came,
      // and it returns round another side.
      const ox = S[0] - CLOUD.x
      const oy = S[1] - CLOUD.y
      const ol = Math.hypot(ox, oy) || 1
      const ang = R.turn * R.side
      const bx = (ox / ol) * Math.cos(ang) - (oy / ol) * Math.sin(ang)
      const by = (ox / ol) * Math.sin(ang) + (oy / ol) * Math.cos(ang)
      c1 = [S[0] + (ox / ol) * reach * R.far1, S[1] + (oy / ol) * reach * R.far1]
      c2 = [T[0] + bx * reach * R.far2, T[1] + by * reach * R.far2]
    } else {
      // A wide, swirling arc across the window.
      c1 = [S[0] + dx * 0.3 + nx * len * R.sag1 * R.side, S[1] + dy * 0.3 + ny * len * R.sag1 * R.side]
      c2 = [T[0] - dx * 0.3 + nx * len * R.sag2 * R.side, T[1] - dy * 0.3 + ny * len * R.sag2 * R.side]
    }
    curA.value[b].set(S[0], S[1], T[0], T[1])
    curB.value[b].set(c1[0], c1[1], c2[0], c2[1])
  }
}

const common = () => ({
  uTime: { value: 0 },
  uAsm: { value: -1 },
  uAnchor: { value: new THREE.Vector2(CX, H) },
  uOffset: { value: new THREE.Vector2() },
  uScale: { value: 1 },
  uPix: { value: 1 },
  uView: { value: new THREE.Vector2(1, 1) },
  uTrail: trailU,
  uLane: laneU,
  uYaw: { value: 0 },
  uPitch: { value: 0 },
  uBodyYaw: { value: 0 },
  uBodyPitch: { value: 0 },
  uAttnOn: { value: 0 },
  uHead: headU,
  uNeck: neckU,
  uClick: clickU,
  uAttn: attnU,
  uWind: { value: 0 },
  uLevel: { value: 0 },
  uDim: { value: 0.8 },
  uWave: { value: 0 },
  uIsFace: { value: 0 },
  uArt: { value: 0 },
  uArtHeat: { value: 0 },
  uArtPhase: { value: 0 },
  uArtBeat: { value: new THREE.Vector3(-9999, 0, 1) },
  uBreath: { value: 0 },
  uParallax: { value: 0 },
  uRed: { value: 0 },
  uFade: { value: 1 },
  uLife: { value: 1 },
  uLoose: { value: 1 },
  uPulse: { value: -9999 },
  uPulseW: { value: 60 },
  uPulseA: { value: 0 },
  uWaveRate: { value: 2.4 },
  uWaveDepth: { value: 0.38 },
  uFreeTime: { value: 0 },
  uBootAt: { value: 1e9 },
  uLive: { value: 0 },
  uFloat: { value: 1 },
  uRamp: { value: 0 },
  uCloud: { value: new THREE.Vector2(CX, H * 0.5) },
  uCurA: curA,
  uCurB: curB,
  uWedge: wedgeAt,
  uCurM: wedgeM,
  uFlowOff: flowOff,
})

/* -------------------------------------------------------------- particles */

const layers = [] // { points, uniforms, kind }

// attrs: extra per-particle attributes, { aName: [size, (p) => values] }.
function makeLayer(list, { kind, anchor, jitter, delayOf, durOf = cyanDur, curOf = bandIndex, startOf, seed, size = 1, attrs = {} }) {
  const n = list.length
  const r = rng(seed)
  const a = {
    target: new Float32Array(n * 2),
    start: new Float32Array(n * 2),
    cur: new Float32Array(n),
    time: new Float32Array(n * 2),
    seed: new Float32Array(n),
    size: new Float32Array(n),
    jit: new Float32Array(n),
    face: new Float32Array(n),
    color: new Float32Array(n * 3),
  }
  for (let i = 0; i < n; i++) {
    const p = list[i]
    a.target.set([p.x, p.y], i * 2)
    const [sx, sy] = startOf(p, r)
    a.start.set([sx, sy], i * 2)
    a.cur[i] = curOf(p)
    a.time.set([delayOf(p, r, [sx, sy]), durOf(p, r, [sx, sy])], i * 2)
    a.seed[i] = r()
    a.size[i] = ((kind === 'back' ? 1.4 : 1.6) + p.l * (kind === 'back' ? 1.2 : 1.6)) * size
    a.jit[i] = jitter(p, r)
    const fb = faceBlob(p.x, p.y)
    a.face[i] = fb
    // Keep the hue, but lift the dim pixels: a contour line is faint in the
    // image yet needs to read as a bright dot once it is a particle.
    const f = (0.42 + 0.58 * Math.sqrt(p.l)) / p.l
    a.color.set([p.r * f, p.g * f, p.b * f], i * 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
  g.setAttribute('aTarget', new THREE.BufferAttribute(a.target, 2))
  g.setAttribute('aStart', new THREE.BufferAttribute(a.start, 2))
  g.setAttribute('aCur', new THREE.BufferAttribute(a.cur, 1))
  g.setAttribute('aTime', new THREE.BufferAttribute(a.time, 2))
  g.setAttribute('aSeed', new THREE.BufferAttribute(a.seed, 1))
  g.setAttribute('aSize', new THREE.BufferAttribute(a.size, 1))
  g.setAttribute('aJit', new THREE.BufferAttribute(a.jit, 1))
  g.setAttribute('aFace', new THREE.BufferAttribute(a.face, 1))
  g.setAttribute('aColor', new THREE.BufferAttribute(a.color, 3))
  for (const [name, [w, of]] of Object.entries(attrs)) {
    const v = new Float32Array(n * w)
    for (let i = 0; i < n; i++) v.set(of(list[i]), i * w)
    g.setAttribute(name, new THREE.BufferAttribute(v, w))
  }
  const uniforms = common()
  uniforms.uAnchor.value.set(anchor[0], anchor[1])
  uniforms.uFloat.value = kind === 'back' ? 0 : 1
  uniforms.uRamp.value = kind === 'back' ? 1 : 0
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(g, m)
  points.frustumCulled = false
  scene.add(points)
  const layer = { points, uniforms, kind }
  layers.push(layer)
  return layer
}

/** A Catmull-Rom curve through [x, y, hidden] points, every half px: where it is, which way it
 * runs, how far along it is (s, px) and whether it is out of sight (when either end of its
 * stretch is). */
function spline(pts) {
  const out = []
  let s = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5))
    const hid = !!(p1[2] || p2[2])
    for (let k = 0; k < n; k++) {
      const t = k / n
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t)
      const x = f(p0[0], p1[0], p2[0], p3[0])
      const y = f(p0[1], p1[1], p2[1], p3[1])
      const last = out[out.length - 1]
      const ds = last ? Math.hypot(x - last.x, y - last.y) : 0
      s += ds
      out.push({ x, y, s, ds, hid, tx: last ? (x - last.x) / (ds || 1) : 0, ty: last ? (y - last.y) / (ds || 1) : -1 })
    }
  }
  return out
}

/**
 * The arteries as particles, along the course the art gives (meta.arteries, canvas px): a
 * dense stroke a px or so wide with a sparse glow round it, nothing where an artery runs out
 * of sight, and at each source (a pectoral port, or the one core) a hot disc in a ring. Each
 * particle knows how far along its artery it is (s, px from the source, the hidden stretches
 * included) and which artery that is (role: 0 a source, 1 inner, 2 outer), so effects can
 * run up them.
 */
function arteryParticles({ sources, sourceSize = 1, routes }, count, seed, plates) {
  const r = rng(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
  const paths = routes.map((rt) => ({ role: rt.role === 'inner' ? 1 : 2, pts: spline(rt.pts) }))
  const shown = paths.reduce((n, pa) => n + pa.pts.reduce((m, q) => m + (q.hid ? 0 : q.ds), 0), 0)
  const coreN = Math.round(count * 0.06 * sourceSize)
  const per = (count - coreN) / shown
  const out = []
  for (const pa of paths) {
    for (const q of pa.pts) {
      if (q.hid) continue
      for (let want = per * q.ds; want > 0; want--) {
        if (r() >= Math.min(1, want)) continue
        const glow = r() < 0.25
        const off = gauss() * (glow ? 2.6 : 0.8)
        const along = (r() - 0.5) * 0.5
        out.push({
          x: q.x - q.ty * off + q.tx * along,
          y: q.y + q.tx * off + q.ty * along,
          ...(glow ? { r: 1, g: 0.13, b: 0.1, l: 0.45 } : { r: 1, g: 0.22, b: 0.14, l: 0.85 }),
          s: q.s,
          role: pa.role,
        })
      }
    }
  }
  for (let i = 0; i < coreN; i++) {
    const src = sources[i % sources.length]
    const a = r() * Math.PI * 2
    const disc = r() < 0.6
    const d = (disc ? Math.sqrt(r()) * 6.5 : 12 + gauss() * 0.8) * sourceSize
    out.push({
      x: src[0] + Math.cos(a) * d,
      y: src[1] + Math.sin(a) * d,
      ...(disc ? { r: 1, g: 0.4, b: 0.28, l: 0.95 } : { r: 1, g: 0.16, b: 0.11, l: 0.6 }),
      s: 0,
      role: 0,
    })
  }
  // How much plate lies over each one (plates.png, 0 open .. 1 a plate).
  for (const p of out) {
    const x = Math.min(plates.w - 1, Math.max(0, Math.round(p.x)))
    const y = Math.min(plates.h - 1, Math.max(0, Math.round(p.y)))
    p.cover = plates.data[(y * plates.w + x) * 4] / 255
  }
  return out
}

function faceBlob(x, y) {
  const dx = (x - FACE.cx) / (FACE.sx * 1.05)
  const dy = (y - FACE.cy) / (FACE.sy * 1.05)
  return y > 700 ? 0 : Math.exp(-(dx * dx + dy * dy))
}

// Offline, nothing has a shape: every particle floats loose in a wide, slowly
// turning cloud (the shader moves it, see loose()); this only picks the middle
// of each one's wander. On the click each leaves from wherever it happens to be
// and flies to its place: the red things first (the lights, the veins), then
// the cyan body around them, the head before the chest.
// Sized from the window, so the dust reaches the edges of a wide monitor too.
const viewScale = Math.min(window.innerHeight / H, (window.innerWidth * 1.08) / W)
const worldW = window.innerWidth / viewScale
const worldH = window.innerHeight / viewScale
const CLOUD = { x: CX, y: H - worldH / 2, R: Math.max(1250, 0.6 * Math.hypot(worldW, worldH)) }
/**
 * Each particle floats in the wedge of the cloud that its current gathers from,
 * and within the wedge those that will end up on the left of their part float on
 * one side and those that will end up on the right on the other, so a stream does
 * not tangle on its way. Together the five wedges are an even cloud. This bakes
 * them in one arrangement (HOME_ANGLE); each boot the shader turns them (rollWedges).
 */
function figureStart(p, r) {
  const b = bandOf(p.y)
  const wedge = (Math.PI * 2) / K
  // Its place across the wedge is its rank, left to right, in its part of the figure,
  // with a little noise (reflected, not clamped, so the density stays even).
  let u = xCdf[b][Math.min(W - 1, Math.floor(p.x))] + (r() - 0.5) * 0.3
  u = u < 0 ? -u : u > 1 ? 2 - u : u
  const ang = HOME_ANGLE[b] + (u - 0.5) * wedge
  const k = r()
  const ray = (sigma) => sigma * Math.sqrt(-2 * Math.log(1 - r()))
  const rad = k < 0.35 ? CLOUD.R * Math.sqrt(r()) : k < 0.8 ? ray(480) : ray(260)
  return [CLOUD.x + Math.cos(ang) * rad, CLOUD.y + Math.sin(ang) * rad * 0.85]
}
// The order the figure is built in, two fronts at once. The red (veins, glow off
// the plates) climbs from the bottom to the top of the figure; the cyan body sweeps
// across it from the left edge to the right. Neither waits for the other: the cyan
// sets off while the red is still climbing. Both fronts are continuous (position
// along the front, not slab by slab), so they never leave a hard line where two
// currents meet. The eyes, with the glow of the face, are
// the last thing to appear, as the rest is still landing.
const climb = (p) => Math.max(0, Math.min(1, (H - p.y) / (H - 60)))
const sweep = (p) => Math.max(0, Math.min(1, (p.x - figX0) / Math.max(figX1 - figX0, 1)))
const RED_SPAN = 4.4 // the red front climbs the figure in this long
const redDelay = (p, r) => climb(p) * RED_SPAN + r() * 0.3
const CYAN_AT = 0.9
const CYAN_SPAN = 5.0 // the cyan front crosses the figure in this long
const figureDelay = (p, r) => CYAN_AT + sweep(p) * CYAN_SPAN + r() * 0.7
// The eyes set off while the last of the cyan is still arriving and land with it
// (a hair after the bulk of it), so they are the last thing to appear without being
// a stage of their own. Everything has landed by ASM_END, when the boot ends.
const EYES_AT = 7.6
const ASM_END = 10.8
const eyesDelay = (p, r) => EYES_AT + r() * 0.5
// Every particle flies at about the same pace whichever current carries it, so the
// stream holds together and the front stays continuous where two parts meet (the
// currents that loop out of the window simply go faster).
const redDur = (p, r) => 1.8 + r() * 0.7
const cyanDur = (p, r) => 2.6 + r() * 1.0
const eyesDur = (p, r) => 1.3 + r() * 0.6

async function build() {
  const [lines, rim, dust, redrim, lights, veins, backdrop] = await Promise.all(
    ['lines.png', 'rim.png', 'dust.png', 'redrim.png', 'lights.png', 'veins.png', 'backdrop.png'].map(pixels),
  )
  partitionFigure(lines)
  rollWedges(newSeed())
  rollRoutes(newSeed())

  // The figure is three layers so that each gets its own share of the budget:
  // sampled together, the bright rim would swallow every particle and the
  // contour lines that give the body its volume would vanish.
  const figure = { kind: 'figure', anchor: [CX, H], delayOf: figureDelay, startOf: figureStart }
  makeLayer(sample(lines, BUDGET.lines, { floor: 0.05, bias: 0.25, seed: 11 }), {
    ...figure,
    seed: 101,
    jitter: (p, r) => 0.3 + r() * 0.7,
  })
  // The shading of the plates, for art that has it (the AI render does).
  if (meta.fill) {
    const fill = await pixels('fill.png')
    makeLayer(sample(fill, BUDGET.fill, { floor: 0.05, bias: 1, seed: 19 }), {
      ...figure,
      seed: 109,
      jitter: (p, r) => 0.2 + r() * 0.5,
    })
  }
  // Extra particles for the head, which is small on screen and carries the
  // character: finer, denser, same palette (see art/from-image.mjs).
  if (meta.head) {
    const [headLines, headFill] = await Promise.all(['head-lines.png', 'head-fill.png'].map(pixels))
    makeLayer(sample(headLines, BUDGET.headLines, { floor: 0.05, bias: 0.8, seed: 21 }), {
      ...figure,
      seed: 111,
      size: 0.8,
      jitter: (p, r) => 0.2 + r() * 0.4,
    })
    makeLayer(sample(headFill, BUDGET.headFill, { floor: 0.05, bias: 1, seed: 22 }), {
      ...figure,
      seed: 112,
      size: 0.8,
      jitter: (p, r) => 0.2 + r() * 0.4,
    })
  }
  // The chin emblem's outline and the edge where the head ends, a little denser than the
  // lines around them but otherwise exactly the head's lines (see art/from-image.mjs).
  if (meta.chin) {
    const chin = await pixels('chin.png')
    makeLayer(sample(chin, BUDGET.chin, { floor: 0.05, bias: 0.8, seed: 40 }), {
      ...figure,
      seed: 120,
      size: 0.8,
      jitter: (p, r) => 0.2 + r() * 0.4,
    })
  }
  makeLayer(sample(rim, BUDGET.rim, { floor: 0.06, bias: 0.5, seed: 14 }), {
    ...figure,
    seed: 104,
    jitter: (p, r) => 0.15 + r() * 0.5,
  })
  makeLayer(sample(dust, BUDGET.dust, { floor: 0.06, bias: 0.3, seed: 15 }), {
    ...figure,
    seed: 105,
    jitter: (p, r) => 2 + r() * 6,
  })

  // Red light spilling off the figure. It is already red, so the palette swap leaves
  // it be (uRed is only driven on the cyan layers, see the frame loop). No flare runs
  // across the eyes: it read as a red line through the face.
  makeLayer(sample(redrim, BUDGET.redrim, { floor: 0.05, bias: 0.5, seed: 16 }), {
    ...figure,
    kind: 'redlight',
    seed: 106,
    jitter: (p, r) => 0.6 + r() * 1.6,
    delayOf: redDelay,
    durOf: redDur,
  })

  // The eyes, the cheek targets and the creases across the forehead. Their own
  // layer so the frame loop can drive their brightness by state. They light last.
  lightsLayer = makeLayer(sample(lights, BUDGET.lights, { floor: 0.05, bias: 0.4, seed: 18 }), {
    ...figure,
    kind: 'redlight',
    seed: 108,
    jitter: () => 0.25,
    delayOf: eyesDelay,
    durOf: eyesDur,
  })

  const vein = makeLayer(sample(veins, BUDGET.veins, { floor: 0.08, bias: 0.6, seed: 12 }), {
    kind: 'veins',
    anchor: [CX, H],
    seed: 102,
    jitter: () => 0.6,
    delayOf: redDelay,
    durOf: redDur,
    startOf: figureStart,
  })
  vein.uniforms.uWave.value = 1

  // The arteries, from the chest to the head (see arteryParticles). They start at the two
  // pectoral ports, or with ?arteries=core at one core under the sternum plate (tried and
  // not liked, kept to compare). They grow in with the red, from the bottom up, so they
  // climb out of where they start.
  const arteryCourse = meta.arteries?.[new URLSearchParams(location.search).get('arteries') ?? 'ports']
  if (arteryCourse) {
    const plates = await pixels('plates.png')
    const art = makeLayer(arteryParticles(arteryCourse, BUDGET.arteries, 41, plates), {
      kind: 'artery',
      anchor: [CX, H],
      seed: 121,
      jitter: () => 0.35,
      delayOf: redDelay,
      durOf: redDur,
      startOf: figureStart,
      attrs: { aArt: [3, (p) => [p.s, p.role, p.cover]] },
    })
    art.uniforms.uArt.value = 1
  }

  const states = {}
  for (const [i, s] of meta.states.entries()) {
    const img = await pixels(`face-${s}.png`)
    const count = /^(speak|strong)/.test(s) ? BUDGET.faceBars : BUDGET.face
    const layer = makeLayer(sample(img, count, { floor: 0.06, bias: 0.45, seed: 20 + i }), {
      kind: 'face',
      anchor: [CX, H],
      seed: 110 + i,
      jitter: () => 0.7,
      delayOf: eyesDelay, // the glow of the face arrives with the eyes
      durOf: eyesDur,
      startOf: figureStart,
    })
    layer.uniforms.uIsFace.value = 1
    layer.uniforms.uFade.value = 0
    states[s] = layer
  }

  makeLayer(sample(backdrop, BUDGET.backdrop, { floor: 0.05, bias: 0.4, seed: 13 }), {
    kind: 'back',
    anchor: [BW / 2, BH],
    seed: 103,
    jitter: (p, r) => 1.5 + r() * 5,
    // Rolls in from the centre outward once the figure is mostly there.
    delayOf: (p, r) => 5.6 + (Math.abs(p.x / BW - 0.5) * 2) * 1.6 + r() * 0.5,
    durOf: (p, r) => 1.5 + r() * 1.2,
    startOf: (p) => [p.x, p.y + 40],
  })
  return states
}

let lightsLayer
const faceLayers = await build()

const total = layers.reduce((n, l) => n + l.points.geometry.attributes.position.count, 0)

/* ---------------------------------------------------------------- layout */

function layout() {
  vw = window.innerWidth
  vh = window.innerHeight
  renderer.setPixelRatio(dprCap)
  renderer.setSize(vw, vh, false)
  scale = Math.min((vh * 1.0) / H, (vw * 1.08) / W)
  const bs = Math.max(vw / BW, (vh * 0.7) / BH)
  // Far enough that a current clears any edge of this window, whatever its shape.
  reachNow = 0.5 * 2.0 * Math.hypot(vw / scale, vh / scale)
  setGuides()
  for (const l of layers) {
    const u = l.uniforms
    u.uView.value.set(vw, vh)
    u.uPix.value = dprCap
    if (l.kind === 'back') {
      u.uScale.value = bs
      u.uOffset.value.set(0, -vh / 2)
    } else {
      u.uScale.value = scale
      u.uOffset.value.set(0, -vh / 2)
    }
  }
}
window.addEventListener('resize', layout)
layout()

/* ----------------------------------------------------------------- input */

const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, speed: 0, seen: false }
const click = { x: 0, y: 0, t: -99 } // the last click on the awake figure, image px and clock
window.addEventListener('pointermove', (e) => {
  const nx = e.clientX
  const ny = e.clientY
  if (mouse.seen) mouse.speed = Math.min(1, Math.hypot(nx - mouse.tx, ny - mouse.ty) / 40)
  mouse.tx = nx
  mouse.ty = ny
  if (!mouse.seen) {
    mouse.x = nx
    mouse.y = ny
    mouse.seen = true
  }
})
window.addEventListener('pointerleave', () => {
  mouse.seen = false
  mouse.tx = mouse.ty = mouse.x = mouse.y = -9999
})

/* ----------------------------------------------------------------- state */

// What each phase of the app does to the figure. Everything here is a target
// that the frame loop eases toward, so one state melts into the next.
//   life   brightness of the whole figure     rate   how fast its clock runs
//   look   how far the head follows the cursor (1 = fully; it is asleep when dormant, and
//          looks less while it speaks, more while it listens)
//   loose  how far particles wander at rest   dim    how far the cyan gives way under the face glow
//   wave   [rate, depth] of the energy running up the red veins
//   level  the voice level that drives the shimmer and the bars. Simulated here;
//          the app would feed its own.
// Optional, set only where a state differs:
//   follow how quickly the head and the trunk follow the cursor (1 = 4.2/s and 1.8/s)
//   nod    rad the head hangs forward       beat   1 = the arteries beat once a breath, else steady flow
//   breath [rad/s, px it rises, how much the brightness follows it]; by default it runs on
//          the figure's clock (0.8 rad/s at rate 1), 1.6 px, brightness steady
// The names are the app's own phases (src/store.ts), minus the ones that are
// only a screen: boot is the assembly, offline is the figure before the click.
const STATE = {
  offline: { look: 0, life: 0.55, rate: 0.5, loose: 1, dim: 0, wave: [1.2, 0.3], level: () => 0 },
  boot: { look: 0, life: 1, rate: 1, loose: 1, dim: 0.8, wave: [2.4, 0.38], level: () => 0.04 },
  // Asleep, waiting for the wake word: it breathes every 5 s (the light and the eyes with it),
  // its heart beats once a breath, it dozes with the head down and it now and then dreams.
  dormant: {
    look: 0.5,
    life: 0.44,
    rate: 0.35,
    loose: 2.2,
    dim: 0.3,
    wave: [0.9, 0.5],
    level: () => 0.01,
    follow: 0.3,
    nod: 0.07,
    breath: [(2 * Math.PI) / 5, 3, 0.18],
    beat: 1,
  },
  waking: { look: 1, life: 1.1, rate: 1.4, loose: 0.8, dim: 0.8, wave: [3.4, 0.5], level: (t) => 0.14 + 0.1 * Math.sin(t * 7.3) },
  listening: { look: 1.1, life: 1, rate: 1, loose: 1, dim: 0.3, wave: [2.4, 0.38], level: (t) => 0.1 + 0.08 * Math.sin(t * 2.2) },
  thinking: { look: 1, life: 1, rate: 1, loose: 1, dim: 0.72, wave: [2.4, 0.38], level: (t) => 0.1 + 0.1 * Math.sin(t * 3.1) },
  tooling: { look: 1, life: 1.05, rate: 1.25, loose: 0.9, dim: 0.6, wave: [7, 0.8], level: () => 0.06 },
  speaking: {
    look: 0.55,
    life: 1,
    rate: 1,
    loose: 1,
    dim: 0.8,
    wave: [2.4, 0.38],
    // Loud and soft passages: the loud ones pick the tall bars, the soft ones the short.
    level: (t) => 0.3 + 0.35 * Math.abs(Math.sin(t * 6.1) * Math.sin(t * 2.3 + 1)) + 0.25 * Math.max(0, Math.sin(t * 0.45)),
  },
}
const LABEL = {
  offline: 'offline',
  boot: 'booting',
  dormant: 'dormant',
  waking: 'waking',
  listening: 'listening',
  thinking: 'thinking',
  tooling: 'tooling',
  speaking: 'speaking',
}

// Which face layer each state shows, and how strongly. Speaking cycles through
// several frames of the voice-print instead (see pickBars).
const FACE_OF = {
  offline: null,
  boot: ['idle', 0.6],
  dormant: ['idle', 0.16],
  waking: ['idle', 1],
  listening: ['listening', 1],
  thinking: ['thinking', 1],
  tooling: ['tooling', 1],
  speaking: 'bars',
}
// Art made before a face existed keeps working: a missing layer borrows a neighbour.
const FACE_ALIAS = { tooling: 'thinking', 'speak-a': 'speaking', 'speak-b': 'speaking', 'strong-a': 'strong', 'strong-b': 'strong' }
const resolveFace = (k) => (faceLayers[k] ? k : FACE_ALIAS[k])

let barFrame = { key: 'speak-a', until: 0 }
/** The voice-print dances: a new frame every ~0.1 s, tall ones when the voice is loud. */
function pickBars(clock, level) {
  if (clock > barFrame.until) {
    const loud = level > 0.45
    barFrame = { key: `${loud ? 'strong' : 'speak'}-${Math.random() < 0.5 ? 'a' : 'b'}`, until: clock + 0.07 + Math.random() * 0.08 }
  }
  return barFrame.key
}

/** The eyes, which are the most readable thing the figure does. */
function eyeGain(s, clock, level, since, breath) {
  switch (s) {
    case 'offline':
      return 0.45 // a few embers drifting in the dust
    case 'dormant':
      return 0.09 + 0.05 * breath // an ember that breathes (the mind's dream stirs it)
    case 'waking':
      // Dark, a stuttering spark, then the flash as the pulse reaches the head.
      return since < 0.5 ? 0.08 + 0.3 * (since / 0.5) * (0.6 + 0.4 * Math.sin(since * 55)) : 1 + 1.5 * Math.exp(-(since - 0.5) * 3.5)
    case 'listening':
      return 1.35
    case 'thinking':
      return 0.75 + 0.3 * Math.sin(clock * 6.3) * Math.sin(clock * 2.1)
    case 'tooling':
      return 1 + 0.15 * Math.sin(clock * 5)
    case 'speaking':
      return 1 + level * 0.9
    default:
      return 0.9
  }
}

let state = 'offline'
let stateAt = performance.now() / 1000
// The assembly runs on its own clock: forward on boot, backward when the figure
// falls apart again (offline). 'off' = it never formed, the cloud is loose.
let asmMode = 'off' // off | up | down
let asmV = -1
let bootAt = 0 // real time the boot began; the shader freezes each particle's start from it
let redNow = 0
let redTarget = 0
let levelNow = 0
let figClock = 0 // the figure's own clock: slow when dormant, quick when waking
let artHeat = 0 // how hard the arteries work, 0 at rest .. 1 at high intensity
let artPhase = 0 // px their pulses have travelled
let breathPhase = 0 // rad; each turn is one breath, breathing in while its sine is positive
let beatAt = -1e9 // real time the last heartbeat left the ports
const look = { yaw: 0, pitch: 0, body: 0, bodyPitch: 0, attn: 0 } // where the head and the trunk are turned, and how much it attends to the cursor
const ease = { life: 0, rate: 0.5, loose: 1, dim: 0, waveRate: 1.2, waveDepth: 0.3, look: 0, follow: 1, nod: 0, breathW: 0.4, breathAmp: 1.6, breathGlow: 0, beat: 0 }

let keepPlan = false
function setState(s, auto = false) {
  if (!STATE[s]) return
  if (!auto) cancelFlow()
  const now = performance.now() / 1000
  if (s === 'boot') {
    // Every boot takes its own routes (R replays the last one instead).
    if (!keepPlan) rollRoutes(newSeed())
    lastBoot = { wedge: plan.wedge, route: plan.route }
    asmMode = 'up'
    bootAt = now
    asmV = 0
  } else if (s === 'offline') {
    // The figure is whole and about to come apart, so nobody can see the cloud
    // right now: the moment to deal the wedges out again for the next boot. (Cut
    // short mid-assembly the cloud is in view, and the arrangement stays.)
    if (asmMode === 'up' && asmV >= ASM_END - 0.1) rollWedges(newSeed())
    // Fall apart into the loose cloud (or stay in it, if it never formed).
    asmMode = asmV > 0 ? 'down' : 'off'
    asmV = Math.min(asmV, ASM_END)
  } else if (asmMode !== 'up') {
    // Jumped past the boot: pick the assembly up from where it is, or call it drawn.
    const v = asmMode === 'down' ? asmV : 12
    asmMode = 'up'
    bootAt = now - v
    asmV = v
  }
  if (s === 'boot' || s === 'offline') {
    bootShown = 0
    $('boot').innerHTML = ''
    $('boot').classList.remove('gone')
  }
  state = s
  stateAt = now
  mind.setContext(s)
  for (const b of document.querySelectorAll('#bar [data-s]')) b.classList.toggle('on', b.dataset.s === s)
  $('status').textContent = LABEL[s]
  $('wake').classList.toggle('on', s === 'offline')
}

/* The whole life of a conversation, end to end, on a timer. */
let flowTimers = []
function cancelFlow() {
  for (const t of flowTimers) clearTimeout(t)
  flowTimers = []
  $('flow').classList.remove('on')
}
const FLOW = [
  [0, 'offline'],
  [1.4, 'boot'], // the assembly ends into dormant by itself, at about 12 s
  [15, 'waking'],
  [16.8, 'listening'],
  [19.8, 'thinking'],
  [22.3, 'tooling'],
  [25.8, 'speaking'],
  [32, 'listening'],
  [34.5, 'dormant'],
]
function runFlow() {
  cancelFlow()
  $('flow').classList.add('on')
  for (const [t, s] of FLOW) flowTimers.push(setTimeout(() => setState(s, true), t * 1000))
  flowTimers.push(setTimeout(cancelFlow, 36000))
}

$('bar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-s]')
  if (b) setState(b.dataset.s)
})
const KEYS = ['offline', 'dormant', 'waking', 'listening', 'thinking', 'tooling', 'speaking']
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase()
  if (k >= '0' && k <= '6') setState(KEYS[Number(k)])
  if (k === 'b') setState('boot')
  if (k === 'r') replayBoot()
  if (k === 'f') runFlow()
  if (k === 'p') togglePalette()
})
// Offline is waiting for a click (the app needs one to unlock audio).
canvas.addEventListener('click', () => {
  if (state === 'offline') setState('boot')
})
$('flow').addEventListener('click', () => runFlow())
// A click on the awake figure sends a pulse of light through it from where it landed.
canvas.addEventListener('pointerdown', (e) => {
  if (state === 'offline' || state === 'boot') return
  click.x = (e.clientX - vw / 2) / scale + CX
  click.y = (e.clientY - vh) / scale + H
  click.t = performance.now() / 1000
})
$('again').addEventListener('click', () => replayBoot())
/** Boot again with the very seeds the last boot ran on, to compare it with another. */
function replayBoot() {
  if (!lastBoot) return setState('boot')
  keepPlan = true
  rollWedges(lastBoot.wedge)
  rollRoutes(lastBoot.route)
  setState('boot')
  keepPlan = false
}
$('palette').addEventListener('click', () => togglePalette())
function togglePalette() {
  redTarget = redTarget ? 0 : 1
  $('palette').textContent = redTarget ? 'P blood red' : 'P cyan + red'
}

/* ------------------------------------------------------------------ boot */

const BOOT = [
  [0.1, 'ultron core // cold start'],
  [0.9, 'lattice ............ <span class="ok">ok</span>'],
  [1.7, 'neural mesh ......... <span class="ok">ok</span>'],
  [2.5, 'voice interface ..... <span class="ok">ok</span>'],
  [3.3, 'assembling form'],
]
let bootShown = 0

/* ------------------------------------------------------------------ loop */

window.__ultron = {
  hold: null,
  trailAt: null,
  clickAge: null,
  pose: null,
  artHeat: null,
  layers,
  // Dev: the mind (its config, output(), force('dream'), stimulate('pointerErratic'), ...).
  mind,
  dream: () => mind.force('dream'),
  // Dev: what the cursor interactions are doing right now.
  info: () => ({ click: { ...click }, look: { ...look }, clickU: clickU.value.toArray(), easeLook: ease.look, state }),
}

// The cursor leaves a sample of its path every ~22 px it travels: where it is,
// which way it is going, and how hard (its speed, 0..1). Fast swipes leave a long
// strong trail, a slow drift a faint one, and holding still leaves nothing.
const trail = []
let trailLast = null
function stirTrail(clock, mx, my) {
  if (mx < -9000) {
    trailLast = null
  } else if (!trailLast) {
    trailLast = { x: mx, y: my, t: clock }
  } else {
    const dx = mx - trailLast.x
    const dy = my - trailLast.y
    const dist = Math.hypot(dx, dy)
    if (dist >= 22) {
      const speed = dist / Math.max(clock - trailLast.t, 1 / 240)
      const k = Math.pow(Math.min(1, speed / 900), 0.9)
      const n = Math.min(8, Math.floor(dist / 22))
      for (let j = 1; j <= n; j++) {
        trail.unshift({ x: trailLast.x + (dx * j) / n, y: trailLast.y + (dy * j) / n, vx: (dx / dist) * k, vy: (dy / dist) * k, t: clock })
      }
      trail.length = Math.min(trail.length, TRAIL_N)
      trailLast = { x: mx, y: my, t: clock }
    }
  }
  // Hand the shader the samples. Through the figure the wind is strongest right where
  // the cursor is and lets go in about 0.7 s (zw). Loose dust is slower to react: the
  // push it gets (lane) builds up after the cursor has passed, peaks about 0.2 s later
  // and is gone by about a second, so the small gap opens behind the cursor, not under it.
  for (let i = 0; i < TRAIL_N; i++) {
    const s = trail[i]
    const v = trailU.value[i]
    if (s) {
      const age = clock - s.t
      const f = Math.exp(-age * 1.45)
      v.set(s.x, s.y, s.vx * f, s.vy * f)
      const up = Math.max(0, Math.min(1, age / 0.18))
      laneU.value[i] = Math.hypot(s.vx, s.vy) * up * up * (3 - 2 * up) * Math.exp(-Math.max(0, age - 0.04) * 2.2)
    } else {
      v.set(-9999, -9999, 0, 0)
      laneU.value[i] = 0
    }
  }
}

let last = performance.now()
let frames = 0
let fpsAt = last
let fps = 0
let slow = 0

function frame(nowMs) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (nowMs - last) / 1000)
  last = nowMs
  const clock = nowMs / 1000
  // Dev: window.__ultron.hold = seconds freezes the assembly at that moment.
  const dev = window.__ultron
  if (dev && dev.hold != null) {
    asmMode = 'hold'
    asmV = dev.hold
  }
  if (asmMode === 'up') asmV = clock - bootAt
  else if (asmMode === 'down') {
    asmV -= dt * 3.2
    if (asmV <= -0.2) {
      asmV = -1
      asmMode = 'off'
    }
  }
  const asm = asmV
  const since = clock - stateAt
  const k = (rate) => Math.min(1, dt * rate)

  // Boot log, paced against the same clock as the assembly. When it is done the
  // figure powers down and waits for its name.
  while (asmMode === 'up' && bootShown < BOOT.length && asm > BOOT[bootShown][0]) {
    $('boot').innerHTML += BOOT[bootShown][1] + '<br>'
    bootShown++
  }
  if (state === 'boot' && asm > ASM_END) {
    $('boot').classList.add('gone')
    setState('dormant', true)
  }

  // Mouse, eased, then converted into the figure's own pixel space.
  mouse.x += (mouse.tx - mouse.x) * k(14)
  mouse.y += (mouse.ty - mouse.y) * k(14)
  mouse.speed *= Math.exp(-dt * 4)
  const mx = mouse.seen ? (mouse.x - vw / 2) / scale + CX : -9999
  const my = mouse.seen ? (mouse.y - vh) / scale + H : -9999
  // Dev: window.__ultron.trailAt = a clock value freezes the age of the trail there.
  stirTrail(dev && dev.trailAt != null ? dev.trailAt : clock, mx, my)

  // Ease every state parameter toward the current state's target.
  const cfg = STATE[state]
  redNow += (redTarget - redNow) * k(3)
  ease.life += (cfg.life - ease.life) * k(state === 'waking' || state === 'boot' ? 8 : 2.5)
  ease.rate += (cfg.rate - ease.rate) * k(3)
  ease.loose += (cfg.loose - ease.loose) * k(2.5)
  ease.dim += (cfg.dim - ease.dim) * k(4)
  ease.waveRate += (cfg.wave[0] - ease.waveRate) * k(3)
  ease.waveDepth += (cfg.wave[1] - ease.waveDepth) * k(3)
  ease.look += ((cfg.look ?? 0) - ease.look) * k(3)
  ease.follow += ((cfg.follow ?? 1) - ease.follow) * k(2)
  ease.nod += ((cfg.nod ?? 0) - ease.nod) * k(1.5)
  ease.breathW += ((cfg.breath?.[0] ?? 0.8 * cfg.rate) - ease.breathW) * k(1.5)
  ease.breathAmp += ((cfg.breath?.[1] ?? 1.6) - ease.breathAmp) * k(1.5)
  ease.breathGlow += ((cfg.breath?.[2] ?? 0) - ease.breathGlow) * k(1.5)
  ease.beat += ((cfg.beat ?? 0) - ease.beat) * k(2)
  levelNow += (cfg.level(clock) - levelNow) * k(10)

  // The mind (../mind): its mood and what it does on its own, as channels laid over the
  // state's own values (see ch() below; a channel nothing touches reads neutral).
  mind.tick(dt)
  const mo = mind.output()
  const ch = (name) => mind.channel(mo, name)

  // The click: a pulse of light that fades in 2.5 s, and the figure's shimmer speeds up
  // for a moment (up to 2.5x, letting go in about 0.6 s).
  // Dev: window.__ultron.clickAge = seconds freezes the pulse at that age.
  const clickAge = dev && dev.clickAge != null ? dev.clickAge : clock - click.t
  const clickAmp = clickAge < 2.5 ? Math.exp(-clickAge * 1.9) : 0
  clickU.value.set(click.x, click.y, clickAmp, clickAge)
  const shimmer = 1 + 1.5 * (clickAge < 3 ? Math.exp(-clickAge / 0.6) : 0)
  figClock += dt * ease.rate * shimmer

  // Breathing: the figure rises as it breathes in, and asleep its light swells with it. As
  // each breath begins, a heartbeat leaves the ports (230 px/s); only sleep shows it.
  // The mind quickens it (breath.rate), deepens it (breath.depth), heaves a sigh through
  // it (body.rise: 1 = a 7 px lift) and dims or brightens the whole figure (glow).
  const turn = Math.floor(breathPhase / (2 * Math.PI))
  breathPhase += dt * shimmer * ease.breathW * ch('breath.rate')
  if (Math.floor(breathPhase / (2 * Math.PI)) > turn) beatAt = clock
  const breathNow = Math.sin(breathPhase)
  const breathPx = breathNow * ease.breathAmp * ch('breath.depth') + ch('body.rise') * 7
  const lifeNow = ease.life * (1 + ease.breathGlow * breathNow) * ch('glow')

  // The arteries stay in the background until the intensity is high: a loud voice (the
  // level past ~0.35, fully at ~0.85), plus whatever the mood adds (arteries.heat). Their
  // pulses run at 120 px/s at rest, up to 300 when working hard.
  // Dev: window.__ultron.artHeat = 0..1 holds it.
  const lv = Math.max(0, Math.min(1, (levelNow - 0.35) / 0.5))
  const heatWant = dev && dev.artHeat != null ? dev.artHeat : Math.min(1, lv * lv * (3 - 2 * lv) + ch('arteries.heat'))
  artHeat += (heatWant - artHeat) * k(4)
  artPhase += dt * ease.rate * shimmer * (120 + 180 * artHeat)

  // Where the head looks: the cursor, as -1..1 across the window, is the target, and the
  // head eases toward it (1 - e^(-4.2 dt)). Off the window it looks straight ahead.
  const lookX = mouse.seen ? Math.max(-1, Math.min(1, (mouse.tx / vw) * 2 - 1)) : 0
  const lookY = mouse.seen ? Math.max(-1, Math.min(1, (mouse.ty / vh) * 2 - 1)) : 0
  // Asleep it follows lazily (follow 0.3: about a second behind) with the head hung forward.
  // The mind sharpens or slows that (head.follow) and lifts or drops the head (head.pitch).
  const follow = ease.follow * ch('head.follow')
  const lk = 1 - Math.exp(-dt * 4.2 * follow)
  // Alive, not posed: even with the cursor still, the head and the trunk drift a little on
  // slow waves that never quite repeat. They run on the figure's own clock (slower when
  // dormant) and are scaled by how awake it is, so a sleeping figure only breathes. An
  // impatient mood makes them wander further (head.restless).
  const restless = ch('head.restless')
  const idleYaw = (0.05 * Math.sin(figClock * 0.43) + 0.03 * Math.sin(figClock * 1.07 + 1.3)) * restless
  const idlePitch = 0.022 * Math.sin(figClock * 0.37 + 0.6) * restless
  const idleBody = (0.032 * Math.sin(figClock * 0.31 + 2.0) + 0.018 * Math.sin(figClock * 0.83)) * restless
  const idleBodyPitch = 0.012 * Math.sin(figClock * 0.52 + 1.0) * restless
  // Where the mind wants to look (looking away, at the edge the cursor left by, across the
  // room) takes over from the cursor by its weight, at full reach whatever the state.
  const gw = mo.gaze.weight
  const aim = (own, full) => own + (full - own) * gw
  look.yaw += (aim((lookX * 0.44 + idleYaw) * ease.look, mo.gaze.x * 0.44) - look.yaw) * lk
  look.pitch += (aim((lookY * 0.2 + idlePitch) * ease.look, mo.gaze.y * 0.2) + ease.nod + ch('head.pitch') - look.pitch) * lk
  // The trunk turns less than the head (up to 0.14 rad, ~8 degrees) and follows later and
  // softer (about 0.55 s behind), as a body does.
  const bk = 1 - Math.exp(-dt * 1.8 * follow)
  look.body += (aim((lookX * 0.14 + idleBody) * ease.look, mo.gaze.x * 0.14) - look.body) * bk
  look.bodyPitch += (aim((lookY * 0.05 + idleBodyPitch) * ease.look, mo.gaze.y * 0.05) - look.bodyPitch) * bk
  // Dev: window.__ultron.pose = { yaw, pitch, body, bodyPitch } holds the head and trunk there.
  if (dev && dev.pose) Object.assign(look, dev.pose)
  look.attn += ((mouse.seen ? Math.min(1, ease.look) : 0) - look.attn) * k(6)
  attnU.value.set(mx, my)

  // A band of light over the figure. Waking sends one strong pulse from the
  // chest up to the head; tooling keeps sending weaker ones, like work being fed upward.
  let pulseY = -9999
  let pulseA = 0
  let pulseW = 60
  if (state === 'waking') {
    const p = Math.min(1, since / 0.9)
    pulseY = H + 60 - (H - 20) * (1 - (1 - p) * (1 - p))
    pulseA = since < 1.25 ? 2 : 0
    pulseW = 80
  } else if (state === 'tooling') {
    pulseY = H + 60 - (H - 40) * ((since * 0.75) % 1)
    pulseA = 0.9
    pulseW = 46
  }

  for (const l of layers) {
    const u = l.uniforms
    const back = l.kind === 'back'
    u.uTime.value = figClock
    u.uFreeTime.value = clock
    u.uBootAt.value = asmMode === 'up' ? bootAt : 1e9
    u.uLive.value = asmMode === 'down' ? 1 : 0
    u.uAsm.value = asm
    u.uWind.value = back ? 0 : 6.5
    u.uYaw.value = look.yaw
    u.uPitch.value = look.pitch
    u.uAttnOn.value = look.attn
    u.uBodyYaw.value = look.body
    u.uBodyPitch.value = look.bodyPitch
    u.uLevel.value = levelNow
    u.uArtHeat.value = artHeat
    u.uArtPhase.value = artPhase
    u.uArtBeat.value.set((clock - beatAt) * 230 - 15, ease.beat * ch('arteries.beat'), 1 - ease.beat)
    u.uBreath.value = breathPx
    u.uDim.value = ease.dim * (meta.dimScale ?? 1)
    u.uRed.value = l.kind === 'figure' || back ? redNow : 0
    u.uLife.value = back ? 0.5 + 0.5 * lifeNow : lifeNow
    u.uLoose.value = ease.loose
    u.uWaveRate.value = ease.waveRate
    u.uWaveDepth.value = ease.waveDepth
    u.uPulse.value = back ? -9999 : pulseY
    u.uPulseW.value = pulseW
    u.uPulseA.value = pulseA
    if (back) u.uParallax.value = mouse.seen ? -((mouse.x - vw / 2) / vw) * 26 : 0
  }

  $('wake').style.opacity = state === 'offline' ? 0.55 + 0.35 * Math.sin(clock * 2.2) : 0

  // Eyes, by state (see eyeGain).
  // The mind brightens or dims them (eyes.gain), adds light (eyes.boost: a dream) and makes
  // them stutter (eyes.flicker).
  const flicker = ch('eyes.flicker') * (0.5 + 0.5 * Math.sin(clock * 47) * Math.sin(clock * 13.3))
  const eg = (eyeGain(state, clock, levelNow, since, breathNow) * ch('eyes.gain') + ch('eyes.boost')) * (1 - 0.85 * flicker)
  lightsLayer.uniforms.uFade.value += (eg - lightsLayer.uniforms.uFade.value) * k(state === 'waking' ? 14 : 8)

  // Face layers: one is up at a time, except that the voice-print crossfades fast.
  const want = {}
  const face = FACE_OF[state]
  if (face === 'bars') want[resolveFace(pickBars(clock, levelNow))] = 1
  else if (face) want[resolveFace(face[0])] = face[1]
  for (const [s, l] of Object.entries(faceLayers)) {
    const rate = /^(speak|strong)/.test(s) ? 16 : 5
    l.uniforms.uFade.value += ((want[s] ?? 0) - l.uniforms.uFade.value) * k(rate)
    l.points.visible = l.uniforms.uFade.value > 0.01
  }

  renderer.render(scene, camera)

  // Stats, and an automatic step down in resolution if the frame rate sags.
  frames++
  if (nowMs - fpsAt > 1000) {
    fps = Math.round((frames * 1000) / (nowMs - fpsAt))
    frames = 0
    fpsAt = nowMs
    $('stats').innerHTML = `${fps} fps<br>${total.toLocaleString('en')} particles<br>dpr ${dprCap.toFixed(2)} · no post-fx<br>plan ${plan.wedge.toString(36)} · ${plan.route.toString(36)}`
    slow = fps < 40 ? slow + 1 : 0
    if (slow >= 2 && dprCap > 1) {
      dprCap = Math.max(1, dprCap - 0.25)
      slow = 0
      layout()
    }
  }
}
requestAnimationFrame(frame)

// ?state=listening opens straight into a state (handy for screenshots).
const startState = new URLSearchParams(location.search).get('state')
setState(STATE[startState] ? startState : 'offline')
