/**
 * The one speed-to-colour ramp.
 *
 * The flow slice and the streamlines draw the same field and sit under the same legend,
 * so they have to agree exactly. Two copies of a gradient drift apart the first time one
 * of them is tweaked, and the result is a picture that quietly contradicts its own key.
 */

/** Speed the ramp is anchored to, in m/s. Roughly the default cruise setting. */
export const REFERENCE_SPEED = 250;

/**
 * Where the ramp changes colour, as multiples of the reference speed.
 *
 * Free stream sits in the middle, so slower-than-free-stream and faster-than are
 * distinguishable at a glance — which is the distinction that matters around a wing.
 */
export const RAMP_STOPS = [0, 0.5, 1.0, 1.4, 2.0];

/** The same stops in m/s, which is what the legend labels. */
export const LEGEND_STOPS = RAMP_STOPS.map((s) => s * REFERENCE_SPEED);

/**
 * Deliberately not a rainbow. A perceptually ordered ramp means "brighter is faster"
 * reads correctly, whereas a rainbow invents boundaries where the data is smooth.
 */
export const SPEED_COLOUR_GLSL = /* glsl */ `
  vec3 speedColour(float s) {
    vec3 stalled = vec3(0.05, 0.10, 0.24);
    vec3 slow    = vec3(0.13, 0.40, 0.72);
    vec3 stream  = vec3(0.55, 0.75, 0.88);
    vec3 fast    = vec3(0.98, 0.83, 0.42);
    vec3 fastest = vec3(0.92, 0.35, 0.18);
    if (s < 0.5) return mix(stalled, slow, s / 0.5);
    if (s < 1.0) return mix(slow, stream, (s - 0.5) / 0.5);
    if (s < 1.4) return mix(stream, fast, (s - 1.0) / 0.4);
    return mix(fast, fastest, clamp((s - 1.4) / 0.6, 0.0, 1.0));
  }
`;
