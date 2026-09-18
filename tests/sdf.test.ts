import { describe, it, expect } from 'vitest';
import { BoxGeometry, SphereGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildSdf, pointTriangleDistanceSq, sampleSdf } from '../src/physics/sdf/buildSdf';

const build = (geometry: BufferGeometry, resolution = 48) =>
  buildSdf(
    geometry.getAttribute('position').array as Float32Array,
    geometry.getIndex()!.array as Uint32Array,
    { resolution },
  );

describe('point to triangle distance', () => {
  // Triangle in the z = 0 plane with vertices at the origin, (1,0,0) and (0,1,0).
  const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0] as const;
  const d = (x: number, y: number, z: number) =>
    Math.sqrt(pointTriangleDistanceSq(x, y, z, ...tri));

  it('is the perpendicular distance above the face', () => {
    expect(d(0.25, 0.25, 2)).toBeCloseTo(2, 10);
  });

  it('is zero on the face', () => {
    expect(d(0.25, 0.25, 0)).toBeCloseTo(0, 10);
    expect(d(0, 0, 0)).toBeCloseTo(0, 10);
  });

  it('measures to the nearest vertex outside a corner', () => {
    expect(d(-1, -1, 0)).toBeCloseTo(Math.SQRT2, 10);
    expect(d(3, 0, 0)).toBeCloseTo(2, 10);
  });

  it('measures to the nearest edge outside an edge', () => {
    // Beyond the hypotenuse, which runs from (1,0) to (0,1).
    expect(d(1, 1, 0)).toBeCloseTo(Math.SQRT1_2, 10);
    expect(d(0.5, -2, 0)).toBeCloseTo(2, 10);
  });
});

describe('a sphere, whose distance field is known exactly', () => {
  const radius = 2;
  const grid = build(new SphereGeometry(radius, 48, 32), 56);

  it('gets the sign right at the centre and outside', () => {
    expect(sampleSdf(grid, 0, 0, 0)).toBeLessThan(0);
    expect(sampleSdf(grid, radius * 1.05, 0, 0)).toBeGreaterThan(0);
    expect(sampleSdf(grid, 0, radius * 1.05, 0)).toBeGreaterThan(0);
  });

  it('matches |p| - r near the surface, to about a cell', () => {
    for (const [x, y, z] of [
      [radius * 0.9, 0, 0],
      [0, radius * 0.92, 0],
      [0, 0, radius * 1.08],
      [radius * 0.62, radius * 0.62, 0],
    ]) {
      const exact = Math.hypot(x, y, z) - radius;
      expect(sampleSdf(grid, x, y, z)).toBeCloseTo(exact, 1);
    }
  });

  it('clamps rather than growing without limit far from the surface', () => {
    expect(sampleSdf(grid, 0, 0, 0)).toBeGreaterThanOrEqual(-grid.band);
    for (let i = 0; i < grid.data.length; i++) {
      expect(Math.abs(grid.data[i])).toBeLessThanOrEqual(grid.band + 1e-6);
    }
  });

  it('has no holes: the interior is a connected solid block', () => {
    // Sampling along any line through the centre must go outside, inside, outside once.
    for (const axis of [0, 1, 2]) {
      const flips: number[] = [];
      let previous = 1;
      for (let t = -radius * 1.4; t <= radius * 1.4; t += 0.05) {
        const p = [0, 0, 0];
        p[axis] = t;
        const sign = Math.sign(sampleSdf(grid, p[0], p[1], p[2])) || 1;
        if (sign !== previous) flips.push(t);
        previous = sign;
      }
      expect(flips).toHaveLength(2);
    }
  });
});

describe('a box, where the corners test the distance metric', () => {
  const grid = build(new BoxGeometry(4, 2, 6), 56);

  it('is inside at the centre and outside past every face', () => {
    expect(sampleSdf(grid, 0, 0, 0)).toBeLessThan(0);
    expect(sampleSdf(grid, 2.2, 0, 0)).toBeGreaterThan(0);
    expect(sampleSdf(grid, 0, 1.2, 0)).toBeGreaterThan(0);
    expect(sampleSdf(grid, 0, 0, 3.2)).toBeGreaterThan(0);
  });

  it('measures the perpendicular distance to a face', () => {
    expect(sampleSdf(grid, 2.3, 0, 0)).toBeCloseTo(0.3, 1);
    expect(sampleSdf(grid, 0, 1.25, 0)).toBeCloseTo(0.25, 1);
  });

  it('measures to the corner outside a corner', () => {
    // Kept inside the exact band; past it the field is deliberately clamped.
    const offset = 0.12;
    const exact = Math.hypot(offset, offset, offset);
    expect(exact).toBeLessThan(grid.band);
    expect(sampleSdf(grid, 2 + offset, 1 + offset, 3 + offset)).toBeCloseTo(exact, 1);
  });

  it('clamps beyond the band rather than reporting a wrong distance', () => {
    const far = sampleSdf(grid, 4, 3, 5);
    expect(far).toBeCloseTo(grid.band, 5);
  });
});

describe('overlapping solids', () => {
  /**
   * The case that decides the inside test. An aircraft is a union of overlapping closed
   * solids, and a ray through the region where two of them meet crosses four faces. Take
   * the parity of that and the interior reads as empty; accumulate the crossings with
   * their orientation and it reads as inside, which is what the winding number does.
   */
  it('treats the region where two spheres meet as solid', () => {
    const left = new SphereGeometry(2, 32, 24).translate(-1.2, 0, 0);
    const right = new SphereGeometry(2, 32, 24).translate(1.2, 0, 0);
    const union = mergeGeometries([left, right], false)!;
    const grid = build(union, 56);

    // The origin lies inside both spheres at once: four crossings along x.
    expect(sampleSdf(grid, 0, 0, 0)).toBeLessThan(0);
    // And so does everywhere along the line joining the two centres.
    for (let x = -1.2; x <= 1.2; x += 0.2) {
      expect(sampleSdf(grid, x, 0, 0)).toBeLessThan(0);
    }
    // While outside the union is still outside.
    expect(sampleSdf(grid, 3.4, 0, 0)).toBeGreaterThan(0);
    expect(sampleSdf(grid, 0, 2.2, 0)).toBeGreaterThan(0);
  });

  it('leaves a genuine gap between two solids that do not touch', () => {
    const left = new SphereGeometry(1, 24, 16).translate(-3, 0, 0);
    const right = new SphereGeometry(1, 24, 16).translate(3, 0, 0);
    const pair = mergeGeometries([left, right], false)!;
    const grid = build(pair, 64);

    expect(sampleSdf(grid, -3, 0, 0)).toBeLessThan(0);
    expect(sampleSdf(grid, 3, 0, 0)).toBeLessThan(0);
    expect(sampleSdf(grid, 0, 0, 0)).toBeGreaterThan(0);
  });
});
