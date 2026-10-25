/**
 * The cruise drag breakdown.
 *
 * Stage 5 established that this model cannot get drag by integrating its own surface
 * pressure, and the reason is not a defect: integrate an inviscid pressure field over a
 * closed body and the answer is exactly zero. That is d'Alembert's paradox, and every
 * inviscid method must give it. Pressure drag on a real aircraft comes from the boundary
 * layer changing the pressure field, and nothing here resolves a boundary layer.
 *
 * So drag is assembled from the three parts that are each calculable, by the same
 * handbook methods a preliminary design office used before CFD:
 *
 *   - induced, from the wake. This one *is* simulated: the vortex lattice solved the
 *     span loading and the trailing system carries it, so the span efficiency is the
 *     model's own answer rather than a correlation.
 *   - parasite, from skin friction over the wetted area with a form factor for thickness.
 *   - wave, from how far past its drag-divergence Mach number the wing is flying.
 *
 * Every correlation here is published and cited. They are approximations with real error
 * bars - a few percent each on a clean configuration - and the interface labels anything
 * built on them as derived rather than simulated.
 */

/**
 * Turbulent flat-plate skin friction, Prandtl-Schlichting with a compressibility
 * correction.
 *
 *     Cf = 0.455 / (log10(Re)^2.58 (1 + 0.144 M^2)^0.65)
 *
 * Fully turbulent, which is right for a transport: at a Reynolds number of tens of
 * millions, transition happens within the first few per cent of every chord. Assuming
 * laminar flow anywhere would flatter every aircraft equally and the modern ones most,
 * since natural laminar flow is a thing only the newest wings attempt.
 */
export function skinFriction(reynolds: number, mach: number): number {
  const re = Math.max(1e5, reynolds);
  const log = Math.log10(re);
  return 0.455 / (Math.pow(log, 2.58) * Math.pow(1 + 0.144 * mach * mach, 0.65));
}

/**
 * Form factor for a body of revolution - fuselage or nacelle - from its fineness ratio.
 *
 * Hoerner: FF = 1 + 60/f^3 + f/400, with f the length over the equivalent diameter. The
 * first term is the pressure drag a blunt body carries and falls away quickly with
 * slenderness; the second is the penalty for being long enough that the boundary layer
 * thickens over it. A fuselage at f = 10 comes out around 1.08.
 *
 * Only for slender bodies. The cubic term runs away below a fineness of about four - at
 * f = 1.5 it returns nineteen - so the fineness is held there. That is not a tuning
 * constant but the edge of the correlation: below it the body is a duct or a blister, not
 * a fuselage, and it needs a different formula. A nacelle is exactly that case and has
 * one of its own.
 */
export const SLENDER_FINENESS_FLOOR = 4;

export function bodyFormFactor(fineness: number): number {
  const f = Math.max(SLENDER_FINENESS_FLOOR, fineness);
  return 1 + 60 / (f * f * f) + f / 400;
}

/**
 * Form factor for an engine nacelle.
 *
 * Raymer: FF = 1 + 0.35/f. A nacelle is a short open-ended duct, not a closed body: the
 * air goes through it as well as round it, so most of what the slender-body formula is
 * accounting for does not happen. A high-bypass nacelle at a fineness near 1.5 comes out
 * around 1.23, where Hoerner's formula would have said nineteen - and did, until the
 * computed lift-to-drag ratios came out forty per cent too low across the roster and the
 * breakdown showed three quarters of the drag coming from the engines.
 */
export function nacelleFormFactor(fineness: number): number {
  return 1 + 0.35 / Math.max(0.5, fineness);
}

/**
 * Form factor for a lifting surface, from thickness, sweep and Mach.
 *
 * Shevell's form, as given by Raymer:
 *
 *     FF = [1 + 0.6/(x/c)m * (t/c) + 100 (t/c)^4] * [1.34 M^0.18 cos(L)^0.28]
 *
 * The thickness terms are the pressure drag of a thick section; the Mach and sweep term
 * is how that grows as the flow over it speeds up. It is why a thin swept wing is worth
 * having twice over: it costs less here and it also pushes back the wave drag below.
 */
export function surfaceFormFactor(
  thicknessRatio: number,
  sweepDeg: number,
  mach: number,
  maxThicknessChordwise = 0.4,
): number {
  const tc = Math.max(0.01, thicknessRatio);
  const sweep = Math.cos((sweepDeg * Math.PI) / 180);
  const shape = 1 + (0.6 / maxThicknessChordwise) * tc + 100 * Math.pow(tc, 4);
  return shape * 1.34 * Math.pow(Math.max(0.05, mach), 0.18) * Math.pow(sweep, 0.28);
}

/**
 * Technology factor in the Korn equation, by section family.
 *
 * This single number is the whole supercritical story. The Korn equation sets the
 * drag-divergence Mach number from the section's thickness, the wing's sweep and the lift
 * it is carrying; the factor is what the section itself is worth. 0.87 is the classic
 * value for a 1950s six-series section, 0.95 for a modern supercritical one. The gap is
 * about 0.08 in Mach, which at a fixed cruise Mach is the difference between flying past
 * drag divergence and flying short of it.
 */
export const KORN_FACTOR = {
  naca4: 0.85,
  peaky: 0.89,
  supercritical: 0.95,
} as const;

/**
 * Drag-divergence Mach number, from the Korn equation.
 *
 *     M_dd = k / cos(L) - (t/c) / cos^2(L) - C_L / (10 cos^3(L))
 *
 * All three terms say the same thing in different ways: the wing is in trouble when the
 * flow over its upper surface goes supersonic, and thickness, lift and the absence of
 * sweep all speed that flow up. Sweep appears three times over because it reduces the
 * component of the stream the section actually sees.
 */
export function divergenceMach(
  kornFactor: number,
  thicknessRatio: number,
  sweepDeg: number,
  liftCoefficient: number,
): number {
  const sweep = Math.cos((sweepDeg * Math.PI) / 180);
  return (
    kornFactor / sweep -
    thicknessRatio / (sweep * sweep) -
    Math.abs(liftCoefficient) / (10 * sweep * sweep * sweep)
  );
}

/**
 * Wave drag coefficient, on the wing reference area.
 *
 * Mason's fourth-power drag rise past divergence: CDw = 20 (M - M_dd)^4. Below divergence
 * it is zero, which is the definition rather than an approximation - drag divergence is
 * the Mach number at which the rise begins. The fourth power is what makes cruise Mach
 * such an unforgiving design variable: five per cent past divergence costs little, and
 * fifteen per cent costs eight times as much.
 */
export function waveDragCoefficient(mach: number, divergence: number): number {
  const over = mach - divergence;
  if (over <= 0) return 0;
  return 20 * Math.pow(over, 4);
}

/**
 * Induced drag, as a force.
 *
 * Written in forces rather than coefficients on purpose. Induced drag depends on the lift
 * being carried, the span it is carried on and how evenly it is spread - and on nothing
 * else. Wing area does not appear, so the answer cannot be disturbed by which of several
 * conventions a reference area follows, and the model's own wing area being smaller than
 * the published one stops mattering.
 */
export function inducedDrag(
  lift: number,
  dynamicPressure: number,
  span: number,
  spanEfficiency: number,
): number {
  if (span <= 0 || spanEfficiency <= 0 || dynamicPressure <= 0) return 0;
  return (lift * lift) / (dynamicPressure * Math.PI * span * span * spanEfficiency);
}
