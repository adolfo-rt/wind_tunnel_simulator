import {
  solveAircraft,
  STABILISER,
  type AircraftModelRequest,
  type PanelAircraft,
} from '../panel/aircraftModel';

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

/**
 * Stabiliser travel, in degrees. A trimmable horizontal stabiliser is not a free
 * variable: it runs between stops, and a solution outside them is not a setting the
 * aircraft can hold.
 */
const STABILISER_MIN_DEG = -12;
const STABILISER_MAX_DEG = 4;

/** A probe step for the stabiliser, large enough to measure against and small enough to stay linear. */
const PROBE_STABILISER = 2;

export interface TrimmedForMoment extends TrimmedSolution {
  /** Stabiliser incidence the aircraft needed, in degrees, leading edge up positive. */
  stabiliserDeg: number;
  /** Fraction of the aircraft's lift carried by the tailplane: negative is a download. */
  tailLiftFraction: number;
  /** False when the stabiliser ran into its stops, so the aircraft is not actually trimmed. */
  withinTravel: boolean;
}

/**
 * Solve for the attitude AND the stabiliser setting that together carry the weight with
 * no pitching moment left over.
 *
 * Trimming for lift alone - which is all `solveAtLift` does - leaves the tailplane at
 * whatever incidence its geometry gave it, and its load is then almost pure angle of
 * attack. Across the roster that ran from 8% of the aircraft's lift downward on a Comet
 * cruising at 0.65 degrees to 7% upward on a 737 MAX at 4.87, where a real trimmable
 * stabiliser is wound to whatever angle zeroes the moment and the cruise load is a
 * percent or three of download whatever the wing is doing.
 *
 * That spurious tail load is not a small error in a corner. A short-span surface carrying
 * several per cent of the lift is expensive in induced drag, and it was wrecking the span
 * efficiency of exactly the high-angle aircraft the project is about: an A350 reported
 * 0.733 whole-aircraft against 0.912 for its wing alone, while a near-identical 787 wing
 * reported 0.938 against 0.902. The aeroplanes were never that different; the tail loads
 * were.
 *
 * A vortex lattice is affine in both controls - angle of attack and stabiliser incidence
 * each move the loading linearly, and camber only shifts the intercepts - so three solves
 * fix both planes exactly and a fourth lands on the answer.
 */
export function solveTrimmed(
  request: AircraftModelRequest,
  liftNewtons: number,
  dynamicPressure: number,
): TrimmedForMoment {
  const base = solveAircraft({ ...request, angleDeg: PROBE_LOW, stabiliserIncidenceDeg: 0 });
  const area = base.referenceArea;
  const target = area > 0 && dynamicPressure > 0 ? liftNewtons / (dynamicPressure * area) : 0;

  const byAngle = solveAircraft({ ...request, angleDeg: PROBE_HIGH, stabiliserIncidenceDeg: 0 });
  const byStab = solveAircraft({
    ...request,
    angleDeg: PROBE_LOW,
    stabiliserIncidenceDeg: PROBE_STABILISER,
  });

  const dAngle = PROBE_HIGH - PROBE_LOW;
  // Jacobian of (CL, Cm) against (angle of attack, stabiliser incidence).
  const a11 = (byAngle.CL - base.CL) / dAngle;
  const a12 = (byStab.CL - base.CL) / PROBE_STABILISER;
  const a21 = (byAngle.Cm - base.Cm) / dAngle;
  const a22 = (byStab.Cm - base.Cm) / PROBE_STABILISER;

  const determinant = a11 * a22 - a12 * a21;
  /*
   * A singular Jacobian means the stabiliser has no independent authority over the
   * moment - a delta with no tailplane at all, which is Concorde. There is nothing to
   * solve for, so fall back to trimming the lift alone and say so.
   */
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    const lift = solveAtLift(request, liftNewtons, dynamicPressure);
    return { ...lift, stabiliserDeg: 0, tailLiftFraction: 0, withinTravel: false };
  }

  const wantCL = target - base.CL;
  const wantCm = -base.Cm;
  const dA = (wantCL * a22 - a12 * wantCm) / determinant;
  const dS = (a11 * wantCm - a21 * wantCL) / determinant;

  let angleDeg = PROBE_LOW + dA;
  let unclamped = dS;
  let stabiliserDeg = Math.min(STABILISER_MAX_DEG, Math.max(STABILISER_MIN_DEG, unclamped));
  let model = solveAircraft({ ...request, angleDeg, stabiliserIncidenceDeg: stabiliserDeg });

  /*
   * One Newton refinement, because the aircraft is not quite affine in the stabiliser.
   *
   * Angle of attack enters through the free stream and is exactly linear. Stabiliser
   * incidence is not: it tilts the tailplane's panels, and a panel's normal turns with
   * the sine and cosine of its own twist. The error is small - a 787 came out with a
   * residual pitching moment of 0.0017 rather than zero - but "trimmed" is the one claim
   * this function makes, so it is worth the extra solve to actually mean it.
   *
   * The Jacobian is reused rather than rebuilt. It is accurate enough that one step
   * takes the residual down by about two orders of magnitude, and rebuilding it would
   * cost two more solves for no useful gain.
   */
  if (Math.abs(stabiliserDeg - unclamped) < 1e-9) {
    const missCL = target - model.CL;
    const missCm = -model.Cm;
    const stepA = (missCL * a22 - a12 * missCm) / determinant;
    const stepS = (a11 * missCm - a21 * missCL) / determinant;
    const refinedAngle = angleDeg + stepA;
    const refinedStab = unclamped + stepS;
    if (
      refinedStab >= STABILISER_MIN_DEG &&
      refinedStab <= STABILISER_MAX_DEG &&
      Number.isFinite(refinedAngle)
    ) {
      angleDeg = refinedAngle;
      unclamped = refinedStab;
      stabiliserDeg = refinedStab;
      model = solveAircraft({ ...request, angleDeg, stabiliserIncidenceDeg: stabiliserDeg });
    }
  }

  const withinTravel = Math.abs(stabiliserDeg - unclamped) < 1e-6;
  const plausible = angleDeg > -2 && angleDeg < 12;

  return {
    model,
    angleDeg,
    stabiliserDeg,
    tailLiftFraction: tailShare(model),
    withinTravel,
    plausible,
  };
}

/** What fraction of the aircraft's lift the tailplane is carrying, download negative. */
function tailShare(model: PanelAircraft): number {
  let tail = 0;
  let total = 0;
  for (const surface of model.surfaces) {
    const lift = surface.lift ?? 0;
    total += lift;
    if (surface.name === STABILISER) tail += lift;
  }
  return Math.abs(total) > 1e-9 ? tail / total : 0;
}
