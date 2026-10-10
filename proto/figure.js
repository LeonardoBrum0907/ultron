// Particle humanoid prototype.
//
// Everything on screen is a point sprite driven by one vertex shader. The art
// lives in ./img as ordinary PNGs (see art/generate.mjs); this file turns them
// into particles and animates them. Nothing is simulated on the CPU per frame
// except a handful of uniforms, which is the whole performance story: ~40k
// points is trivial for a GPU, and there is no post-processing pass at all.

//
// createFigure() builds the figure on a canvas and keeps it alive. The prototype page
// (main.js) runs it with its own buttons, keys and mind; the app runs it behind its HUD,
// following its phase and its real microphone and voice.

import * as THREE from 'three'
import { createHearing } from './hearing.js'

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas where it draws (the whole window)
 * @param {import('../mind/index.ts').Mind} opts.mind the mind it embodies
 * @param {boolean} [opts.controls] the prototype page: its buttons, keys, boot log and status
 * @param {boolean} [opts.tickMind] advance the mind from the frame loop, when nothing else does
 * @param {() => ({ db: number } | { level: number } | null)} [opts.hears] what it hears while
 *   listening; null (or none) falls back to the page's own microphone (M) or a made-up voice
 * @param {() => ({ db: number } | { level: number } | null)} [opts.says] its own voice while
 *   speaking; null falls back to the made-up voice
 * @param {() => void} [opts.onIgnite] a click on the dust while offline (else it boots itself)
 * @param {() => (object | null)[]} [opts.zones] where the HUD is on screen this frame (see HUD_ZONES)
 */
export async function createFigure({ canvas, mind, controls = false, tickMind = controls, hears, says, onIgnite, zones }) {
  // The prototype page's own elements; hosted, a detached stand-in takes every write.
  const stand = {}
  const $ = (id) => (controls && document.getElementById(id)) || (stand[id] ??= document.createElement('div'))
  // Everything it listens to goes with it when it is disposed.
  const life = new AbortController()
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: life.signal })
  const offs = []
  // What it hears: the host's microphone, or the page's own (M), or a made-up voice.
  const hearing = createHearing({ source: hears })

  /* ------------------------------------------------------------------ setup */

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
  const meta = await (await fetch(new URL(`./${ART}/meta.json`, import.meta.url))).json()
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
    faceBars: 5500, // the voice-print frames, which are sparse (the procedural art's; the render's speaks with its mouth)
    eyes: 0, // the eyes the engine draws, and the mouth's slit (only the art made from the render has them)
    mouth: 0,
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
    img.src = new URL(`./${ART}/${name}`, import.meta.url).href
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
   *
   * even: spread them evenly (error diffusion) instead of drawing each pixel at random. As
   * many particles, but no clumps and no holes, so a thin seam reads as a line of dots and
   * not as scattered grains. For the figure; the dust and the backdrop keep their randomness.
   */
  function sample(img, count, { floor = 0.1, bias = 0.9, seed = 1, even = false } = {}) {
    const r = rng(seed)
    const { data, w, h } = img
    let sum = 0
    for (let i = 0; i < w * h; i++) {
      const l = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255
      if (l > floor) sum += Math.pow(l, bias)
    }
    const k = count / Math.max(sum, 1)
    const out = []
    if (even) {
      // Serpentine Floyd-Steinberg over how many particles each pixel should have.
      const d = new Float32Array(w * h)
      for (let i = 0; i < w * h; i++) {
        const l = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) / 255
        if (l > floor) d[i] = Math.pow(l, bias) * k
      }
      for (let y = 0; y < h; y++) {
        const back = y & 1
        const s = back ? -1 : 1
        for (let n = 0; n < w; n++) {
          const x = back ? w - 1 - n : n
          const i = y * w + x
          const v = d[i]
          if (v === 0) continue
          const j = i * 4
          const l = Math.max(data[j], data[j + 1], data[j + 2]) / 255
          // (a pixel too dark to draw passes on what it was handed)
          const on = v >= 0.5 && l > floor ? 1 : 0
          const e = v - on
          if (x + s >= 0 && x + s < w) d[i + s] += (e * 7) / 16
          if (y + 1 < h) {
            if (x - s >= 0 && x - s < w) d[i + w - s] += (e * 3) / 16
            d[i + w] += (e * 5) / 16
            if (x + s >= 0 && x + s < w) d[i + w + s] += e / 16
          }
          if (on) out.push({ x: x + 0.25 + 0.5 * r(), y: y + 0.25 + 0.5 * r(), r: data[j] / 255, g: data[j + 1] / 255, b: data[j + 2] / 255, l })
        }
      }
      return out
    }
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
    attribute vec4 aArt;      // arteries only: x px along the artery from where it starts, y 0 a source / 1 an inner artery / 2 an outer one, z how much plate lies over it (0..1), w px still to go to its end at the eye
    uniform float uArtReach;  // 0..1: how far the pulses run on into the eyes (only at the extremes)
    attribute vec4 aEye;      // eyes only: x which (+1 the left on screen, -1 the right), y 0 the iris / 1 the pupil, z r px from the centre, w the angle rad
    attribute float aSlit;    // the mouth's slit only: how far across the gap it sits, 0 at the seam .. 1 at the jaw

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
    uniform vec3  uArtSurge;  // one strong pulse up all four arteries: x px its front has gone, y strength
    uniform vec3  uArtHear;   // listening: x how far it is given to it 0..1, y the voice now 0..1, z the sources' flare
    uniform vec2  uArtIn[8];  // the voice's pulses coming down the outer arteries from the ears: x px from the source, y strength
    uniform vec3  uArtThink;  // thinking: x how far it is given to it 0..1, y px its pulses have run up the outer arteries
    uniform vec4  uArtTool;   // tooling: x how far it is given to it 0..1, y px the engine's pulses have run up the left arteries, z px run since the work ended (pulses that left after that are gone; <0 still working), w their gain
    uniform vec4  uArtSpeak;  // speaking: x how far it is given to it 0..1, y its voice now 0..1, z the cheeks' flare, w px along an inner artery to the cheek, where the voice comes out
    uniform vec4  uArtOut[8]; // its voice's pulses going up the inner arteries: x px their front has gone from the source, y strength, z 0..1 how far past the cheek it may run on (to the eye), w width px
    uniform vec4  uDiscs[4];  // the red discs (DISCS): centre xy and radius, image px; w how far its blades of light have turned, rad
    uniform vec3  uDiscFx[4]; // each disc: x extra light (-1 = dark), y how far it is drawn in 0..1, z how strong its blades are 0..1
    uniform float uSpins;     // 1 = this layer's light is the discs' (the red layers)
    uniform float uStir;      // listening: how hard the voice stirs the dust round the body (the backdrop, and the dust by the plates), 0..1
    uniform vec2  uPush[4];   // speaking: waves its stressed syllables send through the dust round the body, out from the mouth: x px out they have got, y strength
    uniform float uPushOn;    // 1 = this layer's dust feels them (the same layers as uStir)
    uniform vec3  uPushAt;    // where they start (the mouth) in this layer's px, and z the figure's px in one of this layer's
    uniform vec3  uCheek;     // speaking: x the cheeks flaring as its voice comes out there (on the red layers; 0 on the others), yz the left cheek's red core, image px (the right mirrors it)
    uniform float uEye;       // 1 = this layer is the eyes
    uniform vec2  uEyeC[2];   // each eye's centre (the pupil at rest), image px: 0 the left on screen, 1 the right
    uniform vec4  uEyeGeo;    // x the slant (rad, down toward the nose), y the outer corner's u, z the inner's, w the iris's radius (px)
    uniform vec3  uEyeLid;    // x how far above the centre the upper lid sits at rest, y how far below the lower, z rings across the iris
    uniform vec4  uEyeSt[2];  // each eye: x open (0 shut, 1 at rest, >1 wide), y squint (the lower lid rises), z tilt (+ the upper lid lower toward the nose: anger; - toward the temple), w the iris's size (1 at rest)
    uniform vec2  uEyeLook;   // px the irises have moved in their sockets (both alike)
    uniform vec2  uEyeSpin;   // the iris's rings turning: x how far (rad), y how strongly their segments show 0..1
    uniform vec4  uMouthGeo;  // the jaw piece, image px: x the seam's y, y the column's half width, z where the chin cup starts (y), w the cup's half width
    uniform vec2  uMouth;     // x px the jaw has dropped, y how bright the slit it opens is
    uniform float uSlit;      // 1 = this layer is the mouth's slit
    uniform vec4  uCrumbleAt; // the region crumbling to dust: centre and radii, image px
    uniform float uCrumble;   // how far it has gone to dust, 0..1
    uniform vec4  uRebuildAt; // the plate lifting off and re-seating: centre and radii, image px
    uniform vec3  uRebuild;   // x how far off it is 0..1, y px it lifts, z rad it turns
    uniform float uParallax;
    uniform float uRed;       // 0 cyan, 1 everything that was cyan goes red
    uniform float uLife;      // brightness of the layer: low when dormant
    uniform float uLoose;     // how far particles wander at rest, relative
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
    uniform vec4  uZone[2];   // the HUD on screen: x0 y0 x1 y1, CSS px from the window's centre, y up (see HUD_ZONES)
    uniform vec2  uZoneFx[2]; // each zone: x calm (the text over it must read), y rim (the dust traces its border) 0..1

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

    // The eye's lids, as v (px across the eye, down) at u (px along it, toward the nose), for an
    // eye in state st (see uEyeSt). The socket is an almond: 1 in the middle, 0 at its corners.
    float eyeShape(float u) {
      float sp = u >= 0.0 ? uEyeGeo.z : uEyeGeo.y;
      return max(0.0, 1.0 - (u / sp) * (u / sp));
    }
    float lidLo(float u, vec4 st) {
      return uEyeLid.y * pow(eyeShape(u), 0.7) * (1.0 - 0.6 * st.y);
    }
    // Open 0 brings the upper lid down onto the lower; past 1 it lifts on beyond where it rests.
    // Tilted, it comes lower toward the nose (anger) or toward the temple (sorrow).
    float lidUp(float u, vec4 st) {
      float sh = eyeShape(u);
      float lo = lidLo(u, st);
      float up = mix(lo, -uEyeLid.x * pow(sh, 0.6), st.x) + st.z * 3.0 * clamp(u / 20.0, -1.0, 1.0) * sh;
      return min(up, lo);
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
      // Listening, the voice it hears stirs the dust round the body: each mote shakes on a
      // quick course of its own, a little brighter (see listen.stir).
      p += vec2(sin(uFreeTime * (6.0 + aSeed * 9.0) + ph * 7.0), cos(uFreeTime * (5.0 + aSeed * 8.0) + ph * 11.0)) * (2.0 + aJit) * uStir * e;
      // Speaking, it pushes the dust instead: each stressed syllable sends a light wave out from
      // its mouth, in a ring all round the figure that crosses the whole window, and the motes it
      // passes are shoved outward (up to ~9 px near the mouth, less and less as the wave spends
      // itself, see speak.waves) and brightened. uPushAt is the mouth in this layer's own px (the backdrop has
      // its own image and scale) and how many of the figure's px one of them is.
      float pushed = 0.0;
      if (uPushOn > 0.5) {
        vec2 fromM = p - uPushAt.xy;
        float dm = length(fromM) * uPushAt.z;
        for (int i = 0; i < 4; i++) {
          // The front widens as it travels: 40 px across at the mouth, ~110 at the far edge.
          float wz = (dm - uPush[i].x) / (40.0 + 0.07 * uPush[i].x);
          pushed += uPush[i].y * exp(-wz * wz);
        }
        p += normalize(fromM + vec2(0.0, 0.001)) * (9.0 + 0.8 * aJit) / uPushAt.z * pushed * e;
      }
      // The whole figure breathes.
      p.y -= uBreath * e;

      // THE MIND'S GESTURES on one region of the body (soft ellipses in image px, see
      // REGIONS), before the turn so the region moves with the body it belongs to.
      // Crumbling: every particle in it is flung out a different way and sinks a little, a
      // swirl of dust, flickering; it is pulled back as the amount falls. Rebuilding: the
      // region turns about its middle and lifts away from the body, then seats again.
      float gestureLight = 1.0;
      if (uFloat > 0.5 && uCrumble > 0.001) {
        float m = 1.0 - smoothstep(0.6, 1.0, length((aTarget - uCrumbleAt.xy) / uCrumbleAt.zw));
        float a = uCrumble * m * e;
        float ang = aSeed * 18.85;
        p += vec2(cos(ang), sin(ang)) * (14.0 + 46.0 * fract(aSeed * 7.31)) * a;
        p += vec2(sin(uFreeTime * (1.3 + aSeed) + ph), cos(uFreeTime * (1.1 + aSeed) + ph * 2.0)) * 6.0 * a + vec2(0.0, 22.0 * a * a);
        gestureLight = mix(1.0, 0.45 + 0.9 * fract(aSeed * 3.7) * (0.6 + 0.4 * sin(uFreeTime * 9.0 + ph * 4.0)), a);
      }
      if (uFloat > 0.5 && uRebuild.x > 0.001) {
        vec2 rel = aTarget - uRebuildAt.xy;
        float m = 1.0 - smoothstep(0.75, 1.0, length(rel / uRebuildAt.zw));
        float a = uRebuild.x * m * e;
        float an = uRebuild.z * a;
        vec2 turned = vec2(rel.x * cos(an) - rel.y * sin(an), rel.x * sin(an) + rel.y * cos(an));
        vec2 away = normalize(uRebuildAt.xy - vec2(${CX.toFixed(1)}, 700.0) + vec2(0.0, 0.001));
        p += (turned - rel) + away * uRebuild.y * a;
        gestureLight *= 1.0 + 0.5 * a; // the loose plate catches the light
      }
      // THE DISCS, four red ones (DISCS): two by the middle of the chest, where the arteries
      // start, and two inside the shoulders. Working, the chest's pump like pistons, drawing in
      // and lighting up on each beat, and the shoulders' spin like turbines. Only their red light
      // takes part (uSpins), and a turbine's particles stay where the art has them (half of its
      // rings is under the plate, and turning them broke the circle): three blades of light run
      // round them instead (uDiscs[i].w: how far they have turned), passing behind the plate
      // where there is nothing to light. uDiscFx[i]: x extra light, y how far drawn in, z how
      // strong the blades are.
      float discLight = 1.0;
      if (uSpins > 0.5) {
        for (int i = 0; i < 4; i++) {
          vec2 rel = aTarget - uDiscs[i].xy;
          float m = (1.0 - smoothstep(uDiscs[i].z * 0.9, uDiscs[i].z, length(rel))) * e;
          if (m <= 0.0) continue;
          p -= (p - uDiscs[i].xy) * 0.1 * uDiscFx[i].y * m;
          float blade = pow(0.5 + 0.5 * cos(3.0 * (atan(rel.y, rel.x) - uDiscs[i].w)), 6.0);
          discLight *= max(0.0, 1.0 + uDiscFx[i].x * m) * (1.0 + uDiscFx[i].z * m * (2.2 * blade - 0.5));
        }
      }
      // THE EYES (meta.eyes), drawn here so that they can move. Each particle is a piece of an
      // iris: rings round a hot pupil, aEye.zw its place round the centre. The lids are not
      // drawn, only felt: curves across the almond of the socket (lidUp, lidLo) that open, shut,
      // squint and tilt with the eye's state, and the iris shows only between them. It moves in
      // its socket (uEyeLook), grows and shrinks, and slides under them. Its rings can turn:
      // segments of light run round them, each ring the other way (uEyeSpin), as the turbines'
      // blades do; particles running round a ring would not show.
      float eyeLight = 1.0;
      if (uEye > 0.5) {
        bool left = aEye.x > 0.0;
        vec2 ec = left ? uEyeC[0] : uEyeC[1];
        vec4 st = left ? uEyeSt[0] : uEyeSt[1];
        vec2 eu = vec2(aEye.x * cos(uEyeGeo.x), sin(uEyeGeo.x)); // along the eye, toward the nose
        vec2 ev = vec2(-aEye.x * sin(uEyeGeo.x), cos(uEyeGeo.x)); // across it, down
        vec2 eq = ec + uEyeLook + vec2(cos(aEye.w), sin(aEye.w)) * aEye.z * st.w;
        float eu0 = dot(eq - ec, eu);
        float ev0 = dot(eq - ec, ev);
        float up = lidUp(eu0, st);
        float lo = lidLo(eu0, st);
        eyeLight = smoothstep(up - 0.6, up + 0.6, ev0) * smoothstep(lo + 0.6, lo - 0.6, ev0);
        if (aEye.y < 0.5) {
          float ring = floor(aEye.z / (uEyeGeo.w / uEyeLid.z) + 0.5);
          float dir = mod(ring, 2.0) * 2.0 - 1.0;
          float seg = pow(0.5 + 0.5 * cos(6.0 * (aEye.w - dir * uEyeSpin.x)), 2.0);
          eyeLight *= mix(1.0, 0.35 + 1.3 * seg, uEyeSpin.y);
        }
        p += (eq - aTarget) * e;
      }
      // THE MOUTH. The render has no lips: the mouth is the seam under the nose plate, and under
      // it the jaw is a piece of its own (uMouthGeo): the tabs and the column between the cheek
      // pods, then the chin cup down to where the head ends. Speaking, the voice drops it by a
      // few px (uMouth.x) and the slit it opens glows (the slit layer, aSlit of the way across
      // the gap, dark while the mouth is shut). The arteries behind it stay where they are.
      float slitLight = 1.0;
      if (uMouth.x > 0.001 && uFloat > 0.5) {
        float mdx = abs(aTarget.x - ${CX.toFixed(1)});
        float mw = aTarget.y < uMouthGeo.z ? uMouthGeo.y : uMouthGeo.w;
        float jy = jawLine(aTarget.x - uHead.x);
        float jaw = smoothstep(uMouthGeo.x, uMouthGeo.x + 1.0, aTarget.y) * (1.0 - smoothstep(mw - 1.5, mw + 1.5, mdx))
          * (1.0 - smoothstep(jy - 1.0, jy + 3.0, aTarget.y)) * (1.0 - uArt);
        p.y += uMouth.x * (uSlit > 0.5 ? aSlit : jaw) * e;
      }
      if (uSlit > 0.5) slitLight = uMouth.y;
      // Speaking, the red of each cheek flares round its core as the voice comes out there.
      float cheekLight = 1.0;
      if (uCheek.x > 0.001) {
        vec2 cl = aTarget - uCheek.yz;
        vec2 cr = aTarget - vec2(${(W - 1).toFixed(1)} - uCheek.y, uCheek.z);
        cheekLight = 1.0 + 1.3 * uCheek.x * (exp(-dot(cl, cl) / 900.0) + exp(-dot(cr, cr) / 900.0));
      }
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
      // pulse a breath, leaving the ports and dying out by the neck. Answering a call, one
      // strong surge runs the whole way up, shining through the plates where it passes.
      float artLight = 1.0;
      if (uArt > 0.5) {
        // The course runs to the eyes, but the pulses die out over its last 100 px (under the
        // brow, up the cheekbone) and reach the eyes only at the extremes (uArtReach).
        float reach = mix(smoothstep(25.0, 100.0, aArt.w), 1.0, uArtReach);
        float k = (aArt.x - uArtPhase) / 260.0;
        float band = pow(0.5 + 0.5 * cos(6.2831 * k), 8.0) * reach;
        float beat = pow(0.5 + 0.5 * cos(6.2831 * uArtPhase / 260.0), 6.0);
        float flow = mix(0.5, aArt.y < 0.5 ? 0.75 + 0.6 * beat : 0.5 + 1.1 * band, uArtBeat.z);
        // Thinking, the thought goes UP: quick pulses leave the sources 170 px apart (each
        // one flaring them) and run up the outer arteries, over the temples and down the
        // forehead to the eyes, shining through the plates as they pass (each lights the eyes
        // as it arrives, see eyeGain). The inner ones go quiet.
        float tk = uArtThink.x;
        float tband = pow(0.5 + 0.5 * cos(6.2831 * (aArt.x - uArtThink.y) / 170.0), 10.0) * reach;
        if (aArt.y > 1.5) flow = mix(flow, 0.35 + 2.2 * tband, tk);
        else if (aArt.y > 0.5) flow = mix(flow, 0.4, 0.6 * tk);
        else flow = mix(flow, 0.7 + 1.2 * tband, tk);
        // Tooling, a machine at work: the chest beats like an engine, each beat sending a short
        // pulse up all four arteries of one side (flaring its source as it leaves), left and
        // right in turn like pistons: the right's run 280 px, half a beat, behind. When the
        // work ends no more leave (a pulse at s left when the engine had run s px less), and
        // the gain lets a failure make the stalled ones flicker out.
        float wk = uArtTool.x;
        float wside = step(${CX.toFixed(1)}, aTarget.x);
        float wband = pow(0.5 + 0.5 * cos(6.2831 * (aArt.x - uArtTool.y + 280.0 * wside) / 560.0), 24.0) * step(uArtTool.z, aArt.x) * uArtTool.w * reach;
        flow = mix(flow, 0.35 + 2.4 * wband, wk);
        // Listening, the outer arteries, which pass the ears at the temples, carry the voice
        // IN: their outward flow gives way to a faint glow that follows the voice, and each
        // syllable sends a pulse down them from the ear to the source, as strong as it was.
        // The sources stop flaring outward and flare instead as the words arrive (uArtHear.z).
        float heard = 0.0;
        if (aArt.y > 1.5) {
          flow = mix(flow, 0.45 + 0.6 * uArtHear.y, uArtHear.x);
          for (int i = 0; i < 8; i++) {
            float iz = (aArt.x - uArtIn[i].x) / 30.0;
            heard += uArtIn[i].y * exp(-iz * iz);
          }
          flow += 2.6 * heard;
        } else if (aArt.y < 0.5) flow = mix(flow, 0.7, uArtHear.x) + 3.0 * uArtHear.z;
        // Speaking, the inner arteries carry its voice OUT: each syllable it says sends a pulse up
        // them from the chest (flaring the source as it leaves), as strong as the syllable, and it
        // dies out at the cheek beside the mouth (uArtSpeak.w px along), where the voice comes out
        // and the cheek flares; only the loudest run on up the cheekbone to the eye (uArtOut[i].z),
        // or any at the extremes. Meanwhile the inner ones glow faintly with the voice and the
        // outer ones go quiet.
        float said = 0.0;
        if (uArtSpeak.x > 0.001) {
          float sk = uArtSpeak.x;
          if (aArt.y > 1.5) flow = mix(flow, 0.35, sk);
          else {
            flow = mix(flow, (aArt.y < 0.5 ? 0.6 : 0.4) + 0.5 * uArtSpeak.y, sk);
            float pastCheek = smoothstep(uArtSpeak.w - 15.0, uArtSpeak.w + 25.0, aArt.x);
            for (int i = 0; i < 8; i++) {
              vec4 o = uArtOut[i];
              float oz = (aArt.x - o.x) / o.w;
              said += o.y * exp(-oz * oz) * (1.0 - pastCheek * (1.0 - max(o.z, uArtReach)));
            }
            said *= sk;
            float cz = (aArt.x - uArtSpeak.w) / 30.0;
            flow += 2.6 * said + 2.2 * uArtSpeak.z * exp(-cz * cz) * step(0.5, aArt.y) * sk;
          }
        }
        float hz = (aArt.x - uArtBeat.x) / 26.0;
        flow += 2.4 * uArtBeat.y * exp(-hz * hz) * exp(-aArt.x / 120.0);
        float sz = (aArt.x - uArtSurge.x) / 45.0;
        float surge = uArtSurge.y * exp(-sz * sz) * reach;
        flow += 3.0 * surge;
        float through = mix(mix(0.06, 0.65, uArtHeat), 0.95, min(1.0, surge));
        through = max(through, 0.7 * min(1.0, heard));
        through = max(through, 0.6 * tband * tk * step(1.5, aArt.y));
        through = max(through, 0.55 * wband * wk);
        through = max(through, 0.65 * min(1.0, said));
        artLight = flow * mix(1.0, through, aArt.z) * mix(0.5, 1.7, uArtHeat);
      }

      // Voice makes the face shiver.
      p.y += sin(p.x * 0.06 + uTime * 11.0 + ph) * uLevel * aFace * 2.6 * uIsFace;

      vec2 w = (p - uAnchor) * uScale;
      w.y = -w.y;
      w += uOffset;
      w.x += uParallax * (0.4 + aSeed * 0.6);

      // THE HUD, in screen space so every layer agrees on where it is. Calm: the loose dust
      // drifts out of the zone and fades, and the figure behind it dims, so the text over it
      // reads. Rim: the loose dust near its border is drawn onto it, a thin band of motes.
      float zoneLight = 1.0;
      for (int i = 0; i < 2; i++) {
        vec2 fx = uZoneFx[i];
        if (fx.x + fx.y > 0.001) {
          vec4 z = uZone[i];
          vec2 c = (z.xy + z.zw) * 0.5;
          vec2 h = (z.zw - z.xy) * 0.5;
          vec2 q = w - c;
          vec2 d = abs(q) - h;
          float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); // < 0 inside
          bool beyond = max(d.x, d.y) > 0.0;
          vec2 edge = beyond ? clamp(q, -h, h) : (d.x > d.y ? vec2(sign(q.x) * h.x, q.y) : vec2(q.x, sign(q.y) * h.y));
          vec2 nrm = beyond ? normalize(q - edge + vec2(0.0, 0.0001)) : (d.x > d.y ? vec2(sign(q.x), 0.0) : vec2(0.0, sign(q.y)));
          float inside = 1.0 - smoothstep(-28.0, 10.0, sd);
          if (uPushOn > 0.5) {
            w += nrm * fx.x * inside * 18.0 * e;
            zoneLight *= 1.0 - 0.85 * fx.x * inside;
            // Each mote the rim takes has its own place round the border (by its seed), so the
            // dust that streams in from either side spreads into an even outline.
            float pull = fx.y * (1.0 - smoothstep(280.0, 340.0, abs(sd))) * e;
            float per = 4.0 * (h.x + h.y);
            float at = fract(aSeed * 7.13) * per;
            vec2 rim;
            if (at < 2.0 * h.x) rim = vec2(at - h.x, h.y);
            else if (at < 2.0 * h.x + 2.0 * h.y) rim = vec2(h.x, h.y - (at - 2.0 * h.x));
            else if (at < 4.0 * h.x + 2.0 * h.y) rim = vec2(h.x - (at - 2.0 * h.x - 2.0 * h.y), -h.y);
            else rim = vec2(-h.x, -h.y + (at - 4.0 * h.x - 2.0 * h.y));
            vec2 rimN = abs(rim.x) >= h.x - 0.01 ? vec2(sign(rim.x), 0.0) : vec2(0.0, sign(rim.y));
            vec2 onRim = c + rim + rimN * (fract(aSeed * 13.7) - 0.35) * 6.0;
            w = mix(w, onRim, pull);
            zoneLight *= 1.0 + 0.8 * pull;
          } else {
            zoneLight *= 1.0 - 0.5 * fx.x * inside;
          }
        }
      }
      gl_Position = vec4(w.x / (uView.x * 0.5), w.y / (uView.y * 0.5), 0.0, 1.0);

      // Cyan gives way under the orange; orange swells with the voice.
      float dim = 1.0 - uDim * aFace * (1.0 - uIsFace);
      float boost = 1.0 + uLevel * 0.55 * uIsFace;
      float wave = mix(1.0, (1.0 - uWaveDepth) + uWaveDepth * sin(uTime * uWaveRate - p.y * 0.012 + ph), uWave);

      // Brighter while in flight, so the assembly reads as a stream of light.
      float flight = 1.0 + (1.0 - abs(e * 2.0 - 1.0)) * (1.0 - step(0.999, t)) * 1.2;
      float shown = mix(1.0, smoothstep(0.0, 0.12, t), uRamp);
      // Loose motes differ: a few bright, most dim, all twinkling slowly. That
      // fades out as each one becomes part of the figure.
      float mote = (0.25 + 1.5 * pow(fract(aSeed * 9.13), 3.0)) * (0.8 + 0.2 * sin(uFreeTime * (0.2 + aSeed * 0.5) + ph));
      vAlpha = shown * mix(1.0, mote, looseness) * dim * wave * boost * flight * uLife * headLight * bodyLight * attnLight * clickLight * behind * artLight * gestureLight * discLight * eyeLight * slitLight * cheekLight * zoneLight * (1.0 + 0.6 * uStir + 0.35 * pushed);
      // Palette swap: cyan (and its white highlights) becomes red, red stays red.
      float m = max(max(aColor.r, aColor.g), aColor.b);
      float whiteness = min(min(aColor.r, aColor.g), aColor.b) / max(m, 0.001);
      vec3 redC = mix(vec3(1.0, 0.13, 0.1), vec3(1.0, 0.72, 0.62), clamp(whiteness * 1.4, 0.0, 1.0)) * m;
      vColor = mix(aColor, redC, uRed);
      gl_PointSize = max(1.0, aSize * uPix * (1.0 + uLevel * 0.25 * uIsFace) * mix(1.0, 0.7 + 0.8 * fract(aSeed * 5.7), looseness) * (1.0 + (clickLight - 1.0) * 0.1) * (1.0 + (artLight - 1.0) * 0.2));
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
  // Listening (see uArtHear and uArtIn in the shader).
  const artHearU = { value: new THREE.Vector3() }
  const artInU = { value: Array.from({ length: 8 }, () => new THREE.Vector2(-9999, 0)) }
  let earS = 540 // px along an outer artery from its source to where it passes the ear (set by build())
  let outerLen = 714 // px along an outer artery from its source to its end over the eye (set by build())
  // Thinking and tooling (see uArtThink and uArtTool in the shader).
  const artThinkU = { value: new THREE.Vector3() }
  const artToolU = { value: new THREE.Vector4(0, 0, -1, 1) }
  const artReachU = { value: 0 } // see uArtReach: eased in the frame loop
  // Speaking (see uArtSpeak, uArtOut, uPush and uCheek in the shader). The left cheek's red core,
  // read off the V2 render (canvas px; the right mirrors it), is where its voice comes out.
  const artSpeakU = { value: new THREE.Vector4() }
  const artOutU = { value: Array.from({ length: 8 }, () => new THREE.Vector4(-9999, 0, 0, 30)) }
  const pushU = { value: Array.from({ length: 4 }, () => new THREE.Vector2(-9999, 0)) }
  const CHEEK = [431, 380]
  let cheekS = 366 // px along an inner artery from its source to the cheek's core (set by build())
  let innerLen = 478 // px along an inner artery from its source to its end under the eye (set by build())
  // The four red discs, read off the V2 render (canvas px, [x, y, radius]): two by the middle of
  // the chest, on whose rims the arteries start, and two inside the shoulders, their upper part
  // under the plates. Tooling works them (see disc in the frame loop).
  const DISCS = [
    [440, 766, 42],
    [583, 766, 42],
    [168, 778, 38],
    [855, 778, 38],
  ]
  const discsU = { value: DISCS.map(([x, y, r]) => new THREE.Vector4(x, y, r, 0)) }
  const discFxU = { value: DISCS.map(() => new THREE.Vector3()) }
  // The eyes and the mouth, as the art gives them (meta.eyes, meta.mouth; see art/from-image.mjs).
  // Art without them has no eye layer and no slit, and nothing moves the jaw.
  const EYE = meta.eyes
  const MOUTH = meta.mouth
  const eyeCU = { value: [0, 1].map((i) => new THREE.Vector2(...(EYE ? EYE.at[i].c : [0, 0]))) }
  const eyeGeoU = { value: new THREE.Vector4(EYE?.slant ?? 0, EYE?.outer ?? 30, EYE?.inner ?? 30, EYE?.iris ?? 13) }
  const eyeLidU = { value: new THREE.Vector3(EYE?.up ?? 6, EYE?.lo ?? 9, EYE?.rings ?? 2.5) }
  const eyeStU = { value: [0, 1].map(() => new THREE.Vector4(1, 0, 0, 1)) }
  const eyeLookU = { value: new THREE.Vector2() }
  const eyeSpinU = { value: new THREE.Vector2() }
  const mouthGeoU = { value: new THREE.Vector4(MOUTH?.seam ?? 0, MOUTH?.column ?? 0, MOUTH?.cupTop ?? 0, MOUTH?.cup ?? 0) }
  const mouthU = { value: new THREE.Vector2() }

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
  // HUD_ZONES: the parts of the HUD the figure answers to, shared by every layer. The host
  // says each frame where they are and what each wants (zones()); the strengths ease here,
  // so a zone fades in and out instead of switching.
  const ZONES = 2
  const zoneU = { value: Array.from({ length: ZONES }, () => new THREE.Vector4()) }
  const zoneFxU = { value: Array.from({ length: ZONES }, () => new THREE.Vector2()) }
  const curA = { value: Array.from({ length: K }, () => new THREE.Vector4()) }
  const curB = { value: Array.from({ length: K }, () => new THREE.Vector4()) }
  const curSrc = [] // where each gathers
  const curDst = [] // where each delivers
  let routes = [] // how each current travels this boot
  let reachNow = 2000 // how far a current can carry a particle: past any edge of the window
  let waveReach = 900 // figure px from the mouth to the window's farthest corner (speaking's dust waves)
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
    uArtSurge: { value: new THREE.Vector3(-9999, 0, 0) },
    uArtHear: artHearU,
    uArtIn: artInU,
    uStir: { value: 0 },
    uArtThink: artThinkU,
    uArtTool: artToolU,
    uArtSpeak: artSpeakU,
    uArtOut: artOutU,
    uPush: pushU,
    uPushOn: { value: 0 },
    uPushAt: { value: new THREE.Vector3(CX, H / 2, 1) },
    uCheek: { value: new THREE.Vector3(0, ...CHEEK) },
    uDiscs: discsU,
    uDiscFx: discFxU,
    uSpins: { value: 0 },
    uArtReach: artReachU,
    uEye: { value: 0 },
    uEyeC: eyeCU,
    uEyeGeo: eyeGeoU,
    uEyeLid: eyeLidU,
    uEyeSt: eyeStU,
    uEyeLook: eyeLookU,
    uEyeSpin: eyeSpinU,
    uMouthGeo: mouthGeoU,
    uMouth: mouthU,
    uSlit: { value: 0 },
    uCrumbleAt: { value: new THREE.Vector4(0, 0, 1, 1) },
    uCrumble: { value: 0 },
    uRebuildAt: { value: new THREE.Vector4(0, 0, 1, 1) },
    uRebuild: { value: new THREE.Vector3() },
    uParallax: { value: 0 },
    uRed: { value: 0 },
    uFade: { value: 1 },
    uLife: { value: 1 },
    uLoose: { value: 1 },
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
    uZone: zoneU,
    uZoneFx: zoneFxU,
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
            end: pa.pts.at(-1).s - q.s,
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
        end: 9999,
        role: 0,
      })
    }
    // How much plate lies over each one (plates.png, 0 open .. 1 a plate). Under a plate they
    // are not drawn at all (the user: hidden behind the plates, showing only in the cavities,
    // the cuts and the seams), with a soft edge where an opening ends.
    for (const p of out) {
      const x = Math.min(plates.w - 1, Math.max(0, Math.round(p.x)))
      const y = Math.min(plates.h - 1, Math.max(0, Math.round(p.y)))
      p.cover = plates.data[(y * plates.w + x) * 4] / 255
    }
    return out.filter((p) => p.role === 0 || r() > Math.max(0, Math.min(1, (p.cover - 0.35) / 0.25)))
  }

  /**
   * The eyes as particles (meta.eyes, canvas px). Each iris is drawn whole, its lids hide it
   * in the shader: rings bright at the rim and every 1/rings of the way in, dark between, round
   * a hot pupil, laid on a half-px grid and spread evenly. The lids themselves are not drawn
   * (the user preferred the irises alone to red lines round them): they show only by what they
   * cut off. Each particle carries aEye (see the shader): which eye, what it is, its place on it.
   */
  function eyeParticles({ iris: R, rings, at }, count, seed) {
    const r = rng(seed)
    const sm = (a, b, v) => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    const shoulder = (v) => 1 - Math.exp(-1.7 * v)
    const out = []
    const STEP = 0.5
    const n = Math.ceil((R + 2) / STEP)
    const cells = []
    let sum = 0
    for (let j = -n; j <= n; j++)
      for (let i = -n; i <= n; i++) {
        const dx = i * STEP
        const dy = j * STEP
        const rr = Math.hypot(dx, dy)
        const t = rr / R
        const band = 0.5 + 0.5 * Math.cos((1 - t) * rings * 2 * Math.PI)
        const ring = (0.08 + 0.92 * band ** 4) * sm(1.1, 0.97, t) * sm(0.12, 0.3, t)
        const pupil = Math.exp(-((rr / (0.18 * R)) ** 2))
        const red = shoulder(ring * 1.1 + 0.3 * ring + 1.4 * pupil)
        const w = Math.pow(Math.max(ring, pupil * 1.2), 0.6)
        cells.push({ dx, dy, w, pupil: pupil > ring, col: [red, shoulder(0.13 * 1.1 * ring + 0.58 * (0.3 * ring + 1.4 * pupil)), shoulder(0.1 * 1.1 * ring + 0.4 * (0.3 * ring + 1.4 * pupil))] })
        sum += w
      }
    const perEye = count / at.length
    for (const { c, side } of at) {
      let carry = 0
      for (const cell of cells) {
        carry += (cell.w * perEye) / sum
        if (carry < 0.5) continue
        carry -= 1
        const x = cell.dx + (r() - 0.5) * STEP
        const y = cell.dy + (r() - 0.5) * STEP
        const [cr, cg, cb] = cell.col
        out.push({ x: c[0] + x, y: c[1] + y, r: cr, g: cg, b: cb, l: Math.max(cr, cg, cb), eye: [side, cell.pupil ? 1 : 0, Math.hypot(x, y), Math.atan2(y, x)] })
      }
    }
    return out
  }

  /**
   * The mouth's slit (meta.mouth, canvas px): red particles along the seam under the nose plate,
   * from one red vent to the other, each aSlit of the way across the gap the jaw opens. The gap
   * is widest over the jaw piece (the column) and closes to a glowing line toward the corners;
   * the light is hottest in the middle.
   */
  function mouthParticles({ seam, x0, x1, column }, count, seed) {
    const r = rng(seed)
    const sm = (a, b, v) => {
      const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
      return t * t * (3 - 2 * t)
    }
    const out = []
    for (let k = 0; k < count; k++) {
      const x = x0 + ((k + r()) / count) * (x1 - x0)
      const dx = Math.abs(x - CX)
      const widest = dx < column ? 1 : 0.2 + 0.8 * sm(x1 - CX, column, dx)
      const mid = sm(x1 - CX, 0, dx)
      const l = 0.55 + 0.45 * mid
      out.push({ x, y: seam + 0.5 + (r() - 0.5) * 0.8, r: l, g: l * (0.18 + 0.35 * mid), b: l * (0.12 + 0.25 * mid), l, slit: r() * widest })
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
    makeLayer(sample(lines, BUDGET.lines, { floor: 0.05, bias: 0.25, seed: 11, even: true }), {
      ...figure,
      seed: 101,
      jitter: (p, r) => 0.3 + r() * 0.7,
    })
    // The shading of the plates, for art that has it (the AI render does).
    if (meta.fill) {
      const fill = await pixels('fill.png')
      makeLayer(sample(fill, BUDGET.fill, { floor: 0.05, bias: 1, seed: 19, even: true }), {
        ...figure,
        seed: 109,
        jitter: (p, r) => 0.2 + r() * 0.5,
      })
    }
    // Extra particles for the head, which is small on screen and carries the
    // character: finer, denser, same palette; its seams as thin lines (see art/from-image.mjs).
    if (meta.head) {
      const [headLines, headFill] = await Promise.all(['head-lines.png', 'head-fill.png'].map(pixels))
      makeLayer(sample(headLines, BUDGET.headLines, { floor: 0.05, bias: 0.8, seed: 21, even: true }), {
        ...figure,
        seed: 111,
        size: 0.8,
        jitter: (p, r) => 0.2 + r() * 0.4,
      })
      makeLayer(sample(headFill, BUDGET.headFill, { floor: 0.05, bias: 1, seed: 22, even: true }), {
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
      makeLayer(sample(chin, BUDGET.chin, { floor: 0.05, bias: 0.8, seed: 40, even: true }), {
        ...figure,
        seed: 120,
        size: 0.8,
        jitter: (p, r) => 0.2 + r() * 0.4,
      })
    }
    makeLayer(sample(rim, BUDGET.rim, { floor: 0.06, bias: 0.5, seed: 14, even: true }), {
      ...figure,
      seed: 104,
      jitter: (p, r) => 0.15 + r() * 0.5,
    })
    // The dust shed round the outline, close to the plates. Listening, the voice stirs it
    // along with the backdrop (see listen.stir).
    const dustLayer = makeLayer(sample(dust, BUDGET.dust, { floor: 0.06, bias: 0.3, seed: 15 }), {
      ...figure,
      seed: 105,
      jitter: (p, r) => 2 + r() * 6,
    })
    dustLayer.stirs = true

    // Red light spilling off the figure. It is already red, so the palette swap leaves
    // it be (uRed is only driven on the cyan layers, see the frame loop). No flare runs
    // across the eyes: it read as a red line through the face.
    makeLayer(sample(redrim, BUDGET.redrim, { floor: 0.05, bias: 0.5, seed: 16, even: true }), {
      ...figure,
      kind: 'redlight',
      seed: 106,
      jitter: (p, r) => 0.6 + r() * 1.6,
      delayOf: redDelay,
      durOf: redDur,
    })

    // The hottest red points: the cheek targets, the creases across the forehead, and with the
    // procedural art the eyes (the render's are drawn below, eyeParticles). Their own layer so
    // the frame loop can drive their brightness by state. They light last.
    lightsLayer = makeLayer(sample(lights, BUDGET.lights, { floor: 0.05, bias: 0.4, seed: 18, even: true }), {
      ...figure,
      kind: 'redlight',
      seed: 108,
      jitter: () => 0.25,
      delayOf: eyesDelay,
      durOf: eyesDur,
    })

    const vein = makeLayer(sample(veins, BUDGET.veins, { floor: 0.08, bias: 0.6, seed: 12, even: true }), {
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
        attrs: { aArt: [4, (p) => [p.s, p.role, p.cover, p.end]] },
      })
      art.uniforms.uArt.value = 1
      // Where the outer arteries pass the ears, at the top of the red louvres on the temple
      // (canvas px, left side; the right mirrors it): the voice's pulses start there.
      const EAR = [371, 268]
      const outer = arteryCourse.routes.find((rt) => rt.role === 'outer' && rt.pts[0][0] < CX)
      const nearest = (course, [x, y]) => course.reduce((b, q) => (Math.hypot(q.x - x, q.y - y) < Math.hypot(b.x - x, b.y - y) ? q : b)).s
      if (outer) {
        const course = spline(outer.pts)
        earS = nearest(course, EAR)
        outerLen = course.at(-1).s
      }
      // Where the inner ones pass the cheek's red core, beside the mouth: speaking, the voice
      // comes out there.
      const inner = arteryCourse.routes.find((rt) => rt.role === 'inner' && rt.pts[0][0] < CX)
      if (inner) {
        const course = spline(inner.pts)
        cheekS = nearest(course, CHEEK)
        innerLen = course.at(-1).s
      }
      artSpeakU.value.w = cheekS
    }

    // The eyes, drawn here so that they can move (see eyeParticles and the shader): small, still
    // particles, arriving last with the lights. The frame loop drives them (see eyes).
    if (EYE && BUDGET.eyes) {
      eyesLayer = makeLayer(eyeParticles(EYE, BUDGET.eyes, 51), {
        kind: 'eyes',
        anchor: [CX, H],
        seed: 131,
        size: 0.7,
        jitter: () => 0.12,
        delayOf: eyesDelay,
        durOf: eyesDur,
        startOf: figureStart,
        attrs: { aEye: [4, (p) => p.eye] },
      })
      eyesLayer.uniforms.uEye.value = 1
    }
    // The mouth's slit, dark until the jaw drops (see mouthParticles and the shader).
    if (MOUTH && BUDGET.mouth) {
      const slit = makeLayer(mouthParticles(MOUTH, BUDGET.mouth, 52), {
        kind: 'slit',
        anchor: [CX, H],
        seed: 132,
        size: 0.75,
        jitter: () => 0.2,
        delayOf: eyesDelay,
        durOf: eyesDur,
        startOf: figureStart,
        attrs: { aSlit: [1, (p) => [p.slit]] },
      })
      slit.uniforms.uSlit.value = 1
    }

    const states = {}
    for (const [i, s] of meta.states.entries()) {
      const img = await pixels(`face-${s}.png`)
      const count = /^(speak|strong)/.test(s) ? BUDGET.faceBars : BUDGET.face
      const layer = makeLayer(sample(img, count, { floor: 0.06, bias: 0.45, seed: 20 + i, even: true }), {
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
  let eyesLayer = null
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
    // The mouth, where speaking's waves through the dust start (see uPushAt).
    const mouthAt = [CX, MOUTH?.seam ?? FACE.cy]
    const mouthDown = (H - mouthAt[1]) * scale // CSS px from the mouth down to the window's bottom
    waveReach = Math.hypot(vw / 2, Math.max(mouthDown, vh - mouthDown)) / scale
    for (const l of layers) {
      const u = l.uniforms
      u.uView.value.set(vw, vh)
      u.uPix.value = dprCap
      if (l.kind === 'back') {
        u.uScale.value = bs
        u.uOffset.value.set(0, -vh / 2)
        u.uPushAt.value.set(BW / 2 + ((mouthAt[0] - CX) * scale) / bs, BH + ((mouthAt[1] - H) * scale) / bs, bs / scale)
      } else {
        u.uScale.value = scale
        u.uOffset.value.set(0, -vh / 2)
        u.uPushAt.value.set(mouthAt[0], mouthAt[1], 1)
      }
    }
  }
  on(window, 'resize', layout)
  layout()

  /* ----------------------------------------------------------------- input */

  const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, speed: 0, seen: false }
  const click = { x: 0, y: 0, t: -99 } // the last click on the awake figure, image px and clock
  on(window, 'pointermove', (e) => {
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
  on(window, 'pointerleave', () => {
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
  //   level  the voice level that drives the shimmer (and the mouth while it speaks). Simulated
  //          here; the app would feed its own.
  // Optional, set only where a state differs:
  //   follow how quickly the head and the trunk follow the cursor (1 = 4.2/s and 1.8/s)
  //   nod    rad the head hangs forward       beat   1 = the arteries beat once a breath, else steady flow
  //   breath [rad/s, px it rises, how much the brightness follows it]; by default it runs on
  //          the figure's clock (0.8 rad/s at rate 1), 1.6 px, brightness steady
  //   lid    how open the eyes are (1 at rest, 0 shut, >1 wide)   squint  the lower lids rise 0..1
  //   pupil  the irises' size (1 at rest)                          spin   1 = the irises' rings turn
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
      // heavy-lidded, the irises small
      lid: 0.3,
      pupil: 0.8,
    },
    waking: { look: 1, life: 1.1, rate: 1.4, loose: 0.8, dim: 0.8, wave: [3.4, 0.5], level: (t) => 0.14 + 0.1 * Math.sin(t * 7.3), lid: 1.15, pupil: 1.1 },
    // Attentive, and from above: chin up, the head on the cursor at once, the breath short and
    // held (3 s, 1 px). The voice it hears comes in at the ears and down the outer arteries (see listen).
    listening: {
      look: 1.1,
      life: 1,
      rate: 1,
      loose: 1,
      dim: 0.3,
      wave: [2.4, 0.38],
      level: (t) => 0.1 + 0.08 * Math.sin(t * 2.2),
      follow: 1.7,
      nod: -0.035,
      breath: [(2 * Math.PI) / 3, 1, 0],
      // wide open, the irises open to take it in
      lid: 1.12,
      pupil: 1.15,
    },
    // Absent, calculating: the cursor is let go and it stares at a vague point off to one side
    // and up (stare), the head nearly still; the breath all but stops and the dust settles.
    // What moves is the thought, going up the outer arteries and down into the eyes (see think).
    thinking: {
      look: 0,
      life: 1,
      rate: 0.8,
      loose: 0.4,
      dim: 0.72,
      wave: [1.2, 0.25],
      level: () => 0.08,
      follow: 0.6,
      breath: [(2 * Math.PI) / 6, 0.3, 0],
      stare: 1,
      // half-closed, the irises' rings turning like a lens hunting for focus
      lid: 0.8,
      pupil: 0.9,
      spin: 1,
    },
    // In command of something it is running: it follows the cursor, but stiffly and slower,
    // the trunk held firm and the idle sway nearly gone (sway, trunk); a short, regular breath.
    // The work itself is the engine in the chest and the red discs (see tool and disc).
    tooling: {
      look: 0.8,
      life: 1.05,
      rate: 1.25,
      loose: 0.9,
      dim: 0.6,
      wave: [7, 0.8],
      level: () => 0.06,
      follow: 0.5,
      sway: 0.2,
      trunk: 0.4,
      breath: [(2 * Math.PI) / 2.5, 1.2, 0],
      // narrowed on the work, the irises tight (and catching each beat, see eyes)
      lid: 0.9,
      squint: 0.3,
      pupil: 0.85,
    },
    // Talking: half an eye on the cursor, breathing as one who speaks, the voice going out up the
    // inner arteries to the cheeks, a nod on each stressed syllable (see speak). How it speaks is
    // the tone it answered the call in (TONE, laid over this).
    speaking: {
      look: 0.55,
      life: 1,
      rate: 1,
      loose: 1,
      dim: 0.8,
      wave: [2.4, 0.38],
      // Its own voice, made up here (speech, syllables and short breaths): the mouth moves with
      // it (see mouth), and with the procedural art the loud passages pick the tall bars.
      level: () => 0.12 + 0.88 * speech.level,
      // the steady breath gives way to a speaker's (see speak.air)
      breath: [(2 * Math.PI) / 4, 0, 0],
    },
  }
  // How it speaks: the style it answered the call in (the mind's answer, see call()), or, spoken
  // to without a call, the one its mood would pick (MOOD_TONE). Each sets its made-up voice here
  // (the app would play its own: phrase and pause s, syllables a second, loudness), how its pulses
  // run up the inner arteries (px/s, strength, width px), how loud a word must be to run on to
  // the eyes (reach) and a syllable to count as stressed (stress: it nods, by nod rad, and pushes
  // the dust), px it rises drawing breath (air), how hot the face runs, how bright the eyes, and
  // its bearing (laid over STATE.speaking). Reach and stress are set against the made-up voice:
  // speaking eager, it says ~1.7 words a second, one in ten gets to the eyes (more in a loud
  // phrase, none in a quiet one), and it stresses ~0.6 syllables a second; curt, more of both;
  // regal, fewer; weary, a stress now and then and nothing to the eyes. The app's own voice will
  // want them set again.
  const TONE = {
    // Neutral: clear and direct.
    eager: {
      voice: { phrase: [1.5, 3.5], pause: [0.35, 0.8], rate: [4.5, 6], amp: [0.6, 0.95] },
      speed: 850,
      strength: 1,
      width: 28,
      reach: 0.72,
      stress: 0.6,
      nod: 0.02,
      air: 2,
      heat: 0,
      eyes: 1,
      bearing: { lid: 1.05 },
    },
    // Bored: slow, faint and low, the lids heavy, sighing between phrases; nothing reaches the eyes.
    weary: {
      voice: { phrase: [1.2, 3], pause: [0.6, 1.3], rate: [3, 4], amp: [0.35, 0.6] },
      speed: 480,
      strength: 0.6,
      width: 34,
      reach: 2,
      stress: 0.42,
      nod: 0.012,
      air: 2.6,
      heat: -0.2,
      eyes: 0.75,
      bearing: { lid: 0.6, life: 0.85, follow: 0.6 },
    },
    // Irritated: short, quick, clipped phrases, the pulses hot and hard, the eyes narrowed.
    curt: {
      voice: { phrase: [0.6, 1.6], pause: [0.35, 0.7], rate: [5.5, 7], amp: [0.7, 1] },
      speed: 1200,
      strength: 1.25,
      width: 22,
      reach: 0.72,
      stress: 0.6,
      nod: 0.028,
      air: 1.4,
      heat: 0.4,
      eyes: 1.2,
      bearing: { squint: 0.4, follow: 1.6 },
    },
    // Vain: unhurried and measured, the chin up, the pulses wide and slow.
    regal: {
      voice: { phrase: [2, 4.5], pause: [0.6, 1.2], rate: [3.2, 4.2], amp: [0.6, 0.9] },
      speed: 600,
      strength: 1.05,
      width: 42,
      reach: 0.75,
      stress: 0.63,
      nod: 0.015,
      air: 2.4,
      heat: 0.1,
      eyes: 1.1,
      bearing: { lid: 0.8, nod: -0.05, follow: 0.6 },
    },
  }
  const MOOD_TONE = { irritation: 'curt', boredom: 'weary', vanity: 'regal' }
  const SPEAK_AS = Object.fromEntries(Object.entries(TONE).map(([name, t]) => [name, { ...STATE.speaking, ...t.bearing }]))
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
        // Coming up; the flash, and how fast, is the mind's answer (eyes.boost, eyes.gain).
        return Math.min(1, 0.12 + since / 0.35)
      case 'listening':
        // Steady, catching each syllable of the voice it hears.
        return 1.35 + 0.3 * listen.level + 0.35 * Math.exp(-(clock - listen.onsetAt) / 0.12)
      case 'thinking':
        // Low, calculating, lit by each pulse of thought as it arrives down the outer arteries;
        // now and then a short, uneven stutter (see think).
        return (clock < think.glitchUntil ? 0.7 + 0.4 * Math.sign(Math.sin(clock * 75)) : 0.7) + 0.6 * think.build * think.arrive
      case 'tooling':
        // Firm, catching each beat of the engine.
        return 1.1 + 0.3 * Math.exp(-(clock - tool.beatAt) / 0.08)
      case 'speaking':
        // With its voice, in its tone's light, flashing as a loud syllable's pulse gets to them.
        return (1 + level * 0.9) * TONE[speak.tone].eyes + 0.35 * Math.exp(-Math.max(0, clock - speak.eyeAt) / 0.12)
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
  // Listening: how far it is given to listening (eased), the voice it hears now, the voice's
  // pulses on their way down the outer arteries ({ at, strength, speed, last }), the one the
  // present syllable is still feeding, the sources' flare as they arrive, when the last
  // syllable began (the eyes catch it), and how hard the dust round the body is stirred.
  const listen = { on: 0, level: 0, pulses: [], word: null, flare: 0, onsetAt: -1e9, stir: 0 }
  // Thinking: how far it is given to it (eased), px its pulses have run up the outer arteries,
  // how far the thought has built up in the eyes (over ~2 s) and how much of a pulse is
  // arriving there now (0..1), the point it stares at (-1..1, drawn on entering), and the eyes'
  // next stutter and the end of the present one.
  const think = { on: 0, phase: 0, build: 0, arrive: 0, stare: { x: 0.3, y: -0.25 }, glitchAt: 0, glitchUntil: 0 }
  // Tooling: how far it is given to it (eased), px the engine's pulses have run up the left
  // arteries (the right run 280 behind) and how fast (px/s), when the last beat came (the eyes
  // catch it) and the last from each side (its chest disc pumps), and how the work ended
  // ({ ok, at }, null while it runs) with px run since.
  const tool = { on: 0, phase: 0, speed: 700, beatAt: -1e9, beatL: -1e9, beatR: -1e9, result: null, cut: 0 }
  // The shoulder discs' turbines: how fast they spin (rad/s) and how far they have turned.
  const disc = { speed: 0, angle: 0 }
  // The eyes: their state as it eases (open, squint, tilt, iris size; spin how hard the rings
  // turn and angle how far), px the irises have moved in their sockets, and the next blink.
  const eyes = { open: 1, squint: 0, tilt: 0, pupil: 1, spin: 0, angle: 0, x: 0, y: 0, blinkAt: -1e9, nextBlink: 3, double: false }
  // Speaking: its own voice (made up here; the app would feed the voice it plays), how far the
  // jaw has dropped (0..1) and how bright the slit is.
  const voiceOut = createHearing({ phrase: [1.5, 4], pause: [0.35, 0.8], long: 0, gap: 0.22, source: says })
  const speech = { level: 0, open: 0, light: 0 }
  // How it speaks (see TONE), and what its voice is doing: how far it is given to speaking
  // (eased); the voice's pulses on their way up the inner arteries ({ at, strength, speed, reach,
  // last }) and the one the present word still feeds; the cheeks' flare as they come out; px
  // of breath it holds (drawn in each pause, let out as it talks); the last stressed syllable
  // (it nods) and whether the present one has been; the waves it pushed through the dust
  // ({ at, strength }); and when a pulse last got to the eyes.
  const speak = { tone: 'eager', on: 0, pulses: [], syllable: null, flare: 0, air: 0, stressAt: -1e9, stressed: false, waves: [], eyeAt: -1e9 }
  let answeredAs = null // the style the mind answered the last call in, until the conversation is over
  const look = { yaw: 0, pitch: 0, body: 0, bodyPitch: 0, attn: 0 } // where the head and the trunk are turned, and how much it attends to the cursor
  const ease = { life: 0, rate: 0.5, loose: 1, dim: 0, waveRate: 1.2, waveDepth: 0.3, look: 0, follow: 1, nod: 0, breathW: 0.4, breathAmp: 1.6, breathGlow: 0, beat: 0, stare: 0, sway: 1, trunk: 1, lid: 1, squint: 0, pupil: 1, spin: 0 }

  let keepPlan = false
  function setState(s, auto = false) {
    if (!STATE[s]) return
    // Nothing wakes it but a call, which the mind answers in its own time (see call()).
    if (s === 'waking' && !wakingByAnswer) return call(auto)
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
    if (s === 'listening' && state !== 'listening') hearing.resetSim()
    // It speaks in the tone it answered the call in. Dev: window.__ultron.tone = 'eager' | 'weary'
    // | 'curt' | 'regal' picks one instead.
    if (s === 'speaking' && state !== 'speaking') {
      const held = hooks.tone
      speak.tone = TONE[held] ? held : (answeredAs ?? MOOD_TONE[mind.output().dominant] ?? 'eager')
      voiceOut.setVoice(TONE[speak.tone].voice)
      voiceOut.resetSim()
    }
    // Back to sleep (or gone), the conversation is over: the next one is answered afresh.
    if (s === 'dormant' || s === 'offline') answeredAs = null
    // Set to work (again, if it already was): the engine starts.
    if (s === 'tooling') Object.assign(tool, { result: null, cut: 0, speed: 700 })
    // Each time it thinks it stares at a fresh point, off to one side and up.
    if (s === 'thinking' && state !== 'thinking')
      think.stare = { x: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.15), y: -(0.2 + Math.random() * 0.1) }
    state = s
    stateAt = now
    mind.setContext(s)
    for (const b of document.querySelectorAll('#bar [data-s]')) b.classList.toggle('on', b.dataset.s === s)
    $('status').textContent = s === 'speaking' ? `${LABEL[s]} · ${speak.tone}` : LABEL[s]
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
    [15, 'waking'], // a call: the answer moves on to listening when it has settled (by ~19 s)
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

  // A call (C, or waking from the bar or the flow). The mind answers it its own way: it may
  // sigh or make you wait first (delay, at most 2 s), then wakes in a style its mood picks
  // (see the answer in mind/personalities/ultron.ts). The app would start listening at once;
  // here the figure turns to waking when the answer begins and to listening once it settles.
  // Before the figure exists (offline, boot) the mind is not there to answer: it just wakes.
  let wakingByAnswer = false
  function call(auto = false) {
    if (!auto) cancelFlow()
    let answer = null
    const off = mind.on((e) => {
      if (e.type === 'answer') {
        answer = e
        answeredAs = e.style
      }
    })
    mind.stimulate('call')
    off()
    flowTimers.push(
      setTimeout(() => {
        wakingByAnswer = true
        setState('waking', true)
        wakingByAnswer = false
        if (answer) $('status').textContent = `waking · ${answer.style}`
      }, (answer ? answer.delay : 0) * 1000),
    )
    flowTimers.push(setTimeout(() => setState('listening', true), (answer ? answer.settle : 1.8) * 1000))
  }

  on($('bar'), 'click', (e) => {
    const b = e.target.closest('[data-s]')
    if (b) setState(b.dataset.s)
  })
  const KEYS = ['offline', 'dormant', 'waking', 'listening', 'thinking', 'tooling', 'speaking']
  on(window, 'keydown', (e) => {
    // The prototype's own keys; hosted, the keyboard is the app's.
    if (!controls) return
    const k = e.key.toLowerCase()
    if (k >= '0' && k <= '6') setState(KEYS[Number(k)])
    if (k === 'b') setState('boot')
    if (k === 'r') replayBoot()
    if (k === 'f') runFlow()
    if (k === 'p') togglePalette()
    if (k === 'c') call()
    if (k === 'm') toggleMic()
    // A tool's outcome, as the app would report it: T done (pleased), Y failed (angry).
    if (k === 't') finishTask(true)
    if (k === 'y') finishTask(false)
  })
  /**
   * The tool has finished. The mind takes it its own way (pleased, or angry), and while it is
   * working the engine stops: done, with one last surge up all four arteries (900 px/s); failed,
   * stalling (see tool in the frame loop). 5 sets it working again.
   */
  function finishTask(ok) {
    mind.stimulate(ok ? 'taskDone' : 'taskFailed')
  }
  // The engine hears it from the mind, however the mind heard it (T and Y here, the app's
  // tools hosted), so the host reports a task once.
  offs.push(
    mind.on((e) => {
      if (e.type === 'stimulus' && (e.name === 'taskDone' || e.name === 'taskFailed')) engineStops(e.name === 'taskDone')
    }),
  )
  function engineStops(ok) {
    if (state !== 'tooling' || tool.result) return
    const now = performance.now() / 1000
    tool.result = { ok, at: now }
    tool.cut = 0
    if (ok) Object.assign(surge, { at: now, speed: 900, strength: 1.2 })
  }
  // M: listen through the real microphone instead of the made-up voice (the browser asks first).
  on($('mic'), 'click', () => toggleMic())
  async function toggleMic() {
    try {
      const on = await hearing.toggleMic()
      $('mic').textContent = on ? 'M mic on' : 'M mic off'
      $('mic').classList.toggle('on', on)
    } catch (err) {
      $('mic').textContent = 'M mic blocked'
      console.warn('microphone:', err)
    }
  }
  // Offline is waiting for a click (the app needs one to unlock audio).
  on(canvas, 'click', () => {
    if (state !== 'offline') return
    if (onIgnite) onIgnite()
    else setState('boot')
  })
  on($('flow'), 'click', () => runFlow())
  // A click on the awake figure sends a pulse of light through it from where it landed.
  on(canvas, 'pointerdown', (e) => {
    if (state === 'offline' || state === 'boot') return
    click.x = (e.clientX - vw / 2) / scale + CX
    click.y = (e.clientY - vh) / scale + H
    click.t = performance.now() / 1000
  })
  on($('again'), 'click', () => replayBoot())
  /** Boot again with the very seeds the last boot ran on, to compare it with another. */
  function replayBoot() {
    if (!lastBoot) return setState('boot')
    keepPlan = true
    rollWedges(lastBoot.wedge)
    rollRoutes(lastBoot.route)
    setState('boot')
    keepPlan = false
  }
  on($('palette'), 'click', () => togglePalette())
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

  /* --------------------------------------------------------- mind gestures */

  // The regions of the body the mind can act on (crumble:<name>, rebuild:<name>): soft
  // ellipses in image px, [x, y, rx, ry], read off the V2 render. The right ones mirror the left.
  const REGIONS = { abdomen: [CX, 930, 70, 70] }
  for (const [k, [x, y, rx, ry]] of Object.entries({ shoulder: [125, 640, 85, 70], collar: [318, 565, 60, 40], chest: [345, 760, 85, 70] })) {
    REGIONS[`${k}L`] = [x, y, rx, ry]
    REGIONS[`${k}R`] = [W - 1 - x, y, rx, ry]
  }
  // A plate lifting off: how far and which way it turns are drawn afresh each time.
  const rebuild = { amount: 0, lift: 10, turn: 0.15 }
  // The surge up the arteries (the 'arteries.surge' cue): when it left, how fast, how strong.
  const surge = { at: -1e9, speed: 1000, strength: 0 }
  offs.push(
    mind.on((e) => {
      if (e.type === 'cue' && e.name === 'arteries.surge')
        Object.assign(surge, { at: performance.now() / 1000, speed: Number(e.args.speed) || 1000, strength: Number(e.args.strength) || 1 })
      // However a call reached it, it speaks in the style it answered in until the conversation
      // is over; hosted, the answer also says when the figure wakes (see followPhase).
      if (e.type === 'answer') {
        answeredAs = e.style
        if (!controls) answering = { wakeAt: performance.now() / 1000 + e.delay, settleAt: performance.now() / 1000 + e.settle }
      }
    }),
  )

  /* ------------------------------------------------------------------ loop */

  // Dev hooks: window.__ultron on the prototype page, window.__figure in the app (whose
  // __ultron is its store).
  const hooks = {
    hold: null,
    trailAt: null,
    clickAge: null,
    pose: null,
    artHeat: null,
    eyes: null, // { open, squint, tilt, pupil, x, y, spin }: holds the eyes there (see eyes in the loop)
    mouth: null, // 0..1: holds the mouth that far open
    layers,
    // Dev: the mind (its config, output(), force('crumble'), stimulate('pointerErratic'), ...).
    mind,
    dream: () => mind.force('dream'),
    call: () => call(),
    // Dev: what it hears and what listening is doing with it.
    hearing,
    listen,
    // Dev: what speaking is doing with its own voice; tone = 'eager' | 'weary' | 'curt' | 'regal'
    // makes it speak in that one from the next time it starts speaking.
    speak,
    tone: null,
    // Dev: what the cursor interactions are doing right now.
    info: () => ({ click: { ...click }, look: { ...look }, clickU: clickU.value.toArray(), easeLook: ease.look, state }),
  }
  window[controls ? '__ultron' : '__figure'] = hooks

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

  /*
   * Hosted, the app says what it is doing (its phase) and the figure follows, but a call is
   * answered in the mind's own time: the app opens the microphone at once, while the figure
   * stays as it was through the answer's prelude (delay) and wakes until it has settled.
   */
  let wanted = 'offline'
  let answering = null // { wakeAt, settleAt }, s on the frame clock
  function followPhase(clock) {
    let want = wanted
    if (answering && (want === 'waking' || want === 'listening')) {
      if (clock < answering.wakeAt) want = state === 'waking' || state === 'listening' ? state : 'dormant'
      else if (clock < answering.settleAt) want = 'waking'
      else answering = null
    } else answering = null
    if (want === state) return
    wakingByAnswer = true
    setState(want, true)
    wakingByAnswer = false
  }

  let raf = 0
  function frame(nowMs) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (nowMs - last) / 1000)
    last = nowMs
    const clock = nowMs / 1000
    // Dev: window.__ultron.hold = seconds freezes the assembly at that moment.
    const dev = hooks
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
    if (controls && state === 'boot' && asm > ASM_END) {
      $('boot').classList.add('gone')
      setState('dormant', true)
    }
    // Hosted, the app's phase leads (see followPhase).
    if (!controls) followPhase(clock)

    // Mouse, eased, then converted into the figure's own pixel space.
    mouse.x += (mouse.tx - mouse.x) * k(14)
    mouse.y += (mouse.ty - mouse.y) * k(14)
    mouse.speed *= Math.exp(-dt * 4)
    const mx = mouse.seen ? (mouse.x - vw / 2) / scale + CX : -9999
    const my = mouse.seen ? (mouse.y - vh) / scale + H : -9999
    // Dev: window.__ultron.trailAt = a clock value freezes the age of the trail there.
    stirTrail(dev && dev.trailAt != null ? dev.trailAt : clock, mx, my)

    // Ease every state parameter toward the current state's target.
    const speaking = state === 'speaking'
    const tone = TONE[speak.tone]
    const cfg = speaking ? SPEAK_AS[speak.tone] : STATE[state]
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
    ease.stare += ((cfg.stare ?? 0) - ease.stare) * k(2.5)
    ease.sway += ((cfg.sway ?? 1) - ease.sway) * k(2)
    ease.trunk += ((cfg.trunk ?? 1) - ease.trunk) * k(2)
    ease.lid += ((cfg.lid ?? 1) - ease.lid) * k(state === 'waking' ? 8 : 3)
    ease.squint += ((cfg.squint ?? 0) - ease.squint) * k(3)
    ease.pupil += ((cfg.pupil ?? 1) - ease.pupil) * k(3)
    ease.spin += ((cfg.spin ?? 0) - ease.spin) * k(2)
    const spoken = voiceOut.update(dt, clock, state === 'speaking')
    speech.level = spoken.level
    levelNow += (cfg.level(clock) - levelNow) * k(10)

    // The mind (../mind): its mood and what it does on its own, as channels laid over the
    // state's own values (see ch() below; a channel nothing touches reads neutral).
    if (tickMind) mind.tick(dt)
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
    // Speaking it breathes as one who speaks instead: in each pause it draws breath (rising by its
    // tone's air, ~2 px, in a quarter of a second) and lets it out slowly as it talks.
    const drawing = speaking && !spoken.talking
    speak.air += ((drawing ? tone.air : speaking ? -0.5 * tone.air : 0) - speak.air) * k(drawing ? 7 : speaking ? 0.6 : 2)
    const breathPx = breathNow * ease.breathAmp * ch('breath.depth') + ch('body.rise') * 7 + speak.air
    const lifeNow = ease.life * (1 + ease.breathGlow * breathNow) * ch('glow')

    // The arteries stay in the background until the intensity is high: a loud voice (the
    // level past ~0.35, fully at ~0.85), plus whatever the mood adds (arteries.heat). Their
    // pulses run at 120 px/s at rest, up to 300 when working hard.
    // Dev: window.__ultron.artHeat = 0..1 holds it.
    const lv = Math.max(0, Math.min(1, (levelNow - 0.35) / 0.5))
    const heatWant = dev && dev.artHeat != null ? dev.artHeat : Math.min(1, lv * lv * (3 - 2 * lv) + ch('arteries.heat'))
    artHeat += (heatWant - artHeat) * k(4)
    artPhase += dt * ease.rate * shimmer * (120 + 180 * artHeat)

    // Listening: what it hears (the microphone, or the made-up voice while that is off). Each
    // syllable sends a pulse from the ears down the outer arteries, as strong as it was (in
    // 1.25 s to the chest), and tells the mind someone is speaking (silence makes it
    // impatient). The end of a phrase sends a last, stronger one (in 0.8 s), and the sources
    // flare as it arrives: where the app would move on to thinking.
    const listening = state === 'listening'
    const heard = hearing.update(dt, clock, listening)
    listen.on += ((listening ? 1 : 0) - listen.on) * k(3)
    listen.level = listening ? heard.level : 0
    if (listening && heard.onset) {
      listen.onsetAt = clock
      listen.pulses.push((listen.syllable = { at: clock, strength: 0, speed: earS / 1.25 }))
      mind.stimulate('voice')
    }
    // The pulse grows with its syllable until the syllable is over.
    if (heard.syllable == null) listen.syllable = null
    else if (listen.syllable) listen.syllable.strength = 0.2 + 1.1 * heard.syllable
    if (listening && heard.phraseEnd) listen.pulses.push({ at: clock, strength: 1.3, speed: earS / 0.8, last: true })
    if (listen.pulses.length > 8) listen.pulses.splice(0, listen.pulses.length - 8)
    listen.flare *= Math.exp(-dt / 0.35)
    const inFront = (p) => earS + 20 - (clock - p.at) * p.speed
    for (const p of listen.pulses)
      if (!p.arrived && inFront(p) < 0) {
        p.arrived = true
        listen.flare += p.last ? 1 : 0.12 * p.strength
      }
    listen.pulses = listen.pulses.filter((p) => inFront(p) > -60)
    for (let i = 0; i < 8; i++) {
      const p = listen.pulses[i]
      artInU.value[i].set(p ? inFront(p) : -9999, p ? p.strength * listen.on : 0)
    }
    artHearU.value.set(listen.on, listen.level, Math.min(1.5, listen.flare))
    // Thinking: the thought goes up. Pulses leave the sources 170 px apart and run up the outer
    // arteries, over the temples and down the forehead into the eyes at 480 px/s, quicker the
    // hotter it runs (an irritated mind thinks hot); each lights the eyes as it arrives, more
    // as the thought builds up over ~2 s (see eyeGain). The eyes stutter now and then: for
    // 0.08-0.2 s, every 0.6-2.4 s.
    const thinking = state === 'thinking'
    think.on += ((thinking ? 1 : 0) - think.on) * k(3)
    think.build += ((thinking ? 1 : 0) - think.build) * k(thinking ? 0.5 : 3)
    think.phase = (think.phase + dt * 480 * (1 + 1.2 * ch('arteries.heat'))) % (170 * 400)
    think.arrive = Math.pow(0.5 + 0.5 * Math.cos((2 * Math.PI * (outerLen - think.phase)) / 170), 4)
    artThinkU.value.set(think.on, think.phase, 0)
    if (clock >= think.glitchAt) {
      think.glitchUntil = clock + 0.08 + Math.random() * 0.12
      think.glitchAt = clock + 0.6 + Math.random() * 1.8
    }

    // The dust round the body stirs in step with the arteries: with the voice as it comes in,
    // and harder as the words arrive at the sources (their flare). It settles in ~0.4 s.
    const stirWant = Math.min(1.2, (1.1 * listen.level + 0.8 * Math.min(1, listen.flare)) * listen.on)
    listen.stir += (stirWant - listen.stir) * k(stirWant > listen.stir ? 14 : 2.5)

    // Speaking: its voice goes OUT, up the inner arteries (the words it heard came in down the
    // outer ones). Each word it says sends a pulse from the chest, as strong as the word gets, at
    // its tone's speed; the pulse comes out at the cheek beside the mouth, which flares a little,
    // and dies there. Only a word louder than the tone's reach runs on up the cheekbone to the
    // eye, lighting it as it gets there (any pulse does at the extremes). The end of a phrase
    // sends a last, stronger one (1.3x as fast), and the cheeks flare fully as it comes out. A
    // stressed syllable (past the tone's stress, at most one in 0.35 s) nods the head and sends a
    // wave out from the mouth through the dust across the whole window, losing strength as it goes.
    speak.on += ((speaking ? 1 : 0) - speak.on) * k(3)
    if (speaking && spoken.wordOnset) speak.pulses.push((speak.word = { at: clock, strength: 0, speed: tone.speed, reach: 0 }))
    if (spoken.word == null) speak.word = null
    else if (speak.word) {
      speak.word.strength = (0.2 + 1.1 * spoken.word) * tone.strength
      if (spoken.word > tone.reach) speak.word.reach = 1
    }
    if (spoken.syllable == null) speak.stressed = false
    if (speaking && spoken.syllable != null && !speak.stressed && spoken.syllable > tone.stress && clock - speak.stressAt > 0.35) {
      speak.stressed = true
      speak.stressAt = clock
      speak.waves.push({ at: clock, strength: Math.min(1, spoken.syllable) })
    }
    if (speaking && spoken.phraseEnd) speak.pulses.push({ at: clock, strength: 1.3 * tone.strength, speed: 1.3 * tone.speed, reach: 0, last: true })
    speak.flare *= Math.exp(-dt / 0.3)
    const sent = (p) => (clock - p.at) * p.speed - 20
    for (const p of speak.pulses) {
      if (!p.out && sent(p) > cheekS) {
        p.out = true
        speak.flare += p.last ? 1 : 0.15 * p.strength
      }
      if (!p.home && sent(p) > innerLen && (p.reach || artReachU.value > 0.5)) {
        p.home = true
        speak.eyeAt = clock
      }
    }
    speak.pulses = speak.pulses.filter((p) => sent(p) < innerLen + 60)
    if (speak.pulses.length > 8) speak.pulses.splice(0, speak.pulses.length - 8)
    for (let i = 0; i < 8; i++) {
      const p = speak.pulses[i]
      artOutU.value[i].set(p ? sent(p) : -9999, p ? p.strength : 0, p ? p.reach : 0, tone.width)
    }
    artSpeakU.value.set(speak.on, speaking ? speech.level : 0, Math.min(1.2, speak.flare), cheekS)
    // The waves cross the whole window (to its farthest corner, waveReach) at 650 px/s, strongest
    // as they leave the mouth and weaker the further they get: 1 at the mouth, ~0.45 halfway,
    // 0.15 at the far edge, gone just past it.
    const waveR = (w) => (clock - w.at) * 650
    speak.waves = speak.waves.filter((w) => waveR(w) < waveReach + 120)
    for (let i = 0; i < 4; i++) {
      const w = speak.waves[speak.waves.length - 1 - i]
      const f = w ? Math.min(1, waveR(w) / waveReach) : 0
      const fade = w ? 1 - Math.max(0, Math.min(1, (waveR(w) - waveReach) / 120)) : 0
      pushU.value[i].set(w ? waveR(w) : -9999, w ? w.strength * (0.15 + 0.85 * Math.pow(1 - f, 1.6)) * fade * speak.on : 0)
    }
    // The nod: the head dips by the tone's nod in 0.07 s and comes back up in ~0.2 s.
    const sinceStress = clock - speak.stressAt
    const nodNow = speaking ? tone.nod * (sinceStress < 0.07 ? sinceStress / 0.07 : Math.exp(-(sinceStress - 0.07) / 0.16)) : 0

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
    const restless = ch('head.restless') * ease.sway
    const idleYaw = (0.05 * Math.sin(figClock * 0.43) + 0.03 * Math.sin(figClock * 1.07 + 1.3)) * restless
    const idlePitch = 0.022 * Math.sin(figClock * 0.37 + 0.6) * restless
    const idleBody = (0.032 * Math.sin(figClock * 0.31 + 2.0) + 0.018 * Math.sin(figClock * 0.83)) * restless
    const idleBodyPitch = 0.012 * Math.sin(figClock * 0.52 + 1.0) * restless
    // Where the mind wants to look (looking away, at the edge the cursor left by, across the
    // room) takes over from the cursor by its weight, at full reach whatever the state.
    const gw = mo.gaze.weight
    const aim = (own, full) => own + (full - own) * gw
    // Thinking it stares at a point of its own instead (the trunk turning half as far).
    const stareX = think.stare.x * ease.stare
    const stareY = think.stare.y * ease.stare
    const yawWant = aim((lookX * 0.44 + idleYaw) * ease.look + stareX * 0.44, mo.gaze.x * 0.44)
    const gazeY = aim((lookY * 0.2 + idlePitch) * ease.look + stareY * 0.2, mo.gaze.y * 0.2)
    const pitchWant = gazeY + ease.nod + ch('head.pitch')
    look.yaw += (yawWant - look.yaw) * lk
    look.pitch += (pitchWant - look.pitch) * lk
    // The trunk turns less than the head (up to 0.14 rad, ~8 degrees) and follows later and
    // softer (about 0.55 s behind), as a body does.
    const bk = 1 - Math.exp(-dt * 1.8 * follow)
    // (Held firm, ease.trunk, while it works.)
    look.body += (aim(((lookX * 0.14 + idleBody) * ease.look + stareX * 0.07) * ease.trunk, mo.gaze.x * 0.14) - look.body) * bk
    look.bodyPitch += (aim(((lookY * 0.05 + idleBodyPitch) * ease.look + stareY * 0.025) * ease.trunk, mo.gaze.y * 0.05) - look.bodyPitch) * bk
    // Dev: window.__ultron.pose = { yaw, pitch, body, bodyPitch } holds the head and trunk there.
    if (dev && dev.pose) Object.assign(look, dev.pose)

    // The eyes. Each state sets how open they are, how narrowed and how big the irises (lid,
    // squint, pupil, spin in STATE) and the mood moves them on from there (eyes.lid,
    // eyes.squint, eyes.tilt, eyes.pupil): bored they droop, irritated they narrow, tilt into a
    // glare and the irises tighten. Awake they blink now and then (every 2.5-7 s, one in seven
    // twice); the mind's own blinks are eyes.lid dipping to 0. The irises lead the head: they
    // jump toward where it is about to look (up to 4.5 px across, 2.5 up and down) and settle
    // a little off centre as the head arrives. Listening, each syllable opens them a touch;
    // working, each beat of the engine tightens them.
    const formed = asmMode === 'up' && asm > ASM_END
    // Speaking it blinks in the pauses: a blink due mid-phrase waits for the next one (up to 5 s,
    // longer than any phrase), and a pause takes one that is nearly due.
    if (speaking && spoken.phraseEnd && clock > eyes.nextBlink - 1.5) eyes.nextBlink = clock
    if (clock > eyes.nextBlink && !(speaking && spoken.talking && clock < eyes.nextBlink + 5)) {
      if (formed && state !== 'dormant') {
        eyes.blinkAt = clock
        eyes.double = Math.random() < 0.15
      }
      eyes.nextBlink = clock + 2.5 + Math.random() * 4.5
    }
    const shut = (t) => (t < 0 || t > 0.18 ? 0 : t < 0.06 ? t / 0.06 : 1 - (t - 0.06) / 0.12)
    const blinkNow = Math.max(shut(clock - eyes.blinkAt), eyes.double ? shut(clock - eyes.blinkAt - 0.24) : 0)
    const pulse = (at, tau) => Math.exp(-Math.max(0, clock - at) / tau)
    const eyeWant = {
      open: ease.lid * ch('eyes.lid') * (1 - blinkNow),
      squint: Math.max(0, Math.min(1, ease.squint + ch('eyes.squint'))),
      tilt: Math.max(-1, Math.min(1, ch('eyes.tilt'))),
      pupil: Math.max(0.6, Math.min(1.4, ease.pupil * ch('eyes.pupil') * (1 + (state === 'listening' ? 0.06 * pulse(listen.onsetAt, 0.15) : 0) - (state === 'tooling' ? 0.1 * pulse(tool.beatAt, 0.08) : 0)))),
      x: Math.max(-4.5, Math.min(4.5, (2.2 * yawWant + 6 * (yawWant - look.yaw)) / 0.44)),
      y: Math.max(-2.5, Math.min(2.5, (1.4 * gazeY + 3 * (pitchWant - look.pitch)) / 0.2)),
      spin: ease.spin,
    }
    // Dev: window.__ultron.eyes = { open, squint, tilt, pupil, x, y, spin } holds any of them.
    if (dev && dev.eyes) Object.assign(eyeWant, dev.eyes)
    eyes.open += (eyeWant.open - eyes.open) * k(eyeWant.open < eyes.open ? 40 : 24)
    eyes.squint += (eyeWant.squint - eyes.squint) * k(8)
    eyes.tilt += (eyeWant.tilt - eyes.tilt) * k(6)
    eyes.pupil += (eyeWant.pupil - eyes.pupil) * k(10)
    eyes.x += (eyeWant.x - eyes.x) * k(22)
    eyes.y += (eyeWant.y - eyes.y) * k(22)
    eyes.spin += (eyeWant.spin - eyes.spin) * k(3)
    // The rings hunt for focus: they turn ~0.3 times a second, faster and slower by turns.
    eyes.angle = (eyes.angle + dt * eyes.spin * (1.8 + 1.2 * Math.sin(clock * 1.3))) % (2 * Math.PI * 1000)
    for (const st of eyeStU.value) st.set(eyes.open, eyes.squint, eyes.tilt, eyes.pupil)
    eyeLookU.value.set(eyes.x, eyes.y)
    eyeSpinU.value.set(eyes.angle, eyes.spin)

    // The mouth. Speaking, the jaw drops with its voice (all the way at 0.7 of full voice: the
    // art's 6 px), quick to open and a little slower to close, and the slit it opens glows with
    // it; between phrases it shuts. Dev: window.__ultron.mouth = 0..1 holds it open.
    const sayWant = dev && dev.mouth != null ? dev.mouth : speaking ? Math.min(1, speech.level / 0.7) : 0
    speech.open += (sayWant - speech.open) * k(sayWant > speech.open ? 28 : 16)
    speech.light += ((sayWant > 0 ? Math.min(1.4, 0.3 + 1.5 * sayWant) : 0) - speech.light) * k(20)
    mouthU.value.set(speech.open * (MOUTH?.open ?? 0), speech.light)
    look.attn += ((mouse.seen ? Math.min(1, ease.look) : 0) - look.attn) * k(6)
    attnU.value.set(mx, my)

    // Tooling: a machine at work. The chest beats like an engine, 2.5 times a second, each beat
    // sending a pulse up all four arteries on one side, left and right in turn like pistons
    // (700 px/s, so each side's pulses run 560 px apart), the eyes catching every beat. The
    // red discs do the work (see disc below).
    //
    // When the work ends (finishTask) no more pulses leave. Done: the ones on their way finish
    // their run and one last surge goes up all four at once, then the arteries rest. Failed:
    // the engine stalls, its pulses slowing to a halt where they are (~0.5 s), flickering, and
    // gone by 1.2 s.
    const tooling = state === 'tooling'
    const res = tool.result
    const stalled = res && !res.ok
    const over = res && (res.ok ? tool.cut > outerLen + 40 : clock - res.at > 1.2)
    tool.on += ((tooling && !over ? 1 : 0) - tool.on) * k(4)
    tool.speed += ((stalled ? 0 : 700) - tool.speed) * k(stalled ? 5 : 20)
    const ran = dt * tool.speed
    const beatNo = Math.floor(tool.phase / 280)
    tool.phase = (tool.phase + ran) % (560 * 100)
    const beatNow = Math.floor(tool.phase / 280)
    if (res) tool.cut += ran
    else if (tooling && beatNow !== beatNo) {
      // Even beats leave from the left, odd from the right (the phase wraps after 200 beats).
      tool.beatAt = clock
      if (beatNow % 2 === 0) tool.beatL = clock
      else tool.beatR = clock
    }
    const sinceEnd = res ? clock - res.at : 0
    const toolGain = !stalled ? 1 : sinceEnd < 0.7 ? 0.55 + 0.45 * Math.sign(Math.sin(sinceEnd * 38)) : Math.max(0, 1 - (sinceEnd - 0.7) / 0.5)
    artToolU.value.set(tool.on, tool.phase, res ? tool.cut : -1, toolGain)

    // The discs. The shoulders' are turbines: working, their blades of light spin up to 1.6
    // turns a second over ~2 s (the left one way, the right the other), showing more and the
    // disc glowing more the faster they go. Done, they spin down in ~1.5 s, fading as they
    // slow; failed, they jam at once with a jolt back and stay there, frozen, ~0.5 s before
    // fading. The chest's are pistons: each draws in and lights up as its side's beat leaves
    // it. At the end all four flare together (done), or flicker and go dark for a moment (failed).
    const TOP = 2 * Math.PI * 1.6
    if (stalled) disc.speed = 0
    else disc.speed += ((tooling && !res ? TOP : 0) - disc.speed) * k(res ? 1.4 : 0.9)
    disc.angle = (disc.angle + dt * disc.speed) % (2 * Math.PI * 1000)
    const jolt = stalled ? -0.2 * (1 - Math.exp(-sinceEnd / 0.04)) * Math.exp(-sinceEnd / 0.5) : 0
    const pump = (at) => (clock - at < 0.6 ? Math.exp(-(clock - at) / 0.12) : 0)
    let endLight = 0
    if (res && res.ok) endLight = 1.5 * Math.exp(-sinceEnd / 0.35)
    else if (stalled && sinceEnd < 0.5) endLight = Math.sin(sinceEnd * 45) < 0 ? -0.9 : 0.5
    else if (stalled && sinceEnd < 1.3) endLight = -0.85 * Math.min(1, (1.3 - sinceEnd) / 0.4)
    const spinLight = 0.8 * (disc.speed / TOP) * (0.85 + 0.15 * Math.sin(clock * 9))
    const blades = stalled ? Math.max(0, Math.min(1, 1 - (sinceEnd - 0.5) / 0.8)) : disc.speed / TOP
    discsU.value[2].w = disc.angle + jolt
    discsU.value[3].w = -(disc.angle + jolt)
    discFxU.value[0].set(1.4 * pump(tool.beatL) + endLight, pump(tool.beatL), 0)
    discFxU.value[1].set(1.4 * pump(tool.beatR) + endLight, pump(tool.beatR), 0)
    discFxU.value[2].set(spinLight + endLight, 0, blades)
    discFxU.value[3].set(spinLight + endLight, 0, blades)

    // The mind's gestures. The surge's front runs up the arteries and fades once it has reached
    // the eyes (from the end of the outer ones, over the next 250 px). The region crumbling or
    // being rebuilt is whichever channel is furthest along; a rebuild that starts afresh draws
    // its lift (8-14 px) and turn (6-15°).
    const surgeFront = (clock - surge.at) * surge.speed - 20
    const surgeFade = Math.max(0, Math.min(1, (surgeFront - outerLen) / 250))
    const surgeAmp = surge.strength * (1 - surgeFade * surgeFade * (3 - 2 * surgeFade))
    // Only at the extremes do the pulses run on into the eyes: the arteries at full heat (a
    // voice at its loudest, an angry mind), the face at its hottest (a failure, a curt answer),
    // a strong surge (a curt answer, a task done). Dev: window.__ultron.artReach holds it.
    const ramp = (a, b, v) => Math.max(0, Math.min(1, (v - a) / (b - a)))
    const extreme = dev && dev.artReach != null ? dev.artReach : Math.max(ramp(0.85, 1, artHeat), ramp(0.65, 1, ch('face.heat')), surgeAmp > 1.15 ? 1 : 0)
    artReachU.value += (extreme - artReachU.value) * k(extreme > artReachU.value ? 8 : 1.5)
    let crumbleAt = null
    let crumbleAmt = 0
    let rebuildAt = null
    let rebuildAmt = 0
    for (const [name, region] of Object.entries(REGIONS)) {
      const c = ch(`crumble:${name}`)
      if (c > crumbleAmt) [crumbleAmt, crumbleAt] = [c, region]
      const r = ch(`rebuild:${name}`)
      if (r > rebuildAmt) [rebuildAmt, rebuildAt] = [r, region]
    }
    if (rebuildAmt > 0 && rebuild.amount === 0) {
      rebuild.lift = 8 + Math.random() * 6
      rebuild.turn = ((6 + Math.random() * 9) * Math.PI) / 180 * (Math.random() < 0.5 ? -1 : 1)
    }
    rebuild.amount = rebuildAmt

    // The HUD (see HUD_ZONES): a zone the host no longer names keeps its last place and fades.
    const hud = zones?.() ?? []
    for (let i = 0; i < ZONES; i++) {
      const zn = hud[i]
      const fx = zoneFxU.value[i]
      if (zn) zoneU.value[i].set(zn.left - vw / 2, vh / 2 - zn.bottom, zn.right - vw / 2, vh / 2 - zn.top)
      fx.x += ((zn?.calm ?? 0) - fx.x) * k(5)
      fx.y += ((zn?.rim ?? 0) - fx.y) * k(4)
      if (fx.x + fx.y < 0.002) fx.set(0, 0)
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
      u.uPitch.value = look.pitch + nodNow
      u.uAttnOn.value = look.attn
      u.uBodyYaw.value = look.body
      u.uBodyPitch.value = look.bodyPitch
      u.uLevel.value = levelNow
      u.uArtHeat.value = artHeat
      u.uArtPhase.value = artPhase
      u.uArtBeat.value.set((clock - beatAt) * 230 - 15, ease.beat * ch('arteries.beat'), 1 - ease.beat)
      u.uBreath.value = breathPx
      u.uArtSurge.value.set(surgeFront, surgeAmp, 0)
      if (crumbleAt) u.uCrumbleAt.value.set(...crumbleAt)
      u.uCrumble.value = crumbleAmt
      if (rebuildAt) u.uRebuildAt.value.set(...rebuildAt)
      u.uRebuild.value.set(rebuildAmt, rebuild.lift, rebuild.turn)
      u.uSpins.value = l.kind === 'veins' || l.kind === 'redlight' || l.kind === 'artery' ? 1 : 0
      u.uDim.value = ease.dim * (meta.dimScale ?? 1)
      u.uRed.value = l.kind === 'figure' || back ? redNow : 0
      u.uLife.value = back ? 0.5 + 0.5 * lifeNow : lifeNow
      u.uLoose.value = ease.loose
      u.uWaveRate.value = ease.waveRate
      u.uWaveDepth.value = ease.waveDepth
      if (back) u.uParallax.value = mouse.seen ? -((mouse.x - vw / 2) / vw) * 26 : 0
      u.uStir.value = back || l.stirs ? listen.stir : 0
      u.uPushOn.value = back || l.stirs ? 1 : 0
      u.uCheek.value.x = l.kind === 'veins' || l.kind === 'redlight' || l.kind === 'face' ? Math.min(1.2, speak.flare) * speak.on : 0
    }

    $('wake').style.opacity = state === 'offline' ? 0.55 + 0.35 * Math.sin(clock * 2.2) : 0

    // Eyes, by state (see eyeGain).
    // The mind brightens or dims them (eyes.gain), adds light (eyes.boost: a dream) and makes
    // them stutter (eyes.flicker).
    const flicker = ch('eyes.flicker') * (0.5 + 0.5 * Math.sin(clock * 47) * Math.sin(clock * 13.3))
    const eg = (eyeGain(state, clock, levelNow, since, breathNow) * ch('eyes.gain') + ch('eyes.boost')) * (1 - 0.85 * flicker)
    // (Quick while listening, thinking, tooling and speaking, so a blink, a syllable, a stutter, a
    // beat or a pulse arriving reads.)
    lightsLayer.uniforms.uFade.value += (eg - lightsLayer.uniforms.uFade.value) * k(state === 'waking' ? 14 : state === 'listening' || state === 'thinking' || state === 'tooling' || speaking ? 16 : 8)
    if (eyesLayer) eyesLayer.uniforms.uFade.value = lightsLayer.uniforms.uFade.value

    // Face layers: one is up at a time, except that the voice-print crossfades fast (the
    // procedural art's; the render's speaks with its mouth and keeps the face of waking).
    // The red glow of the face shows how hot it runs: the mood (face.heat: irritation, a curt
    // answer, a failure), whatever is done at high intensity (the arteries' heat: a loud voice,
    // an angry mind) and its own voice as it speaks, in its tone (hot when curt, cooler when
    // weary). Up to about twice as bright.
    const faceHeat = Math.min(1.2, ch('face.heat') + 0.6 * artHeat + speak.on * tone.heat + (speaking ? 0.3 * speech.light : 0))
    const want = {}
    const face = FACE_OF[state] === 'bars' && !faceLayers['speak-a'] ? ['idle', 1] : FACE_OF[state]
    if (face === 'bars') want[resolveFace(pickBars(clock, levelNow))] = 1
    else if (face) want[resolveFace(face[0])] = face[1] * (1 + 0.9 * faceHeat)
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
  raf = requestAnimationFrame(frame)

  // ?state=listening opens straight into a state (handy for screenshots).
  const startState = controls && new URLSearchParams(location.search).get('state')
  setState(STATE[startState] ? startState : 'offline')

  return {
    /** The app's phase, which the figure follows (hosted). */
    setPhase(phase) {
      if (STATE[phase]) wanted = phase
    },
    dispose() {
      life.abort()
      cancelAnimationFrame(raf)
      for (const off of offs) off()
      hearing.stopMic()
      for (const l of layers) {
        l.points.geometry.dispose()
        l.points.material.dispose()
      }
      renderer.dispose()
      if (window[controls ? '__ultron' : '__figure'] === hooks) delete window[controls ? '__ultron' : '__figure']
    },
  }
}
