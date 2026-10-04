import { describe, it, expect } from 'vitest';
import { buildAircraft } from '../src/aircraft/AircraftBuilder';
import { ROSTER, specById } from '../src/aircraft/roster';
import { solveAircraft, CRUISE_ANGLE_DEG } from '../src/physics/panel/aircraftModel';

/**
 * The three solvers assembled into an aeroplane.
 *
 * These are the checks that an aircraft, rather than a wing, has to pass: both halves
 * lift the same way, the loading falls off towards the tips, a near-vertical winglet
 * carries circulation without carrying lift, and nothing comes back as a NaN on any of
 * the twenty-one types in the roster.
 */

const solve = (id: string, angleDeg = CRUISE_ANGLE_DEG) => {
  const built = buildAircraft(specById(id)!, 'low');
  const model = solveAircraft({ ...built.aero, angleDeg });
  built.dispose();
  return model;
};

describe('every aircraft in the roster', () => {
  const solved = ROSTER.map((spec) => {
    const built = buildAircraft(spec, 'low');
    const model = solveAircraft(built.aero);
    built.dispose();
    return { spec, model };
  });

  it('produces a finite answer', () => {
    for (const { spec, model } of solved) {
      expect(Number.isFinite(model.CL), spec.id).toBe(true);
      expect(Number.isFinite(model.CDi), spec.id).toBe(true);
      for (const surface of model.surfaces) {
        for (const section of surface.sections) {
          for (const cp of section.upper) expect(Number.isFinite(cp), spec.id).toBe(true);
          for (const cp of section.lower) expect(Number.isFinite(cp), spec.id).toBe(true);
        }
      }
    }
  });

  it('lifts, by a believable amount for a cruise angle', () => {
    for (const { spec, model } of solved) {
      expect(model.CL, spec.id).toBeGreaterThan(0);
      // Concorde's delta is the outlier at the bottom: a slender wing needs a far larger
      // angle to do the same work, which is why it lands nose-high.
      expect(model.CL, spec.id).toBeLessThan(0.7);
    }
  });

  it('pays induced drag, and never recovers any', () => {
    for (const { spec, model } of solved) expect(model.CDi, spec.id).toBeGreaterThan(0);
  });

  it('never beats the elliptical minimum by more than discretisation', () => {
    for (const { spec, model } of solved) {
      expect(model.spanEfficiency, spec.id).toBeGreaterThan(0.4);
      expect(model.spanEfficiency, spec.id).toBeLessThan(1.06);
    }
  });

  it('gives Concorde the lowest aspect ratio and the modern twins the highest', () => {
    const by = (id: string) => solved.find((s) => s.spec.id === id)!.model.aspectRatio;
    expect(by('concorde')).toBeLessThan(3);
    expect(by('comet1')).toBeLessThan(by('a350'));
    expect(by('boeing707')).toBeLessThan(by('boeing787'));
  });

  it('suctions the upper surface of every wing', () => {
    for (const { spec, model } of solved) {
      const wing = model.surfaces.find((s) => s.name === 'wing');
      const peak = Math.min(...(wing?.sections.flatMap((s) => [...s.upper]) ?? [1]));
      expect(peak, spec.id).toBeLessThan(-0.15);
      // Incompressible flow cannot exceed stagnation.
      const highest = Math.max(...(wing?.sections.flatMap((s) => [...s.upper, ...s.lower]) ?? [0]));
      expect(highest, spec.id).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('lift behaves', () => {
  it('grows with angle of attack', () => {
    const low = solve('boeing737-800', 0).CL;
    const mid = solve('boeing737-800', 2.5).CL;
    const high = solve('boeing737-800', 5).CL;
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('loads the root harder than the tip', () => {
    const wing = solve('boeing777').surfaces.find((s) => s.name === 'wing')!;
    const root = wing.sections[0].cl;
    const tip = wing.sections[wing.sections.length - 1].cl;
    expect(root).toBeGreaterThan(tip);
  });

  /**
   * Both halves have to carry circulation the same way round. They did not at first: the
   * mirrored side's bound vortices ran the other way, the two wings cancelled exactly,
   * and every aircraft in the roster reported a lift coefficient of zero while its
   * individual sections all reported sensible numbers.
   */
  it('does not cancel between the two wings', () => {
    for (const id of ['comet1', 'boeing747-100', 'a350']) {
      expect(Math.abs(solve(id).CL)).toBeGreaterThan(0.1);
    }
  });

  /**
   * A winglet is not more span. It stands nearly vertical, so it carries circulation and
   * almost no lift, and it adds almost nothing to the planform area. Modelled as a
   * horizontal surface it would read as extra wing, which is the opposite of the point.
   */
  it('gives a winglet circulation but barely any lift', () => {
    const wing = solve('a320neo').surfaces.find((s) => s.name === 'wing')!;
    const root = wing.sections[0].cl;
    const tipDevice = wing.sections[wing.sections.length - 1].cl;
    expect(tipDevice).toBeLessThan(0.4 * root);
  });
});

/**
 * A finding rather than a check, pinned so that it is not mistaken for a bug later.
 *
 * Washout costs inviscid span efficiency, and the more of it a wing has the more it
 * costs: the 787's five degrees drops its span efficiency from 1.01 to 0.61, and the
 * Comet's two degrees from 1.05 to 1.00. That is real - unloading the tip moves the
 * loading away from elliptical - but it is not the whole story for a real wing, which
 * varies its camber along the span so that twist and camber together come out elliptical
 * at cruise. These wings carry one camber from root to tip, so the washout is
 * uncompensated and the model understates the efficiency of the wings with the most of
 * it, which is the modern ones.
 *
 * It does not affect the pressure map, which shows the loading the model actually has.
 * It does affect any comparison of induced drag across the eras, so stage 8 has to
 * either vary camber spanwise or say this out loud.
 */
describe('washout, and what this model does not know about it', () => {
  const withTwist = (id: string, twistDeg: number) => {
    const built = buildAircraft(specById(id)!, 'low');
    const surfaces = built.aero.surfaces.map((s) =>
      s.name === 'wing' ? { ...s, params: { ...s.params, twistDeg } } : s,
    );
    const model = solveAircraft({ ...built.aero, surfaces });
    built.dispose();
    return model;
  };

  it('costs span efficiency, in proportion to how much there is', () => {
    const none = withTwist('boeing787', 0).spanEfficiency;
    const some = withTwist('boeing787', -2).spanEfficiency;
    const lots = withTwist('boeing787', -5).spanEfficiency;
    expect(none).toBeGreaterThan(some);
    expect(some).toBeGreaterThan(lots);
    expect(none).toBeGreaterThan(0.95);
  });

  it('unloads the tip, which is what it is for', () => {
    const tipOf = (twist: number) => {
      const wing = withTwist('boeing787', twist).surfaces.find((s) => s.name === 'wing')!;
      return wing.sections[wing.sections.length - 1].cl;
    };
    expect(tipOf(-5)).toBeLessThan(tipOf(0));
  });
});
