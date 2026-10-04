import { generateAirfoil } from '../../aircraft/airfoil';
import { chordAt, liftingSurfaceFrames, type LiftingSurfaceParams } from '../../aircraft/build/wing';
import {
  angleForLift,
  sectionPressures,
  solveSection,
  type SectionSolution,
} from './airfoilPanels';
import { solveBodyOfRevolution, type BodySolution, type BodyStation } from './bodyOfRevolution';
import { solveLattice, type LatticePanel, type LatticeResult } from './vlm';

/**
 * The whole aircraft, as a panel model.
 *
 * Three solvers, each doing the part it is good at. The vortex lattice works out how the
 * lift is shared along the span, which is where sweep, taper, twist and tip devices make
 * their difference. Each spanwise station then gets a two-dimensional section solve at
 * the lift the lattice gave it, which is where the airfoil family makes its difference.
 * The fuselage and nacelles are bodies of revolution.
 *
 * Everything comes from the same `LiftingSurfaceParams` the mesh is lofted from, through
 * the same `liftingSurfaceFrames`, so the pressure map describes the wing on screen
 * rather than a second wing assembled from the same spec by a different route.
 */

/** Angle of attack the aircraft is shown at, in degrees. */
export const CRUISE_ANGLE_DEG = 2.5;

const DEG = Math.PI / 180;

/** Chordwise samples kept per section, cosine spaced to resolve the suction peak. */
const CHORD_SAMPLES = 48;

export interface SectionCurve {
  /** Span fraction of this station: 0 at the root, 1 at the tip, beyond 1 on a winglet. */
  u: number;
  /** Lift coefficient the lattice asked of this section. */
  cl: number;
  /** Cp along the upper and lower surfaces, at `chordStations`. */
  upper: Float64Array;
  lower: Float64Array;
}

export interface SurfaceSolution {
  name: string;
  sections: SectionCurve[];
}

export interface PanelAircraft {
  /** Lift coefficient on the wing's own reference area. */
  CL: number;
  CDi: number;
  spanEfficiency: number;
  aspectRatio: number;
  referenceArea: number;
  surfaces: SurfaceSolution[];
  bodies: { name: string; solution: BodySolution }[];
  /** Chordwise stations the section curves are sampled at, 0 at the leading edge. */
  chordStations: Float64Array;
}

/** Cosine-spaced, so the leading edge — where the pressure actually moves — is resolved. */
function chordStations(): Float64Array {
  const stations = new Float64Array(CHORD_SAMPLES);
  for (let i = 0; i < CHORD_SAMPLES; i++) {
    stations[i] = 0.5 * (1 - Math.cos((Math.PI * i) / (CHORD_SAMPLES - 1)));
  }
  return stations;
}

/**
 * Resample a section solve onto fixed chordwise stations, split by surface.
 *
 * The panel order a section solve returns depends on how the contour was cleaned up, so
 * nothing downstream should depend on it. Sampling onto a fixed grid makes the lookup a
 * plain interpolation and keeps the display independent of the solver's bookkeeping.
 */
function resample(
  solution: SectionSolution,
  cp: Float64Array,
  stations: Float64Array,
): { upper: Float64Array; lower: Float64Array } {
  const gather = (wantUpper: boolean) => {
    const xs: number[] = [];
    const values: number[] = [];
    for (let i = 0; i < cp.length; i++) {
      if (solution.upper[i] !== wantUpper) continue;
      xs.push(solution.x[i]);
      values.push(cp[i]);
    }
    const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const sortedX = order.map((i) => xs[i]);
    const sortedV = order.map((i) => values[i]);

    const out = new Float64Array(stations.length);
    for (let s = 0; s < stations.length; s++) {
      const x = stations[s];
      if (sortedX.length === 0) {
        out[s] = 0;
        continue;
      }
      if (x <= sortedX[0]) {
        out[s] = sortedV[0];
        continue;
      }
      if (x >= sortedX[sortedX.length - 1]) {
        out[s] = sortedV[sortedV.length - 1];
        continue;
      }
      let hi = 1;
      while (hi < sortedX.length && sortedX[hi] < x) hi++;
      const lo = hi - 1;
      const span = sortedX[hi] - sortedX[lo];
      const t = span > 1e-12 ? (x - sortedX[lo]) / span : 0;
      out[s] = sortedV[lo] + (sortedV[hi] - sortedV[lo]) * t;
    }
    return out;
  };

  return { upper: gather(true), lower: gather(false) };
}

export interface SurfaceRequest {
  name: string;
  params: LiftingSurfaceParams;
  /** Both halves are built, so the lattice carries the mirrored side too. */
  mirrored: boolean;
}

/**
 * Lay a lattice over one lifting surface.
 *
 * The bound vortex goes on each panel's quarter chord and the control point on its
 * three-quarter chord, measured along the local chord so that twist and incidence tilt
 * the panel rather than merely moving it. The normal comes from the camber line, which
 * is how a lattice knows about camber at all: the surface it models is the mean camber
 * surface, not the skin.
 */
function latticeFor(
  request: SurfaceRequest,
  chordwise: number,
): { panels: LatticePanel[]; area: number; span: number; stripsPerSide: number } {
  const { params } = request;
  const { frames, quarterChordX } = liftingSurfaceFrames(params);
  const incidence = params.incidenceDeg ?? 0;
  const camberSlope = meanCamberSlope(params);

  const panels: LatticePanel[] = [];
  let area = 0;
  let strip = 0;

  const sides = request.mirrored ? [1, -1] : [1];
  for (const side of sides) {
    for (let f = 0; f < frames.length - 1; f++) {
      const inner = frames[f];
      const outer = frames[f + 1];
      const chord = 0.5 * (inner.chord + outer.chord);
      const dSpan = outer.spanPos - inner.spanPos;
      const dRise = outer.riseY - inner.riseY;
      const width = Math.hypot(dSpan, dRise);
      if (width < 1e-9 || chord < 1e-9) continue;

      // Cant of this strip: zero for a flat wing, the dihedral angle over the main span,
      // and approaching ninety degrees up a winglet. Without it a tip device is modelled
      // as a horizontal surface, which is to say as more wing - and a winglet works by
      // being the opposite of that.
      const cant = Math.atan2(dRise, dSpan);
      const twist = (incidence + 0.5 * (inner.twistDeg + outer.twistDeg)) * DEG;
      const leadInner = quarterChordX[f] - 0.25 * inner.chord;
      const leadOuter = quarterChordX[f + 1] - 0.25 * outer.chord;

      const place = (fraction: number, frame: typeof inner, lead: number) => {
        const along = fraction * frame.chord;
        const x = lead + along * Math.cos(twist);
        const drop = along * Math.sin(twist);
        if (params.axis === 'y') {
          // A fin spans upwards: its stations climb in y and it has no z extent.
          return { x, y: frame.spanPos, z: -drop * side };
        }
        return { x, y: frame.riseY - drop, z: frame.spanPos * side };
      };

      for (let c = 0; c < chordwise; c++) {
        const front = c / chordwise;
        const bound = front + 0.25 / chordwise;
        const control = front + 0.75 / chordwise;
        const slope = camberSlope(front + 0.5 / chordwise);
        const pitch = twist - Math.atan(slope);

        let a = place(bound, inner, leadInner);
        let b = place(bound, outer, leadOuter);
        // The bound vortex has to run the same way round on both wings or the two halves
        // carry equal and opposite circulation and the aircraft generates no lift at all.
        if (side < 0) [a, b] = [b, a];

        const controlPoint = {
          x: 0.5 * (place(control, inner, leadInner).x + place(control, outer, leadOuter).x),
          y: 0.5 * (place(control, inner, leadInner).y + place(control, outer, leadOuter).y),
          z: 0.5 * (place(control, inner, leadInner).z + place(control, outer, leadOuter).z),
        };

        // Normal of the camber surface, tilted by the strip's cant. A vertical surface
        // ends up with its normal in z, so at zero sideslip it carries no load - which is
        // what a fin does.
        const normal =
          params.axis === 'y'
            ? { x: Math.sin(pitch), y: 0, z: Math.cos(pitch) * side }
            : {
                x: Math.sin(pitch),
                y: Math.cos(pitch) * Math.cos(cant),
                z: -Math.cos(pitch) * Math.sin(cant) * side,
              };

        panels.push({ a, b, control: controlPoint, normal, strip, width, chord });
      }

      // Area is the surface's own projected planform, so a near-vertical winglet adds
      // almost nothing to it - which is why a winglet raises aspect ratio so little and
      // span efficiency so much.
      area += chord * Math.abs(dSpan);
      strip++;
    }
  }

  const stripsPerSide = request.mirrored ? strip / 2 : strip;
  const tip = frames[frames.length - 1];
  const span = (request.mirrored ? 2 : 1) * tip.spanPos;
  return { panels, area, span, stripsPerSide };
}

/** Slope of the mean camber line at a chordwise fraction, for the panel normals. */
function meanCamberSlope(params: LiftingSurfaceParams): (x: number) => number {
  const contour = generateAirfoil({
    thickness: params.thicknessRoot,
    camber: params.camber,
    family: params.family,
    resolution: 40,
  });
  // The camber line is the mean of the two surfaces, so differencing it at a station
  // gives the slope the lattice tilts its panels by.
  const camber = (x: number) => {
    let above = 0;
    let below = 0;
    let bestAbove = Infinity;
    let bestBelow = Infinity;
    for (const p of contour) {
      const d = Math.abs(p.x - x);
      if (p.y >= 0 && d < bestAbove) {
        bestAbove = d;
        above = p.y;
      }
      if (p.y <= 0 && d < bestBelow) {
        bestBelow = d;
        below = p.y;
      }
    }
    return 0.5 * (above + below);
  };
  return (x: number) => {
    const h = 0.02;
    const back = Math.max(0, x - h);
    const forward = Math.min(1, x + h);
    return (camber(forward) - camber(back)) / (forward - back);
  };
}

export interface AircraftModelRequest {
  surfaces: SurfaceRequest[];
  bodies: { name: string; stations: BodyStation[] }[];
  /** Angle of attack in degrees. */
  angleDeg?: number;
  /** Chordwise lattice panels per strip. */
  chordwise?: number;
}

/**
 * Solve a whole aircraft.
 *
 * The first surface is taken as the reference for the coefficients, which is the usual
 * convention: a wing's lift coefficient is on the wing's own area, not on the sum of
 * everything that happens to generate lift.
 */
export function solveAircraft(request: AircraftModelRequest): PanelAircraft {
  const angle = (request.angleDeg ?? CRUISE_ANGLE_DEG) * DEG;
  const chordwise = request.chordwise ?? 4;
  const stations = chordStations();
  const stream = { x: Math.cos(angle), y: Math.sin(angle), z: 0 };

  const built = request.surfaces.map((surface) => ({
    surface,
    lattice: latticeFor(surface, chordwise),
  }));

  const reference = built[0];
  const referenceArea = Math.max(reference?.lattice.area ?? 1, 1e-6);
  const referenceSpan = Math.max(reference?.lattice.span ?? 1, 1e-6);

  // One lattice over every lifting surface at once, so that each one sees the others'
  // downwash. A tailplane in a wing's wake is the obvious case, and it is the reason a
  // tailplane is usually set at a different incidence from the wing.
  const panels: LatticePanel[] = [];
  const offsets: number[] = [];
  for (const entry of built) {
    offsets.push(panels.length);
    panels.push(...entry.lattice.panels);
  }

  let result: LatticeResult = { gamma: new Float64Array(0), strips: [], CL: 0, CDi: 0, spanEfficiency: 0 };
  if (panels.length > 0) {
    // Strip indices have to be unique across surfaces or two wings would share one.
    let nextStrip = 0;
    for (const entry of built) {
      const seen = new Map<number, number>();
      for (const panel of entry.lattice.panels) {
        let mapped = seen.get(panel.strip);
        if (mapped === undefined) {
          mapped = nextStrip++;
          seen.set(panel.strip, mapped);
        }
        panel.strip = mapped;
      }
    }
    result = solveLattice(panels, { area: referenceArea, span: referenceSpan, stream });
  }

  const surfaces: SurfaceSolution[] = [];
  for (let s = 0; s < built.length; s++) {
    const entry = built[s];
    const { frames } = liftingSurfaceFrames(entry.surface.params);
    const sections: SectionCurve[] = [];

    // Section lift at each frame, read back off the lattice strips for this surface.
    const perSide = Math.max(1, entry.lattice.stripsPerSide);

    for (let f = 0; f < frames.length; f++) {
      const frame = frames[f];
      const contour = generateAirfoil({
        thickness: frame.thickness,
        camber: entry.surface.params.camber,
        family: entry.surface.params.family,
        resolution: 60,
      });
      const section = solveSection(contour);

      // The strips either side of this frame, on the first half of the surface.
      const before = Math.min(perSide - 1, Math.max(0, f - 1));
      const after = Math.min(perSide - 1, f);
      const stripIndex = (i: number) => offsets[s] / chordwise + i;
      const cl =
        0.5 *
        ((result.strips[Math.round(stripIndex(before))]?.cl ?? 0) +
          (result.strips[Math.round(stripIndex(after))]?.cl ?? 0));

      const sectionAngle = angleForLift(section, cl);
      const cp = sectionPressures(section, sectionAngle);
      const { upper, lower } = resample(section, cp, stations);
      sections.push({ u: frame.u, cl, upper, lower });
    }

    surfaces.push({ name: entry.surface.name, sections });
  }

  const bodies = request.bodies.map((body) => ({
    name: body.name,
    solution: solveBodyOfRevolution(body.stations),
  }));

  return {
    CL: result.CL,
    CDi: result.CDi,
    spanEfficiency: result.spanEfficiency,
    aspectRatio: (referenceSpan * referenceSpan) / referenceArea,
    referenceArea,
    surfaces,
    bodies,
    chordStations: stations,
  };
}

/**
 * Cp at a point on a lifting surface, given where it sits: span fraction, chordwise
 * fraction, and which side of the section it is on.
 */
export function surfacePressureAt(
  model: PanelAircraft,
  surface: SurfaceSolution,
  u: number,
  chordFraction: number,
  upper: boolean,
): number {
  const sections = surface.sections;
  if (sections.length === 0) return 0;

  let hi = 1;
  while (hi < sections.length && sections[hi].u < u) hi++;
  const lo = Math.max(0, hi - 1);
  hi = Math.min(sections.length - 1, hi);
  const spanGap = sections[hi].u - sections[lo].u;
  const spanT = spanGap > 1e-9 ? Math.min(1, Math.max(0, (u - sections[lo].u) / spanGap)) : 0;

  const along = (section: SectionCurve) => {
    const curve = upper ? section.upper : section.lower;
    const stations = model.chordStations;
    const x = Math.min(1, Math.max(0, chordFraction));
    let j = 1;
    while (j < stations.length && stations[j] < x) j++;
    const i = Math.max(0, j - 1);
    j = Math.min(stations.length - 1, j);
    const gap = stations[j] - stations[i];
    const t = gap > 1e-12 ? (x - stations[i]) / gap : 0;
    return curve[i] + (curve[j] - curve[i]) * t;
  };

  return along(sections[lo]) + (along(sections[hi]) - along(sections[lo])) * spanT;
}

/** Cp at an axial position on a body of revolution. */
export function bodyPressureAt(solution: BodySolution, x: number): number {
  const xs = solution.x;
  if (xs.length === 0) return 0;
  if (x <= xs[0]) return solution.cp[0];
  if (x >= xs[xs.length - 1]) return solution.cp[xs.length - 1];
  let hi = 1;
  while (hi < xs.length && xs[hi] < x) hi++;
  const lo = hi - 1;
  const gap = xs[hi] - xs[lo];
  const t = gap > 1e-12 ? (x - xs[lo]) / gap : 0;
  return solution.cp[lo] + (solution.cp[hi] - solution.cp[lo]) * t;
}

export { chordAt };
