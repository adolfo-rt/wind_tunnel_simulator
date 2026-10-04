import type { AirfoilPoint } from '../../aircraft/airfoil';
import { solveDense } from './linear';

/**
 * A two-dimensional panel method for an airfoil section.
 *
 * The vortex lattice says how hard each section of the wing is working. This says what
 * that looks like on the skin: where the suction peak sits, how sharp it is, how far aft
 * the recovery runs. That is the part of the picture that answers the project's actual
 * question, because the difference between a 1950s peaky section and a supercritical one
 * is a redistribution of exactly this curve.
 *
 * The method is Hess–Smith: the contour is covered with constant-strength source panels
 * that give it thickness, plus one constant-strength vortex over the whole surface that
 * gives it circulation, with the Kutta condition at the trailing edge picking the
 * circulation that makes the flow leave smoothly. It is the oldest computational
 * aerodynamics there is, and for attached subsonic flow over a section it is still
 * accurate to a few percent.
 *
 * ## The two-solve trick
 *
 * The system is linear in the free-stream direction, so a section is solved exactly twice
 * — once for a stream along x, once along y — and every angle of attack after that is
 * `cos(a)` of the first plus `sin(a)` of the second. No iteration, no re-solve when the
 * lift changes. That is what makes it affordable to do this for every spanwise station on
 * every surface of an aircraft, and it is exact rather than an approximation: the
 * combination is of the solutions, not of the angles.
 *
 * ## What it does not know
 *
 * No viscosity, so no boundary layer, no separation and no stall: push the lift high
 * enough and it will report a suction peak a real section could never hold. No
 * compressibility either, so the shock that forms on a swept wing near its cruise Mach is
 * absent — which matters, because delaying that shock is precisely what the supercritical
 * section was invented to do. What the picture shows is the pressure distribution that
 * makes the shock more or less likely, not the shock.
 */

export interface SectionSolution {
  /** Chordwise position of each panel's midpoint, 0 at the leading edge and 1 at the trailing. */
  x: Float64Array;
  /** Height of each panel's midpoint, as a fraction of chord. */
  y: Float64Array;
  /** True where the panel is on the upper surface. */
  upper: boolean[];
  /** Surface velocity per panel for a unit free stream along x, and along y. */
  tangentialX: Float64Array;
  tangentialY: Float64Array;
  /** Section lift coefficient for those same two unit free streams. */
  liftX: number;
  liftY: number;
}

/**
 * Clean up a contour before it is panelled: drop repeated points, close the loop once,
 * and make it run clockwise.
 *
 * Both steps were found the hard way. A closed trailing edge puts the last upper point
 * and the last lower point at the same place, but only to within rounding - they differ
 * in the last bit - so an equality test misses it and leaves a zero-length panel. That
 * panel influences nothing, which makes its column in the matrix all zeros, which makes
 * the whole system singular; the solve returned a symmetric section generating a lift
 * coefficient of eight.
 *
 * The direction matters because the panel frame's own "up" is the tangent turned a
 * quarter turn, and that points out of the section only if the contour runs clockwise.
 * On a counter-clockwise one it points inwards, and then the half-strength a source
 * induces on its own panel is applied to the wrong side.
 */
function prepareContour(contour: AirfoilPoint[]): AirfoilPoint[] {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of contour) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  const tolerance = Math.max(maxX - minX, 1e-12) * 1e-7;

  const points: AirfoilPoint[] = [];
  for (const p of contour) {
    const previous = points[points.length - 1];
    if (previous && Math.hypot(p.x - previous.x, p.y - previous.y) <= tolerance) continue;
    points.push({ x: p.x, y: p.y });
  }
  while (
    points.length > 1 &&
    Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) <=
      tolerance
  ) {
    points.pop();
  }

  let twiceArea = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  if (twiceArea > 0) points.reverse();

  // Start at the trailing edge, so that the first and last panels are the two that meet
  // there and the Kutta condition has the right pair to work on. Reversing the contour
  // moves the trailing edge to the far end, and applying the condition to panel zero
  // regardless gave a symmetric section lift at zero incidence - a quiet, plausible
  // wrongness of about a degree of built-in camber that was not there.
  let trailing = 0;
  for (let i = 1; i < points.length; i++) if (points[i].x > points[trailing].x) trailing = i;
  if (trailing !== 0) points.push(...points.splice(0, trailing));
  return points;
}

/**
 * Velocity at `p` induced by a unit-strength constant source panel, in the panel's own
 * frame: the panel runs from the origin to (length, 0).
 *
 * The vortex panel's field is this one rotated a quarter turn — (u, v) becomes (v, -u) —
 * which is worth knowing because it halves the geometry and removes the second place a
 * sign can go wrong.
 */
function sourcePanelVelocity(px: number, py: number, length: number): { u: number; v: number } {
  const r1sq = px * px + py * py;
  const r2sq = (px - length) * (px - length) + py * py;
  const u = (1 / (4 * Math.PI)) * Math.log(r1sq / r2sq);
  const v = (1 / (2 * Math.PI)) * (Math.atan2(py, px - length) - Math.atan2(py, px));
  return { u, v };
}

/**
 * Build and solve the section.
 *
 * The contour must be closed and run from the trailing edge forward along one surface and
 * back along the other, which is what `generateAirfoil` produces.
 */
export function solveSection(contour: AirfoilPoint[]): SectionSolution {
  const points = prepareContour(contour);
  const n = points.length;

  const midX = new Float64Array(n);
  const midY = new Float64Array(n);
  const sinTheta = new Float64Array(n);
  const cosTheta = new Float64Array(n);
  const lengths = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const s = Math.hypot(dx, dy);
    lengths[i] = s;
    cosTheta[i] = s > 0 ? dx / s : 1;
    sinTheta[i] = s > 0 ? dy / s : 0;
    midX[i] = 0.5 * (a.x + b.x);
    midY[i] = 0.5 * (a.y + b.y);
  }

  // The panel frame's own "up" is the tangent turned a quarter turn. Whether that points
  // out of the section or into it depends on which way round the contour runs, and the
  // tests settle it rather than this comment: a symmetric section at no incidence must
  // come out with no lift and a stagnation point of exactly Cp = 1 on its nose.
  const normalX = new Float64Array(n);
  const normalY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    normalX[i] = -sinTheta[i];
    normalY[i] = cosTheta[i];
  }

  // Unknowns: one source strength per panel, plus a single vortex strength shared by all
  // of them. The extra equation is the Kutta condition.
  const size = n + 1;
  const matrix = new Float64Array(size * size);
  const rhsX = new Float64Array(size);
  const rhsY = new Float64Array(size);

  // Tangential influence is kept as well as normal, because the Kutta condition is
  // written on it and so is the surface speed the pressure comes from.
  const tangentSource = new Float64Array(n * n);
  const tangentVortex = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    let vortexNormal = 0;
    let vortexTangent = 0;

    for (let j = 0; j < n; j++) {
      let sourceNormal: number;
      let sourceTangent: number;
      let vortexNormalJ: number;
      let vortexTangentJ: number;

      if (i === j) {
        // On its own panel a source pushes straight out at half strength and induces no
        // flow along itself; the vortex does the opposite.
        sourceNormal = 0.5;
        sourceTangent = 0;
        vortexNormalJ = 0;
        vortexTangentJ = 0.5;
      } else {
        // Control point in panel j's frame.
        const dx = midX[i] - points[j].x;
        const dy = midY[i] - points[j].y;
        const px = dx * cosTheta[j] + dy * sinTheta[j];
        const py = -dx * sinTheta[j] + dy * cosTheta[j];
        const { u, v } = sourcePanelVelocity(px, py, lengths[j]);

        // Back to global, for the source and for the vortex, which is the same field
        // turned a quarter turn.
        const su = u * cosTheta[j] - v * sinTheta[j];
        const sv = u * sinTheta[j] + v * cosTheta[j];
        const vu = v * cosTheta[j] + u * sinTheta[j];
        const vv = v * sinTheta[j] - u * cosTheta[j];

        sourceNormal = su * normalX[i] + sv * normalY[i];
        sourceTangent = su * cosTheta[i] + sv * sinTheta[i];
        vortexNormalJ = vu * normalX[i] + vv * normalY[i];
        vortexTangentJ = vu * cosTheta[i] + vv * sinTheta[i];
      }

      matrix[i * size + j] = sourceNormal;
      tangentSource[i * n + j] = sourceTangent;
      vortexNormal += vortexNormalJ;
      vortexTangent += vortexTangentJ;
    }

    matrix[i * size + n] = vortexNormal;
    tangentVortex[i] = vortexTangent;

    // Flow tangency: the free stream's normal component has to be cancelled.
    rhsX[i] = -normalX[i];
    rhsY[i] = -normalY[i];
  }

  // Kutta: the flow leaves the trailing edge smoothly, so the surface speeds on the two
  // panels either side of it are equal and opposite along the contour.
  const first = 0;
  const last = n - 1;
  for (let j = 0; j < n; j++) {
    matrix[n * size + j] = tangentSource[first * n + j] + tangentSource[last * n + j];
  }
  matrix[n * size + n] = tangentVortex[first] + tangentVortex[last];
  rhsX[n] = -(cosTheta[first] + cosTheta[last]);
  rhsY[n] = -(sinTheta[first] + sinTheta[last]);

  const solutionX = solveDense(matrix, rhsX, size);
  const solutionY = solveDense(matrix, rhsY, size);

  const perimeter = lengths.reduce((sum, s) => sum + s, 0);
  const tangentialX = new Float64Array(n);
  const tangentialY = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    let tx = cosTheta[i];
    let ty = sinTheta[i];
    for (let j = 0; j < n; j++) {
      tx += tangentSource[i * n + j] * solutionX[j];
      ty += tangentSource[i * n + j] * solutionY[j];
    }
    tangentialX[i] = tx + tangentVortex[i] * solutionX[n];
    tangentialY[i] = ty + tangentVortex[i] * solutionY[n];
  }

  // Lift from circulation rather than from integrating the pressure. Circulation is a
  // direct unknown of the solve, so lift stays exactly linear in the free-stream
  // direction, which is what lets any angle of attack be a combination of these two.
  // The tests check it against the pressure integral, which has no reason to agree
  // unless both are right.
  const chord = chordOf(points);
  const liftX = (2 * solutionX[n] * perimeter) / chord;
  const liftY = (2 * solutionY[n] * perimeter) / chord;

  const leadingEdge = points.reduce((best, p) => (p.x < best ? p.x : best), Infinity);
  const upper: boolean[] = [];
  for (let i = 0; i < n; i++) {
    // Which surface a panel is on, by where it sits relative to the chord line.
    upper.push(midY[i] >= camberAt(points, midX[i], leadingEdge));
  }

  return { x: midX, y: midY, upper, tangentialX, tangentialY, liftX, liftY };
}

function chordOf(points: AirfoilPoint[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.x < min) min = p.x;
    if (p.x > max) max = p.x;
  }
  return max - min;
}

/** Mean of the two surfaces at a chordwise station, used only to label upper and lower. */
function camberAt(points: AirfoilPoint[], x: number, leadingEdge: number): number {
  let above = -Infinity;
  let below = Infinity;
  for (const p of points) {
    if (Math.abs(p.x - x) > 0.08 && p.x > leadingEdge + 1e-9) continue;
    if (p.y > above) above = p.y;
    if (p.y < below) below = p.y;
  }
  if (above === -Infinity || below === Infinity) return 0;
  return 0.5 * (above + below);
}

/**
 * The angle of attack at which this section carries the lift the wing is asking of it.
 *
 * Exact rather than iterated: lift is `cos(a) * liftX + sin(a) * liftY`, which is a
 * single sinusoid, so inverting it is one arcsine. Returns the smaller of the two roots,
 * which is the one on the right side of the stall the model cannot see.
 */
export function angleForLift(solution: SectionSolution, targetCl: number): number {
  const amplitude = Math.hypot(solution.liftX, solution.liftY);
  if (amplitude < 1e-12) return 0;
  const phase = Math.atan2(solution.liftX, solution.liftY);
  const ratio = Math.max(-1, Math.min(1, targetCl / amplitude));
  return Math.asin(ratio) - phase;
}

/** Surface pressure coefficient at every panel, at a given angle of attack. */
export function sectionPressures(solution: SectionSolution, angle: number): Float64Array {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cp = new Float64Array(solution.x.length);
  for (let i = 0; i < cp.length; i++) {
    const speed = cos * solution.tangentialX[i] + sin * solution.tangentialY[i];
    cp[i] = 1 - speed * speed;
  }
  return cp;
}

/** Section lift coefficient at a given angle of attack. */
export function sectionLift(solution: SectionSolution, angle: number): number {
  return Math.cos(angle) * solution.liftX + Math.sin(angle) * solution.liftY;
}

/**
 * Lift found by integrating the surface pressure instead, which is a genuinely separate
 * route to the same number: circulation is an unknown of the solve, pressure is what
 * comes out of it. Used by the tests, and by stage 8 where forces are wanted on the
 * actual geometry rather than per unit span.
 */
export function liftFromPressure(solution: SectionSolution, angle: number): number {
  const cp = sectionPressures(solution, angle);
  const n = cp.length;
  let fx = 0;
  let fy = 0;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const dx = solution.x[next] - solution.x[i];
    const dy = solution.y[next] - solution.y[i];
    // Pressure acts inwards along the outward normal, which for this clockwise contour
    // is the panel vector turned a quarter turn: (-dy, dx).
    fx += cp[i] * dy;
    fy -= cp[i] * dx;
  }
  return -fx * Math.sin(angle) + fy * Math.cos(angle);
}
