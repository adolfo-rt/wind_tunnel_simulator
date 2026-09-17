import type { AirfoilFamily } from './airfoil';

/**
 * The parametric description of an airliner.
 *
 * One spec drives everything: the 3D mesh, the signed distance field the flow
 * solver uses as an obstacle, and the aerodynamic analytics. That is deliberate.
 * If the wing's sweep, aspect ratio and airfoil only affected how the aeroplane
 * looked, the simulation would be decoration. Because the same numbers feed the
 * solver, changing aircraft genuinely changes the flow.
 *
 * Coordinate convention used throughout the project:
 *   +X  streamwise, downstream. The nose sits at x = 0 and the tail at x = +length,
 *       so the aircraft faces into a wind that blows towards +X.
 *   +Y  up
 *   +Z  starboard (right wing)
 * All dimensions are in metres, all angles in degrees.
 */

export type WingletType =
  | 'none'
  | 'fence'      // A320-family wingtip fence
  | 'blended'    // 737NG / Boeing Aviation Partners blended winglet
  | 'sharklet'   // A320neo
  | 'raked'      // 787, 777-300ER: swept extension rather than an upturned tip
  | 'scimitar';  // 737 MAX split-tip

/**
 * The shape of the tail only. Whether there is a centre engine is a separate question,
 * answered by `EngineSpec.count`: the 727 is a T-tail and a trijet at the same time, so
 * one enum cannot describe both.
 */
export type TailConfig =
  | 'conventional'
  | 't-tail'
  | 'delta'; // Concorde: no horizontal stabiliser at all

export type EngineType =
  | 'turbojet'
  | 'low-bypass'
  | 'high-bypass'
  | 'ultra-high-bypass';

export type EngineMount =
  | 'wing-pylon'
  | 'rear-fuselage'
  | 'wing-root-buried'  // Comet: engines inside the wing root
  | 'underwing-delta';  // Concorde: paired boxes under the delta

export interface FuselageSpec {
  length: number;
  /** Maximum equivalent diameter. */
  diameter: number;
  /** Width / height of the cross-section. 1 is circular; the A380 is taller than wide. */
  widthRatio: number;
  /** Nose cone length as a multiple of diameter. Higher is more slender. */
  noseFineness: number;
  /** Tail cone length as a multiple of diameter. */
  tailFineness: number;
  /** Upsweep of the rear fuselage, which sets the tail-strike angle on rotation. */
  tailUpsweepDeg: number;
  /**
   * Superellipse exponent for the cross-section. 2 is a true ellipse; larger values
   * square it off, as on the double-bubble sections of widebodies.
   */
  crossSectionExponent: number;
  deck: 'single' | 'partial-upper' | 'full-double';
}

export interface WingSpec {
  /**
   * Planform shape. Nearly every airliner is a swept trapezoid with a kink; Concorde's
   * ogival delta is a genuinely different shape and gets its own generator.
   */
  planform: 'trapezoid' | 'ogival-delta';
  /**
   * Structural span of the bare wing, tip to tip, excluding any upturned tip device.
   * The published overall span lives in `reference.spanOverallM`.
   */
  span: number;
  rootChord: number;
  tipChord: number;
  sweepQuarterChordDeg: number;
  dihedralDeg: number;
  /** Washout: tip incidence relative to the root, normally negative. */
  twistDeg: number;
  thicknessRootRatio: number;
  thicknessTipRatio: number;
  camber: number;
  family: AirfoilFamily;
  /** Leading edge of the root chord, as a fraction of fuselage length from the nose. */
  rootStationFrac: number;
  /** Vertical position as a fraction of fuselage radius: -1 low wing, +1 high wing. */
  verticalOffsetFrac: number;
  wingletType: WingletType;
  /** Winglet height in metres; 0 when there is none. */
  wingletHeight: number;
  /** Spanwise position of the trailing-edge kink, as a fraction of semi-span. */
  kinkFrac: number;
  /** Chord at the kink as a fraction of the root chord. */
  kinkChordRatio: number;
  /** Root incidence angle relative to the fuselage axis. */
  incidenceDeg: number;
}

export interface EngineSpec {
  type: EngineType;
  mount: EngineMount;
  /** Total number of engines on the aircraft. */
  count: number;
  bypassRatio: number;
  nacelleLength: number;
  nacelleDiameter: number;
  /** Spanwise stations of the wing-mounted engines, as fractions of semi-span. */
  spanStations: number[];
  /** Station along the fuselage for rear-mounted engines, as a fraction of its length. */
  fuselageStationFrac?: number;
}

export interface TailSpec {
  config: TailConfig;
  hStabSpan: number;
  hStabRootChord: number;
  hStabTipChord: number;
  hStabSweepDeg: number;
  hStabDihedralDeg: number;
  vStabHeight: number;
  vStabRootChord: number;
  vStabTipChord: number;
  vStabSweepDeg: number;
}

/**
 * Published figures, used for comparison against what the simulation computes.
 *
 * These are book values from manufacturer data and standard references. They are
 * NEVER presented as simulation output: the UI labels them explicitly so the
 * project stays honest about which numbers are computed and which are quoted.
 */
export interface ReferenceData {
  wingAreaM2: number;
  /**
   * Published overall span, including any wingtip device.
   *
   * `wing.span` is the STRUCTURAL span of the bare wing, which is what the geometry is
   * built from; this is the figure quoted in the aircraft's specification and the one to
   * show and to use aerodynamically, since a tip device extends the effective span.
   * For a raked tip the two are equal, because the rake is part of the span rather than
   * an addition to it.
   */
  spanOverallM: number;
  mtowKg: number;
  /** Typical operating empty weight plus payload at the start of cruise. */
  cruiseMassKg: number;
  seatsTypical: number;
  rangeKm: number;
  /** Published cruise lift-to-drag ratio. */
  cruiseLD: number;
  /** Cruise thrust-specific fuel consumption, lb/(lbf*h), equal to kg/(kgf*h). */
  tsfcCruise: number;
}

export interface LiverySpec {
  fuselage: string;
  stripe: string;
  tail: string;
  wing: string;
  engine: string;
}

export interface AircraftSpec {
  id: string;
  manufacturer: string;
  model: string;
  /** Year the type first flew. The roster is ordered by this. */
  firstFlightYear: number;
  cruiseMach: number;
  /** Typical cruise altitude in metres, used for the Reynolds number. */
  cruiseAltitudeM: number;
  /** One line on what this aircraft contributed aerodynamically. */
  innovation: string;
  fuselage: FuselageSpec;
  wing: WingSpec;
  engines: EngineSpec;
  tail: TailSpec;
  reference: ReferenceData;
  livery: LiverySpec;
}

/** Decade bucket used to group the selector menu. */
export function decadeOf(spec: AircraftSpec): string {
  const decade = Math.floor(spec.firstFlightYear / 10) * 10;
  return `${decade}s`;
}

/**
 * Wing aspect ratio, span^2 / area. The single most important number for induced drag.
 * Uses the overall span, because a wingtip device works by extending the effective span.
 */
export function aspectRatio(spec: AircraftSpec): number {
  const span = spec.reference.spanOverallM;
  return (span * span) / spec.reference.wingAreaM2;
}

/** Taper ratio, tip chord / root chord. */
export function taperRatio(spec: AircraftSpec): number {
  return spec.wing.tipChord / spec.wing.rootChord;
}

/** Mean aerodynamic chord, the reference length for pitching moments and Reynolds number. */
export function meanAerodynamicChord(spec: AircraftSpec): number {
  const lambda = taperRatio(spec);
  return (2 / 3) * spec.wing.rootChord * ((1 + lambda + lambda * lambda) / (1 + lambda));
}
