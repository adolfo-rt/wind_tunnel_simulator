import type { GridSize } from '../gpu/atlas';

/**
 * Streamlines traced through a velocity field that has been read back to the CPU.
 *
 * A *streamline* is the curve everywhere tangent to the velocity field at one instant —
 * which is not the same thing as the tracers in `Streamlines.ts`. Those are pathlines:
 * where a particle actually went, over time. In a steady flow the two coincide, and the
 * solved field settles, so after a few hundred steps they are the same curves. In the
 * unsteady wake they are not, and the difference is honest rather than awkward: one shows
 * where the air is going now, the other where it has been.
 *
 * Traced on the CPU rather than the GPU because these are drawn as thick ribbons, and a
 * thick line has to be expanded into geometry from points something can see. The field
 * comes back once per rebuild, not once per frame — and because the solve is
 * non-dimensional, the shape of a streamline does not change with the tunnel speed at
 * all, so a rebuild is needed only when the aircraft, the grid or the rake moves.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Field {
  /** Velocity, three components per cell, x fastest. */
  data: Float32Array;
  grid: GridSize;
  /** World position of the grid's lower corner. */
  min: Vec3;
  /** World size of the whole grid. */
  size: Vec3;
}

export interface TraceOptions {
  /** How far to step, as a fraction of a cell. */
  stepCells?: number;
  /** Most points in one streamline. */
  maxPoints?: number;
  /**
   * Speed below which the trace stops, relative to the free stream.
   *
   * The field is exactly zero inside the aircraft, so a streamline that runs into the
   * skin stalls rather than passing through it, and this is what notices. It also ends
   * lines that wander into a dead corner of the wake, where carrying on would draw a
   * shape from numerical noise.
   */
  minSpeed?: number;
}

const DEFAULTS = { stepCells: 0.5, maxPoints: 600, minSpeed: 0.02 };

/**
 * Velocity at a world point, trilinearly interpolated.
 *
 * Returns null outside the grid, which is how the trace knows it has left the tunnel.
 * Cell centres sit at half-integer positions, so the sample coordinate is offset by half
 * a cell — getting that wrong shifts every streamline half a cell upstream, which looks
 * entirely plausible and puts the stagnation point inside the nose.
 */
export function sampleField(field: Field, at: Vec3): Vec3 | null {
  const { data, grid, min, size } = field;
  const gx = ((at.x - min.x) / size.x) * grid.x - 0.5;
  const gy = ((at.y - min.y) / size.y) * grid.y - 0.5;
  const gz = ((at.z - min.z) / size.z) * grid.z - 0.5;
  if (gx < -0.5 || gy < -0.5 || gz < -0.5) return null;
  if (gx > grid.x - 0.5 || gy > grid.y - 0.5 || gz > grid.z - 0.5) return null;

  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
  const x0 = clamp(Math.floor(gx), grid.x - 1);
  const y0 = clamp(Math.floor(gy), grid.y - 1);
  const z0 = clamp(Math.floor(gz), grid.z - 1);
  const x1 = clamp(x0 + 1, grid.x - 1);
  const y1 = clamp(y0 + 1, grid.y - 1);
  const z1 = clamp(z0 + 1, grid.z - 1);
  const fx = clamp(gx - x0, 1);
  const fy = clamp(gy - y0, 1);
  const fz = clamp(gz - z0, 1);

  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (let c = 0; c < 8; c++) {
    const ix = c & 1 ? x1 : x0;
    const iy = c & 2 ? y1 : y0;
    const iz = c & 4 ? z1 : z0;
    const w =
      (c & 1 ? fx : 1 - fx) * (c & 2 ? fy : 1 - fy) * (c & 4 ? fz : 1 - fz);
    if (w === 0) continue;
    const i = (ix + grid.x * (iy + grid.y * iz)) * 3;
    vx += w * data[i];
    vy += w * data[i + 1];
    vz += w * data[i + 2];
  }
  return { x: vx, y: vy, z: vz };
}

export interface Streamline {
  /** Points along the curve, world units. */
  points: Vec3[];
  /** Speed at each point, relative to the free stream. */
  speeds: number[];
}

/**
 * Follow the field from a release point until it leaves the domain or stops.
 *
 * Midpoint steps rather than Euler, for the same reason the GPU tracers use them: a
 * first-order step through a curving field cuts every corner, and around a wing the field
 * is nothing but corners. The step is a fixed fraction of a cell, so the error is set by
 * the grid rather than by how fast the air happens to be moving.
 */
export function traceStreamline(
  field: Field,
  from: Vec3,
  options: TraceOptions = {},
): Streamline {
  const { stepCells, maxPoints, minSpeed } = { ...DEFAULTS, ...options };
  const cell = Math.min(
    field.size.x / field.grid.x,
    field.size.y / field.grid.y,
    field.size.z / field.grid.z,
  );
  const step = stepCells * cell;

  const points: Vec3[] = [];
  const speeds: number[] = [];
  let p = { ...from };

  for (let i = 0; i < maxPoints; i++) {
    const v = sampleField(field, p);
    if (!v) break;
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < minSpeed) break;

    points.push({ ...p });
    speeds.push(speed);

    // Midpoint: step half way on the local velocity, resample, step the whole way on that.
    const half = step / (2 * speed);
    const mid = { x: p.x + v.x * half, y: p.y + v.y * half, z: p.z + v.z * half };
    const vm = sampleField(field, mid);
    if (!vm) break;
    const midSpeed = Math.hypot(vm.x, vm.y, vm.z);
    if (midSpeed < minSpeed) break;

    const scale = step / midSpeed;
    p = { x: p.x + vm.x * scale, y: p.y + vm.y * scale, z: p.z + vm.z * scale };
  }

  return { points, speeds };
}

/**
 * Release points for a rake: evenly spaced up a vertical line, in one spanwise plane.
 *
 * Evenly spaced rather than clustered, because the point of a rake is to show how the
 * flow is deflected across the whole height of the tunnel — the lines crowding together
 * where the air accelerates is the reading, and it only means something if they started
 * equally spaced.
 */
export function rakeStations(count: number, min: number, max: number): number[] {
  if (count < 1) return [];
  if (count === 1) return [(min + max) / 2];
  const stations: number[] = [];
  // Inset by half a gap at each end, so the outermost lines are not on the tunnel wall.
  const gap = (max - min) / count;
  for (let i = 0; i < count; i++) stations.push(min + gap * (i + 0.5));
  return stations;
}
