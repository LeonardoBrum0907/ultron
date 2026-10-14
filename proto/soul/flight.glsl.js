// GLSL: the dust and the wind. Before the summons every particle rests in a wide, slowly
// turning cloud of dust; the summons sends five currents through it (currents.js), each
// gathering the particles of one wedge of the cloud and carrying them as one stream to
// their part of the soul. Dissolving runs it backwards, to wherever the dust is now.
// The same scheme as Ultron's own assembly (figure.js: loose, the currents).

export const FLIGHT = /* glsl */ `
  // Where it rests in the dust: in the wedge its current gathers from, placed across the
  // wedge by its lane, so a stream does not tangle on its way (aMeta.zw: current, lane).
  vec2 restHome() {
    float ang = uWedge[int(aMeta.z + 0.5)] + (aMeta.w - 0.5) * (2.0 * PI / 5.0);
    float ray = sqrt(-2.0 * log(1.0 - 0.999 * aFly.z));
    float rad = aFly.w < 0.35 ? sqrt(aFly.z) : (aFly.w < 0.8 ? 0.38 : 0.2) * ray;
    return uCloud.xy + vec2(cos(ang), sin(ang) * 0.85) * rad * uCloud.z;
  }

  // Where it is at free-time t while it rests: its place, a slow wander of its own, a
  // flutter, and the whole cloud turning.
  vec2 loose(vec2 home, float t, float s) {
    t *= 0.18; // the dust drifts at a fraction of real time: nearly at rest
    float ph = s * 6.2831;
    float amp = 0.6 + 1.6 * fract(s * 7.31);
    vec2 q = home + vec2(sin(t * (0.16 + fract(s * 3.7) * 0.34) + ph * 3.0), cos(t * (0.19 + fract(s * 5.3) * 0.31) + ph * 5.0)) * amp;
    q += vec2(sin(t * 0.9 + q.y * 1.2 + ph), cos(t * 0.8 + q.x * 1.2 + ph * 1.7)) * 0.16;
    float a = t * 0.03;
    vec2 c = q - uCloud.xy;
    return uCloud.xy + vec2(c.x * cos(a) - c.y * sin(a), c.x * sin(a) + c.y * cos(a));
  }

  // Carried by its current from where it rested to where it belongs (e 0..1): along the
  // current's cubic, keeping its place in the bundle, which narrows to a river on the way,
  // with a swirl of turbulence so the stream is not a rigid thing.
  vec2 fly(vec2 rest, vec2 target, float e) {
    int k = int(aMeta.z + 0.5);
    vec4 ca = uCurEnds[k];
    vec4 cb = uCurMids[k];
    float ie = 1.0 - e;
    float env = sin(PI * e);
    vec2 G = ie * ie * ie * ca.xy + 3.0 * ie * ie * e * cb.xy + 3.0 * ie * e * e * cb.zw + e * e * e * ca.zw;
    vec2 p = G + mix(rest - ca.xy, target - ca.zw, e) * (1.0 - 0.7 * env);
    vec3 q = vec3(p * 0.3, uTime * 0.25 + aMeta.z);
    return p + vec2(snoise(q), snoise(q + 13.7)) * env * 0.45;
  }

  // The cursor stirs whatever it passed through, more the faster it went, and the wake
  // closes behind it. Its path is a line through the trail's samples (the first is where it
  // is now); each particle gives way by its own amount, so the wake is ragged.
  vec2 stir(vec2 p, float w) {
    vec2 push = vec2(0.0);
    float best = 0.0; // the nearest stretch of the path pushes (summed, they would bead where they meet)
    for (int i = 0; i < 7; i++) {
      vec4 a = uTrail[i];
      vec4 b = uTrail[i + 1];
      vec2 ab = b.xy - a.xy;
      float h = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
      vec2 d = p - (a.xy + ab * h);
      vec2 vel = mix(a.zw, b.zw, h);
      float near = exp(-dot(d, d) / 0.4);
      float speed = smoothstep(0.3, 4.0, length(vel));
      float k = near * speed * (1.0 - float(i) / 7.0);
      if (k > best) {
        best = k;
        push = (d / (length(d) + 0.08) * 0.38 + vel * 0.05) * k;
      }
    }
    return push * (0.6 + 0.8 * fract(w * 17.3));
  }
`
