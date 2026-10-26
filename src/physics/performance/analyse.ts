import type { AircraftSpec } from '../../aircraft/AircraftSpec';
import { buildAircraft, type BuiltAircraft } from '../../aircraft/AircraftBuilder';
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
  const built = prebuilt ?? buildAircraft(spec, 'low');
  const conditions = cruiseConditions(spec);
  const lift = spec.reference.cruiseMassKg * GRAVITY;

  const request = stations === undefined ? built.aero : { ...built.aero, stations };
  const trim = solveTrimmed(request, lift, conditions.dynamicPressure);
  const cruise = estimateCruise({
    spec,
    wetted: wettedAreas(built.group),
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
