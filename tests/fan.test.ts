import { describe, it, expect } from 'vitest';
import { blurArcFor, buildRotor, Fan } from '../src/tunnel/Fan';

/**
 * A fan blade's angular width is its chord divided by the local radius, which explodes
 * near the hub: a chord of a fifth of the fan radius spans 150 degrees at a hub a
 * fifteenth of the way out. Unchecked, that turns a rotor into a handful of overlapping
 * shards rather than blades, so the width is capped and these tests hold it to that.
 */
describe('wind tunnel rotor', () => {
  const options = { radius: 20, x: 0, bladeCount: 7 };
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

/**
 * A rotor with N blades repeats every 2*pi/N, so at 60 fps its apparent rotation cannot
 * exceed half that per frame. With eleven blades the fan visually tops out near 164 rpm
 * and beyond that strobes, stops or runs backwards however fast the shaft really turns.
 * Smearing the rotor across the arc it sweeps during a frame is what removes it.
 */
describe('rotor motion blur', () => {
  const BLADES = 7;
  const SPACING = (Math.PI * 2) / BLADES;

  const spun = (metresPerSecond: number) => {
    const fan = new Fan({ radius: 20, x: 0, bladeCount: BLADES });
    fan.setSpeed(metresPerSecond);
    // Long steps to reach the commanded speed, then one frame-sized step to set the smear.
    for (let i = 0; i < 40; i++) fan.update(0.25);
    fan.update(1 / 60);
    return fan;
  };

  it('keeps the blades sharp when the fan is stopped', () => {
    const fan = new Fan({ radius: 20, x: 0, bladeCount: BLADES });
    fan.update(1 / 60);
    expect(fan.blurCopies).toBe(1);
    expect(fan.blurArc).toBe(0);
    fan.dispose();
  });

  it('smears further as the fan speeds up', () => {
    const slow = spun(20);
    const medium = spun(80);
    expect(medium.blurArc).toBeGreaterThan(slow.blurArc);
    expect(medium.blurCopies).toBeGreaterThanOrEqual(slow.blurCopies);
    slow.dispose();
    medium.dispose();
  });

  it('covers a whole blade spacing once it is spinning fast', () => {
    // Below this the image still has gaps between blades and can alias.
    const fan = spun(250);
    expect(fan.blurArc).toBeGreaterThanOrEqual(SPACING);
    fan.dispose();
  });

  it('leaves no angular gap big enough to strobe, at any speed in range', () => {
    for (const kmh of [100, 200, 300, 500, 700, 800, 900, 1100, 1300]) {
      const fan = spun(kmh / 3.6);
      // Where the blades land within one spacing decides what the eye sees, because
      // every spacing looks alike.
      const positions = fan.renderedAngles
        .map((a) => ((a % SPACING) + SPACING) % SPACING)
        .sort((x, y) => x - y);
      let largestGap = positions[0] + (SPACING - positions[positions.length - 1]);
      for (let i = 1; i < positions.length; i++) {
        largestGap = Math.max(largestGap, positions[i] - positions[i - 1]);
      }
      // Either the fan turns slowly enough that a sharp image is unambiguous, or the
      // smear has to cover the spacing evenly enough that consecutive frames match.
      const perFrame = ((kmh / 3.6) * 0.18) / 60;
      const unambiguous = perFrame < SPACING * 0.5;
      if (!unambiguous) expect(largestGap).toBeLessThan(SPACING * 0.3);
      fan.dispose();
    }
  });

  it('opens the smear out before the pattern can start to strobe', () => {
    const spacing = SPACING;
    // Crisp while a frame's rotation is clearly unambiguous.
    expect(blurArcFor(spacing * 0.2, spacing)).toBeLessThan(spacing * 0.35);
    // Fully covering by the time it approaches the Nyquist limit of half a spacing.
    expect(blurArcFor(spacing * 0.45, spacing)).toBeGreaterThanOrEqual(spacing);
    expect(blurArcFor(spacing * 3, spacing)).toBeGreaterThanOrEqual(spacing);
    // And widening monotonically in between, so a slider drag does not snap.
    let previous = 0;
    for (let i = 0; i <= 40; i++) {
      const arc = blurArcFor(spacing * (i / 20), spacing);
      expect(arc).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = arc;
    }
  });

  it('never draws more copies than the budget allows', () => {
    const fan = spun(400);
    expect(fan.blurCopies).toBeLessThanOrEqual(12);
    fan.dispose();
  });

  it('still advances the shaft at the commanded speed', () => {
    // The blur changes how the rotor is drawn, not how fast it turns.
    const fan = new Fan({ radius: 20, x: 0 });
    fan.setSpeed(250);
    for (let i = 0; i < 40; i++) fan.update(0.25);
    const before = fan.shaftAngle;
    fan.update(1);
    const turned = Math.abs(fan.shaftAngle - before);
    expect(turned).toBeCloseTo(250 * 0.18, 0);
    fan.dispose();
  });
});
