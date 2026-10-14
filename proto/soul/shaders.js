// The soul's shaders. One vertex shader places every particle from its random numbers and
// the clock: the orb, its glow, the flames, the smoke over them and the embers.
// World units: the orb's radius is 1 and its centre is the origin, y up.

// 3D simplex noise, Ashima Arts / Stefan Gustavson (MIT), as used across WebGL demos.
const SIMPLEX = /* glsl */ `
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`

const UNIFORMS = /* glsl */ `
  attribute vec4 aRand;   // four random numbers 0..1
  attribute vec2 aMeta;   // x which part (swarm.js PART), y one more random number
  uniform float uTime;    // seconds
  uniform float uFlare;   // a click's burst: 1 just now, fading to 0
  uniform float uLevel;   // the microphone, 0..1
  uniform vec2  uWind;    // world units the cursor's movement pushes the tips
  uniform vec3  uHot;     // the palette: white-hot core ..
  uniform vec3  uMid;     // .. the flame's own colour ..
  uniform vec3  uCool;    // .. and its cooling edges and smoke
  uniform vec2  uView;    // clip units per world unit, x and y
  uniform float uYMid;    // world y at the middle of the screen
  uniform float uPx;      // device px per world unit
  varying vec3  vColor;
  varying float vAlpha;
`

const PARTS = /* glsl */ `
  const float PI = 3.14159265;
  struct Spark { vec2 xy; float size; float alpha; float heat; };

  vec3 heatColor(float h) {
    return h < 0.5 ? mix(uCool, uMid, h * 2.0) : mix(uMid, uHot, h * 2.0 - 1.0);
  }
  // The whole flame sways, more the higher it is; the smoke rides on the same sway.
  float sway(float y) {
    float lean = smoothstep(0.6, 4.5, y);
    return lean * (0.30 * sin(y * 0.85 - uTime * 1.3) + 0.12 * sin(y * 2.1 - uTime * 2.4 + 1.3));
  }
  // How much of the cursor's push a particle at this height feels: the base stays put.
  float windAt(float y) { return pow(smoothstep(0.3, 6.0, y), 1.4); }

  // The orb: a ball that turns (the inside faster than the skin, so its wisps swirl) and boils.
  Spark core(vec4 r, float w) {
    float z = r.x * 2.0 - 1.0;
    float a = r.y * 2.0 * PI + uTime * (0.35 + 0.6 * (1.0 - r.z)) + w * 0.3;
    vec3 dir = vec3(sqrt(1.0 - z * z) * cos(a), z, sqrt(1.0 - z * z) * sin(a));
    float rad = pow(r.z, 0.5);
    float boil = snoise(dir * 2.3 + vec3(0.0, -uTime * 0.7, uTime * 0.3));
    rad *= 1.0 + 0.07 * boil * rad + 0.05 * uLevel;
    float wisp = 0.5 + 0.5 * snoise(dir * 3.5 + uTime * 0.4);
    return Spark(dir.xy * rad, 0.07 + 0.04 * r.w, 0.06 + 0.1 * wisp,
      clamp(1.15 - rad * 0.7 + 0.2 * wisp, 0.0, 1.0));
  }

  // The glow round the orb: a few big faint sprites, so there is bloom with no extra pass.
  Spark halo(vec4 r, float w) {
    float a = r.x * 2.0 * PI;
    float rad = 0.2 + 1.5 * sqrt(r.y);
    float flicker = 0.8 + 0.2 * sin(uTime * 2.0 + w * 30.0);
    float alpha = 0.04 * (1.0 - rad / 1.8) * flicker * (1.0 + uFlare);
    return Spark(vec2(cos(a), sin(a)) * rad + vec2(0.0, 0.25 * r.z), 0.4 + 0.4 * r.z, alpha, 0.6);
  }

  // A flame particle: born on the orb (round its top and sides, so the fire wraps it),
  // rising and narrowing to the tip. Ones born near each other reach about as high,
  // which makes the tongues, and the noise they rise through scrolls up and shapes them.
  Spark flame(vec4 r, float w) {
    float life = fract(uTime * mix(0.32, 0.62, r.x) * (1.0 + 0.4 * uFlare) + w);
    float a = asin(r.y * 2.0 - 1.0) * 1.24;
    vec2 born = vec2(sin(a), cos(a));
    float tongue = smoothstep(-0.6, 0.8, snoise(vec3(born.x * 2.4, uTime * 0.25, 3.7)));
    float reach = mix(1.4, 6.2, tongue * (0.55 + 0.45 * r.z)) * (1.0 + 0.5 * uFlare + 0.45 * uLevel);
    float y = born.y + reach * life;
    float bulge = 1.0 + 0.22 * exp(-pow((y - 1.4) / 0.9, 2.0));
    float x = born.x * 1.06 * bulge * pow(1.0 - smoothstep(0.5, 5.8, y), 0.85) + (r.z - 0.5) * 0.06;
    float amp = 0.10 + 0.55 * smoothstep(0.3, 4.3, y);
    vec3 q = vec3(x * 0.6, y * 0.5 - uTime * 0.95, uTime * 0.2);
    x += snoise(q) * amp + sway(y) + uWind.x * windAt(y);
    y += snoise(q + 19.1) * amp * 0.3 + uWind.y * windAt(y) * 0.3;
    float alpha = 0.3 * smoothstep(0.0, 0.07, life) * (1.0 - smoothstep(0.45, 1.0, life));
    float heat = clamp(0.82 - life * 0.6 - smoothstep(0.5, 4.5, y) * 0.2, 0.25, 1.0);
    return Spark(vec2(x, y), mix(0.045, 0.025, life) * (0.7 + 0.6 * r.w), alpha, heat);
  }

  // The smoke: a thin wisp off the flame's tip that curls as it climbs and spreads out.
  Spark smoke(vec4 r, float w) {
    float life = fract(uTime * mix(0.09, 0.14, r.x) + w);
    float s = life * 6.5;
    float phase = 1.7 * s - uTime * 1.2;
    float amp = 0.12 + 0.11 * s;
    float y0 = 2.4 + s;
    vec2 xy = vec2(amp * sin(phase) + 0.25 * sin(0.7 * s - uTime * 0.45), y0 + amp * 0.55 * cos(phase));
    xy.x += sway(y0) + uWind.x * windAt(y0);
    xy += (r.yz - 0.5) * (0.06 + 0.07 * s);
    xy.x += snoise(vec3(xy * 0.8, uTime * 0.3)) * 0.08 * s;
    float alpha = 0.07 * smoothstep(0.05, 0.3, life) * pow(1.0 - life, 1.6);
    return Spark(xy, 0.03 + 0.02 * r.w + 0.01 * s, alpha, 0.55 - 0.4 * life);
  }

  // Embers: a few bright specks thrown up out of the fire, drifting apart and twinkling.
  Spark ember(vec4 r, float w) {
    float life = fract(uTime * mix(0.12, 0.28, r.x) + w);
    float y = 0.6 + r.z * 0.8 + life * (3.5 + 2.0 * r.w) * (1.0 + 0.6 * uFlare);
    float drift = (r.y - 0.5) * 1.2 * (1.0 + life) + 0.25 * sin(uTime * (1.0 + r.w) + w * 40.0) * life;
    float x = drift + sway(y) * 0.6 + uWind.x * windAt(y);
    float twinkle = 0.55 + 0.45 * sin(uTime * (6.0 + 6.0 * r.x) + w * 60.0);
    float alpha = 0.9 * twinkle * smoothstep(0.0, 0.1, life) * (1.0 - life);
    return Spark(vec2(x, y), 0.03 + 0.03 * r.w, alpha, 0.9 - 0.5 * life);
  }
`

export const SOUL_VERTEX = /* glsl */ `
  ${UNIFORMS}
  ${SIMPLEX}
  ${PARTS}
  Spark place(float part, vec4 r, float w) {
    if (part < 0.5) return core(r, w);
    if (part < 1.5) return halo(r, w);
    if (part < 2.5) return flame(r, w);
    if (part < 3.5) return smoke(r, w);
    return ember(r, w);
  }
  void main() {
    Spark p = place(aMeta.x, aRand, aMeta.y);
    vColor = heatColor(p.heat);
    vAlpha = p.alpha * (1.0 + 0.6 * uFlare + 0.5 * uLevel);
    gl_Position = vec4(p.xy.x * uView.x, (p.xy.y - uYMid) * uView.y, 0.0, 1.0);
    gl_PointSize = max(1.0, p.size * uPx);
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
