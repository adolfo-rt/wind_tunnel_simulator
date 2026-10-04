/**
 * Vortex-lattice method.
 *
 * The grid solver cannot give a surface pressure. A 737's wing is thinner than one of
 * its cells, and a no-slip wall on a body that size grows a numerical shear layer metres
 * thick that buries the pressure signal entirely — measured, and it gets worse as the
 * grid is refined. Surface pressure is a surface quantity and needs a surface method.
 *
 * This is that method, and it is the one the aeroplanes in the roster were actually
 * designed with. A lifting surface is represented by its mean camber surface, covered
 * with horseshoe vortices whose strengths are chosen so that no air flows through it.
 * What comes out is the spanwise distribution of circulation, and from that the lift,
 * the induced drag, and the local section lift coefficient that the chordwise pressure
 * distribution is then built on.
 *
 * It is inviscid, incompressible and linear: no boundary layer, no separation, no shock.
 * For attached flow on a slender wing at a small angle — which is cruise — those are the
 * right assumptions, and they are why the method survived into the era of real CFD for
 * preliminary design. Where it breaks is exactly where the grid solver is useful: the
 * stalled, separated, wake-dominated flow the streamlines show.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LatticePanel {
  /** Ends of the bound vortex, which lies on the panel's quarter-chord line. */
  a: Vec3;
  b: Vec3;
  /** Where the no-through-flow condition is applied: three-quarter chord, mid-span. */
  control: Vec3;
  /** Camber-surface normal at the control point. */
  normal: Vec3;
  /** Spanwise strip this panel belongs to. */
  strip: number;
  /** Width of the panel measured along the span. */
  width: number;
  /** Chord of the section this panel sits on, which turns circulation into a coefficient. */
  chord: number;
}

export interface LatticeStrip {
  /** Spanwise station of the strip's midpoint, along the lifting surface's span axis. */
  y: number;
  chord: number;
  /** Lift coefficient of this section, which sets its chordwise pressure distribution. */
  cl: number;
  /** Circulation shed by the whole strip. */
  gamma: number;
}

export interface LatticeResult {
  gamma: Float64Array;
  strips: LatticeStrip[];
  /** Lift coefficient on the reference area. */
  CL: number;
  /** Induced drag coefficient, from the Trefftz plane. */
  CDi: number;
  /** Span efficiency: 1 for elliptical loading, less for anything else. */
  spanEfficiency: number;
}

const FOUR_PI = 4 * Math.PI;

/** How far downstream a trailing leg runs before it is treated as infinite. */
const WAKE_LENGTH = 1e4;

function sub(p: Vec3, q: Vec3): Vec3 {
  return { x: p.x - q.x, y: p.y - q.y, z: p.z - q.z };
}

function cross(p: Vec3, q: Vec3): Vec3 {
  return {
    x: p.y * q.z - p.z * q.y,
    y: p.z * q.x - p.x * q.z,
    z: p.x * q.y - p.y * q.x,
  };
}

function dot(p: Vec3, q: Vec3): number {
  return p.x * q.x + p.y * q.y + p.z * q.z;
}

function length(p: Vec3): number {
  return Math.hypot(p.x, p.y, p.z);
}

/**
 * Velocity at `p` induced by a straight vortex filament from `a` to `b`, per unit
 * circulation. Biot–Savart, integrated along the segment.
 *
 * The guard is not decoration: a control point lies on the bound vortex of its own
 * panel's neighbours often enough that an unguarded evaluation returns infinities and
 * the whole solve becomes NaN.
 */
export function filamentVelocity(p: Vec3, a: Vec3, b: Vec3): Vec3 {
  const r1 = sub(p, a);
  const r2 = sub(p, b);
  const r0 = sub(b, a);

  const c = cross(r1, r2);
  const cc = dot(c, c);
  const l1 = length(r1);
  const l2 = length(r2);
  if (cc < 1e-12 || l1 < 1e-9 || l2 < 1e-9) return { x: 0, y: 0, z: 0 };

  const k = (dot(r0, r1) / l1 - dot(r0, r2) / l2) / (FOUR_PI * cc);
  return { x: c.x * k, y: c.y * k, z: c.z * k };
}

/**
 * Velocity induced by one horseshoe, per unit circulation.
 *
 * The filament runs in from downstream along the leg at `b`, forward across the bound
 * segment to `a`, and back out downstream — that is, from the outboard end to the
 * inboard one, which is the reverse of how a caller naturally lists the two ends.
 *
 * That direction is the whole sign convention and it is worth stating plainly. Lift is
 * rho * V x Gamma. With the stream along +x, lift along +y and the span along +z, a
 * circulation vector pointing along +z gives x cross z, which is -y: a wing that pushes
 * itself into the ground. Running the filament the other way makes positive circulation
 * mean positive lift, which is what every formula downstream assumes. Written the
 * natural way round first, and every test in the suite failed in the same direction.
 *
 * The trailing legs are long finite filaments rather than a separate semi-infinite
 * formula: two extra evaluations, and a whole class of sign error removed.
 */
export function horseshoeVelocity(p: Vec3, panel: LatticePanel, stream: Vec3): Vec3 {
  const far = {
    x: (stream.x * WAKE_LENGTH) / length(stream),
    y: (stream.y * WAKE_LENGTH) / length(stream),
    z: (stream.z * WAKE_LENGTH) / length(stream),
  };
  const aFar = { x: panel.a.x + far.x, y: panel.a.y + far.y, z: panel.a.z + far.z };
  const bFar = { x: panel.b.x + far.x, y: panel.b.y + far.y, z: panel.b.z + far.z };

  const v1 = filamentVelocity(p, bFar, panel.b);
  const v2 = filamentVelocity(p, panel.b, panel.a);
  const v3 = filamentVelocity(p, panel.a, aFar);
  return {
    x: v1.x + v2.x + v3.x,
    y: v1.y + v2.y + v3.y,
    z: v1.z + v2.z + v3.z,
  };
}

export interface LatticeReference {
  /** Area the coefficients are taken on. */
  area: number;
  /** Full span, tip to tip. */
  span: number;
  /** Free-stream speed. The answer is a coefficient, so only the direction matters. */
  stream: Vec3;
}

/**
 * Solve for the circulation that makes the camber surface a streamline.
 *
 * Gauss–Seidel rather than a factorisation: the matrix is diagonally dominant for a
 * sensible lattice, a few hundred sweeps converge to far better than the model's own
 * accuracy, and it needs no pivoting and no library.
 */
export function solveLattice(
  panels: LatticePanel[],
  reference: LatticeReference,
  iterations = 400,
): LatticeResult {
  const n = panels.length;
  const gamma = new Float64Array(n);
  if (n === 0) {
    return { gamma, strips: [], CL: 0, CDi: 0, spanEfficiency: 0 };
  }

  const stream = reference.stream;
  const speed = length(stream);

  // Influence of each panel's unit horseshoe on each control point, normal component.
  const a = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = horseshoeVelocity(panels[i].control, panels[j], stream);
      a[i * n + j] = dot(v, panels[i].normal);
    }
    rhs[i] = -dot(stream, panels[i].normal);
  }

  for (let sweep = 0; sweep < iterations; sweep++) {
    let change = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) if (j !== i) sum += a[i * n + j] * gamma[j];
      const diagonal = a[i * n + i];
      if (Math.abs(diagonal) < 1e-12) continue;
      const next = (rhs[i] - sum) / diagonal;
      change = Math.max(change, Math.abs(next - gamma[i]));
      gamma[i] = next;
    }
    if (change < 1e-10 * speed) break;
  }

  return summarise(panels, gamma, reference);
}

/**
 * Lift from Kutta–Joukowski on each bound segment, induced drag from the Trefftz plane.
 *
 * Trefftz rather than summing the downwash at the lattice itself: the near-field sum is
 * notoriously sensitive to how the panels are laid out, and the far-field one recovers
 * the elliptical-wing result to better than a percent on a lattice this coarse. The test
 * suite holds it to that.
 */
function summarise(
  panels: LatticePanel[],
  gamma: Float64Array,
  reference: LatticeReference,
): LatticeResult {
  const speed = length(reference.stream);
  const stripCount = panels.reduce((most, p) => Math.max(most, p.strip + 1), 0);

  const stripGamma = new Float64Array(stripCount);
  const stripWidth = new Float64Array(stripCount);
  const stripChord = new Float64Array(stripCount);
  // Where the wake leaves, and which way the strip faces, both in the cross-flow plane.
  const innerY = new Float64Array(stripCount);
  const innerZ = new Float64Array(stripCount);
  const outerY = new Float64Array(stripCount);
  const outerZ = new Float64Array(stripCount);
  const normalY = new Float64Array(stripCount);
  const normalZ = new Float64Array(stripCount);

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];
    stripGamma[panel.strip] += gamma[i];
    // The last chordwise panel of a strip is the one nearest the trailing edge, which is
    // where the wake actually leaves.
    stripWidth[panel.strip] = panel.width;
    stripChord[panel.strip] = panel.chord;
    innerY[panel.strip] = panel.a.y;
    innerZ[panel.strip] = panel.a.z;
    outerY[panel.strip] = panel.b.y;
    outerZ[panel.strip] = panel.b.z;
    normalY[panel.strip] = panel.normal.y;
    normalZ[panel.strip] = panel.normal.z;
  }

  // Lift, from Kutta-Joukowski on each bound segment. Only the component that lifts
  // counts: a near-vertical winglet carries circulation and almost no lift, which is
  // exactly what distinguishes it from more span.
  let lift = 0;
  for (let s = 0; s < stripCount; s++) lift += stripGamma[s] * stripWidth[s] * normalY[s];
  const CL = (2 * lift) / (speed * reference.area);

  /*
   * Induced drag from the Trefftz plane, treated properly as two-dimensional.
   *
   * The wake is a sheet of trailing vorticity, and the drag is the kinetic energy it
   * leaves behind. Summing that along the span alone is right for one flat wing and
   * wrong the moment anything leaves the plane: a winglet rises out of it, and a
   * tailplane sits above or below it. Done in span only, a 747 came out with a span
   * efficiency of 0.14 and an MD-80 with negative induced drag.
   *
   * A trailing filament along +x at cross-flow position (y0, z0) induces
   * (0, -dz, dy) * Gamma / (2*pi*r^2) at (y, z). Each strip sheds +Gamma where its wake
   * leaves the inboard edge and -Gamma at the outboard one.
   */
  let drag = 0;
  for (let i = 0; i < stripCount; i++) {
    const y = 0.5 * (innerY[i] + outerY[i]);
    const z = 0.5 * (innerZ[i] + outerZ[i]);
    let vy = 0;
    let vz = 0;
    for (let j = 0; j < stripCount; j++) {
      const edges: Array<[number, number, number]> = [
        [innerY[j], innerZ[j], stripGamma[j]],
        [outerY[j], outerZ[j], -stripGamma[j]],
      ];
      for (const [ey, ez, strength] of edges) {
        const dy = y - ey;
        const dz = z - ez;
        const rsq = dy * dy + dz * dz;
        if (rsq < 1e-12) continue;
        vy += (strength * -dz) / (2 * Math.PI * rsq);
        vz += (strength * dy) / (2 * Math.PI * rsq);
      }
    }
    const inflow = vy * normalY[i] + vz * normalZ[i];
    drag += stripGamma[i] * inflow * stripWidth[i];
  }
  const CDi = -drag / (speed * speed * reference.area);

  const aspectRatio = (reference.span * reference.span) / reference.area;
  const spanEfficiency =
    Math.abs(CDi) > 1e-12 ? (CL * CL) / (Math.PI * aspectRatio * CDi) : 0;

  const strips: LatticeStrip[] = [];
  for (let s = 0; s < stripCount; s++) {
    // Section lift coefficient: the strip's circulation turned into a coefficient on its
    // own chord. This is what says how hard each section is working, and so what its
    // chordwise pressure distribution has to look like.
    const chord = stripChord[s];
    strips.push({
      y: 0.5 * (innerZ[s] + outerZ[s]),
      chord,
      cl: chord > 1e-9 ? (2 * stripGamma[s]) / (speed * chord) : 0,
      gamma: stripGamma[s],
    });
  }

  return { gamma, strips, CL, CDi, spanEfficiency };
}
