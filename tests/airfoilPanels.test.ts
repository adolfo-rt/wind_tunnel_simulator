import { describe, it, expect } from 'vitest';
import { generateAirfoil } from '../src/aircraft/airfoil';
import {
  angleForLift,
  liftFromPressure,
  sectionLift,
  sectionPressures,
  solveSection,
} from '../src/physics/panel/airfoilPanels';

/**
 * The section solver, against the section everyone checks against.
 *
 * NACA 0012 is the most measured airfoil in existence, so there is no excuse for not
 * knowing what the answer should be. Inviscid, at no incidence, its minimum pressure
 * coefficient is about -0.41 and it sits at roughly 12% of chord. That one number catches
 * most of what can go wrong here, because almost any error in the panelling moves it.
 */

const DEG = Math.PI / 180;

const section = (
  thickness: number,
  camber: number,
  family: 'naca4' | 'peaky' | 'supercritical' = 'naca4',
) => solveSection(generateAirfoil({ thickness, camber, family, resolution: 80 }));

describe('a symmetric section', () => {
  it('makes no lift at no incidence, exactly', () => {
    expect(section(0.12, 0).liftX).toBeCloseTo(0, 10);
  });

  it('has a stagnation point, and nothing anywhere faster than one', () => {
    const solved = section(0.12, 0);
    const cp = sectionPressures(solved, 0);
    expect(Math.max(...cp)).toBeGreaterThan(0.97);
    // Incompressible flow cannot push a pressure coefficient above 1: that is the
    // stagnation value, where all the dynamic pressure has been recovered.
    expect(Math.max(...cp)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('puts its suction peak where the published data does', () => {
    const solved = section(0.12, 0);
    const cp = sectionPressures(solved, 0);
    let lowest = Infinity;
    let at = 0;
    for (let i = 0; i < cp.length; i++) {
      if (cp[i] < lowest) {
        lowest = cp[i];
        at = solved.x[i];
      }
    }
    expect(lowest).toBeCloseTo(-0.41, 1);
    expect(at).toBeCloseTo(0.12, 1);
  });

  it('is symmetric top to bottom', () => {
    const solved = section(0.12, 0);
    const cp = sectionPressures(solved, 0);
    // Every upper panel has a mirror below it carrying the same pressure.
    for (let i = 0; i < cp.length; i++) {
      if (!solved.upper[i]) continue;
      let best = Infinity;
      let mirrored = 0;
      for (let j = 0; j < cp.length; j++) {
        if (solved.upper[j]) continue;
        const d = Math.abs(solved.x[j] - solved.x[i]);
        if (d < best) {
          best = d;
          mirrored = cp[j];
        }
      }
      expect(cp[i]).toBeCloseTo(mirrored, 2);
    }
  });
});

describe('lift', () => {
  it('follows thin-airfoil theory, a little steepened by thickness', () => {
    const slope = section(0.12, 0).liftY;
    expect(slope).toBeGreaterThan(2 * Math.PI);
    // A thin section gives 2*pi; a real one is steeper, by roughly 0.77 * thickness.
    // That correction is an empirical fit rather than a theorem, so the bound is
    // relative: within 2% is as much agreement as it is worth claiming.
    const thickEstimate = 2 * Math.PI * (1 + 0.77 * 0.12);
    expect(Math.abs(slope - thickEstimate) / thickEstimate).toBeLessThan(0.02);
  });

  it('steepens further as the section thickens', () => {
    expect(section(0.18, 0).liftY).toBeGreaterThan(section(0.08, 0).liftY);
  });

  /**
   * Circulation and surface pressure are genuinely separate routes to the lift —
   * circulation is an unknown the solve returns, pressure is what comes out afterwards.
   * They have no reason to agree unless both are right.
   */
  it('agrees whether taken from circulation or from the pressure on the skin', () => {
    const solved = section(0.12, 0.02);
    for (const angle of [0, 2, 4, 6]) {
      const fromCirculation = sectionLift(solved, angle * DEG);
      const fromPressure = liftFromPressure(solved, angle * DEG);
      expect(fromPressure).toBeCloseTo(fromCirculation, 1);
      expect(Math.abs(fromPressure - fromCirculation)).toBeLessThan(
        0.03 * Math.abs(fromCirculation) + 0.01,
      );
    }
  });

  it('comes from camber even at no incidence', () => {
    expect(section(0.12, 0.02).liftX).toBeGreaterThan(0.1);
    expect(section(0.12, 0.04).liftX).toBeGreaterThan(section(0.12, 0.02).liftX);
  });

  it('can be inverted to find the incidence a section needs', () => {
    const solved = section(0.12, 0.02);
    for (const target of [-0.2, 0, 0.35, 0.8]) {
      expect(sectionLift(solved, angleForLift(solved, target))).toBeCloseTo(target, 6);
    }
  });
});

/**
 * The comparison the whole project exists to make.
 *
 * A supercritical section carries its lift further aft, which is what lets the upper
 * surface stay flat and keeps the shock weak at cruise Mach. That it needs less incidence
 * for the same lift, and loads further back when it gets there, is the shape of the
 * improvement that took airliners from the Comet's thick unswept wing to the A350's.
 */
describe('the sections differ the way the eras did', () => {
  const centreOfPressure = (family: 'naca4' | 'peaky' | 'supercritical') => {
    const solved = section(0.11, 0.02, family);
    const angle = angleForLift(solved, 0.5);
    const cp = sectionPressures(solved, angle);
    let moment = 0;
    let load = 0;
    for (let i = 0; i < cp.length; i++) {
      const lift = solved.upper[i] ? -cp[i] : cp[i];
      moment += lift * solved.x[i];
      load += lift;
    }
    return moment / load;
  };

  it('loads the supercritical section furthest aft', () => {
    const classic = centreOfPressure('naca4');
    const peaky = centreOfPressure('peaky');
    const supercritical = centreOfPressure('supercritical');
    expect(peaky).toBeGreaterThan(classic);
    expect(supercritical).toBeGreaterThan(peaky);
    expect(supercritical - classic).toBeGreaterThan(0.03);
  });

  it('lets it reach the same lift at a smaller angle', () => {
    const angle = (family: 'naca4' | 'peaky' | 'supercritical') =>
      angleForLift(section(0.11, 0.02, family), 0.5);
    expect(angle('supercritical')).toBeLessThan(angle('peaky'));
    expect(angle('peaky')).toBeLessThan(angle('naca4'));
  });
});

describe('panelling', () => {
  it('leaves no degenerate panel at a closed trailing edge', () => {
    // The upper and lower surfaces meet there to within rounding rather than exactly, so
    // an equality test misses the duplicate and leaves a zero-length panel. Its column in
    // the matrix is all zeros, the system is singular, and the symmetric section above
    // came out with a lift coefficient of eight.
    const contour = generateAirfoil({ thickness: 0.12, camber: 0, family: 'naca4', resolution: 80 });
    expect(solveSection(contour).x).toHaveLength(contour.length - 1);
  });

  it('splits the surface into an upper and a lower half', () => {
    const solved = section(0.12, 0.02);
    const upper = solved.upper.filter(Boolean).length;
    expect(upper).toBeGreaterThan(0.4 * solved.upper.length);
    expect(upper).toBeLessThan(0.6 * solved.upper.length);
  });
});
