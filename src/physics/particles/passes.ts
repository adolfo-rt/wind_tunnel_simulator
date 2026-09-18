import { ATLAS_GLSL } from '../gpu/atlas';
import { SPEED_COLOUR_GLSL } from '../gpu/colourRamp';
import { OBSTACLE_GLSL } from '../gpu/passes';

/**
 * The streamline passes.
 *
 * Particles live in a texture, one texel each: xyz is the position as a fraction of the
 * domain, w is how long the particle has been alive. Normalised coordinates rather than
 * metres because the values then sit near 1, where floating point has its precision, and
 * because the velocity field is indexed the same way.
 *
 * Each frame the particles are integrated forward, the new positions are pushed onto the
 * front of a history texture, and the history is drawn as one line per particle. Nothing
 * here decides where the air goes — that is the solver's field, sampled. What these
 * passes decide is only how a massless tracer released into it would travel.
 */

const HEADER = `precision highp float;\nprecision highp sampler2D;\nout vec4 fragColor;\n`;

/**
 * Start every particle from its seed point, spread along the tunnel.
 *
 * The seed texture carries the spawn point in xyz and, in w, how far along the tunnel
 * this particle begins its first life. Releasing them all at the inlet together would
 * send one sheet down the tunnel and bring one sheet back, pulsing forever.
 */
export const PARTICLE_INIT_SHADER = HEADER + /* glsl */ `
  uniform sampler2D uSeeds;

  void main() {
    vec4 seed = texelFetch(uSeeds, ivec2(gl_FragCoord.xy), 0);
    fragColor = vec4(fract(seed.x + seed.w), seed.y, seed.z, 0.0);
  }
`;

/** An empty trail. Age below zero marks a sample that was never written. */
export const HISTORY_CLEAR_SHADER = HEADER + /* glsl */ `
  void main() { fragColor = vec4(0.0, 0.0, 0.0, -1.0); }
`;

/**
 * Carry each particle along the flow.
 *
 * Two things here are easy to get wrong and are the whole point of the pass.
 *
 * The first is that the solved field is non-dimensional — the free stream is exactly 1
 * at every tunnel setting — so the distance a particle covers has to come from the
 * slider, via uAdvance, or the streamlines would stream just as fast with the fans
 * stopped as at cruise. The flow slice had precisely this bug.
 *
 * The second is the step length. Integrating a whole frame's travel in one go draws a
 * chord across whatever the streamline curves around, and near a wing that chord goes
 * through the wing. So the frame is split into substeps short enough to stay on the
 * field, and what is left — a particle that still ends up inside the aircraft, because
 * the surface moved or the field is coarse there — is pushed back out along the distance
 * field's own gradient.
 */
export const PARTICLE_UPDATE_SHADER =
  HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  uniform sampler2D uParticles;
  uniform sampler2D uSeeds;
  uniform sampler2D uVelocity;
  /// World metres a particle at free-stream speed covers this frame.
  uniform float uAdvance;
  /// Real seconds this frame, which is what ages the particle.
  uniform float uDt;
  uniform int uSubsteps;
  uniform float uMaxAge;
  /// How far outside the surface a particle is held, in metres.
  uniform float uMargin;
  uniform vec3 uInvDomain;

  vec3 fieldAt(vec3 p) {
    return sampleAtlas(uVelocity, clamp(p, vec3(0.0), vec3(1.0)) * uGrid).xyz;
  }

  void main() {
    ivec2 texel = ivec2(gl_FragCoord.xy);
    vec4 state = texelFetch(uParticles, texel, 0);
    vec4 seed = texelFetch(uSeeds, texel, 0);

    vec3 p = state.xyz;
    float age = state.w;

    // Midpoint integration. Forward Euler on a curving field drifts consistently to the
    // outside of every bend, which on a wing means the streamline lifting off a surface
    // it should be following.
    float h = uAdvance / float(uSubsteps);
    for (int i = 0; i < 16; i++) {
      if (i >= uSubsteps) break;
      vec3 v1 = fieldAt(p);
      vec3 v2 = fieldAt(p + v1 * (h * 0.5) * uInvDomain);
      p += v2 * h * uInvDomain;
    }

    vec3 world = uDomainMin + p * uDomainSize;
    float gap = solidDistanceWorld(world);
    if (gap < uMargin) {
      world += solidNormalWorld(world, uCellWorld * 0.5) * (uMargin - gap);
      p = (world - uDomainMin) * uInvDomain;
    }

    age += uDt;

    // Restart on reaching the outlet, on leaving sideways, or on running out of life.
    // The last is not housekeeping: the streamline that ends on the nose is a real
    // feature of the flow, and a particle on it would otherwise slow asymptotically and
    // sit there for good.
    bool gone = p.x > 0.995 || p.x < 0.0
      || any(lessThan(p.yz, vec2(0.0))) || any(greaterThan(p.yz, vec2(1.0)));
    if (gone || age > uMaxAge) {
      p = seed.xyz;
      age = 0.0;
    }

    fragColor = vec4(p, age);
  }
`;

/**
 * Push the current positions onto the front of the history and shift the rest back.
 *
 * The history is one block of rows per trail sample, newest first, so drawing needs no
 * ring-buffer arithmetic. Copying the whole thing each frame rather than writing one
 * block in place costs a pass over a texture of a few hundred thousand texels, and
 * avoids reading a render target while it is bound for writing, which is undefined.
 */
export const HISTORY_RECORD_SHADER = HEADER + /* glsl */ `
  uniform sampler2D uParticles;
  uniform sampler2D uHistory;
  uniform float uParticleHeight;

  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    int height = int(uParticleHeight);
    if (px.y < height) fragColor = texelFetch(uParticles, px, 0);
    else fragColor = texelFetch(uHistory, ivec2(px.x, px.y - height), 0);
  }
`;

/**
 * Shared by the trails and the bright head at the end of each one.
 *
 * Speed comes from the two samples themselves — the distance between them divided by
 * the time between them — rather than from another look at the velocity field. That is
 * free, it is immune to a varying frame time, and it reports what the particle actually
 * did rather than what the field says now.
 */
const TRAIL_COMMON = /* glsl */ `
  uniform sampler2D uHistory;
  uniform vec2 uParticleSize;
  uniform vec3 uDomainMin;
  uniform vec3 uDomainSize;
  uniform float uTrail;
  /// Turns metres per second on screen back into real airspeed, in ramp units.
  uniform float uSpeedScale;
  uniform float uFade;
  uniform float uOpacity;

  struct TrailPair {
    vec3 head;
    vec3 tail;
    float speed;
    bool real;
  };

  TrailPair readPair(float index, int segment) {
    float width = uParticleSize.x;
    int height = int(uParticleSize.y);
    ivec2 texel = ivec2(int(mod(index, width)), int(floor(index / width)));

    vec4 a = texelFetch(uHistory, ivec2(texel.x, texel.y + segment * height), 0);
    vec4 b = texelFetch(uHistory, ivec2(texel.x, texel.y + (segment + 1) * height), 0);

    TrailPair s;
    s.head = uDomainMin + a.xyz * uDomainSize;
    s.tail = uDomainMin + b.xyz * uDomainSize;

    // Both ends of a segment ask the same question and get the same answer, so a segment
    // is either drawn or it is not. A particle that has just restarted at the inlet has
    // an age below the sample behind it, and the line that would join the two runs the
    // length of the working section; this is what stops it being drawn.
    float elapsed = a.w - b.w;
    s.real = b.w >= 0.0 && elapsed > 0.0;
    s.speed = s.real ? distance(s.head, s.tail) / max(elapsed, 1e-5) : 0.0;
    return s;
  }
`;

/** One line per particle, tapering away behind it. */
export const TRAIL_VERTEX_SHADER = TRAIL_COMMON + /* glsl */ `
  in float aSlot;
  in float aSegment;
  in float aIndex;

  out float vAlpha;
  out float vSpeed;

  void main() {
    TrailPair s = readPair(aIndex, int(aSegment));
    vSpeed = s.speed * uSpeedScale;

    // Squared so the tail thins out quickly and the leading end reads as the front.
    float taper = 1.0 - aSlot / max(uTrail - 1.0, 1.0);
    vAlpha = s.real ? taper * taper * uFade * uOpacity : 0.0;

    vec3 world = aSlot < aSegment + 0.5 ? s.head : s.tail;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(world, 1.0);
  }
`;

export const TRAIL_FRAGMENT_SHADER = `precision highp float;\n` + SPEED_COLOUR_GLSL + /* glsl */ `
  in float vAlpha;
  in float vSpeed;
  out vec4 fragColor;

  void main() {
    if (vAlpha < 0.004) discard;
    fragColor = vec4(speedColour(vSpeed), vAlpha);
  }
`;

/**
 * A dot at the head of each streamline.
 *
 * Lines are a pixel wide whatever the display, which is thin on a dense screen and makes
 * it hard to tell which end of a streak is the front. A point at the leading end costs
 * one more draw of one vertex per particle and settles both.
 */
export const HEAD_VERTEX_SHADER = TRAIL_COMMON + /* glsl */ `
  in float aIndex;
  uniform float uPointSize;

  out float vAlpha;
  out float vSpeed;

  void main() {
    TrailPair s = readPair(aIndex, 0);
    vSpeed = s.speed * uSpeedScale;
    vAlpha = s.real ? uFade * uOpacity : 0.0;
    gl_PointSize = uPointSize;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(s.head, 1.0);
  }
`;

export const HEAD_FRAGMENT_SHADER = `precision highp float;\n` + SPEED_COLOUR_GLSL + /* glsl */ `
  in float vAlpha;
  in float vSpeed;
  out vec4 fragColor;

  void main() {
    if (vAlpha < 0.004) discard;
    // Round rather than square, and soft at the rim so it does not alias.
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float mask = 1.0 - smoothstep(0.7, 1.0, r);
    if (mask <= 0.0) discard;
    fragColor = vec4(speedColour(vSpeed), vAlpha * mask);
  }
`;
