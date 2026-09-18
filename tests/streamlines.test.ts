import { describe, it, expect } from 'vitest';
import {
  cellsPerStep,
  chordCells,
  discSeeds,
  particleTextureSize,
  recordCount,
  startFractions,
  substepCount,
  trailSegmentVertices,
} from '../src/physics/particles/seeding';
import { SLOW_MOTION, STREAMLINE_COUNTS } from '../src/physics/Streamlines';
import { LEGEND_STOPS, REFERENCE_SPEED } from '../src/physics/gpu/colourRamp';
import { SliceView } from '../src/physics/SliceView';

/**
 * Seeding covers the inlet, evenly.
 *
 * Uneven seeding would be invisible as a defect and misleading as a picture: a thin patch
 * over the wing reads as air that is not going there.
 */
describe('inlet seeding', () => {
  it('keeps every point inside the disc', () => {
    for (const point of discSeeds(2000, 10)) {
      expect(Math.hypot(point.y, point.z)).toBeLessThanOrEqual(10 + 1e-9);
    }
  });

  it('puts equal numbers of points in equal areas', () => {
    // Half the area of a disc lies inside 1/sqrt(2) of its radius, so half the seeds
    // should. Spacing the radii linearly instead would put about 70% of them there.
    const points = discSeeds(4000, 1);
    const inner = points.filter((p) => Math.hypot(p.y, p.z) < Math.SQRT1_2).length;
    expect(inner / points.length).toBeCloseTo(0.5, 2);
  });

  it('spreads them around the disc rather than along one arm', () => {
    // Twelve sectors of a disc seeded evenly should each hold about a twelfth.
    const sectors = new Array(12).fill(0);
    const points = discSeeds(2400, 1);
    for (const p of points) {
      const angle = Math.atan2(p.z, p.y) + Math.PI;
      sectors[Math.min(11, Math.floor((angle / (2 * Math.PI)) * 12))]++;
    }
    for (const count of sectors) expect(count).toBeGreaterThan(points.length / 12 * 0.8);
  });

  it('is the same every time, so a streamline is the same streamline', () => {
    expect(discSeeds(50, 3)).toEqual(discSeeds(50, 3));
  });

  it('releases the first pass along the whole tunnel', () => {
    const fractions = [...startFractions(1000)];
    expect(Math.min(...fractions)).toBeLessThan(0.01);
    expect(Math.max(...fractions)).toBeGreaterThan(0.99);
    // Ten equal stretches of the tunnel, each getting roughly a tenth of the release.
    const bins = new Array(10).fill(0);
    for (const f of fractions) bins[Math.min(9, Math.floor(f * 10))]++;
    for (const count of bins) expect(count).toBeGreaterThan(80);
  });

  /**
   * The defect this replaced: staggering the release by a golden-ratio sequence, to match
   * the golden angle the seeds are laid out by, made the release point a function of the
   * angle. The tracers came out as a spiral sheet sweeping down the tunnel, which looks
   * like a finding about the flow and is a finding about the arithmetic.
   */
  it('does not tie where a particle starts to where it sits on the disc', () => {
    const count = 4096;
    const points = discSeeds(count, 1);
    const fractions = startFractions(count);

    const bins = Array.from({ length: 8 }, () => new Array(8).fill(0));
    for (let i = 0; i < count; i++) {
      const angle = Math.atan2(points[i].z, points[i].y) + Math.PI;
      const sector = Math.min(7, Math.floor((angle / (2 * Math.PI)) * 8));
      const along = Math.min(7, Math.floor(fractions[i] * 8));
      bins[along][sector]++;
    }

    // Sixty-four bins over 4096 particles is 64 each. The golden stagger left 55 of them
    // empty and put 513 in one.
    const occupancy = bins.flat();
    expect(Math.min(...occupancy)).toBeGreaterThan(40);
    expect(Math.max(...occupancy)).toBeLessThan(96);
  });
});

/**
 * Step length, which is this stage's version of the sampling trap that made the fans
 * strobe: a particle that covers most of a cell in one step draws a chord across whatever
 * it is flowing around, and near a wing that chord goes through the wing.
 */
describe('integration step length', () => {
  it('splits a long frame into enough pieces to stay on the field', () => {
    for (const advance of [0.1, 0.5, 1, 2, 2.8]) {
      expect(cellsPerStep(advance)).toBeLessThanOrEqual(0.35 + 1e-9);
    }
  });

  it('does not waste steps when the flow is slow', () => {
    expect(substepCount(0.05)).toBe(1);
    expect(substepCount(0.3)).toBe(1);
    expect(substepCount(0.4)).toBe(2);
  });

  it('caps the work rather than subdividing without limit', () => {
    expect(substepCount(1000)).toBe(8);
  });

  it('treats a stopped tunnel as one step rather than none', () => {
    expect(substepCount(0)).toBe(1);
    expect(substepCount(Number.NaN)).toBe(1);
  });

  /**
   * If the top of the speed slider needed more than the eight substeps allowed, particles
   * would start cutting corners at exactly the speeds people will drag it to.
   */
  it('has headroom at the top of the speed slider', () => {
    const cells = WORST_CASE_ADVANCE_CELLS;
    expect(substepCount(cells)).toBeLessThan(8);
    expect(cellsPerStep(cells)).toBeLessThanOrEqual(0.35 + 1e-9);
  });
});

/**
 * How far apart the points the trail is drawn through are, which is a different limit
 * from how far the integration steps: the path can be right while the line drawn through
 * it cuts across the curve, and near a wing that line goes through the wing.
 */
describe('trail sample spacing', () => {
  it('costs nothing at a normal frame rate', () => {
    // 900 km/h at sixty frames a second on a 737's grid.
    const cells = ((900 / 3.6) / SLOW_MOTION) * (1 / 60) / (109 / 128);
    expect(recordCount(cells)).toBe(1);
  });

  it('keeps the chord short on the longest frame the app allows', () => {
    expect(chordCells(WORST_CASE_ADVANCE_CELLS)).toBeLessThanOrEqual(0.6 + 1e-9);
  });

  it('caps the extra copies rather than recording without limit', () => {
    expect(recordCount(1000)).toBe(3);
  });

  it('records once when the tunnel is stopped', () => {
    expect(recordCount(0)).toBe(1);
    expect(recordCount(Number.NaN)).toBe(1);
  });
});

/**
 * The app's own worst case: the top of the speed slider, on a 737's working section of
 * about 109 m over 128 cells, on a machine slow enough to hit the frame-time clamp.
 */
const WORST_CASE_ADVANCE_CELLS = ((1300 / 3.6) / SLOW_MOTION) * (1 / 20) / (109 / 128);

describe('particle storage', () => {
  it('finds a texture that holds every particle', () => {
    for (const count of [1, 7, 1024, 4096, 5000, 16384]) {
      const { width, height } = particleTextureSize(count);
      expect(width * height).toBeGreaterThanOrEqual(count);
    }
  });

  it('keeps it square, so neither side runs into the texture limit first', () => {
    for (const count of Object.values(STREAMLINE_COUNTS)) {
      const { width, height } = particleTextureSize(count);
      expect(Math.abs(width - height)).toBeLessThanOrEqual(1);
    }
  });

  it('leaves room for the trail stack under a modest texture limit', () => {
    // The trail is stored as one block of rows per sample, so the tallest offender is the
    // highest particle count; 4096 is the oldest hardware's guaranteed limit.
    const { height } = particleTextureSize(STREAMLINE_COUNTS.high);
    expect(height * 24).toBeLessThanOrEqual(4096);
  });
});

/**
 * Trails are drawn as separate segments rather than a connected strip, so that the one
 * spanning a particle's restart can be dropped outright instead of faded. Both ends of a
 * segment have to read the same pair of samples, or they would disagree about it.
 */
describe('trail geometry', () => {
  it('makes one segment between each pair of samples', () => {
    const { slot, segment, count } = trailSegmentVertices(24);
    expect(count).toBe(23 * 2);
    expect(slot).toHaveLength(count);
    expect(segment).toHaveLength(count);
  });

  it('gives both ends of a segment the same segment index', () => {
    const { slot, segment } = trailSegmentVertices(8);
    for (let i = 0; i < segment.length; i += 2) {
      expect(segment[i]).toBe(segment[i + 1]);
      expect(slot[i]).toBe(segment[i]);
      expect(slot[i + 1]).toBe(segment[i] + 1);
    }
  });

  it('reads no sample beyond the end of the trail', () => {
    const { slot } = trailSegmentVertices(24);
    expect(Math.max(...slot)).toBe(23);
  });
});

/**
 * The streamlines and the flow slice are drawn from one field and sit under one legend,
 * so they have to be coloured by one ramp. Two copies would drift apart the first time
 * either was adjusted, and the picture would then contradict its own key.
 */
describe('the colour ramp is shared', () => {
  it('gives the slice the same reference speed and stops', () => {
    expect(SliceView.REFERENCE_SPEED).toBe(REFERENCE_SPEED);
    expect(SliceView.LEGEND_STOPS).toBe(LEGEND_STOPS);
  });

  it('puts the free stream in the middle of the ramp', () => {
    expect(LEGEND_STOPS[2]).toBe(REFERENCE_SPEED);
  });
});
