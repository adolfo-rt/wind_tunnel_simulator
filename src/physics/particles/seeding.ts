/**
 * The arithmetic behind the streamlines, kept out of the shaders so it can be tested.
 *
 * Everything here is deterministic. Seed points are laid out by a fixed construction
 * rather than drawn at random, which matters for more than repeatability: a particle
 * that always restarts from the same place retraces the same streamline, so the picture
 * is a stable set of lines through the flow instead of a scintillating cloud. Random
 * reseeding looks busier and tells you less.
 */

export interface DiscPoint {
  y: number;
  z: number;
}

/** Golden angle, in radians. Consecutive points land as far from each other as possible. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Seed points spread evenly over a disc, by the sunflower construction.
 *
 * The radius goes as the square root of the index so that equal counts of points fall in
 * equal areas — spacing them linearly would crowd the centre and leave the rim bare,
 * and since the tunnel's cross-section is a disc, the outer annuli are most of the air.
 */
export function discSeeds(count: number, radius: number): DiscPoint[] {
  const points: DiscPoint[] = [];
  for (let i = 0; i < count; i++) {
    const r = radius * Math.sqrt((i + 0.5) / count);
    const theta = i * GOLDEN_ANGLE;
    points.push({ y: r * Math.sin(theta), z: r * Math.cos(theta) });
  }
  return points;
}

/**
 * The smallest square-ish texture that holds this many particles.
 *
 * Particle state lives in a texture one texel per particle, so the count is rounded up
 * to fill it. The spare texels hold particles like any other; they are seeded along with
 * the rest rather than left as undefined data that would advect somewhere strange.
 */
export function particleTextureSize(count: number): { width: number; height: number } {
  const clamped = Math.max(1, Math.round(count));
  const width = Math.ceil(Math.sqrt(clamped));
  const height = Math.ceil(clamped / width);
  return { width, height };
}

/**
 * How many integration steps to take this frame.
 *
 * A particle that moves most of a cell in one step cuts the corner of whatever it is
 * flowing around — the straight chord crosses ground the real streamline curves past,
 * which near a wing means passing through it. Keeping each step to a fraction of a cell
 * keeps the path on the field. This is the CFL condition wearing a different hat, and it
 * is the same class of mistake as the fans strobing in stage 2: a discrete sample rate
 * that is fine at one speed and wrong at another.
 */
export function substepCount(
  advanceCells: number,
  maxCellsPerStep = 0.35,
  maxSubsteps = 8,
): number {
  if (!Number.isFinite(advanceCells) || advanceCells <= 0) return 1;
  return Math.min(maxSubsteps, Math.max(1, Math.ceil(advanceCells / maxCellsPerStep)));
}

/**
 * The longest step any one particle takes, in cells, after substepping.
 *
 * Above the substep ceiling the steps stop getting shorter and the trails start cutting
 * corners. Nothing in the app currently reaches that — this exists so a test can say so
 * rather than the limit being discovered from a screenshot.
 */
export function cellsPerStep(advanceCells: number, maxCellsPerStep = 0.35, maxSubsteps = 8): number {
  return advanceCells / substepCount(advanceCells, maxCellsPerStep, maxSubsteps);
}

/**
 * How many trail samples to record this frame.
 *
 * Substepping keeps the path a particle *takes* on the field, but the trail *drawn* is a
 * polyline through whatever was recorded, and one sample per frame means each chord spans
 * a whole frame's travel. At sixty frames a second that is a fraction of a cell and the
 * line sits on the streamline. On a machine managing twenty, at the top of the speed
 * slider, it is nearly two cells, and a chord that long cuts across the curve the flow
 * makes round a wing — the drawn line clips the wing the particle went around.
 *
 * Recording more than once on a long frame fixes that, at the price of a copy of the
 * trail buffer each time, so it is capped: in the ordinary case this returns 1 and costs
 * nothing, and the worst case the app can reach is three.
 */
export function recordCount(advanceCells: number, maxChordCells = 0.6, maxRecords = 3): number {
  if (!Number.isFinite(advanceCells) || advanceCells <= 0) return 1;
  return Math.min(maxRecords, Math.max(1, Math.ceil(advanceCells / maxChordCells)));
}

/** The gap between consecutive trail samples, in cells, after that. */
export function chordCells(advanceCells: number, maxChordCells = 0.6, maxRecords = 3): number {
  return advanceCells / recordCount(advanceCells, maxChordCells, maxRecords);
}

/**
 * Vertices for one trail, as a list of segments rather than a connected strip.
 *
 * A strip would be cheaper, but a trail has a seam in it: when a particle reaches the
 * outlet it restarts at the inlet, and the two samples either side of that restart are
 * at opposite ends of the tunnel. With a strip the seam is a vertex shared by a good
 * segment and a bad one, so it can only be faded, leaving a ghost line drawn clean
 * across the working section. As separate segments each one stands or falls on its own
 * and the bad one is simply not drawn.
 *
 * Returns, per vertex, which trail sample it reads (`slot`) and which segment it belongs
 * to (`segment`); both ends of a segment test the same pair of samples and so make the
 * same decision.
 */
export function trailSegmentVertices(trailLength: number): {
  slot: Float32Array;
  segment: Float32Array;
  count: number;
} {
  const segments = Math.max(1, trailLength - 1);
  const slot = new Float32Array(segments * 2);
  const segment = new Float32Array(segments * 2);
  for (let s = 0; s < segments; s++) {
    slot[s * 2] = s;
    slot[s * 2 + 1] = s + 1;
    segment[s * 2] = s;
    segment[s * 2 + 1] = s;
  }
  return { slot, segment, count: segments * 2 };
}

/**
 * Where each particle starts along the tunnel, as a fraction of its length.
 *
 * All of them released at the inlet together would cross as one sheet and arrive back at
 * the inlet as one sheet, pulsing forever. Spreading the first release along the tunnel
 * breaks that up once and for all — and it has to, because the spacing is permanent: a
 * particle restarts the moment it reaches the outlet, so whatever phase it is given here
 * it keeps.
 *
 * The sequence is the radical inverse in base two, and the base matters. The obvious
 * choice was another golden-ratio sequence, to match the seeding, and it produced exactly
 * the artefact it was meant to prevent: the seed angle advances by frac(0.382 i) and a
 * golden stagger by frac(0.618 i), which are the same sequence reflected, so release
 * position was a one-to-one function of angle and the tracers formed a spiral sheet
 * sweeping down the tunnel. Binning 4096 of them by angle and by release point left 55 of
 * 64 bins empty, with an eighth of every particle in one of them. The radical inverse is
 * built from the binary expansion of the index rather than from a multiple of an
 * irrational, so it has no such relationship with the golden angle: the same binning
 * comes out between 60 and 68 per bin.
 */
export function startFractions(count: number): Float32Array {
  const fractions = new Float32Array(count);
  for (let i = 0; i < count; i++) fractions[i] = radicalInverse(i + 1);
  return fractions;
}

/** The index's binary digits, reflected about the point. */
function radicalInverse(index: number): number {
  let result = 0;
  let place = 0.5;
  let remaining = index;
  while (remaining > 0) {
    result += (remaining & 1) * place;
    remaining >>>= 1;
    place *= 0.5;
  }
  return result;
}
