import type { AircraftSpec } from '../../aircraft/AircraftSpec';
import {
  buildAircraft,
  type BuiltAircraft,
  type DetailLevel,
} from '../../aircraft/AircraftBuilder';
import { cruiseConditions, estimateCruise, type CruiseEstimate } from './cruise';
import { solveTrimmed } from './trim';
import { wettedAreas } from './wetted';

/**
 * Everything stage 8 has to say about one aircraft, in one call.
 *
 * The order matters and is the point of having this in one place: the aircraft is built,
 * trimmed to carry its own cruise weight, and only then asked what that costs. Nothing
 * here is evaluated at a convenient attitude or a nominal lift.
 */

const GRAVITY = 9.80665;

/**
 * The tessellation every cruise estimate is measured on, whatever is on screen.
 *
 * Wetted area is measured off real triangles, which is a feature - it accounts for the
 * shape actually built rather than a formula for an idealised one. It also means the
 * number depends on how finely that shape was tessellated: a 787 at high detail has 1.6%
 * more wetted area than at low, and 1.6% more parasite drag with it, which moved its
 * lift-to-drag ratio by the same amount. Once quality tiers let the viewer change mesh
 * detail, that became a rendering setting steering the physics - the same fault that
 * `AERO_STATIONS` exists to prevent on the lattice, and it gets the same treatment.
 *
 * Pinned to `low` because that is what every published figure in the roster dataset was
 * generated at. Neither tessellation is converged: a finer mesh of a curved body always
 * has more area, so both under-read the true wetted area, low by about 1.6% more than
 * high. That bias is inside the model's stated accuracy and it is the same for every
 * aircraft, which is what matters for comparing them.
 */
export const AERO_DETAIL: DetailLevel = 'low';

export interface AircraftAnalysis {
  spec: AircraftSpec;
  cruise: CruiseEstimate;
  /** Angle of attack needed to hold the aircraft up at cruise. */
  angleDeg: number;
  /** Lift coefficient on the published wing area. */
  liftCoefficient: number;
  spanEfficiency: number;
  /** Stabiliser incidence the aircraft is trimmed at, degrees, leading edge up positive. */
  stabiliserDeg: number;
  /** Share of the aircraft's lift carried by the tailplane; a download is negative. */
  tailLiftFraction: number;
  /** False when the trim or the drag correlations fall outside what the model can claim. */
  trustworthy: boolean;
}

export function analyseAircraft(
  spec: AircraftSpec,
  prebuilt?: BuiltAircraft,
  /** Spanwise stations per surface, for convergence studies. Production uses the default. */
  stations?: number,
): AircraftAnalysis {
  const built = prebuilt ?? buildAircraft(spec, AERO_DETAIL);
  const conditions = cruiseConditions(spec);
  const lift = spec.reference.cruiseMassKg * GRAVITY;

  const request = stations === undefined ? built.aero : { ...built.aero, stations };
  const trim = solveTrimmed(request, lift, conditions.dynamicPressure);

  /*
   * The lattice is safe to take from whatever mesh was handed in - it is rebuilt from the
   * surface parameters at `AERO_STATIONS` and never sees the triangles. The wetted area
   * is not, so it is measured on a mesh at `AERO_DETAIL` even when that means building a
   * second one and throwing it away.
   */
  const measured = built.detail === AERO_DETAIL ? built : buildAircraft(spec, AERO_DETAIL);
  const wetted = wettedAreas(measured.group);
  if (measured !== built) measured.dispose();

  const cruise = estimateCruise({
    spec,
    wetted,
    spanEfficiency: trim.model.spanEfficiency,
  });

  if (!prebuilt) built.dispose();

  return {
    spec,
    cruise,
    angleDeg: trim.angleDeg,
    liftCoefficient: cruise.liftCoefficient,
    spanEfficiency: trim.model.spanEfficiency,
    stabiliserDeg: trim.stabiliserDeg,
    tailLiftFraction: trim.tailLiftFraction,
    trustworthy: trim.plausible && cruise.applicable,
  };
}
