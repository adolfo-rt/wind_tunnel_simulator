import { describe, it, expect } from 'vitest';
import {
  rakeStations,
  sampleField,
  traceStreamline,
  type Field,
  type Vec3,
} from '../src/physics/particles/trace';

/** Build a field on a grid from a function of world position. */
function fieldOf(
  grid: { x: number; y: number; z: number },
  min: Vec3,
  size: Vec3,
  at: (p: Vec3) => Vec3,
): Field {
  const data = new Float32Array(grid.x * grid.y * grid.z * 3);
  for (let z = 0; z < grid.z; z++) {
    for (let y = 0; y < grid.y; y++) {
      for (let x = 0; x < grid.x; x++) {
        const p = {
          x: min.x + ((x + 0.5) / grid.x) * size.x,
          y: min.y + ((y + 0.5) / grid.y) * size.y,
          z: min.z + ((z + 0.5) / grid.z) * size.z,
        };
        const v = at(p);
        const i = (x + grid.x * (y + grid.y * z)) * 3;
        data[i] = v.x;
        data[i + 1] = v.y;
        data[i + 2] = v.z;
      }
    }
  }
  return { data, grid, min, size };
}

const CUBE = { x: 32, y: 32, z: 32 };
const MIN = { x: -8, y: -8, z: -8 };
const SIZE = { x: 16, y: 16, z: 16 };

describe('sampling a field read back from the grid', () => {
  /*
   * Cell centres sit at half-integer positions. Getting that offset wrong shifts every
   * streamline half a cell upstream, which looks entirely plausible and puts the
   * stagnation point inside the nose. A field that varies linearly catches it: the
   * interpolation is then exact everywhere, so any disagreement is the offset.
   */
  it('is exact on a field that varies linearly', () => {
    const field = fieldOf(CUBE, MIN, SIZE, (p) => ({ x: p.x, y: 2 * p.y, z: -p.z }));
    for (const at of [
      { x: 0, y: 0, z: 0 },
      { x: 1.3, y: -2.7, z: 4.1 },
      { x: -5.5, y: 6.25, z: -0.75 },
    ]) {
      const v = sampleField(field, at)!;
      expect(v.x).toBeCloseTo(at.x, 4);
      expect(v.y).toBeCloseTo(2 * at.y, 4);
      expect(v.z).toBeCloseTo(-at.z, 4);
    }
  });

  /* Outside the grid there is no answer, which is how a trace knows it has left. */
  it('reports nothing outside the grid', () => {
    const field = fieldOf(CUBE, MIN, SIZE, () => ({ x: 1, y: 0, z: 0 }));
    expect(sampleField(field, { x: 0, y: 0, z: 0 })).not.toBeNull();
    expect(sampleField(field, { x: 9, y: 0, z: 0 })).toBeNull();
    expect(sampleField(field, { x: 0, y: -9, z: 0 })).toBeNull();
  });
});

describe('tracing a streamline', () => {
  /* A uniform stream makes straight lines, and they run until they leave the domain. */
  it('runs straight down a uniform stream', () => {
    const field = fieldOf(CUBE, MIN, SIZE, () => ({ x: 1, y: 0, z: 0 }));
    const line = traceStreamline(field, { x: -7.5, y: 1, z: -2 }, { stepCells: 0.5 });

    expect(line.points.length).toBeGreaterThan(20);
    for (const p of line.points) {
      expect(p.y).toBeCloseTo(1, 6);
      expect(p.z).toBeCloseTo(-2, 6);
    }
    // It crosses the whole domain rather than stopping somewhere in the middle.
    const last = line.points[line.points.length - 1];
    expect(last.x).toBeGreaterThan(7);
    for (const s of line.speeds) expect(s).toBeCloseTo(1, 6);
  });

  /*
   * Solid-body rotation, whose streamlines are exact circles.
   *
   * This is the test that makes the integrator worth trusting. Euler steps on a circle
   * spiral outwards without ever looking wrong — each step leaves along the tangent — and
   * on a wing that is the difference between flow that follows the surface and flow that
   * drifts off it. A midpoint step holds the radius; the tolerance here is tight enough
   * that first-order stepping fails it.
   */
  it('holds its radius going round a vortex', () => {
    const field = fieldOf(CUBE, MIN, SIZE, (p) => ({ x: -p.y, y: p.x, z: 0 }));
    const radius = 4;
    const line = traceStreamline(
      field,
      { x: radius, y: 0, z: 0 },
      { stepCells: 0.5, maxPoints: 400 },
    );

    expect(line.points.length).toBeGreaterThan(100);
    for (const p of line.points) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(radius, 1);
      expect(p.z).toBeCloseTo(0, 6);
    }
  });

  /*
   * The field is exactly zero inside the aircraft, so a line that reaches the skin stops
   * rather than carrying on through it. Without this a streamline sails through a wing
   * and out the other side, which is the most convincing wrong picture this code could
   * draw.
   */
  it('stops at a wall rather than passing through it', () => {
    const wall = 2;
    const field = fieldOf(CUBE, MIN, SIZE, (p) => (p.x < wall ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 0 }));
    const line = traceStreamline(field, { x: -7.5, y: 0, z: 0 }, { stepCells: 0.25 });

    const last = line.points[line.points.length - 1];
    expect(last.x).toBeLessThan(wall + 1);
    expect(last.x).toBeGreaterThan(-7.5);
  });

  /* A line never has more points than it was allowed, however long the field lets it run. */
  it('respects the point budget', () => {
    const field = fieldOf(CUBE, MIN, SIZE, (p) => ({ x: -p.y, y: p.x, z: 0 }));
    const line = traceStreamline(field, { x: 4, y: 0, z: 0 }, { maxPoints: 37 });
    expect(line.points).toHaveLength(37);
    expect(line.speeds).toHaveLength(37);
  });
});

describe('the rake stations', () => {
  /*
   * Evenly spaced, and not touching the ends. The reading a rake gives is the lines
   * crowding together where the air speeds up, and that only means something if they
   * started equally spaced; starting one on the tunnel wall would put it in the boundary
   * the solver treats as free-slip.
   */
  it('spreads evenly and keeps clear of the ends', () => {
    const stations = rakeStations(8, -10, 10);
    expect(stations).toHaveLength(8);
    expect(stations[0]).toBeGreaterThan(-10);
    expect(stations[7]).toBeLessThan(10);

    const gaps = stations.slice(1).map((s, i) => s - stations[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0], 9);

    // Symmetric about the middle, so the picture is not quietly biased up or down.
    expect(stations[0] + stations[7]).toBeCloseTo(0, 9);
  });

  it('handles the degenerate counts', () => {
    expect(rakeStations(0, -1, 1)).toEqual([]);
    expect(rakeStations(1, -4, 6)).toEqual([1]);
  });
});
