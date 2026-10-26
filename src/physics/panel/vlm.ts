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
  /**
   * Pitching moment about the reference point, nose-up positive, on the reference area
   * and chord. Zero when no moment reference was given.
   */
  Cm: number;
}

/*
 * HOW THE INDUCED DRAG IS TAKEN, AND WHAT IT IS WORTH.
 *
 * The wake is a sheet of trailing vorticity and the induced drag is the kinetic energy
 * it leaves behind, so the calculation belongs in the Trefftz plane far downstream. It
 * is done there on constant-strength sheet panels, integrated in closed form, rather
 * than on point vortices at the strip edges.
 *
 * That choice is the whole reason the answer converges. A point vortex a distance d away
 * induces a velocity going as 1/d, so lumping a strip's shed vorticity into its edges and
 * evaluating the downwash at the neighbouring strip divides by half a strip width -
 * and refining the lattice shrinks that distance rather than the error. Span efficiency
 * fell steadily under refinement and never settled: a Comet ran 0.995, 0.956, 0.939,
 * 0.918, 0.874, 0.838 at 12 to 60 stations and was still falling, and a 737 MAX whose
 * planform break happened to land beside a grid point reported 0.527 against its
 * near-twin A320neo's 0.845. A sheet has no such term; on itself it induces exactly zero.
 *
 * What it is validated against, in `tests/vlm.test.ts`:
 *
 *   - An elliptical planform converges on the elliptical minimum from above at first
 *     order: 1.1838, 1.0886, 1.0445, 1.0227, 1.0116 over 10 to 160 strips.
 *   - A rectangular planform, whose loading carries a square-root singularity at the
 *     tip that the elliptical one does not, passes below 1 as it must: 1.2126, 1.0872,
 *     1.0255, 0.9902, 0.9672.
 *   - Multi-surface systems reproduce Prandtl's biplane interference. Two identical
 *     wings stacked vertically give an interference factor of 0.955 as the gap closes,
 *     where coincident sheets must behave as a single wing, and 0.006 at two spans
 *     apart, where they must be independent, monotonic throughout.
 *
 * What it is NOT: converged at the station count the application runs. `AERO_STATIONS`
 * trades accuracy for a solve that finishes inside a frame budget, and at that count
 * the first-order error is still worth a few hundredths of span efficiency - enough that
 * several aircraft report slightly more than 1.0, which a planar wing cannot achieve.
 * Values above 1 here are discretisation, not a wing beating the elliptical minimum.
 *
 * One real limitation remains, and it is in the geometry rather than in this file: the
 * wake is rigid. It trails straight downstream from where it is shed instead of rolling
 * up and convecting down, so a tailplane sits wherever the airframe puts it relative to
 * an undeflected wing sheet. In the cross-flow plane that can be a few centimetres, and
 * the mutual interference between two sheets that close is both large and sensitive.
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
  /**
   * How the strips group into lifting surfaces, in strip-index order.
   *
   * The Trefftz calculation needs to know which strips form one continuous wake, because
   * it represents each wake as a sheet rather than as loose filaments and a sheet has to
   * be joined up. Omitted means one surface, which is what every test fixture is.
   */
  groups?: LatticeGroup[];
  /**
   * Where moments are taken about, and the chord they are made dimensionless on.
   *
   * Omitted means the pitching moment is not wanted and is reported as zero, which is
   * what the fixtures that only ask about lift and drag do.
   */
  moment?: { x: number; chord: number };
}

export interface LatticeGroup {
  /** Strips on one side of this surface. */
  stripsPerSide: number;
  /** Whether the surface was built as two mirrored halves. */
  mirrored: boolean;
}

/**
 * Velocity induced in the cross-flow plane by a straight vortex sheet of constant
 * strength, integrated along its length.
 *
 * This is what replaced a pair of point vortices per strip, and the difference is the
 * whole reason the induced drag now converges. A point vortex a distance d away induces
 * a velocity going as 1/d, so evaluating a strip's downwash half a strip width from its
 * own shed vorticity divides by half a strip width - and refining the lattice makes that
 * number smaller, not the error. The span efficiency fell steadily under refinement and
 * never settled.
 *
 * A sheet has no such problem. Integrating the same vorticity along the length it is
 * actually spread over gives, on the sheet itself, a normal velocity of exactly zero and
 * a tangential one of plus or minus half the sheet strength - the familiar jump across a
 * vortex sheet. Both are finite, and the principal value on the sheet is the average of
 * the two sides, which is zero. Nothing is divided by the spacing, so refining the
 * lattice refines the answer.
 *
 *     v = (g / 2pi) [ (1/2) ln(d0/d1) n - (atan(z0/h) - atan((z0-L)/h)) u ]
 *
 * with u along the sheet, n perpendicular to it, z0 and h the along and across distances
 * to the start, and d0, d1 the squared distances to the two ends.
 */
export function sheetVelocity(
  py: number,
  pz: number,
  ay: number,
  az: number,
  by: number,
  bz: number,
  strength: number,
): { vy: number; vz: number } {
  const uy = by - ay;
  const uz = bz - az;
  const length = Math.hypot(uy, uz);
  if (length < 1e-12 || strength === 0) return { vy: 0, vz: 0 };

  const ey = uy / length;
  const ez = uz / length;
  // Normal is the tangent turned a quarter turn, matching the sign of a point vortex.
  const ny = -ez;
  const nz = ey;

  const ry = py - ay;
  const rz = pz - az;
  const along = ry * ey + rz * ez;
  const across = ry * ny + rz * nz;

  const d0 = along * along + across * across;
  const d1 = (along - length) * (along - length) + across * across;
  const logTerm = d0 > 1e-300 && d1 > 1e-300 ? 0.5 * Math.log(d0 / d1) : 0;

  /*
   * On the sheet the tangential term is the jump, and its principal value is zero. Off
   * the sheet - which includes every panel of a winglet relative to the wing it grows
   * from - the arctangents are taken normally.
   */
  let atanTerm = 0;
  if (Math.abs(across) > 1e-9 * Math.max(1, length)) {
    // Plain arctangents, not atan2. The formula is a difference of angles each within a
    // quarter turn; atan2 wraps at the branch cut and turned a far-field sheet into one
    // carrying a whole extra turn of circulation.
    atanTerm = Math.atan(along / across) - Math.atan((along - length) / across);
  }

  const k = strength / (2 * Math.PI);
  return {
    vy: k * (logTerm * ny - atanTerm * ey),
    vz: k * (logTerm * nz - atanTerm * ez),
  };
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
    return { gamma, strips: [], CL: 0, CDi: 0, spanEfficiency: 0, Cm: 0 };
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
   * Pitching moment about the reference point, nose-up positive.
   *
   * Taken per panel rather than per strip, because the whole point of it is WHERE along
   * the chord the load sits: a strip's total circulation says nothing about that, and
   * the difference between a load at the quarter chord and the same load at the three
   * quarter chord is the entire pitching moment.
   *
   * Only the lifting component is carried. The streamwise force has a moment arm too,
   * but it is the induced drag acting over the height of the surface above the centre of
   * gravity - two small numbers multiplied together, against a lift acting over tens of
   * metres of tail arm. Leaving it out keeps this consistent with how `CL` above is
   * taken, which is the thing the trim solution balances it against.
   */
  let moment = 0;
  const momentRef = reference.moment;
  if (momentRef) {
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const panelLift = gamma[i] * panel.width * panel.normal.y;
      // x runs aft, so a load ahead of the reference point pitches the nose up.
      moment += panelLift * (momentRef.x - 0.5 * (panel.a.x + panel.b.x));
    }
  }
  const Cm =
    momentRef && momentRef.chord > 1e-9
      ? (2 * moment) / (speed * reference.area * momentRef.chord)
      : 0;

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
   * The wake, joined up into sheets.
   *
   * Each lifting surface trails one continuous sheet, and the strips have to be walked
   * in the order they are physically joined before it can be built. A mirrored surface
   * is stored as one side's strips followed by the other's, each running root to tip, so
   * the chain across the whole span is the second half reversed and then the first - the
   * same walk the trailing filaments take in `aircraftModel`, for the same reason.
   */
  const groups = reference.groups ?? [{ stripsPerSide: stripCount, mirrored: false }];
  const chains: number[][] = [];
  let base = 0;
  for (const group of groups) {
    const perSide = Math.max(0, Math.round(group.stripsPerSide));
    const chain: number[] = [];
    if (group.mirrored) {
      for (let i = perSide - 1; i >= 0; i--) {
        const index = base + perSide + i;
        if (index < stripCount) chain.push(index);
      }
    }
    for (let i = 0; i < perSide; i++) {
      const index = base + i;
      if (index < stripCount) chain.push(index);
    }
    if (chain.length > 0) chains.push(chain);
    base += perSide * (group.mirrored ? 2 : 1);
  }
  // Anything the groups did not account for is its own chain rather than silently lost.
  for (let i = base; i < stripCount; i++) chains.push([i]);

  /*
   * Sheet panels run between the points where the circulation is known - the strip
   * midpoints - and out to the tips, where it is zero. A panel's sheet strength is the
   * change in circulation across it divided by its length, which is the discrete form of
   * the shed vorticity being minus the gradient of the bound circulation.
   *
   * The downwash is then taken at each panel's OWN midpoint, not at the nodes. That is
   * not a detail: a constant-strength sheet has a logarithmic singularity at its ends, so
   * the nodes are the worst points on the whole wake to ask. Evaluating there gave the
   * elliptical planform a span efficiency of 1.105 - ten per cent below the minimum
   * induced drag, which is a theorem and cannot be beaten. At the panel midpoints the
   * sheet's own contribution is exactly zero and every neighbour's is finite.
   */
  interface SheetPanel {
    midY: number;
    midZ: number;
    ny: number;
    nz: number;
    length: number;
    /** Circulation at the panel's midpoint, which is what the drag integral weights. */
    gamma: number;
    strength: number;
    ay: number;
    az: number;
    by: number;
    bz: number;
  }

  const sheets: SheetPanel[] = [];
  for (const chain of chains) {
    const nodeY: number[] = [innerY[chain[0]]];
    const nodeZ: number[] = [innerZ[chain[0]]];
    const nodeGamma: number[] = [0];
    // Which way is up for this part of the sheet, taken from the strip that made it.
    const nodeUpY: number[] = [normalY[chain[0]]];
    const nodeUpZ: number[] = [normalZ[chain[0]]];
    for (const i of chain) {
      nodeY.push(0.5 * (innerY[i] + outerY[i]));
      nodeZ.push(0.5 * (innerZ[i] + outerZ[i]));
      nodeGamma.push(stripGamma[i]);
      nodeUpY.push(normalY[i]);
      nodeUpZ.push(normalZ[i]);
    }
    const last = chain[chain.length - 1];
    nodeY.push(outerY[last]);
    nodeZ.push(outerZ[last]);
    nodeGamma.push(0);
    nodeUpY.push(normalY[last]);
    nodeUpZ.push(normalZ[last]);

    for (let k = 0; k + 1 < nodeY.length; k++) {
      const uy = nodeY[k + 1] - nodeY[k];
      const uz = nodeZ[k + 1] - nodeZ[k];
      const length = Math.hypot(uy, uz);
      if (length < 1e-12) continue;

      /*
       * The panel's normal is turned to agree with the surface it came from, rather than
       * taken from the direction the chain happens to be walked. Otherwise a surface
       * chained the other way round contributes drag of the opposite sign, which is a
       * sign error waiting for the first aircraft whose geometry walks differently.
       */
      let ny = -uz / length;
      let nz = uy / length;
      const upY = 0.5 * (nodeUpY[k] + nodeUpY[k + 1]);
      const upZ = 0.5 * (nodeUpZ[k] + nodeUpZ[k + 1]);
      if (ny * upY + nz * upZ < 0) {
        ny = -ny;
        nz = -nz;
      }

      sheets.push({
        midY: 0.5 * (nodeY[k] + nodeY[k + 1]),
        midZ: 0.5 * (nodeZ[k] + nodeZ[k + 1]),
        ny,
        nz,
        length,
        gamma: 0.5 * (nodeGamma[k] + nodeGamma[k + 1]),
        strength: (nodeGamma[k + 1] - nodeGamma[k]) / length,
        ay: nodeY[k],
        az: nodeZ[k],
        by: nodeY[k + 1],
        bz: nodeZ[k + 1],
      });
    }
  }

  /*
   * Induced drag is the work the wake's own downwash does on the circulation it carries,
   * integrated over the sheet. Midpoint rule, one point per panel.
   */
  let drag = 0;
  for (const at of sheets) {
    let vy = 0;
    let vz = 0;
    for (const from of sheets) {
      const v = sheetVelocity(at.midY, at.midZ, from.ay, from.az, from.by, from.bz, from.strength);
      vy += v.vy;
      vz += v.vz;
    }
    drag += at.gamma * (vy * at.ny + vz * at.nz) * at.length;
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

  return { gamma, strips, CL, CDi, spanEfficiency, Cm };
}
