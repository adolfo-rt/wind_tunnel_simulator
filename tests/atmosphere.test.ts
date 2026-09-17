import { describe, it, expect } from 'vitest';
import {
  atmosphereAt,
  dynamicViscosity,
  machNumber,
  reynoldsNumber,
  speedOfSound,
  SEA_LEVEL,
} from '../src/core/atmosphere';

describe('International Standard Atmosphere', () => {
  it('reproduces sea level conditions', () => {
    const sea = atmosphereAt(0);
    expect(sea.temperature).toBeCloseTo(288.15, 2);
    expect(sea.pressure).toBeCloseTo(101325, 0);
    expect(sea.density).toBeCloseTo(1.225, 3);
    expect(sea.speedOfSound).toBeCloseTo(340.29, 1);
  });

  it('reproduces the tropopause, where airliners cruise', () => {
    const tropopause = atmosphereAt(11000);
    // Published ISA values at 11 km.
    expect(tropopause.temperature).toBeCloseTo(216.65, 2);
    expect(tropopause.pressure).toBeCloseTo(22632, -1);
    expect(tropopause.density).toBeCloseTo(0.3639, 3);
    expect(tropopause.speedOfSound).toBeCloseTo(295.07, 1);
  });

  it('holds temperature constant above the tropopause but keeps losing pressure', () => {
    const lower = atmosphereAt(12000);
    const upper = atmosphereAt(16000);
    expect(lower.temperature).toBeCloseTo(216.65, 2);
    expect(upper.temperature).toBeCloseTo(216.65, 2);
    expect(upper.pressure).toBeLessThan(lower.pressure);
    expect(upper.density).toBeLessThan(lower.density);
  });

  it('falls monotonically in density with altitude', () => {
    let previous = Infinity;
    for (let h = 0; h <= 20000; h += 500) {
      const density = atmosphereAt(h).density;
      expect(density).toBeLessThan(previous);
      previous = density;
    }
  });

  it('treats altitudes below sea level as sea level', () => {
    expect(atmosphereAt(-500).pressure).toBeCloseTo(atmosphereAt(0).pressure, 6);
  });
});

describe('speed of sound', () => {
  it('matches the standard value at 15 C', () => {
    expect(speedOfSound(288.15)).toBeCloseTo(340.29, 1);
  });

  it('falls with temperature, which is why cruise Mach is faster than it feels', () => {
    // The same Mach number is a slower true airspeed up high.
    expect(speedOfSound(216.65)).toBeLessThan(speedOfSound(288.15));
  });
});

describe('Mach number', () => {
  it('is 1 at the local speed of sound', () => {
    const sea = atmosphereAt(0);
    expect(machNumber(sea.speedOfSound, sea)).toBeCloseTo(1, 6);
  });

  it('gives a typical cruise true airspeed near 250 m/s at the tropopause', () => {
    const cruise = atmosphereAt(11000);
    const trueAirspeed = 0.85 * cruise.speedOfSound;
    expect(trueAirspeed).toBeGreaterThan(240);
    expect(trueAirspeed).toBeLessThan(260);
  });
});

describe('Reynolds number', () => {
  it('matches Sutherland viscosity at the reference temperature', () => {
    expect(dynamicViscosity(273.15)).toBeCloseTo(1.716e-5, 8);
    expect(dynamicViscosity(288.15)).toBeCloseTo(SEA_LEVEL.viscosity, 6);
  });

  it('puts an airliner at cruise around 10^7, as the documentation claims', () => {
    const cruise = atmosphereAt(11000);
    // A350 at Mach 0.85 on a mean aerodynamic chord of roughly 7 m.
    const re = reynoldsNumber(0.85 * cruise.speedOfSound, 7, cruise);
    expect(re).toBeGreaterThan(1e7);
    expect(re).toBeLessThan(1e8);
  });

  it('scales linearly with speed and with reference length', () => {
    const sea = atmosphereAt(0);
    const base = reynoldsNumber(100, 5, sea);
    expect(reynoldsNumber(200, 5, sea)).toBeCloseTo(base * 2, 6);
    expect(reynoldsNumber(100, 10, sea)).toBeCloseTo(base * 2, 6);
  });
});
