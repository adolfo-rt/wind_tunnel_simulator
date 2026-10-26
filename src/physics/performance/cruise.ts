import type { AircraftSpec } from '../../aircraft/AircraftSpec';
import { meanAerodynamicChord } from '../../aircraft/AircraftSpec';
import { atmosphereAt, dynamicViscosity } from '../../core/atmosphere';
import {
  DEFAULT_INTERFERENCE,
  INTERFERENCE_FACTOR,
  KORN_FACTOR,
  LEAKAGE_AND_PROTUBERANCE,
  bodyFormFactor,
  divergenceMach,
  nacelleFormFactor,
  inducedDrag,
  skinFriction,
  surfaceFormFactor,
  waveDragCoefficient,
} from './drag';
import type { WettedAreas } from './wetted';

/**
 * What the aircraft is doing at cruise, and what it costs.
 *
 * The whole point of this stage is one chart: fuel per seat per hundred kilometres,
 * against the year the aircraft first flew. Getting there needs the aircraft to be flown
 * rather than merely described, so everything below starts from a condition rather than a
 * coefficient - this altitude, this Mach number, this mass - and the lift is whatever
 * holds that mass up. Nothing here depends on the arbitrary attitude the surface-pressure
 * stage used, and nothing depends on which convention a reference area follows.
 */

const GRAVITY = 9.80665;
/** Seconds in an hour, for turning a thrust-specific fuel consumption into SI. */
const HOUR = 3600;

export interface CruiseConditions {
  altitudeM: number;
  mach: number;
  /** True airspeed, m/s. */
  speed: number;
  densityKgM3: number;
  /** Dynamic pressure, Pa. */
  dynamicPressure: number;
  /** Reynolds number on the mean aerodynamic chord. */
  reynolds: number;
}

export interface DragItem {
  name: string;
  /** Force, newtons. */
  force: number;
  /** Share of the total, 0 to 1. */
  share: number;
}

export interface CruiseEstimate {
  conditions: CruiseConditions;
  /** Lift, newtons: the weight it has to hold up. */
  lift: number;
  liftCoefficient: number;
  induced: number;
  parasite: number;
  wave: number;
  /** Parasite drag split by component. */
  parasiteParts: DragItem[];
  totalDrag: number;
  liftToDrag: number;
  /** Mach number at which the drag rise begins. Below the cruise Mach means wave drag. */
  divergenceMach: number;
  /** Span efficiency used for the induced drag. */
  spanEfficiency: number;
  wettedAreaM2: number;
  /** Kilograms of fuel per seat per hundred kilometres. */
  fuelPerSeat100km: number;
  /** Kilograms of fuel per kilometre for the whole aircraft. */
  fuelPerKm: number;
  /**
   * Whether the drag correlations apply to this aircraft's cruise.
   *
   * False means the figures above are arithmetic rather than an estimate and should not
   * be shown or charted.
   */
  applicable: boolean;
  /** Why not, when it is not. */
  limitation?: string;
}

/**
 * Above this Mach number the subsonic correlations stop meaning anything.
 *
 * The Korn equation gives the Mach number at which the drag rise *begins*, and Mason's
 * fourth-power rise describes the first part of that rise. Neither is a supersonic drag
 * model: past about Mach 1 the shock system is attached to the whole aircraft rather than
 * sitting on the wing's upper surface, and the drag comes from the volume distribution
 * along its length - a different calculation needing a different geometry.
 *
 * Concorde is the one aircraft in the roster this excludes, and the correlation does not
 * fail quietly about it: extrapolated to Mach 2.02 it returns a wave drag twenty times
 * the aircraft's weight. Reporting that as a lift-to-drag ratio of zero would be worse
 * than reporting nothing.
 */
const SUPERSONIC_LIMIT = 0.95;

export interface CruiseInputs {
  spec: AircraftSpec;
  wetted: WettedAreas;
  /** Span efficiency from the vortex lattice. */
  spanEfficiency: number;
}

/** The atmosphere and the speed the aircraft is flying at. */
export function cruiseConditions(spec: AircraftSpec): CruiseConditions {
  const air = atmosphereAt(spec.cruiseAltitudeM);
  const speed = spec.cruiseMach * air.speedOfSound;
  const chord = meanAerodynamicChord(spec);
  const viscosity = dynamicViscosity(air.temperature);
  return {
    altitudeM: spec.cruiseAltitudeM,
    mach: spec.cruiseMach,
    speed,
    densityKgM3: air.density,
    dynamicPressure: 0.5 * air.density * speed * speed,
    reynolds: (air.density * speed * chord) / viscosity,
  };
}

/**
 * Reynolds number on a different length, at the same conditions.
 *
 * Skin friction falls slowly with Reynolds number, so a fuselage forty metres long is
 * smoother per square metre than a four-metre chord. Using the wing's number for
 * everything would overstate the fuselage's drag by about a tenth.
 */
function reynoldsOn(conditions: CruiseConditions, length: number, spec: AircraftSpec): number {
  const chord = meanAerodynamicChord(spec);
  if (chord <= 0) return conditions.reynolds;
  return conditions.reynolds * (Math.max(0.1, length) / chord);
}

/**
 * The cruise drag breakdown, and what it costs in fuel.
 *
 * Induced drag is the simulated part: it comes from the lift, the span and the span
 * efficiency the vortex lattice solved. Parasite and wave drag are derived from published
 * correlations, because an inviscid method cannot produce either - see `drag.ts`.
 */
export function estimateCruise(inputs: CruiseInputs): CruiseEstimate {
  const { spec, wetted, spanEfficiency } = inputs;
  const conditions = cruiseConditions(spec);
  const { mach, dynamicPressure: q } = conditions;

  const lift = spec.reference.cruiseMassKg * GRAVITY;
  const area = spec.reference.wingAreaM2;
  const liftCoefficient = q > 0 && area > 0 ? lift / (q * area) : 0;

  // --- Induced: from the wake, on the published overall span. ---
  const induced = inducedDrag(lift, q, spec.reference.spanOverallM, spanEfficiency);

  // --- Parasite: skin friction over the wetted area, with a form factor each. ---
  const wing = spec.wing;
  const meanThickness = 0.5 * (wing.thicknessRootRatio + wing.thicknessTipRatio);
  const chord = meanAerodynamicChord(spec);
  const fuselageFineness = spec.fuselage.length / Math.max(0.1, spec.fuselage.diameter);
  const nacelleFineness =
    spec.engines.nacelleLength / Math.max(0.1, spec.engines.nacelleDiameter);

  const shapes: Record<string, { length: number; formFactor: number }> = {
    fuselage: {
      length: spec.fuselage.length,
      formFactor: bodyFormFactor(fuselageFineness),
    },
    wing: {
      length: chord,
      formFactor: surfaceFormFactor(meanThickness, wing.sweepQuarterChordDeg, mach),
    },
    tailplane: {
      length: 0.5 * (spec.tail.hStabRootChord + spec.tail.hStabTipChord),
      formFactor: surfaceFormFactor(0.09, spec.tail.hStabSweepDeg, mach),
    },
    fin: {
      length: 0.5 * (spec.tail.vStabRootChord + spec.tail.vStabTipChord),
      formFactor: surfaceFormFactor(0.09, spec.tail.vStabSweepDeg, mach),
    },
    nacelle: {
      length: spec.engines.nacelleLength,
      formFactor: nacelleFormFactor(nacelleFineness),
    },
    // Pylons, fairings and the rest: short, thick and not worth naming individually.
    other: { length: 0.3 * chord, formFactor: 1.4 },
  };

  /*
   * Component build-up: skin friction over the wetted area, raised by a form factor for
   * the component's thickness and by an interference factor for the junctions it makes
   * with its neighbours, then a flat markup for everything too small to name.
   *
   * The interference and the markup were both missing until the pitch trim went in, and
   * their absence had been hidden by a second error. An untrimmed tailplane was carrying
   * several per cent of the aircraft's lift on a short span, and the induced drag of that
   * spurious load stood in for the parasite drag that was never counted. Trimming the
   * aircraft removed the compensation and left every aircraft in the roster reporting a
   * lift-to-drag ratio above its published figure - all twenty of them, which is a
   * missing term and not scatter.
   */
  const parasiteParts: DragItem[] = [];
  let parasite = 0;
  for (const [name, wettedArea] of wetted.byPart) {
    const shape = shapes[name] ?? shapes.other;
    const interference = INTERFERENCE_FACTOR[name] ?? DEFAULT_INTERFERENCE;
    const cf = skinFriction(reynoldsOn(conditions, shape.length, spec), mach);
    const force = q * cf * shape.formFactor * interference * wettedArea;
    parasiteParts.push({ name, force, share: 0 });
    parasite += force;
  }
  const leakage = parasite * LEAKAGE_AND_PROTUBERANCE;
  parasiteParts.push({ name: 'leakage', force: leakage, share: 0 });
  parasite += leakage;

  // --- Wave: how far past drag divergence this wing is flying. ---
  const korn = KORN_FACTOR[wing.family] ?? KORN_FACTOR.peaky;
  const divergence = divergenceMach(
    korn,
    meanThickness,
    wing.sweepQuarterChordDeg,
    liftCoefficient,
  );
  const wave = q * area * waveDragCoefficient(mach, divergence);

  const applicable = mach <= SUPERSONIC_LIMIT;
  const totalDrag = induced + parasite + wave;
  for (const part of parasiteParts) part.share = totalDrag > 0 ? part.force / totalDrag : 0;
  parasiteParts.sort((a, b) => b.force - a.force);

  /*
   * Fuel, at the cruise point.
   *
   * Thrust equals drag in level flight, so the fuel flow is the specific consumption
   * times the drag. This is the differential form of the Breguet relation rather than the
   * integral: it asks what the aircraft is burning now, which is the honest question when
   * the mass is a single quoted cruise figure rather than a fuel fraction. Published
   * consumption is in lb per lbf per hour, which is kilograms per kilogram-force per
   * hour, so the conversion is a gravity and an hour.
   */
  const tsfcSi = spec.reference.tsfcCruise / (GRAVITY * HOUR);
  const fuelPerSecond = tsfcSi * totalDrag;
  const fuelPerKm = conditions.speed > 0 ? (fuelPerSecond * 1000) / conditions.speed : 0;
  const seats = Math.max(1, spec.reference.seatsTypical);

  return {
    conditions,
    lift,
    liftCoefficient,
    induced,
    parasite,
    wave,
    parasiteParts,
    totalDrag,
    liftToDrag: totalDrag > 0 ? lift / totalDrag : 0,
    divergenceMach: divergence,
    spanEfficiency,
    wettedAreaM2: wetted.total,
    fuelPerSeat100km: (fuelPerKm * 100) / seats,
    fuelPerKm,
    applicable,
    limitation: applicable
      ? undefined
      : `Cruise at Mach ${mach.toFixed(2)} is beyond these correlations, which describe ` +
        `the start of the transonic drag rise and not supersonic flight. Supersonic wave ` +
        `drag comes from the volume distribution along the aircraft and needs a different ` +
        `calculation.`,
  };
}
