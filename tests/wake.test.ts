import { describe, it, expect } from 'vitest';
import { buildAircraft } from '../src/aircraft/AircraftBuilder';
import { ROSTER, specById } from '../src/aircraft/roster';
import {
  solveAircraft,
  CRUISE_ANGLE_DEG,
  type PanelAircraft,
} from '../src/physics/panel/aircraftModel';
import { wakeVelocity, type WakeFilament } from '../src/physics/panel/wakeField';
import type { Vec3 } from '../src/physics/panel/vlm';

const STREAM = {
  x: Math.cos((CRUISE_ANGLE_DEG * Math.PI) / 180),
  y: Math.sin((CRUISE_ANGLE_DEG * Math.PI) / 180),
  z: 0,
};

/** Solving an aircraft costs a tenth of a second; the whole roster is wanted twice over. */
const solved = new Map<string, PanelAircraft>();
function modelOf(id: string): PanelAircraft {
  let model = solved.get(id);
  if (!model) {
    model = solveAircraft(buildAircraft(specById(id)!).aero);
    solved.set(id, model);
  }
  return model;
}

/** Circulation accumulated across the span, which is the span loading rebuilt from the wake. */
function spanLoadIntegral(wake: readonly WakeFilament[]): number {
  const sorted = [...wake].sort((p, q) => p.z - q.z);
  let running = 0;
  let integral = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    running += sorted[i].gamma;
    integral += running * (sorted[i + 1].z - sorted[i].z);
  }
  return integral;
}

/** The same wake without roll-up: the classical rigid sheet, for comparison. */
function straightened(wake: readonly WakeFilament[]): WakeFilament[] {
  return wake.map((f) => ({ ...f, roll: { x: f.x, y: f.y, z: f.z } }));
}

describe('the trailing wake', () => {
  /*
   * Helmholtz, as an accounting identity: the aircraft sheds as much circulation one way
   * as the other, because the bound circulation starts at nothing beyond one tip and
   * ends at nothing beyond the other.
   */
  it('sheds no net circulation', () => {
    for (const spec of ROSTER) {
      const { wake } = modelOf(spec.id);
      const total = wake.reduce((sum, f) => sum + f.gamma, 0);
      const strongest = wake.reduce((most, f) => Math.max(most, Math.abs(f.gamma)), 0);
      expect(Math.abs(total), spec.id).toBeLessThan(1e-6 * strongest);
    }
  }, 60000);

  /*
   * An aeroplane symmetric about its centreline, flown with no sideslip, sheds a wake
   * symmetric about its centreline. Position as well as strength.
   *
   * This is the test that pays for itself, and it is the only one here that catches what
   * it was written for. The lattice swaps the ends of the bound vortex on the mirrored
   * wing — it has to, or the two halves carry opposite circulation and cancel — so a
   * strip's two edges are not inboard and outboard in the same order on both sides. The
   * wake walk trusted the names: every filament on the left wing came out one strip too
   * far inboard, the tip vortex a strip short of the tip, and a spurious filament on the
   * centreline. Every force the model reports was unchanged and the picture would have
   * looked entirely reasonable.
   *
   * It also catches the subtler one underneath. Neighbouring strips put the corner they
   * share in two slightly different places, because each lays its bound vortex at its own
   * average twist; taking either one biases the wake towards one neighbour, and the two
   * wings are walked in opposite directions, so the bias lands opposite ways on opposite
   * sides. A centimetre of asymmetry on an aeroplane that has none.
   */
  it('is antisymmetric about the centreline', () => {
    for (const spec of ROSTER) {
      const { wake } = modelOf(spec.id);
      const span = Math.max(...wake.map((f) => Math.abs(f.z)));
      const tolerance = 1e-6 * span;
      for (const f of wake) {
        const mate = wake.find(
          (g) => g !== f && Math.abs(g.z + f.z) < tolerance && Math.abs(g.x - f.x) < tolerance,
        );
        expect(mate, `${spec.id}: nothing mirrors z=${f.z.toFixed(3)} x=${f.x.toFixed(3)}`).toBeDefined();
        expect(mate!.gamma, spec.id).toBeCloseTo(-f.gamma, 8);
        expect(mate!.y, spec.id).toBeCloseTo(f.y, 8);
      }
    }
  }, 60000);

  /*
   * The wake carries the lift.
   *
   * Circulation at a spanwise station is whatever has not been shed outboard of it, so
   * the span loading can be rebuilt from the filaments alone and turned back into lift
   * by Kutta-Joukowski. It has to agree with the lift the lattice reported, which it got
   * a different way: from each bound segment's own circulation and normal.
   *
   * The two differ by a few tenths of a percent, and the residual is understood rather
   * than tolerated. The lattice counts only the component of each segment's force along
   * the lift axis, so it carries a cosine of the local pitch that the plain spanwise
   * integral of circulation does not. The evidence is in the ordering: Concorde, whose
   * sections are nearly symmetric and barely loaded, agrees to 0.01%, the 1950s wings to
   * about 0.3%, and the modern supercritical ones — which are the most cambered — to
   * 0.6-0.8%. Camber is what sets the local pitch.
   *
   * What this does *not* do is check where the filaments are. With the displacement bug
   * above deliberately reinstated, the same figures come out between 0.09% and 1.03% —
   * overlapping the correct range, and better than correct for two aircraft. Moving both
   * halves inboard in opposite directions very nearly cancels in a spanwise integral.
   * Strengths here, positions above; neither test covers the other.
   */
  it('carries the aircraft lift', () => {
    for (const spec of ROSTER) {
      const model = modelOf(spec.id);
      const fromWake = (2 * spanLoadIntegral(model.wake)) / model.referenceArea;
      expect(Math.abs(fromWake - model.CL) / Math.abs(model.CL), spec.id).toBeLessThan(0.015);
    }
  }, 60000);

  /*
   * Downwash between the tips and upwash outside them: the shape of every photograph of
   * a wake, and the reason aircraft are spaced out behind one another.
   *
   * It is the sign test. Run the circulation the other way and this field pushes air up
   * through the middle of the wake, which looks just as organised and is exactly wrong.
   */
  it('blows down inside the wake and up outside it', () => {
    const model = modelOf('boeing747-100');
    expect(model.CL).toBeGreaterThan(0);
    const span = Math.max(...model.wake.map((f) => Math.abs(f.z)));

    // Along the wake, not along the tunnel: the filaments trail at the cruise attitude,
    // so a point at constant height is out of the sheet long before it is far downstream.
    const far = { x: STREAM.x * 400, y: STREAM.y * 400, z: 0 };
    const inside = wakeVelocity(far, model.wake, STREAM, 0.2);
    const outside = wakeVelocity({ ...far, z: span * 1.2 }, model.wake, STREAM, 0.2);

    expect(inside.y).toBeLessThan(0);
    expect(outside.y).toBeGreaterThan(0);
  });

  /*
   * The classic factor of two: a semi-infinite filament induces half as much in the
   * plane it starts in as it does far downstream, where it looks infinite in both
   * directions. It is why lifting-line theory takes the induced angle at the wing and
   * the induced drag in the Trefftz plane, and why those two differ by exactly this.
   *
   * On a bare vortex pair rather than an aeroplane, because an aeroplane has no such
   * plane: its filaments leave the wing, the winglets and the tailplane at a spread of
   * stations several chords apart, so no point is level with all of them at once.
   */
  it('induces twice as much far downstream as in the plane it leaves from', () => {
    // Straight filaments: roll-up point at the departure point, so the converging leg
    // has no length and only the semi-infinite one remains.
    const pair: WakeFilament[] = [
      { x: 0, y: 0, z: -10, gamma: 1, roll: { x: 0, y: 0, z: -10 } },
      { x: 0, y: 0, z: 10, gamma: -1, roll: { x: 0, y: 0, z: 10 } },
    ];
    const stream = { x: 1, y: 0, z: 0 };
    const atWing = wakeVelocity({ x: 0, y: 0, z: 0 }, pair, stream, 0.5).y;
    const farDownstream = wakeVelocity({ x: 1e7, y: 0, z: 0 }, pair, stream, 0.5).y;

    expect(atWing).toBeLessThan(0);
    expect(farDownstream / atWing).toBeCloseTo(2, 6);
  });

  /* A trailing wake is behind the aircraft, not around it: far ahead it induces nothing. */
  it('leaves the air far ahead alone', () => {
    const { wake } = modelOf('boeing747-100');
    const nose = Math.min(...wake.map((f) => f.x)) - 1e6;
    const ahead = wakeVelocity({ x: nose, y: 0, z: 0 }, wake, STREAM, 0.5);
    expect(Math.hypot(ahead.x, ahead.y, ahead.z)).toBeLessThan(1e-6);
  });

  /*
   * Far from the core a trailing filament has to reproduce the plain two-dimensional
   * point vortex, G / 2 pi r. That is the one closed form in this file, so it is what the
   * implementation is pinned to.
   */
  it('matches the two-dimensional point vortex far downstream', () => {
    const line: WakeFilament[] = [{ x: 0, y: 0, z: 0, gamma: 2.5, roll: { x: 0, y: 0, z: 0 } }];
    const radius = 3;
    const v = wakeVelocity({ x: 1e7, y: radius, z: 0 }, line, { x: 1, y: 0, z: 0 }, 1e-4);
    expect(Math.abs(v.z)).toBeCloseTo(2.5 / (2 * Math.PI * radius), 6);
  });

  /*
   * The core keeps the singularity finite. Without it a tracer seeded on a filament
   * leaves at an absurd speed; with it the filament turns over into solid-body rotation
   * inside the core radius, which is what a real vortex does for a different reason —
   * viscosity rather than arithmetic.
   */
  it('stays finite on the filament itself', () => {
    const line: WakeFilament[] = [{ x: 0, y: 0, z: 0, gamma: 1, roll: { x: 0, y: 0, z: 0 } }];
    const onIt = wakeVelocity({ x: 10, y: 0, z: 0 }, line, { x: 1, y: 0, z: 0 }, 0.5);
    expect(Number.isFinite(onIt.x + onIt.y + onIt.z)).toBe(true);
    expect(Math.hypot(onIt.x, onIt.y, onIt.z)).toBeLessThan(1e-12);

    // The peak sits at the core radius and scales as one over it, so halving the core
    // doubles the fastest air in the vortex. That is what sizes it to the grid.
    const peak = (core: number) =>
      Math.abs(wakeVelocity({ x: 1e7, y: core, z: 0 }, line, { x: 1, y: 0, z: 0 }, core).z);
    expect(peak(0.1) / peak(0.2)).toBeCloseTo(2, 6);
  });

  /*
   * Roll-up moves vorticity about without changing what it does at a distance.
   *
   * Munk's stagger theorem: the induced drag of a wake depends on the vorticity left in
   * the far field, not on how it got there. Winding a sheet into two ropes keeps each
   * side's total circulation and keeps its centroid, so the first two moments of the
   * wake are untouched and only the higher ones move.
   *
   * Asserting that is sharper than asserting a tolerance, because the rate tells you
   * which moment went wrong. Scale the difference by the field itself and watch it as
   * the distance doubles: if roll-up had changed the circulation, the ratio would sit at
   * one and the two wakes would differ for ever; if it had moved the centroid, at two.
   * Measured, it is between two and a third and four - the difference is dying faster
   * than either, so neither moment moved and what is left is the third and beyond.
   *
   * This is the check that keeps the roll-up honest. It models something real, but it is
   * still a choice made partly so that the vortex can be seen, and a choice that changed
   * the aerodynamics would not be worth making.
   */
  it('rolls up without changing the far field', () => {
    const stream = { x: 1, y: 0, z: 0 };
    for (const id of ['boeing747-100', 'comet1', 'a350', 'concorde']) {
      const { wake } = modelOf(id);
      const sheet = straightened(wake);
      const span = Math.max(...wake.map((f) => Math.abs(f.z)));

      const difference = (spans: number) => {
        const where = { x: 1e6, y: 0, z: spans * span };
        const rolled = wakeVelocity(where, wake, stream, 0.5);
        const flat = wakeVelocity(where, sheet, stream, 0.5);
        return (
          Math.hypot(rolled.x - flat.x, rolled.y - flat.y, rolled.z - flat.z) /
          Math.hypot(flat.x, flat.y, flat.z)
        );
      };

      expect(difference(5), id).toBeLessThan(0.02);
      for (const spans of [2.5, 5, 10]) {
        expect(difference(spans) / difference(2 * spans), `${id} at ${spans} semi-spans`)
          .toBeGreaterThan(2.3);
      }
    }
  }, 60000);

  /*
   * And it concentrates what it moves, which is the whole point.
   *
   * Spread along the span, the trailing vorticity is weaker than the grid solver's own
   * numerical noise in the wake, so the tip vortex is present in the field and invisible
   * in it. Wound up, the same circulation sits in one core.
   */
  it('concentrates the vorticity into a core', () => {
    const { wake } = modelOf('boeing747-100');
    const stream = { x: 1, y: 0, z: 0 };
    const core = 1.5;

    const speedAt = (filaments: readonly WakeFilament[], at: Vec3) => {
      const v = wakeVelocity(at, filaments, stream, core);
      return Math.hypot(v.x, v.y, v.z);
    };

    // A ring of points one core radius out from where one side has rolled up.
    const centre = wake.reduce((best, f) => (f.gamma > best.gamma ? f : best)).roll;
    let rolled = 0;
    let flat = 0;
    const sheet = straightened(wake);
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 8) {
      const at = {
        x: centre.x,
        y: centre.y + core * Math.sin(a),
        z: centre.z + core * Math.cos(a),
      };
      rolled = Math.max(rolled, speedAt(wake, at));
      flat = Math.max(flat, speedAt(sheet, at));
    }
    expect(rolled).toBeGreaterThan(3 * flat);
  });

  /*
   * Where it rolls up to. Betz puts the vortex at the centroid of the shed vorticity on
   * its side, which for elliptical loading is pi/4 of the semi-span - a wake narrower
   * than the wing that made it, which is the observation the whole model rests on.
   * Airliner loadings are not elliptical, so this holds them to the neighbourhood rather
   * than to the number, and to being mirror images of each other exactly.
   */
  it('winds up inboard of the tip, symmetrically', () => {
    for (const id of ['comet1', 'boeing747-100', 'a350', 'boeing737max']) {
      const { wake } = modelOf(id);
      const span = Math.max(...wake.map((f) => Math.abs(f.z)));
      const left = wake.reduce((best, f) => (f.gamma > best.gamma ? f : best)).roll;
      const right = wake.reduce((best, f) => (f.gamma < best.gamma ? f : best)).roll;

      expect(Math.abs(left.z) / span, id).toBeGreaterThan(0.55);
      expect(Math.abs(left.z) / span, id).toBeLessThan(0.95);
      expect(left.z + right.z, id).toBeCloseTo(0, 8);
      expect(left.y, id).toBeCloseTo(right.y, 8);
      expect(left.x, id).toBeCloseTo(right.x, 8);
    }
  }, 60000);
});
