import { describe, it, expect } from 'vitest';
import { buildAircraft, type BuiltAircraft } from '../src/aircraft/AircraftBuilder';
import { ROSTER, specById } from '../src/aircraft/roster';
import { cruiseConditions } from '../src/physics/performance/cruise';
import { solveAtLift, solveTrimmed } from '../src/physics/performance/trim';
import { solveAircraft, STABILISER } from '../src/physics/panel/aircraftModel';

/**
 * Trim, which is the difference between an aircraft that is flying and a set of surfaces
 * that happen to be in the air together.
 *
 * Solving for lift alone leaves the tailplane at whatever incidence its geometry gives
 * it, and because that incidence is zero to the body axis for every aircraft here, the
 * tail load came out as almost pure angle of attack: a Comet cruising at 0.65 degrees
 * carried 8% of its lift downward on the tail and a 737 MAX at 4.87 carried 7% upward.
 * Both are wrong, and the second is expensive - several per cent of an aircraft's lift
 * on a twenty-metre span is a lot of induced drag. It was wrecking the span efficiency
 * of exactly the modern, highly loaded aircraft the project is about.
 *
 * These tests hold the trimmed solution to what a trimmed aircraft actually looks like.
 */

const GRAVITY = 9.80665;

const built = new Map<string, BuiltAircraft>();
function aircraft(id: string): BuiltAircraft {
  let model = built.get(id);
  if (!model) {
    model = buildAircraft(specById(id)!, 'low');
    built.set(id, model);
  }
  return model;
}

/** Trimming is four lattice solves, and the roster is walked several times below. */
const trims = new Map<string, ReturnType<typeof solveTrimmed>>();
function trimOf(id: string) {
  let trim = trims.get(id);
  if (!trim) {
    const spec = specById(id)!;
    const conditions = cruiseConditions(spec);
    trim = solveTrimmed(
      aircraft(id).aero,
      spec.reference.cruiseMassKg * GRAVITY,
      conditions.dynamicPressure,
    );
    trims.set(id, trim);
  }
  return trim;
}

describe('a trimmed aircraft balances', () => {
  /**
   * The defining property: the moment about the centre of gravity is gone. Everything
   * else in this file follows from it, and if this fails the rest is meaningless.
   */
  it('leaves no pitching moment', () => {
    for (const id of ['boeing787', 'a350', 'comet1', 'boeing737max']) {
      const { model } = trimOf(id);
      expect(Math.abs(model.Cm), `${id} is not trimmed`).toBeLessThan(1e-3);
    }
  }, 600000);

  /** And it is still holding itself up while doing it. */
  it('still carries its own weight', () => {
    for (const id of ['boeing787', 'a350', 'comet1']) {
      const spec = specById(id)!;
      const conditions = cruiseConditions(spec);
      const { model } = trimOf(id);
      const lift = model.CL * conditions.dynamicPressure * model.referenceArea;
      const weight = spec.reference.cruiseMassKg * GRAVITY;
      expect(Math.abs(lift - weight) / weight, `${id} is not holding itself up`).toBeLessThan(0.01);
    }
  }, 600000);
});

describe('the stabiliser setting is one an aircraft could hold', () => {
  /**
   * A trimmable stabiliser runs between stops. A solution outside them is not a setting,
   * and the solver has to say so rather than report an angle the aircraft cannot reach.
   */
  it('stays inside its travel for every aircraft in the roster', () => {
    const outside: string[] = [];
    for (const spec of ROSTER) {
      const trim = trimOf(spec.id);
      if (!trim.withinTravel && spec.tail.config !== 'delta') outside.push(spec.id);
    }
    expect(outside, `stabiliser hit the stops: ${outside.join(', ')}`).toHaveLength(0);
  }, 600000);

  /**
   * Every one of them trims nose down. A cambered wing at a positive angle pitches nose
   * down about the quarter chord, so the tail has to push down to balance it - which is
   * why a conventional airliner's stabiliser is wound leading edge down in cruise.
   */
  it('trims leading edge down on every conventional aircraft', () => {
    for (const spec of ROSTER) {
      if (spec.tail.config === 'delta') continue;
      expect(trimOf(spec.id).stabiliserDeg, `${spec.id} trims the wrong way`).toBeLessThan(0);
    }
  }, 600000);
});

describe('the trimmed tail carries a download', () => {
  /**
   * This is the point of the whole exercise. A conventional airliner with its centre of
   * gravity ahead of the wing's centre of pressure balances with a download on the tail -
   * every aircraft, at every cruise attitude, because it is the arrangement that makes
   * the aircraft stable. An upload means the aircraft is not trimmed, it is merely
   * flying.
   */
  it('on every conventional aircraft in the roster', () => {
    const uploading: string[] = [];
    for (const spec of ROSTER) {
      if (spec.tail.config === 'delta') continue;
      if (trimOf(spec.id).tailLiftFraction >= 0) uploading.push(spec.id);
    }
    expect(uploading, `tail is lifting on: ${uploading.join(', ')}`).toHaveLength(0);
  }, 600000);

  /**
   * And it is a download of the right size. Trim loads on a transport run to a few per
   * cent of the aircraft's weight; a tenth would be a design mistake rather than a
   * cruise condition.
   */
  it('of a few per cent rather than a large fraction', () => {
    for (const spec of ROSTER) {
      if (spec.tail.config === 'delta') continue;
      const share = Math.abs(trimOf(spec.id).tailLiftFraction);
      expect(share, `${spec.id} carries an implausible tail load`).toBeLessThan(0.15);
    }
  }, 600000);

  /**
   * Trimming for lift alone does NOT give that, and this test records the difference so
   * that nobody quietly reverts to it. An untrimmed tail tracks angle of attack: it
   * pushes down on the aircraft that cruises flat and lifts on the one that cruises at
   * an angle.
   */
  it('unlike an untrimmed one, which simply follows the angle of attack', () => {
    const flat = specById('comet1')!;
    const steep = specById('boeing737max')!;
    const untrimmed = (spec: typeof flat) => {
      const conditions = cruiseConditions(spec);
      const lift = solveAtLift(
        aircraft(spec.id).aero,
        spec.reference.cruiseMassKg * GRAVITY,
        conditions.dynamicPressure,
      );
      const tail = lift.model.surfaces.find((s) => s.name === STABILISER);
      const total = lift.model.surfaces.reduce((sum, s) => sum + s.lift, 0);
      return (tail?.lift ?? 0) / total;
    };
    // The one that cruises nearly flat is pushed down, the one that cruises at an angle
    // is lifted - the tail load is the attitude, not the balance.
    expect(untrimmed(flat)).toBeLessThan(-0.05);
    expect(untrimmed(steep)).toBeGreaterThan(0.05);
    // Trimmed, both are downloads of a sane size.
    expect(trimOf(flat.id).tailLiftFraction).toBeLessThan(0);
    expect(trimOf(steep.id).tailLiftFraction).toBeLessThan(0);
  }, 600000);
});

describe('the stabiliser is a real control', () => {
  /** Winding it changes the moment, or there is nothing to solve with. */
  it('changes the pitching moment when it moves', () => {
    const request = aircraft('boeing787').aero;
    const down = solveAircraft({ ...request, angleDeg: 3, stabiliserIncidenceDeg: -3 });
    const up = solveAircraft({ ...request, angleDeg: 3, stabiliserIncidenceDeg: 1 });
    expect(down.Cm).toBeGreaterThan(up.Cm);
  }, 600000);

  /** And it only touches the tailplane: the wing's own loading is left alone. */
  it('does not disturb the wing', () => {
    const request = aircraft('boeing787').aero;
    const a = solveAircraft({ ...request, angleDeg: 3, stabiliserIncidenceDeg: -3 });
    const b = solveAircraft({ ...request, angleDeg: 3, stabiliserIncidenceDeg: 1 });
    const wingOf = (m: typeof a) => m.surfaces.find((s) => s.name === 'wing')!.lift;
    // Not identical - the tail's field reaches the wing - but close.
    expect(Math.abs(wingOf(a) - wingOf(b)) / Math.abs(wingOf(a))).toBeLessThan(0.05);
  }, 600000);
});
