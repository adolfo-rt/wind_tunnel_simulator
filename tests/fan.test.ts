import { describe, it, expect } from 'vitest';
import { buildRotor } from '../src/tunnel/Fan';

/**
 * A fan blade's angular width is its chord divided by the local radius, which explodes
 * near the hub: a chord of a fifth of the fan radius spans 150 degrees at a hub a
 * fifteenth of the way out. Unchecked, that turns a rotor into a handful of overlapping
 * shards rather than blades, so the width is capped and these tests hold it to that.
 */
describe('wind tunnel rotor', () => {
  const options = { radius: 20, x: 0, bladeCount: 11 };
  const SPAN_STEPS = 6;
  const VERTICES_PER_BLADE = (SPAN_STEPS + 1) * 2;

  const blades = (geometry: ReturnType<typeof buildRotor>) => {
    const position = geometry.getAttribute('position');
    const out: Array<Array<{ r: number; theta: number; x: number }>> = [];
    for (let i = 0; i < position.count; i += VERTICES_PER_BLADE) {
      const blade = [];
      for (let j = 0; j < VERTICES_PER_BLADE; j++) {
        const y = position.getY(i + j);
        const z = position.getZ(i + j);
        blade.push({ r: Math.hypot(y, z), theta: Math.atan2(y, z), x: position.getX(i + j) });
      }
      out.push(blade);
    }
    return out;
  };

  it('splits into the expected number of blades', () => {
    const all = blades(buildRotor(options));
    expect(all).toHaveLength(options.bladeCount);
  });

  it('never lets a blade span more than its share of the disc', () => {
    const spacing = (Math.PI * 2) / options.bladeCount;
    for (const blade of blades(buildRotor(options))) {
      for (let s = 0; s < VERTICES_PER_BLADE; s += 2) {
        const width = Math.abs(blade[s].theta - blade[s + 1].theta);
        // Wrapped angles would read as nearly a full turn; neither case is allowed.
        const angular = Math.min(width, Math.PI * 2 - width);
        expect(angular).toBeLessThan(spacing);
      }
    }
  });

  it('keeps every blade between the hub and the tip', () => {
    const geometry = buildRotor(options);
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      const r = Math.hypot(position.getY(i), position.getZ(i));
      expect(r).toBeGreaterThan(options.radius * 0.19);
      expect(r).toBeLessThan(options.radius * 0.96);
    }
  });

  it('twists the blades, so they are not a flat disc', () => {
    const geometry = buildRotor(options);
    const position = geometry.getAttribute('position');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < position.count; i++) {
      min = Math.min(min, position.getX(i));
      max = Math.max(max, position.getX(i));
    }
    expect(max - min).toBeGreaterThan(options.radius * 0.02);
    // ...but the rotor is a disc, not a screw: it stays thin along the shaft.
    expect(max - min).toBeLessThan(options.radius * 0.35);
  });

  it('narrows the blade root, since a constant chord cannot fit there', () => {
    const all = blades(buildRotor(options));
    const blade = all[0];
    const widthAt = (s: number) => {
      const w = Math.abs(blade[s * 2].theta - blade[s * 2 + 1].theta);
      return Math.min(w, Math.PI * 2 - w);
    };
    // Chord over radius keeps shrinking outboard, so the tip is the narrowest in angle.
    expect(widthAt(SPAN_STEPS)).toBeLessThan(widthAt(0));
  });

  it('reverses the blade twist for an outlet fan', () => {
    const forward = buildRotor(options);
    const reversed = buildRotor({ ...options, reversed: true });
    const firstX = (g: ReturnType<typeof buildRotor>) => g.getAttribute('position').getX(0);
    expect(Math.sign(firstX(forward))).toBe(-Math.sign(firstX(reversed)));
  });
});
