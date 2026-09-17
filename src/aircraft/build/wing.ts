import { BufferGeometry, Vector3 } from 'three';
import { generateAirfoil, type AirfoilFamily } from '../airfoil';
import type { WingletType } from '../AircraftSpec';
import { loftRings, type Ring } from './loft';

/**
 * Lifting-surface generation: wings, tailplanes, fins and winglets.
 *
 * Every surface is a loft of real airfoil sections placed along a span line that
 * carries sweep, dihedral and twist. Nothing here is a flat plate, because the flow
 * solver reads this geometry as its obstacle: the leading-edge radius is what makes
 * the suction peak appear in the right place, and the washout is what makes the tip
 * unload the way a real wing does.
 *
 * A surface is built as a single half (root at the span origin, running outboard) and
 * mirrored by the caller, so a wing is two lofts and the flow over each is solved
 * independently rather than being assumed symmetric.
 */

export interface WingletParams {
  type: WingletType;
  /** Height of the upturned tip device in metres. Ignored by raked tips. */
  height: number;
}

export interface LiftingSurfaceParams {
  /** Leading edge of the root chord. */
  rootLE: Vector3;
  /** Distance from root to tip. For a wing this is the semi-span. */
  semiSpan: number;
  rootChord: number;
  tipChord: number;
  /** Spanwise position of the trailing-edge kink, as a fraction of the semi-span. */
  kinkFrac?: number;
  /** Chord at the kink, as a fraction of the root chord. */
  kinkChordRatio?: number;
  sweepQuarterChordDeg: number;
  dihedralDeg?: number;
  /** Washout at the tip relative to the root. */
  twistDeg?: number;
  /** Root incidence relative to the fuselage axis. */
  incidenceDeg?: number;
  thicknessRoot: number;
  thicknessTip: number;
  camber: number;
  family: AirfoilFamily;
  /** 'z' spans sideways (wing, tailplane); 'y' spans upwards (fin). */
  axis: 'z' | 'y';
  /** Build the port side by mirroring across the centreline. */
  mirror?: boolean;
  winglet?: WingletParams;
  /**
   * Override the leading-edge position, as an x offset from the root leading edge at
   * span fraction u. Used for Concorde's ogival delta, whose leading edge curves
   * continuously from about 80 degrees of sweep at the root to 55 at the tip rather
   * than running straight. When omitted the quarter-chord sweep is used instead.
   */
  leadingEdgeOffset?: (u: number) => number;
  /** Number of spanwise stations. */
  stations?: number;
  /** Points per airfoil surface. */
  airfoilResolution?: number;
}

const DEG = Math.PI / 180;

/** Chord at a spanwise fraction, following the root-kink-tip planform break. */
export function chordAt(u: number, params: LiftingSurfaceParams): number {
  const kinkFrac = params.kinkFrac ?? 0;
  const kinkChord = (params.kinkChordRatio ?? 1) * params.rootChord;
  if (kinkFrac <= 0 || kinkFrac >= 1) {
    return params.rootChord + (params.tipChord - params.rootChord) * u;
  }
  if (u <= kinkFrac) {
    return params.rootChord + (kinkChord - params.rootChord) * (u / kinkFrac);
  }
  return kinkChord + (params.tipChord - kinkChord) * ((u - kinkFrac) / (1 - kinkFrac));
}

interface SectionFrame {
  /** Span fraction, 0 at the root and 1 at the tip. Above 1 inside a tip device. */
  u: number;
  /** Distance travelled outboard along the span line. */
  spanPos: number;
  /** Offset perpendicular to the span line, for canted winglets. */
  riseY: number;
  chord: number;
  twistDeg: number;
  thickness: number;
  /**
   * Absolute quarter-chord sweep for this station, overriding the surface's own.
   * Undefined means inherit. This must be able to express a sweep BELOW the wing's,
   * which is why it is not an increment.
   */
  sweepDeg?: number;
  v: number;
}

/**
 * Shape of each kind of wingtip device.
 *
 * Two things here were previously wrong and made every device too big.
 *
 * Sweep is now ABSOLUTE rather than added to the wing's own. It used to be an
 * increment, so a 737's winglet inherited 25 degrees from the wing and added 38 more:
 * at 63 degrees of sweep the device marched nearly seven metres downstream over a
 * two-and-a-half metre climb, sixteen times its own chord. A winglet's sweep is set by
 * its own critical Mach number, not by the wing it grows from.
 *
 * The cant transition is now compressed into `blendFraction` of the device's height.
 * Spreading it over the full height, as before, made the device lean outboard the whole
 * way up and inflated the span: the 737-800 came out 34.32 m structural plus 4.3 m of
 * winglet, against a published 35.79 m. "Blended" names a tight arc tangent to the wing
 * at one end and to a straight blade at the other, not a gentle curve all the way.
 */
interface TipDeviceProfile {
  /** Cant at the top of the device, measured from horizontal. 90 is vertical. */
  finalCant: number;
  /** Absolute quarter-chord sweep of the device, in degrees. */
  sweepDeg: number;
  /** Chord at the device's tip, as a fraction of its root chord. */
  tipChordRatio: number;
  /** Chord where the device meets the wing tip, as a multiple of the wing tip chord. */
  rootChordRatio: number;
  /** Fraction of the device height over which the cant transition happens. */
  blendFraction: number;
  stations: number;
}

const TIP_DEVICES: Record<'fence' | 'blended' | 'sharklet' | 'scimitar', TipDeviceProfile> = {
  // A plate on the tip: it turns almost at once and keeps a broad chord.
  fence: { finalCant: 90, sweepDeg: 52, tipChordRatio: 0.5, rootChordRatio: 1.0, blendFraction: 0.2, stations: 6 },
  // The Aviation Partners device: the widest blend radius, and its fairing genuinely
  // widens the chord where it wraps over the tip.
  blended: { finalCant: 75, sweepDeg: 37, tipChordRatio: 0.4, rootChordRatio: 1.07, blendFraction: 0.3, stations: 10 },
  // Airbus's knee is more defined and the blade stands closer to vertical.
  sharklet: { finalCant: 80, sweepDeg: 40, tipChordRatio: 0.35, rootChordRatio: 1.0, blendFraction: 0.28, stations: 10 },
  // Like a sharklet, but the top quarter sweeps forward again - that unsweep is what
  // makes it a scimitar.
  scimitar: { finalCant: 80, sweepDeg: 40, tipChordRatio: 0.32, rootChordRatio: 1.0, blendFraction: 0.3, stations: 10 },
};

/** Absolute sweep of a raked tip, which stays in the plane of the wing. */
const RAKED_SWEEP_DEG = 50;
/** Fraction of the semi-span occupied by a raked tip. */
const RAKED_FRACTION = 0.08;

function smoothstep(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Stations along an upturned tip device: fences, blended winglets, sharklets and
 * scimitars. Raked tips are not built here — they stay in the plane of the wing and are
 * generated as part of the wing's own span, see `buildLiftingSurface`.
 */
function wingletFrames(
  params: LiftingSurfaceParams,
  tipSpanPos: number,
  /** Vertical position the wing has already reached at the tip through its dihedral. */
  tipRise: number,
): SectionFrame[] {
  const winglet = params.winglet;
  if (!winglet || winglet.type === 'none' || winglet.type === 'raked') return [];

  const profile = TIP_DEVICES[winglet.type];
  const dihedral = params.dihedralDeg ?? 0;
  const count = profile.stations;
  const rootChord = params.tipChord * profile.rootChordRatio;

  // Walk the blend with unit steps, then rescale so the total rise equals the
  // requested winglet height.
  const cants: number[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const blend = smoothstep(t / profile.blendFraction);
    cants.push(dihedral + (profile.finalCant - dihedral) * blend);
  }
  let riseSum = 0;
  for (const cant of cants) riseSum += Math.abs(Math.sin(cant * DEG));
  const step = riseSum > 0 ? winglet.height / riseSum : 0;

  // Never let a device look less swept than the wing it grows out of.
  const sweepFloor = params.sweepQuarterChordDeg + 8;

  const frames: SectionFrame[] = [];
  let spanPos = tipSpanPos;
  let riseY = tipRise;
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / count;
    spanPos += step * Math.cos(cants[i] * DEG);
    riseY += step * Math.sin(cants[i] * DEG);

    let sweepDeg = Math.max(profile.sweepDeg, sweepFloor);
    if (winglet.type === 'scimitar') {
      // The top quarter sweeps forward again.
      sweepDeg -= (profile.sweepDeg - 14) * smoothstep((t - 0.75) / 0.25);
    }

    frames.push({
      u: 1 + t,
      spanPos,
      riseY,
      chord: rootChord * (1 - (1 - profile.tipChordRatio) * t),
      // Real winglet toe-out is around a couple of degrees relative to the wing tip
      // chord. On a near-vertical surface any more reads as the device being
      // knock-kneed when seen from the front.
      twistDeg: (params.twistDeg ?? 0) - 1.5 * t,
      thickness: params.thicknessTip * (1 - 0.15 * t),
      sweepDeg,
      v: 1 + t * 0.2,
    });
  }
  return frames;
}

/** Build one half of a lifting surface as a closed, capped loft. */
export function buildLiftingSurface(params: LiftingSurfaceParams): BufferGeometry {
  const stationCount = params.stations ?? 12;
  const resolution = params.airfoilResolution ?? 26;
  const dihedral = params.dihedralDeg ?? 0;
  const incidence = params.incidenceDeg ?? 0;
  const twist = params.twistDeg ?? 0;
  const sweep = Math.tan(params.sweepQuarterChordDeg * DEG);

  /**
   * A raked tip is part of the wing's span, not an addition to it.
   *
   * Published spans for the 787 and A350 already include their raked tips, so extending
   * beyond the semi-span put them three and a half metres too wide and inflated the
   * aspect ratio with it. Here the outer `RAKED_FRACTION` of the span simply carries the
   * rake's sweep and a sharper chord taper, which leaves both span and area intact.
   */
  const isRaked = params.winglet?.type === 'raked';
  const rakeStart = 1 - RAKED_FRACTION;

  /**
   * Spanwise stations: an even spread, plus exact stations at the planform breaks so
   * they stay crisp.
   *
   * The breaks are INSERTED rather than snapping the nearest station onto them. Moving
   * a station is fine in the middle of the span but silently truncates the wing when the
   * break happens to fall next to the tip, which is exactly where a rake begins.
   */
  const kinkFrac = params.kinkFrac ?? 0;
  const stationSet = new Set<number>();
  for (let i = 0; i < stationCount; i++) stationSet.add(i / (stationCount - 1));
  if (kinkFrac > 0 && kinkFrac < 1) stationSet.add(kinkFrac);
  if (isRaked) stationSet.add(rakeStart);
  const stations = [...stationSet].sort((a, b) => a - b);

  const frames: SectionFrame[] = [];
  for (const u of stations) {
    const raked = isRaked && u > rakeStart;
    const rakeT = raked ? (u - rakeStart) / RAKED_FRACTION : 0;

    frames.push({
      u,
      spanPos: u * params.semiSpan,
      riseY: u * params.semiSpan * Math.tan(dihedral * DEG),
      chord: chordAt(u, params) * (raked ? 1 - 0.45 * rakeT : 1),
      twistDeg: twist * u,
      thickness: params.thicknessRoot + (params.thicknessTip - params.thicknessRoot) * u,
      sweepDeg: raked ? RAKED_SWEEP_DEG : undefined,
      v: u,
    });
  }
  // The tip device continues from wherever the wing's dihedral has carried the tip,
  // not from the root plane, otherwise every winglet starts with a kink downwards.
  const tipRise = params.semiSpan * Math.tan(dihedral * DEG);
  frames.push(...wingletFrames(params, params.semiSpan, tipRise));

  // Quarter-chord line, accumulated so tip devices can add their own sweep.
  const quarterChordX: number[] = [];
  let x = params.rootLE.x + 0.25 * params.rootChord;
  let previousSpan = 0;
  let previousRise = 0;
  for (const frame of frames) {
    if (params.leadingEdgeOffset && frame.u <= 1) {
      // The planform prescribes where the leading edge runs; the quarter-chord line
      // follows from it and the local chord.
      x = params.rootLE.x + params.leadingEdgeOffset(frame.u) + 0.25 * frame.chord;
    } else {
      const ds = Math.hypot(frame.spanPos - previousSpan, frame.riseY - previousRise);
      const localSweep =
        frame.sweepDeg === undefined ? sweep : Math.tan(frame.sweepDeg * DEG);
      x += ds * localSweep;
    }
    quarterChordX.push(x);
    previousSpan = frame.spanPos;
    previousRise = frame.riseY;
  }

  const sign = params.mirror ? -1 : 1;
  const rings: Ring[] = frames.map((frame, index) => {
    const contour = generateAirfoil({
      thickness: frame.thickness,
      camber: params.camber,
      family: params.family,
      resolution,
      closedTrailingEdge: true,
    });
    // The closed-trailing-edge contour repeats its first point at the end; drop it so
    // the loop closes cleanly instead of producing degenerate triangles.
    contour.pop();

    const angle = (incidence + frame.twistDeg) * DEG;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const leadingEdgeX = quarterChordX[index] - 0.25 * frame.chord;

    const points = contour.map((p) => {
      // Rotate the section about its quarter chord so sweep and twist stay consistent.
      const dx = p.x - 0.25;
      const chordwise = 0.25 + dx * cos + p.y * sin;
      const normal = -dx * sin + p.y * cos;
      const alongChord = leadingEdgeX + frame.chord * chordwise;
      const perpendicular = frame.chord * normal;

      if (params.axis === 'y') {
        // A fin: the section lies in the xz plane and the span runs upwards.
        return new Vector3(
          alongChord,
          params.rootLE.y + frame.spanPos,
          params.rootLE.z + sign * perpendicular,
        );
      }
      return new Vector3(
        alongChord,
        params.rootLE.y + frame.riseY + perpendicular,
        params.rootLE.z + sign * frame.spanPos,
      );
    });

    return { points, v: frame.v };
  });

  return loftRings(rings, { closed: true, capStart: true, capEnd: true });
}

/**
 * Planform area of one half of a surface, by integrating the chord along the span.
 * Used to check generated geometry against the published wing area.
 */
export function halfPlanformArea(params: LiftingSurfaceParams, samples = 200): number {
  let area = 0;
  for (let i = 0; i < samples; i++) {
    const u = (i + 0.5) / samples;
    area += chordAt(u, params) * (params.semiSpan / samples);
  }
  return area;
}

/**
 * Leading-edge curve of an ogival delta.
 *
 * Concorde's wing is not a triangle. Its leading edge sweeps at roughly 80 degrees at
 * the root and relaxes to about 55 at the tip, tracing the double curve that gives the
 * planform its name. The steep inboard section generates the controlled vortex lift the
 * aircraft relied on at low speed; the shallower outboard section keeps the tip
 * efficient in supersonic cruise.
 */
export function ogivalLeadingEdge(semiSpan: number, rootSweepDeg = 80, tipSweepDeg = 55) {
  const samples = 64;
  // Integrate tan(sweep) along the span once, then interpolate.
  const table: number[] = [0];
  for (let i = 1; i <= samples; i++) {
    const u = i / samples;
    const sweepDeg = rootSweepDeg - (rootSweepDeg - tipSweepDeg) * Math.pow(u, 0.8);
    const step = (semiSpan / samples) * Math.tan(sweepDeg * DEG);
    table.push(table[i - 1] + step);
  }
  return (u: number): number => {
    const clamped = Math.min(1, Math.max(0, u)) * samples;
    const i = Math.min(samples - 1, Math.floor(clamped));
    return table[i] + (table[i + 1] - table[i]) * (clamped - i);
  };
}
