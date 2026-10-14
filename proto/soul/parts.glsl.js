// GLSL: where each particle sits in the formed soul and how it looks there: the orb, its
// glow, the flames, the smoke over them and the embers. World units: the orb's radius is
// 1 and its centre is the origin, y up. flight.glsl.js carries a particle here from the dust.

export const PARTS = /* glsl */ `
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

  // How far through its life a particle of the fire is, 0..1 over and over. Its clock starts
  // when it lands (aFly: set off + flight), so the fire lights from the orb up as the
  // particles arrive; until then it waits at start. uFire runs faster while it flares.
  float lifeAt(float rate, float start) {
    float since = uFire - (aFly.x + aFly.y);
    return since < 0.0 ? start : fract(since * rate + start);
  }

  // The orb: a ball that turns (the inside faster than the skin, so its wisps swirl) and
  // boils; a few motes of its skin are thrown off it now and then and fall back.
  Spark core(vec4 r, float w) {
    float z = r.x * 2.0 - 1.0;
    float a = r.y * 2.0 * PI + uTime * (0.35 + 0.6 * (1.0 - r.z)) + w * 0.3;
    vec3 dir = vec3(sqrt(1.0 - z * z) * cos(a), z, sqrt(1.0 - z * z) * sin(a));
    float rad = pow(r.z, 0.5);
    float boil = snoise(dir * 2.3 + vec3(0.0, -uTime * 0.7, uTime * 0.3));
    float thrown = step(0.93, r.w) * max(0.0, snoise(dir * 1.5 + vec3(w * 9.0, uTime * 0.5, 0.0)));
    rad *= 1.0 + 0.07 * boil * rad + 0.05 * uLevel + 0.6 * thrown * rad;
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

  // Where a flame particle is born on the orb: round its top and sides, so the fire wraps it.
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
    x += snoise(q) * amp + sway(y) + uWind.x * windAt(y);
    y += snoise(q + 19.1) * amp * 0.3 + uWind.y * windAt(y) * 0.3;
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
    xy.x += sway(y0) + uWind.x * windAt(y0);
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
    float x = drift + sway(y) * 0.6 + uWind.x * windAt(y);
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
