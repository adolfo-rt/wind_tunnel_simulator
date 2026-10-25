import { solveDense } from './linear';

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
  /**
   * The two ends of the strip's bound vortex, in full three dimensions, named for the
   * sign of the filament that trails from each.
   *
   * The wake leaves from here: the difference in circulation between neighbouring strips
   * is shed at the edge they share, and a tip vortex has to be put where the tip actually
   * is - which for a canted winglet is nothing like its spanwise station alone.
   *
   * Named by sign rather than by inboard and outboard deliberately. The bound vortex has
   * to run the same way round on both wings or the two halves cancel, so the lattice
   * swaps the ends on the mirrored side; `trailPlus` is therefore the *inboard* end on one
   * wing and the *outboard* end on the other. Calling these inner and outer cost a real
   * bug: the wake walk below trusted the names, and every filament on the left wing came
   * out one edge too far inboard, with the tip vortex a strip short of the tip and a
   * spurious one on the centreline.
   */
  trailPlus: Vec3;
  trailMinus: Vec3;
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
 * Gaussian elimination with partial pivoting, which is what the section and body methods
 * already use. This was Gauss-Seidel, and the change is not because it was giving wrong
 * answers - a direct solve reproduced it to every digit on the whole roster, so it had
 * been converging. It is because it had no way of saying whether it had: the loop ran to
 * its cap and returned whatever it had reached, with nothing to tell a caller apart from
 * a converged answer and an abandoned one. At a few hundred panels, built once per
 * aircraft, a direct solve costs milliseconds and cannot fail quietly.
 *
 * Worth recording that this was changed while chasing a span efficiency of 0.0002, on the
 * theory that the iteration had diverged. It had not. The fault was a missing core radius
 * in the Trefftz sum below, and the only thing that found it was trying the direct solve
 * and watching the bad number come back unchanged.
 */
export function solveLattice(
  panels: LatticePanel[],
  reference: LatticeReference,
): LatticeResult {
  const n = panels.length;
  const gamma = new Float64Array(n);
  if (n === 0) {
    return { gamma, strips: [], CL: 0, CDi: 0, spanEfficiency: 0 };
  }

  const stream = reference.stream;

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

  const solved = solveDense(a, rhs, n);
  gamma.set(solved);

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
  const innerX = new Float64Array(stripCount);
  const innerY = new Float64Array(stripCount);
  const innerZ = new Float64Array(stripCount);
  const outerX = new Float64Array(stripCount);
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
    innerX[panel.strip] = panel.a.x;
    innerY[panel.strip] = panel.a.y;
    innerZ[panel.strip] = panel.a.z;
    outerX[panel.strip] = panel.b.x;
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
  /*
   * A core radius, because the Trefftz plane has no x in it.
   *
   * Two filaments at the same height and spanwise station are coincident here however
   * many metres apart they are along the aircraft - which is correct, since the plane is
   * infinitely far downstream, and ruinous without a core. A tailplane strip landing on
   * top of a wing strip produced an induced velocity limited only by how nearly they
   * coincided: an A380 at zero twist came back with an induced drag coefficient of 107
   * and a span efficiency of 0.0002, an A340 with 0.62 where its neighbours gave 1.01.
   * Both looked like aerodynamics and were a division by very nearly nothing.
   *
   * Sized to the strips rather than picked: a quarter of the mean strip width is well
   * inside the spacing the lattice can resolve, so it cannot blunt a real gradient, and
   * it is far larger than the accidental near-coincidences it exists to survive. This is
   * the same lesson as the wake filaments in stage 6, which needed a core for the same
   * reason and got one; this sum was left singular.
   */
  let meanWidth = 0;
  for (let i = 0; i < stripCount; i++) meanWidth += stripWidth[i];
  meanWidth = stripCount > 0 ? meanWidth / stripCount : 0;
  const coreSq = Math.pow(0.25 * meanWidth, 2);

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
        const rsq = dy * dy + dz * dz + coreSq;
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
      trailPlus: { x: innerX[s], y: innerY[s], z: innerZ[s] },
      trailMinus: { x: outerX[s], y: outerY[s], z: outerZ[s] },
    });
  }

  return { gamma, strips, CL, CDi, spanEfficiency };
}
