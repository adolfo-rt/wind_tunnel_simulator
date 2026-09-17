import { describe, it, expect } from 'vitest';
import { generateAirfoil, nacaThickness, airfoilArea } from '../src/aircraft/airfoil';

describe('NACA 4-digit thickness distribution', () => {
  // Published NACA 0012 ordinates (original open trailing edge).
  const published: Array<[number, number]> = [
    [0.0125, 0.01894],
    [0.025, 0.02615],
    [0.05, 0.03555],
    [0.1, 0.04683],
    [0.2, 0.05737],
    [0.3, 0.06002],
    [0.5, 0.05294],
    [0.7, 0.03664],
    [0.9, 0.01448],
    [1.0, 0.00126],
  ];

  it.each(published)('matches the published ordinate at x/c = %f', (x, y) => {
    expect(nacaThickness(x, 0.12, false)).toBeCloseTo(y, 4);
  });

  it('peaks at very close to the nominal thickness', () => {
    let max = 0;
    for (let i = 0; i <= 1000; i++) max = Math.max(max, nacaThickness(i / 1000, 0.15));
    // Half-thickness at the peak is half of the nominal t/c.
    expect(max * 2).toBeCloseTo(0.15, 2);
  });
});

describe('generateAirfoil', () => {
  it('produces a symmetric section when camber is zero', () => {
    const contour = generateAirfoil({ thickness: 0.12, camber: 0, family: 'naca4', resolution: 40 });
    // The contour runs TE -> upper -> LE -> lower -> TE, so point i and its mirror
    // across the leading edge should have equal and opposite y.
    const n = contour.length;
    for (let i = 0; i < 40; i++) {
      const upper = contour[i];
      const lower = contour[n - 1 - i];
      expect(upper.x).toBeCloseTo(lower.x, 10);
      expect(upper.y).toBeCloseTo(-lower.y, 10);
    }
  });

  it('gives a cambered section positive area and a raised mean line', () => {
    const flat = generateAirfoil({ thickness: 0.12, camber: 0, family: 'naca4' });
    const cambered = generateAirfoil({ thickness: 0.12, camber: 0.02, family: 'naca4' });
    expect(airfoilArea(flat)).toBeGreaterThan(0);
    // Camber lifts the section without changing its thickness, so areas stay close.
    expect(airfoilArea(cambered)).toBeCloseTo(airfoilArea(flat), 2);
    const meanY = cambered.reduce((s, p) => s + p.y, 0) / cambered.length;
    expect(meanY).toBeGreaterThan(0);
  });

  it('gives a supercritical section aft-loaded camber and a blunter nose', () => {
    const sc = generateAirfoil({ thickness: 0.11, camber: 0.02, family: 'supercritical' });
    const classic = generateAirfoil({ thickness: 0.11, camber: 0.02, family: 'naca4' });

    // Blunter nose: more thickness very close to the leading edge.
    const noseThickness = (c: ReturnType<typeof generateAirfoil>) => {
      const near = c.filter((p) => p.x > 0.002 && p.x < 0.02);
      return Math.max(...near.map((p) => Math.abs(p.y)));
    };
    expect(noseThickness(sc)).toBeGreaterThan(noseThickness(classic));

    // Aft loading: the camber line's peak sits behind mid-chord.
    // The contour pairs index i (upper) with n-1-i (lower) at the same chord station,
    // so averaging the pair recovers the mean line.
    const camberPeakX = (c: ReturnType<typeof generateAirfoil>) => {
      const n = c.length;
      let bestX = 0;
      let best = -Infinity;
      for (let i = 0; i < (n + 1) / 2; i++) {
        const meanY = (c[i].y + c[n - 1 - i].y) / 2;
        if (meanY > best) {
          best = meanY;
          bestX = (c[i].x + c[n - 1 - i].x) / 2;
        }
      }
      return bestX;
    };

    // Shape function x^2(1-x) peaks at x = 2/3; the classic mean line peaks at p = 0.4.
    expect(camberPeakX(sc)).toBeGreaterThan(0.5);
    expect(camberPeakX(classic)).toBeLessThan(0.5);
  });

  it('returns a closed contour of the expected length', () => {
    const contour = generateAirfoil({ thickness: 0.1, camber: 0.01, family: 'peaky', resolution: 32 });
    expect(contour).toHaveLength(63);
    expect(contour[0].x).toBeCloseTo(1, 6);
    expect(contour[contour.length - 1].x).toBeCloseTo(1, 6);
  });
});
