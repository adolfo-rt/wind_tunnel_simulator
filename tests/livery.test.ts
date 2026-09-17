import { describe, it, expect } from 'vitest';
import { mirroredBand } from '../src/aircraft/build/livery';

/**
 * The fuselage texture wraps with u = 0 at the starboard equator, u = 0.25 at the crown
 * and u = 0.5 at the port equator, so the mirror plane maps u to 0.5 - u. Anything that
 * runs down both sides has to respect that, or the aircraft is visibly lopsided from the
 * front — which is exactly what happened when the same offset was added to both sides.
 */
describe('mirrored side features', () => {
  const CROWN = 0.25;

  it('places the port band at the mirror of the starboard one', () => {
    const [starboard, port] = mirroredBand(0.077, 0.016);
    expect(starboard.u).toBeCloseTo(0.077, 10);
    expect(port.u).toBeCloseTo(0.5 - 0.077 - 0.016, 10);
    expect(port.span).toBe(starboard.span);
  });

  it.each([
    ['window line', 0.055, 0.012],
    ['cheatline', 0.077, 0.016],
    ['doors', 0.043, 0.05],
    ['upper deck windows', 0.11, 0.012],
  ])('keeps the %s equidistant from the crown on both sides', (_name, u, span) => {
    const [starboard, port] = mirroredBand(u, span);
    const starboardCentre = starboard.u + starboard.span / 2;
    const portCentre = port.u + port.span / 2;
    // Mirror images satisfy u + u' = 0.5, so both sit the same distance from the crown.
    expect(starboardCentre + portCentre).toBeCloseTo(0.5, 10);
    expect(Math.abs(CROWN - starboardCentre)).toBeCloseTo(Math.abs(portCentre - CROWN), 10);
  });

  it('is its own inverse', () => {
    const [, port] = mirroredBand(0.077, 0.016);
    const [, back] = mirroredBand(port.u, port.span);
    expect(back.u).toBeCloseTo(0.077, 10);
  });

  it('keeps every side feature off the crown and off the keel', () => {
    for (const [u, span] of [[0.055, 0.012], [0.077, 0.016], [0.043, 0.05], [0.11, 0.012]]) {
      for (const band of mirroredBand(u, span)) {
        expect(band.u).toBeGreaterThan(0);
        expect(band.u + band.span).toBeLessThan(0.5);
      }
    }
  });

  it('puts the upper deck windows above the main cabin windows, not below', () => {
    // Higher u on the starboard side means higher up the fuselage.
    const [mainDeck] = mirroredBand(0.055, 0.012);
    const [upperDeck] = mirroredBand(0.11, 0.012);
    expect(upperDeck.u).toBeGreaterThan(mainDeck.u);
  });
});
