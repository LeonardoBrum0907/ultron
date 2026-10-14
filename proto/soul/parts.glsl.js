// GLSL: where each particle sits in the formed soul and how it looks there: the heart, its
// glow, the flames, the smoke over them and the embers. World units: the heart's radius is
// 1 and its centre is the origin, y up. flight.glsl.js carries a particle here from the dust.

import { TINT } from './tint.js'

const f = (x) => x.toFixed(3) // a GLSL float

export const PARTS = /* glsl */ `
  const float PI = 3.14159265;
  struct Spark { vec2 xy; float size; float alpha; float heat; };

  vec3 ramp(float h, vec3 hot, vec3 mid, vec3 cool) {
    return h < 0.5 ? mix(cool, mid, h * 2.0) : mix(mid, hot, h * 2.0 - 1.0);
  }
  // How far a particle here has turned to the new colour, 0..1 (tint.js): the farther from
  // the heart, the later, and each at its own moment, so the change climbs the fire.
  float tintAt(vec2 p, float w) {
    float delay = ${f(TINT.pace)} * min(length(p - vec2(0.0, 0.6)), ${f(TINT.reach)}) + ${f(TINT.spread)} * fract(w * 91.7);
    return smoothstep(0.0, 1.0, (uShift - delay) / ${f(TINT.turn)});
  }
  vec3 heatColor(float h, float k) {
    return mix(ramp(h, uHotWas, uMidWas, uCoolWas), ramp(h, uHot, uMid, uCool), k);
  }
  // The whole flame sways, more the higher it is; the smoke rides on the same sway.
  float sway(float y) {
    float lean = smoothstep(0.6, 4.5, y);
    return lean * (0.30 * sin(y * 0.85 - uTime * 1.3) + 0.12 * sin(y * 2.1 - uTime * 2.4 + 1.3));
  }

  // How far through its life a particle of the fire is, 0..1 over and over. Its clock starts
  // when it lands (aFly: set off + flight), so the fire lights from the heart up as the
  // particles arrive; until then it waits at start. uFire runs faster while it flares.
  float lifeAt(float rate, float start) {
    float since = uFire - (aFly.x + aFly.y);
    return since < 0.0 ? start : fract(since * rate + start);
  }

  // The heart of the fire, in layers like a drawn flame (Léo's references): the outer
  // flame, a lighter layer inside it and the ember at the middle, white-hot. Each layer is
  // a teardrop whose sides boil (lobes run up them); its particles rise through it, faster
  // near the top, and crowd its edge, so each layer reads as its own outline. The whole
  // heart breathes, the ember a beat ahead of the layers round it.
  vec3 layerShape(float layer) { // bottom y, top y, half width (world units)
    if (layer < 0.5) return vec3(-0.78, 0.95, 0.58);
    if (layer < 1.5) return vec3(-0.95, 1.75, 0.88);
    return vec3(-1.08, 2.6, 1.18);
  }
  Spark core(vec4 r, float w) {
    float layer = r.z < 0.24 ? 0.0 : (r.z < 0.56 ? 1.0 : 2.0); // 0 the ember, 1 the middle, 2 the outer flame
    vec3 shape = layerShape(layer);
    float breath = 1.0 + 0.045 * sin(uTime * 1.6 - layer * 0.7) + 0.06 * uLevel + 0.1 * uFlare;
    float rise = fract(r.x + uFire * mix(0.16, 0.3, w) * (1.0 + 0.25 * layer));
    float v = 1.0 - sqrt(1.0 - rise); // most of it low down, in the belly
    float side = r.y < 0.5 ? -1.0 : 1.0;
    float lobes = snoise(vec3(v * 3.2 - uTime * 1.5, side * 2.0 + layer * 5.0, uTime * 0.3));
    float width = shape.z * sin(PI * pow(v, 0.6)) * (1.0 - 0.3 * v) * (1.0 + 0.22 * lobes) * breath;
    float y = mix(shape.x, shape.y, v) * breath;
    float across = fract(r.y * 2.0); // 0 its middle .. 1 its edge
    float x = side * (r.w < 0.4 ? pow(across, 0.25) : across) * width; // some crowd the edge: the outline
    x += 0.18 * v * snoise(vec3(v * 2.0 - uTime * 1.2, layer * 7.0, 1.0)) + sway(y);
    float ends = smoothstep(0.0, 0.06, rise) * (1.0 - smoothstep(0.88, 1.0, v)); // it fades at its tip, not halfway up
    float glow = 1.0 + 5.0 * (breath - 1.0) * (1.0 - 0.5 * layer); // brighter as it breathes in, the ember most
    float alpha = (layer < 0.5 ? 0.3 : (layer < 1.5 ? 0.24 : 0.12)) * ends * glow;
    float heat = layer < 0.5 ? 1.0 : (layer < 1.5 ? 0.8 - 0.15 * v : 0.58 - 0.2 * v);
    return Spark(vec2(x, y), 0.05 + 0.03 * r.w, alpha, heat);
  }

  // The glow round the heart: a few big faint sprites, so there is bloom with no extra pass.
  Spark halo(vec4 r, float w) {
    float a = r.x * 2.0 * PI;
    float rad = 0.2 + 1.5 * sqrt(r.y);
    float flicker = 0.8 + 0.2 * sin(uTime * 2.0 + w * 30.0);
    float alpha = 0.04 * (1.0 - rad / 1.8) * flicker * (1.0 + uFlare);
    return Spark(vec2(cos(a), sin(a)) * rad + vec2(0.0, 0.25 * r.z), 0.4 + 0.4 * r.z, alpha, 0.6);
  }

  // Where a flame particle is born on the heart: round its top and sides, so the fire wraps it.
  vec2 flameBirth(vec4 r) {
    float a = asin(r.y * 2.0 - 1.0) * 1.24;
    return vec2(sin(a), cos(a));
  }

  // A flame particle rises from its birth and narrows to the tip. Ones born near each other
  // reach about as high, which makes the tongues, and the noise they rise through scrolls up
  // and shapes them. Each also wanders on a course of its own, so the fire is not one rigid
  // sheet, and about one in ten breaks away from it and drifts off loose.
  Spark flame(vec4 r, float w) {
    float life = lifeAt(mix(0.32, 0.62, r.x), 0.08);
    vec2 born = flameBirth(r);
    float tongue = smoothstep(-0.6, 0.8, snoise(vec3(born.x * 2.4, uTime * 0.25, 3.7)));
    float reach = mix(1.4, 6.2, tongue * (0.55 + 0.45 * r.z)) * (1.0 + 0.5 * uFlare + 0.45 * uLevel);
    float y = born.y + reach * life;
    float bulge = 1.0 + 0.22 * exp(-pow((y - 1.4) / 0.9, 2.0));
    float x = born.x * 1.06 * bulge * pow(1.0 - smoothstep(0.5, 5.8, y), 0.85) + (r.z - 0.5) * 0.06;
    float amp = 0.10 + 0.55 * smoothstep(0.3, 4.3, y);
    vec3 q = vec3(x * 0.6, y * 0.5 - uTime * 0.95, uTime * 0.2);
    x += snoise(q) * amp + sway(y);
    y += snoise(q + 19.1) * amp * 0.3;
    x += snoise(vec3(w * 37.0, y * 0.9 - uTime * 1.4, uTime * 0.35)) * (0.05 + 0.4 * amp);
    float stray = step(0.9, fract(w * 23.7)) * smoothstep(0.25, 1.0, life);
    x += sign(born.x + 0.01) * stray * stray * (0.8 + 1.4 * fract(w * 51.3));
    y += stray * 0.8;
    float fade = mix(1.0 - smoothstep(0.45, 1.0, life), 1.0 - life, step(0.9, fract(w * 23.7)));
    float alpha = 0.3 * smoothstep(0.0, 0.07, life) * fade;
    float heat = clamp(0.82 - life * 0.6 - smoothstep(0.5, 4.5, y) * 0.2, 0.25, 1.0);
    return Spark(vec2(x, y), mix(0.045, 0.025, life) * (0.7 + 0.6 * r.w), alpha, heat);
  }

  // The smoke: a thin wisp off the flame's tip that curls as it climbs and spreads out.
  Spark smoke(vec4 r, float w) {
    float life = lifeAt(mix(0.09, 0.14, r.x), w); // the slow smoke lands all along its wisp
    float s = life * 6.5;
    float phase = 1.7 * s - uTime * 1.2;
    float amp = 0.12 + 0.11 * s;
    float y0 = 2.4 + s;
    vec2 xy = vec2(amp * sin(phase) + 0.25 * sin(0.7 * s - uTime * 0.45), y0 + amp * 0.55 * cos(phase));
    xy.x += sway(y0);
    xy += (r.yz - 0.5) * (0.06 + 0.07 * s);
    xy += vec2(snoise(vec3(xy * 0.8, uTime * 0.3)), snoise(vec3(w * 41.0, s, uTime * 0.4)) * 0.5) * 0.09 * s;
    float alpha = 0.07 * smoothstep(0.05, 0.3, life) * pow(1.0 - life, 1.6);
    return Spark(xy, 0.03 + 0.02 * r.w + 0.01 * s, alpha, 0.55 - 0.4 * life);
  }

  // Embers: a few bright specks thrown up out of the fire, drifting apart and twinkling.
  Spark ember(vec4 r, float w) {
    float life = lifeAt(mix(0.12, 0.28, r.x), w);
    float y = 0.6 + r.z * 0.8 + life * (3.5 + 2.0 * r.w) * (1.0 + 0.6 * uFlare);
    float drift = (r.y - 0.5) * 1.2 * (1.0 + life) + 0.25 * sin(uTime * (1.0 + r.w) + w * 40.0) * life;
    float x = drift + sway(y) * 0.6;
    float twinkle = 0.55 + 0.45 * sin(uTime * (6.0 + 6.0 * r.x) + w * 60.0);
    float alpha = 0.9 * twinkle * smoothstep(0.0, 0.1, life) * (1.0 - life);
    return Spark(vec2(x, y), 0.03 + 0.03 * r.w, alpha, 0.9 - 0.5 * life);
  }

  // A mote of the dust at rest (every particle before the summons, and the loose dust always):
  // dim, a few brighter than the rest, glinting slowly.
  Spark mote(float w) {
    float glint = 0.25 + 1.5 * pow(fract(w * 9.13), 3.0);
    float slow = 0.75 + 0.25 * sin(uTime * (0.2 + w * 0.5) + w * 40.0);
    return Spark(vec2(0.0), 0.034 + 0.02 * fract(w * 3.1), 0.9 * glint * slow, 0.42 + 0.2 * fract(w * 5.7));
  }
`
