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

/**
 * KNOWN LIMITATION: the induced drag below is not grid converged.
 *
 * Span efficiency should settle as the lattice is refined and does not. On a Comet's wing
 * alone - no tip device, no tailplane, nothing exotic - it runs 0.995, 0.956, 0.939,
 * 0.918, 0.874, 0.838 at 12, 18, 24, 32, 44 and 60 spanwise stations, and is still
 * falling. Every aircraft in the roster behaves the same way.
 *
 * The validation in `tests/vlm.test.ts` passes and is not wrong: on a clean elliptical
 * planform the same code converges onto the elliptical minimum at first order, 1.0953 to
 * 1.0019 over 10 to 320 strips. Whatever this is, it is not present there.
 *
 * Four things have been ruled out, each by measurement:
 *
 *   - The linear solve. Gauss-Seidel was replaced by a direct factorisation and returned
 *     the same numbers to every digit.
 *   - Singular kernels. Both the Trefftz sum and the horseshoe filaments were given core
 *     radii. They fixed real bugs - see below and in `aircraftModel` - and changed the
 *     numbers, but the drift with refinement is unaffected by the core size.
 *   - Cosine spanwise spacing, the usual answer to a loading that is singular at the tip.
 *     It made matters worse: at 18 stations a 737 MAX returned a NEGATIVE induced drag.
 *   - Richardson extrapolation, on the hypothesis that the error is cleanly first order.
 *     It is not: extrapolating a Comet from 12/24, 16/32, 20/40 and 26/52 gives 0.889,
 *     0.870, 0.829 and 0.794, which is the same drift one level up.
 *
 * What it means downstream: induced drag is about a third of cruise drag, so a span
 * efficiency uncertain by 0.1 moves a lift-to-drag ratio by roughly five per cent. The
 * fuel-per-seat trend across the roster survives that comfortably; a single aircraft's
 * figure does not, and the 737 MAX returning 0.527 against its near-twin A320neo's 0.845
 * is the proof - an artefact, not a difference between the aeroplanes.
 *
 * Still the best guess, now with the easy explanations gone: the Trefftz sum treats each
 * strip's wake as two point vortices at its edges and evaluates the downwash at strip
 * midpoints. That is a midpoint rule on an integrand that is singular where the strips
 * meet, and refining the strips refines the singularity along with everything else. The
 * classical formulations - Multhopp's, or a Glauert series in the Trefftz plane - avoid
 * it by solving for the loading in a basis that already carries the tip behaviour, rather
 * than by sampling a loading that does not.
 */
const FOUR_PI = 4 * Math.PI;

/**
 * Filament core radius, as a fraction of the span.
 *
 * Of the span rather than of the panel width, which was the first attempt. The lattice
 * takes its station count from the aircraft's visual detail level, so a core measured in
 * panels changes size when the quality setting changes - and at low detail it grew enough
 * to lift a 777's tip section above its root, which washout makes impossible. An
 * aerodynamic answer must not move when a rendering setting does.
 *
 * Five ten-thousandths of the span is about three centimetres on a widebody: four
 * hundredths of a panel width even at low detail, so it cannot redistribute loading, and
 * far more than the distance a control point ever accidentally lands from another
 * surface's trailing leg.
 */
const CORE_SPAN_FRACTION = 5e-4;

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
export function filamentVelocity(p: Vec3, a: Vec3, b: Vec3, core = 0): Vec3 {
  const r1 = sub(p, a);
  const r2 = sub(p, b);
  const r0 = sub(b, a);

  const c = cross(r1, r2);
  const l1 = length(r1);
  const l2 = length(r2);
  // |r1 x r2| is the segment's length times the perpendicular distance to its line, so
  // the core enters scaled by that length - the same regularisation the trailing wake
  // filaments use in `wakeField`, written for a segment.
  const cc = dot(c, c) + dot(r0, r0) * core * core;
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
export function horseshoeVelocity(
  p: Vec3,
  panel: LatticePanel,
  stream: Vec3,
  core = 0,
): Vec3 {
  const far = {
    x: (stream.x * WAKE_LENGTH) / length(stream),
    y: (stream.y * WAKE_LENGTH) / length(stream),
    z: (stream.z * WAKE_LENGTH) / length(stream),
  };
  const aFar = { x: panel.a.x + far.x, y: panel.a.y + far.y, z: panel.a.z + far.z };
  const bFar = { x: panel.b.x + far.x, y: panel.b.y + far.y, z: panel.b.z + far.z };

  const v1 = filamentVelocity(p, bFar, panel.b, core);
  const v2 = filamentVelocity(p, panel.b, panel.a, core);
  const v3 = filamentVelocity(p, panel.a, aFar, core);
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
 * theory that the iteration had diverged. It had not: the direct solve returned the same
 * bad number to every digit, which is how that theory died.
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

  /*
   * A core radius on the filaments, sized to the lattice.
   *
   * Each horseshoe trails two legs ten kilometres downstream, which on a whole aircraft
   * means every wing panel's wake runs straight through the tailplane and the fin. A
   * control point landing near one of those lines divides by the distance to it, and
   * nothing but luck keeps that distance sensible. An A380 was the aircraft where the
   * luck ran out: its lift coefficient went from 0.56 at two and a half degrees to 0.92
   * at four, and a vortex lattice is affine in angle, so that was arithmetic rather than
   * aerodynamics. The span efficiencies it produced - 0.0002 at one setting, 0.07 at
   * another - were the same thing further along.
   *
   * Sized to the span, so it is the same physical length whatever resolution the lattice
   * is run at. Small enough to leave the validated elliptical and rectangular planforms
   * alone and to leave the span loading where it was; large enough to survive one
   * surface's wake passing through another's control points.
   */
  const core = CORE_SPAN_FRACTION * Math.abs(reference.span);

  // Influence of each panel's unit horseshoe on each control point, normal component.
  const a = new Float64Array(n * n);
  const rhs = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = horseshoeVelocity(panels[i].control, panels[j], stream, core);
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
   * A core radius, because the Trefftz plane has no streamwise coordinate in it.
   *
   * Two filaments at the same height and spanwise station are coincident here however
   * many metres apart they are along the aircraft - correct, since the plane sits
   * infinitely far downstream, and singular without a core. The guard this replaces
   * caught exact coincidence only, which is the one case that never happens.
   *
   * Deliberately tiny, and that is the whole difficulty. A core large enough to be felt
   * blunts the wing's own spanwise gradient and flatters the answer: at a quarter of a
   * strip width the validated elliptical planform came out at e = 1.045 and a rectangular
   * one at 1.021, which is impossible - no planar wing beats elliptical. Induced drag is
   * a singular integral and regularising it changes the result, so the only safe core is
   * one small enough to leave the physics alone. At a fiftieth of a strip width the
   * elliptical and rectangular checks both pass unchanged, and a filament landing a
   * micrometre from another still divides by something.
   *
   * It is not a fix for anything. It was added while chasing an A380 that returned a span
   * efficiency of 0.0002, and the A380 still does - see the note in `aircraftModel`.
   */
  let meanWidth = 0;
  for (let i = 0; i < stripCount; i++) meanWidth += stripWidth[i];
  meanWidth = stripCount > 0 ? meanWidth / stripCount : 0;
  const coreSq = Math.pow(0.02 * meanWidth, 2);

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
