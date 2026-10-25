import { solveAircraft, type AircraftModelRequest, type PanelAircraft } from '../panel/aircraftModel';

/**
 * Fly the aircraft at the lift it actually needs, rather than at a fixed attitude.
 *
 * Stage 5 solved every aircraft at the same 2.5 degrees, which was right for drawing a
 * surface pressure map and wrong for comparing aircraft. A Comet cruises at a lift
 * coefficient near 0.26 and an A350 near 0.60, and span efficiency depends strongly on
 * which: the loading a wing's twist imposes does not scale with lift, so its cost
 * relative to the lift being carried falls as the lift rises. Measured on a 787, span
 * efficiency runs from 0.51 at a lift coefficient of 0.29 to 0.99 at 0.86.
 *
 * Judging every aircraft at one attitude therefore flattered the ones that cruise at low
 * lift and penalised the ones that cruise at high lift - which is to say it penalised
 * exactly the modern, highly loaded wings this project is about.
 */

/** Two angles far enough apart to fit a line through, in degrees. */
const PROBE_LOW = 1;
const PROBE_HIGH = 5;

export interface TrimmedSolution {
  model: PanelAircraft;
  /** Angle of attack the aircraft needed, in degrees. */
  angleDeg: number;
  /** Whether that angle is within the range a linear method can be believed over. */
  plausible: boolean;
}

/**
 * Solve the aircraft at whatever angle carries the given lift.
 *
 * A vortex lattice is affine in angle of attack - camber moves the line's intercept, not
 * its slope - so two solves fix the line exactly and a third lands on the answer. There
 * is a test that holds the method to that affineness, because when it stopped being true
 * it was the first sign that the influence matrix had gone wrong.
 */
export function solveAtLift(
  request: AircraftModelRequest,
  liftNewtons: number,
  dynamicPressure: number,
): TrimmedSolution {
  const low = solveAircraft({ ...request, angleDeg: PROBE_LOW });
  const high = solveAircraft({ ...request, angleDeg: PROBE_HIGH });

  // The lattice reports lift on its own reference area, so the target has to be too.
  const area = low.referenceArea;
  const target = area > 0 && dynamicPressure > 0 ? liftNewtons / (dynamicPressure * area) : 0;

  const slope = (high.CL - low.CL) / (PROBE_HIGH - PROBE_LOW);
  if (!Number.isFinite(slope) || Math.abs(slope) < 1e-6) {
    return { model: low, angleDeg: PROBE_LOW, plausible: false };
  }
  const angleDeg = PROBE_LOW + (target - low.CL) / slope;

  /*
   * Outside this band the answer is not worth having. A linear method knows nothing about
   * stall, so a wing asked for more lift than it can hold will simply report it, and a
   * negative angle means the aircraft is being asked to fly at less lift than its camber
   * gives for free.
   */
  const plausible = angleDeg > -2 && angleDeg < 12;
  return { model: solveAircraft({ ...request, angleDeg }), angleDeg, plausible };
}
