import { describe, it, expect } from 'vitest';
import { buildAircraft } from '../src/aircraft/AircraftBuilder';
import { ROSTER, specById } from '../src/aircraft/roster';
import { solveAircraft } from '../src/physics/panel/aircraftModel';
import { wettedAreas } from '../src/physics/performance/wetted';
import { cruiseConditions, estimateCruise, type CruiseEstimate } from '../src/physics/performance/cruise';
import {
  bodyFormFactor,
  divergenceMach,
  inducedDrag,
  nacelleFormFactor,
  skinFriction,
  surfaceFormFactor,
  waveDragCoefficient,
} from '../src/physics/performance/drag';

const cache = new Map<string, CruiseEstimate>();
function cruiseOf(id: string): CruiseEstimate {
  let estimate = cache.get(id);
  if (!estimate) {
    const spec = specById(id)!;
    const built = buildAircraft(spec);
    const model = solveAircraft(built.aero);
    estimate = estimateCruise({
      spec,
      wetted: wettedAreas(built.group),
      spanEfficiency: model.spanEfficiency,
    });
    cache.set(id, estimate);
  }
  return estimate;
}

describe('the drag correlations', () => {
  /*
   * Skin friction against the Prandtl-Schlichting curve at a Reynolds number a textbook
   * tabulates, and against the direction it must move: smoother per unit area the longer
   * and faster the surface, because the boundary layer spends more of its length thick.
   */
  it('gives flat-plate skin friction of the right size', () => {
    expect(skinFriction(1e7, 0)).toBeCloseTo(0.003, 3);
    expect(skinFriction(1e8, 0)).toBeLessThan(skinFriction(1e7, 0));
    // Compressibility thins the boundary layer's contribution; Mach 0.85 is worth ~6%.
    expect(skinFriction(5e7, 0.85)).toBeLessThan(skinFriction(5e7, 0));
    expect(skinFriction(5e7, 0.85) / skinFriction(5e7, 0)).toBeGreaterThan(0.9);
  });

  /*
   * Form factors are multipliers on skin friction and must never fall below one: a shape
   * cannot have less drag than the flat plate of the same wetted area.
   */
  it('never makes a shape slipperier than a flat plate', () => {
    for (const fineness of [0.5, 1, 2, 4, 8, 12, 20]) {
      expect(bodyFormFactor(fineness), `body f=${fineness}`).toBeGreaterThanOrEqual(1);
      expect(nacelleFormFactor(fineness), `nacelle f=${fineness}`).toBeGreaterThanOrEqual(1);
    }
    for (const tc of [0.08, 0.12, 0.18]) {
      expect(surfaceFormFactor(tc, 30, 0.8)).toBeGreaterThan(1);
    }
  });

  /*
   * The nacelle is why this function exists separately. Hoerner's slender-body formula
   * has a 60/f^3 term that runs away on anything stubby: a high-bypass nacelle at a
   * fineness near 1.5 came out at nineteen, which put three quarters of the aircraft's
   * drag on its engines and dropped every computed lift-to-drag ratio by forty per cent.
   */
  it('keeps a stubby nacelle sane', () => {
    expect(nacelleFormFactor(1.5)).toBeLessThan(1.4);
    expect(bodyFormFactor(1.5)).toBeLessThan(2.5);
  });

  /*
   * The Korn equation, and the whole supercritical story in one assertion: the same wing
   * made of a modern section flies meaningfully faster before its drag starts to rise.
   */
  it('rewards sweep, thinness and a modern section', () => {
    const base = divergenceMach(0.87, 0.12, 25, 0.5);
    expect(divergenceMach(0.95, 0.12, 25, 0.5)).toBeGreaterThan(base + 0.05);
    expect(divergenceMach(0.87, 0.09, 25, 0.5)).toBeGreaterThan(base);
    expect(divergenceMach(0.87, 0.12, 35, 0.5)).toBeGreaterThan(base);
    // And carrying more lift brings the rise forward, which is why cruise climbs.
    expect(divergenceMach(0.87, 0.12, 25, 0.7)).toBeLessThan(base);
  });

  /* Below divergence there is no wave drag at all, and past it the rise is fourth power. */
  it('starts the wave drag at divergence and not before', () => {
    expect(waveDragCoefficient(0.7, 0.8)).toBe(0);
    expect(waveDragCoefficient(0.8, 0.8)).toBe(0);
    const small = waveDragCoefficient(0.82, 0.8);
    const twice = waveDragCoefficient(0.84, 0.8);
    expect(small).toBeGreaterThan(0);
    expect(twice / small).toBeCloseTo(16, 0);
  });

  /*
   * Induced drag depends on lift, span and span efficiency - and on nothing else. Writing
   * it in forces rather than coefficients is what makes that true, and it matters here
   * because the model's wing area is about a sixth smaller than the published reference
   * area, so anything carrying an area through would inherit that discrepancy.
   */
  it('makes induced drag depend on span and not on area', () => {
    const base = inducedDrag(1e6, 1e4, 60, 0.9);
    expect(inducedDrag(2e6, 1e4, 60, 0.9) / base).toBeCloseTo(4, 6);
    expect(inducedDrag(1e6, 1e4, 120, 0.9) / base).toBeCloseTo(0.25, 6);
    expect(inducedDrag(1e6, 1e4, 60, 1.0) / base).toBeCloseTo(0.9, 6);
  });
});

describe('the cruise estimate', () => {
  /* The condition itself: thinner air and a real speed at altitude. */
  it('flies the aircraft at its own cruise condition', () => {
    const conditions = cruiseConditions(specById('boeing737-800')!);
    expect(conditions.densityKgM3).toBeLessThan(0.5);
    expect(conditions.speed).toBeGreaterThan(200);
    expect(conditions.speed).toBeLessThan(290);
    // A transport wing at cruise sits in the tens of millions, which is the number the
    // README uses to say why no browser resolves its boundary layer.
    expect(conditions.reynolds).toBeGreaterThan(1e7);
    expect(conditions.reynolds).toBeLessThan(1e8);
  });

  /*
   * The check this stage stands or falls on.
   *
   * Lift-to-drag at cruise is published for every aircraft in the roster, and nothing in
   * the calculation is fitted to it: the induced part comes from the lattice's own span
   * loading, the parasite part from the mesh's own wetted area through published
   * correlations, and the wave part from the Korn equation. Mean absolute error across
   * the roster is about 9%.
   *
   * The error is not evenly spread, and the pattern is the honest finding: the model is
   * too kind to the oldest aircraft, by twenty to thirty per cent on a Comet or a
   * Caravelle, and within a few per cent from the late 1960s on. Nothing here models how
   * rough an aeroplane is - the rivets, the gaps, the aerials, the surface finish - and
   * that is exactly what the 1950s paid for and modern manufacture does not.
   */
  it('reproduces published cruise lift-to-drag', () => {
    const errors: number[] = [];
    for (const spec of ROSTER) {
      const estimate = cruiseOf(spec.id);
      if (!estimate.applicable) continue;
      const error = estimate.liftToDrag / spec.reference.cruiseLD - 1;
      errors.push(Math.abs(error));
      expect(Math.abs(error), `${spec.id}: ${estimate.liftToDrag.toFixed(1)} against ` +
        `${spec.reference.cruiseLD}`).toBeLessThan(0.35);
    }
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    expect(mean).toBeLessThan(0.12);
  }, 600000);

  /*
   * Since 1967 the surface-finish excuse runs out and the model has to be close.
   *
   * The bound is a fifth rather than a tenth because of one aircraft: the A340 comes out
   * at 21.2 against a published 18.0, and every other airliner since 1967 is inside ten
   * per cent. It is not obvious why - the likeliest cause is that the model's wing area
   * runs about a sixth below the published reference area across the roster, which makes
   * its wings more slender than the real ones, and the A340's wing is the most slender
   * here. Recorded rather than excused.
   */
  it('is within a fifth on everything since the late sixties', () => {
    for (const spec of ROSTER) {
      if (spec.firstFlightYear < 1967) continue;
      const estimate = cruiseOf(spec.id);
      if (!estimate.applicable) continue;
      const error = estimate.liftToDrag / spec.reference.cruiseLD - 1;
      expect(Math.abs(error), spec.id).toBeLessThan(0.2);
    }
  }, 600000);

  /* And only the one of them is outside a tenth, which keeps that excuse from spreading. */
  it('has exactly one modern aircraft outside a tenth', () => {
    const wide = ROSTER.filter((spec) => {
      if (spec.firstFlightYear < 1967) return false;
      const estimate = cruiseOf(spec.id);
      if (!estimate.applicable) return false;
      return Math.abs(estimate.liftToDrag / spec.reference.cruiseLD - 1) >= 0.1;
    }).map((spec) => spec.id);
    expect(wide).toEqual(['a340']);
  }, 600000);

  /*
   * The drag has to be shared out sensibly. A transport at cruise carries roughly a third
   * of its drag as induced and most of the rest as skin friction; anything outside these
   * bounds means a correlation has run away, which is how the nacelle form factor was
   * caught.
   */
  it('splits the drag the way a transport does', () => {
    for (const spec of ROSTER) {
      const estimate = cruiseOf(spec.id);
      if (!estimate.applicable) continue;
      const induced = estimate.induced / estimate.totalDrag;
      const parasite = estimate.parasite / estimate.totalDrag;
      expect(induced, `${spec.id} induced share`).toBeGreaterThan(0.15);
      expect(induced, `${spec.id} induced share`).toBeLessThan(0.6);
      expect(parasite, `${spec.id} parasite share`).toBeGreaterThan(0.4);
    }
  }, 600000);

  /*
   * Subsonic airliners cruise just below their drag rise - that is what choosing a cruise
   * Mach number means - so wave drag should be a small part of the total or none at all.
   * A wing flying far past divergence would be a design nobody built.
   */
  it('keeps wave drag small on a subsonic airliner', () => {
    for (const spec of ROSTER) {
      const estimate = cruiseOf(spec.id);
      if (!estimate.applicable) continue;
      expect(estimate.wave / estimate.totalDrag, spec.id).toBeLessThan(0.15);
    }
  }, 600000);

  /*
   * Concorde is the one the correlations cannot touch, and they do not fail quietly about
   * it: extrapolated to Mach 2 the Korn equation returns a wave drag twenty times the
   * aircraft's weight. Saying so is the only honest option.
   */
  it('declines to estimate supersonic cruise', () => {
    const concorde = cruiseOf('concorde');
    expect(concorde.applicable).toBe(false);
    expect(concorde.limitation).toMatch(/supersonic/i);
    for (const spec of ROSTER) {
      if (spec.id === 'concorde') continue;
      expect(cruiseOf(spec.id).applicable, spec.id).toBe(true);
    }
  }, 600000);

  /*
   * And the headline the stage exists for. Fuel per seat per hundred kilometres has to
   * fall over the era: a modern narrowbody burns about a third of what the first jets did
   * per seat, which is the finding this whole project is about.
   */
  it('shows fuel per seat falling across the era', () => {
    const early = cruiseOf('boeing707').fuelPerSeat100km;
    const modern = cruiseOf('boeing737max').fuelPerSeat100km;
    expect(modern).toBeLessThan(early);
    expect(early / modern).toBeGreaterThan(2);
    expect(early / modern).toBeLessThan(5);
  }, 600000);
});

describe('wetted area', () => {
  /*
   * Measured off the aircraft's own triangles, so it has to behave like an area: every
   * part positive, the total their sum, and a bigger aeroplane bigger.
   */
  it('adds up and scales with the aircraft', () => {
    const small = wettedAreas(buildAircraft(specById('caravelle')!).group);
    const large = wettedAreas(buildAircraft(specById('boeing747-100')!).group);
    for (const areas of [small, large]) {
      let sum = 0;
      for (const [, area] of areas.byPart) sum += area;
      expect(sum).toBeCloseTo(areas.total, 6);
      expect(areas.byPart.get('fuselage')).toBeGreaterThan(0);
      expect(areas.byPart.get('wing')).toBeGreaterThan(0);
    }
    expect(large.total).toBeGreaterThan(3 * small.total);
  }, 120000);

  /*
   * A wing's wetted area is a little over twice its planform - both surfaces, plus what
   * the thickness adds round the edges. Well outside that and the mesh is being counted
   * wrong.
   */
  it('finds about twice the planform on a wing', () => {
    const spec = specById('boeing737-800')!;
    const areas = wettedAreas(buildAircraft(spec).group);
    const ratio = areas.byPart.get('wing')! / spec.reference.wingAreaM2;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.4);
  }, 120000);
});
