import { describe, it, expect } from 'vitest';
import { chordPositionFromContour } from '../src/physics/surface/bakeCp';

/**
 * Turning a vertex's place around the airfoil contour back into a chordwise position.
 *
 * The loft already records where every vertex sits — around the section in u, along the
 * span in v — so the pressure map never has to work it back out from the geometry. What
 * it does have to do is undo the cosine spacing the airfoil was drawn with. Treating the
 * contour as evenly spaced would put the leading edge in the wrong place by a tenth of a
 * chord, and the suction peak lives in the first tenth.
 */
describe('reading a chordwise position off the contour', () => {
  const resolution = 60;
  const at = (u: number) => chordPositionFromContour(u, resolution);

  it('starts and ends at the trailing edge', () => {
    expect(at(0).chordFraction).toBeCloseTo(1, 3);
    expect(at(1).chordFraction).toBeCloseTo(1, 3);
  });

  it('reaches the leading edge half way round', () => {
    expect(at(0.5).chordFraction).toBeCloseTo(0, 2);
  });

  it('calls the first half the upper surface and the second the lower', () => {
    expect(at(0.1).upper).toBe(true);
    expect(at(0.45).upper).toBe(true);
    expect(at(0.6).upper).toBe(false);
    expect(at(0.95).upper).toBe(false);
  });

  it('runs forward along the top and back along the bottom', () => {
    let previous = Infinity;
    for (let u = 0; u <= 0.5; u += 0.02) {
      const { chordFraction } = at(u);
      expect(chordFraction).toBeLessThanOrEqual(previous + 1e-9);
      previous = chordFraction;
    }
    previous = -Infinity;
    for (let u = 0.5; u <= 1; u += 0.02) {
      const { chordFraction } = at(u);
      expect(chordFraction).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = chordFraction;
    }
  });

  it('packs its samples towards both edges, as the airfoil was drawn', () => {
    // Cosine spacing clusters at the leading edge and the trailing edge alike, and
    // spreads out across the middle. Equal steps around the contour would cover equal
    // chord everywhere; here the same step covers several times more at mid-chord.
    const step = 0.06;
    const span = (from: number) =>
      Math.abs(at(from + step).chordFraction - at(from).chordFraction);
    expect(span(0.44)).toBeLessThan(span(0.22) * 0.4);
    expect(span(0)).toBeLessThan(span(0.22) * 0.4);
  });

  it('stays inside the chord however odd the input', () => {
    for (const u of [-1, 0, 0.5, 1, 2]) {
      const { chordFraction } = at(u);
      expect(chordFraction).toBeGreaterThanOrEqual(0);
      expect(chordFraction).toBeLessThanOrEqual(1);
    }
  });
});
