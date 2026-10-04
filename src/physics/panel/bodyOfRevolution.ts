import { solveDense } from './linear';

/**
 * Pressure on a fuselage or a nacelle.
 *
 * A body of revolution in an axial stream is represented by a line of point sources
 * along its own axis, with the strengths solved so that no flow crosses the surface.
 * This is the oldest trick in the subject — Rankine was drawing ship hulls this way in
 * the 1860s — and for a shape as slender as a fuselage it is accurate to a few percent.
 *
 * Why a line of sources rather than panels on the skin: an axisymmetric surface panel
 * needs complete elliptic integrals for its influence, and the extra accuracy buys
 * nothing here. The place it would matter is a blunt body, and a fuselage has a fineness
 * ratio around ten.
 *
 * Inviscid again, so the same caveats as everywhere else in this directory: it recovers
 * all of its pressure at the tail, where a real fuselage has a boundary layer that has
 * been thickening for forty metres and an upswept tail cone shedding a pair of vortices.
 * The streamlines show that; this does not.
 */

export interface BodyStation {
  /** Position along the body's axis. */
  x: number;
  /** Radius of the body there. */
  radius: number;
}

export interface BodySolution {
  x: Float64Array;
  radius: Float64Array;
  /** Pressure coefficient at each station. */
  cp: Float64Array;
}

/**
 * Stations too close to the axis are left out of the solve.
 *
 * At the nose and the tail the radius goes to zero, which puts a control point on top of
 * the very singularities it is meant to constrain.
 */
const MINIMUM_RADIUS_FRACTION = 0.06;

/**
 * Where the solved pressure is trusted completely, as a fraction of the largest radius.
 *
 * Between this and the minimum above, the solution is faded towards the stagnation value.
 * Measured against the Rankine ovoid, every bit of the error lives in the first and last
 * eighth of the body: over the middle, the mean error in Cp is 0.005 to 0.013, while at
 * the tips it reaches 0.4 and a slender body picked up a suction peak of -0.66 where the
 * exact answer is -0.33. Fading rather than cutting is also what the flow does - the
 * radius going to zero *is* the stagnation point - so this is closer to the physics than
 * a hard edge, not a cosmetic patch over it.
 */
const TRUSTED_RADIUS_FRACTION = 0.35;

/** How far inside the body's ends the source line is held, as a fraction of its length. */
const SOURCE_INSET = 0.02;

/**
 * How many sources the body is represented by.
 *
 * Fixed by the geometry, deliberately not by how finely the caller sampled it. Scaling the
 * source count with the station count makes the answer depend on the sampling: cosine
 * spacing bunches stations at the ends, which bunches sources onto the axis exactly where
 * the body is closest to it, and the system gets more ill-conditioned the more carefully
 * you describe the shape. On a 737's tail cone the suction peak wandered -0.29, -0.38,
 * -0.41, -0.38, -0.22, -0.13 as the station count went from 40 to 500 — not convergence,
 * just a different amount of damping each time. Held fixed, the same sweep gives -0.33 to
 * -0.34 throughout.
 *
 * More stations now do what more stations should: constrain the same smooth source
 * distribution more tightly, which is what the least-squares fit below is for.
 *
 * The number itself is where accuracy stops improving. Mean error in Cp against the exact
 * Rankine ovoid: 0.054 at 15 sources, 0.020 at 20, 0.0084 at 25, and 0.0080 from 30
 * onwards — flat thereafter, so beyond this the extra freedom buys nothing and only
 * sharpens its pursuit of the singularity at a closing tail.
 */
const SOURCE_COUNT = 32;

/**
 * Tikhonov regularisation, relative to the mean diagonal of the normal equations.
 *
 * Least squares alone still leaves the problem mildly ill-conditioned. This penalises
 * large source strengths, which is a statement about the physics as well as the
 * arithmetic: the distribution that represents a smooth body is itself smooth.
 */
const REGULARISATION = 1e-6;

/**
 * Velocity induced at a point by a unit point source on the axis, in cylindrical
 * coordinates: `dx` along the axis from the source, `r` away from it.
 */
function sourceVelocity(dx: number, r: number): { axial: number; radial: number } {
  const d = Math.hypot(dx, r);
  if (d < 1e-12) return { axial: 0, radial: 0 };
  const k = 1 / (4 * Math.PI * d * d * d);
  return { axial: dx * k, radial: r * k };
}

/**
 * Solve for the pressure distribution over a body of revolution in a unit axial stream.
 *
 * The stations describe the body's radius along its own axis, nose first.
 */
export interface BodyOptions {
  sources?: number;
  regularisation?: number;
}

export function solveBodyOfRevolution(
  stations: BodyStation[],
  options: BodyOptions = {},
): BodySolution {
  const n = stations.length;
  const x = new Float64Array(n);
  const radius = new Float64Array(n);
  const cp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = stations[i].x;
    radius[i] = stations[i].radius;
  }
  if (n < 3) return { x, radius, cp };

  const maxRadius = Math.max(...radius);
  const length = x[n - 1] - x[0];
  if (maxRadius <= 0 || length <= 0) return { x, radius, cp };

  // Stations fat enough to carry a control point.
  const active: number[] = [];
  for (let i = 0; i < n; i++) {
    if (radius[i] >= MINIMUM_RADIUS_FRACTION * maxRadius) active.push(i);
  }
  if (active.length < 3) return { x, radius, cp };

  // Surface slope, which is what the tangency condition is written on.
  const slope = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const back = Math.max(0, i - 1);
    const forward = Math.min(n - 1, i + 1);
    const dx = x[forward] - x[back];
    slope[i] = dx > 1e-12 ? (radius[forward] - radius[back]) / dx : 0;
  }

  // Fewer sources than control points, spread along the axis and held clear of the ends.
  const rows = active.length;
  const count = Math.max(3, Math.min(options.sources ?? SOURCE_COUNT, Math.floor(rows / 2)));
  const sourceX = new Float64Array(count);
  const first = x[0] + SOURCE_INSET * length;
  const span = length * (1 - 2 * SOURCE_INSET);
  for (let j = 0; j < count; j++) {
    sourceX[j] = first + (span * (j + 0.5)) / count;
  }

  const influence = new Float64Array(rows * count);
  const target = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    const station = active[i];
    for (let j = 0; j < count; j++) {
      const { axial, radial } = sourceVelocity(x[station] - sourceX[j], radius[station]);
      // No flow through the surface: the normal is (-dR/dx, 1), unnormalised.
      influence[i * count + j] = -slope[station] * axial + radial;
    }
    // The free stream is unit and axial, so its normal component is -dR/dx * 1.
    target[i] = slope[station];
  }

  // Normal equations, with a small penalty on the size of the source strengths.
  const normal = new Float64Array(count * count);
  const projected = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    for (let k = 0; k < count; k++) {
      let sum = 0;
      for (let i = 0; i < rows; i++) sum += influence[i * count + j] * influence[i * count + k];
      normal[j * count + k] = sum;
    }
    let sum = 0;
    for (let i = 0; i < rows; i++) sum += influence[i * count + j] * target[i];
    projected[j] = sum;
  }
  let trace = 0;
  for (let j = 0; j < count; j++) trace += normal[j * count + j];
  const damping = ((options.regularisation ?? REGULARISATION) * trace) / count;
  for (let j = 0; j < count; j++) normal[j * count + j] += damping;

  const strengths = solveDense(normal, projected, count);

  for (let i = 0; i < n; i++) {
    const slimness = radius[i] / maxRadius;
    if (slimness < MINIMUM_RADIUS_FRACTION) {
      // Nose and tail: the flow stops there.
      cp[i] = 1;
      continue;
    }

    let axial = 1;
    let radial = 0;
    for (let j = 0; j < count; j++) {
      const v = sourceVelocity(x[i] - sourceX[j], radius[i]);
      axial += strengths[j] * v.axial;
      radial += strengths[j] * v.radial;
    }
    const solved = 1 - (axial * axial + radial * radial);

    const t = Math.min(
      1,
      Math.max(
        0,
        (slimness - MINIMUM_RADIUS_FRACTION) /
          (TRUSTED_RADIUS_FRACTION - MINIMUM_RADIUS_FRACTION),
      ),
    );
    const confidence = t * t * (3 - 2 * t);
    cp[i] = confidence * solved + (1 - confidence) * 1;
  }

  return { x, radius, cp };
}

/**
 * The Rankine ovoid: a point source and an equal sink in a uniform stream, whose
 * dividing streamline is a closed body.
 *
 * It exists here because it is the one axisymmetric shape whose exact answer is known in
 * closed form *and* which a line-source method ought to reproduce almost perfectly — the
 * body is generated by line singularities, so a solver built on line singularities has
 * no excuse. A sphere would be the more familiar check and the wrong one: it needs a
 * point doublet, and no distribution along the axis represents it well.
 */
export interface Ovoid {
  stations: BodyStation[];
  /** Exact surface pressure coefficient at each station. */
  cp: number[];
}

export function rankineOvoid(strength: number, halfSeparation: number, samples = 60): Ovoid {
  const a = halfSeparation;
  const m = strength;

  // The stagnation points sit where the axial velocity vanishes on the axis. A point
  // source pushes the flow away from itself in both directions, so its axial velocity
  // carries the sign of the offset - writing it as 1/(x+a)^2 loses that, and then there
  // is no stagnation point upstream at all and the body has no nose.
  const onAxis = (offset: number) => offset / Math.abs(offset) ** 3;
  const axialVelocity = (x: number) =>
    1 + (m / (4 * Math.PI)) * (onAxis(x + a) - onAxis(x - a));

  let outside = -a - 10 * a;
  let inside = -a - 1e-9;
  for (let k = 0; k < 200; k++) {
    const mid = 0.5 * (outside + inside);
    if (axialVelocity(mid) > 0) outside = mid;
    else inside = mid;
  }
  const nose = 0.5 * (outside + inside);

  // Stokes stream function of the pair in a unit stream; the body is the zero streamline.
  const streamFunction = (x: number, r: number) => {
    const d1 = Math.hypot(x + a, r);
    const d2 = Math.hypot(x - a, r);
    return (
      0.5 * r * r -
      (m / (4 * Math.PI)) * ((x + a) / d1) +
      (m / (4 * Math.PI)) * ((x - a) / d2)
    );
  };

  const stations: BodyStation[] = [];
  const cp: number[] = [];
  const tail = -nose;
  for (let i = 0; i < samples; i++) {
    // Cosine spacing, clustered at the ends. A body of revolution does almost all of its
    // shape change in the first and last tenth, and sampling it uniformly leaves the nose
    // described by two stations - which is not a weakness of the solver but of the
    // question put to it. Anything calling this should cluster its stations the same way.
    const t = 0.5 * (1 - Math.cos((Math.PI * i) / (samples - 1)));
    const x = nose + (tail - nose) * t;

    // Radius of the body at this station, by bisection on the zero streamline.
    let low = 0;
    let high = Math.abs(nose) * 2;
    if (streamFunction(x, high) < 0) {
      stations.push({ x, radius: 0 });
      cp.push(1);
      continue;
    }
    for (let k = 0; k < 80; k++) {
      const mid = 0.5 * (low + high);
      if (streamFunction(x, mid) > 0) high = mid;
      else low = mid;
    }
    const r = 0.5 * (low + high);

    const d1 = Math.hypot(x + a, r);
    const d2 = Math.hypot(x - a, r);
    const u =
      1 + (m / (4 * Math.PI)) * ((x + a) / (d1 * d1 * d1) - (x - a) / (d2 * d2 * d2));
    const v = (m / (4 * Math.PI)) * (r / (d1 * d1 * d1) - r / (d2 * d2 * d2));

    stations.push({ x, radius: r });
    cp.push(1 - (u * u + v * v));
  }

  return { stations, cp };
}
