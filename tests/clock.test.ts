import { describe, it, expect } from 'vitest';
import {
  MAX_FRAME_SECONDS,
  SLOW_MOTION,
  SimulationClock,
  establishingSteps,
} from '../src/physics/clock';

/** A 737 at the default grid: 109 m of tunnel across 128 cells. */
const CELL = 0.8511;
const STEP_CELLS = 0.8;
const FRAME = 1 / 60;

function run(clock: SimulationClock, freeStream: number, frames: number, seconds = FRAME): number {
  let steps = 0;
  for (let i = 0; i < frames; i++) {
    steps += clock.stepsFor({ seconds, freeStream, cellWorld: CELL, stepCells: STEP_CELLS });
  }
  return steps;
}

/** The clock's own definition, which is what the solver and the tracers have to share. */
function expected(freeStream: number, seconds: number): number {
  return ((freeStream / SLOW_MOTION) * seconds) / (STEP_CELLS * CELL);
}

describe('the simulation clock', () => {
  /*
   * The defect this exists for: stepping once a frame regardless of the slider makes the
   * wake shed at the same rate at taxi speed as at cruise. Shedding follows a roughly
   * constant Strouhal number, so the rate has to scale with the airspeed — and the
   * cleanest statement of that is that doubling the speed doubles the steps.
   */
  it('advances the flow in proportion to the airspeed', () => {
    const slow = new SimulationClock();
    const fast = new SimulationClock();
    const frames = 600;

    const atHalf = run(slow, 125, frames);
    const atFull = run(fast, 250, frames);

    expect(atFull / atHalf).toBeCloseTo(2, 1);
  });

  /*
   * And in proportion to elapsed time, not to frames. Stepping per frame tied the flow to
   * the frame rate, so the same wake evolved more slowly on a slower machine — a second
   * defect hiding behind the first, and invisible on whatever computer it was written on.
   */
  it('advances the flow in proportion to elapsed time, not frames', () => {
    const smooth = new SimulationClock();
    const choppy = new SimulationClock();

    // The same second of wall clock, at 60 fps and at 30.
    const atSixty = run(smooth, 250, 60, 1 / 60);
    const atThirty = run(choppy, 250, 30, 1 / 30);

    expect(atThirty).toBe(atSixty);
  });

  /* The rate itself, against the arithmetic the tracers use for their own travel. */
  it('asks for the number of steps the distance needs', () => {
    for (const speed of [27.8, 111.1, 250, 361.1]) {
      const clock = new SimulationClock();
      const frames = 2000;
      const steps = run(clock, speed, frames);
      expect(steps / frames, `${speed} m/s`).toBeCloseTo(expected(speed, FRAME), 2);
    }
  });

  /*
   * A stall is a pause, not a debt. A frame that took a second is a backgrounded tab, and
   * repaying it would advance the flow by a visible jump the moment the window came back.
   */
  it('treats a long frame as a pause rather than a debt', () => {
    const clock = new SimulationClock();
    const stalled = clock.stepsFor({
      seconds: 5,
      freeStream: 250,
      cellWorld: CELL,
      stepCells: STEP_CELLS,
    });
    const honoured = expected(250, MAX_FRAME_SECONDS);
    expect(stalled).toBeLessThanOrEqual(4);
    expect(stalled).toBeGreaterThanOrEqual(Math.floor(honoured));

    // And the frame after it is an ordinary frame, not a catch-up.
    expect(run(clock, 250, 1)).toBeLessThanOrEqual(1);
  });

  /*
   * With the fans stopped there is no flow, so nothing develops. The solved field is the
   * same field at every slider setting — that is what a non-dimensional solve means — so
   * freezing it costs nothing and is what the display is already showing.
   */
  it('stops the flow when the tunnel is stopped', () => {
    const clock = new SimulationClock();
    expect(run(clock, 0, 300)).toBe(0);

    // And picks up again where it left off rather than owing anything.
    expect(run(clock, 250, 600)).toBeGreaterThan(0);
  });

  /*
   * The cold start runs flat out. At 100 km/h the honest clock is a twentieth of a step a
   * frame, and waiting half a minute to see any flow at all would be correct and useless.
   */
  it('establishes the flow before the clock applies', () => {
    const clock = new SimulationClock();
    clock.establish(50);
    expect(clock.establishingSteps).toBe(50);

    // Flat out, even with the tunnel stopped, because there is a field to fill either way.
    expect(run(clock, 0, 50)).toBe(50);
    expect(clock.establishingSteps).toBe(0);
    expect(run(clock, 0, 50)).toBe(0);
  });

  /*
   * Two transits of the working section, derived from the grid rather than picked: a
   * finer grid takes a shorter step, so it needs proportionally more of them to carry the
   * free stream the same distance.
   */
  it('scales the cold start with the grid', () => {
    expect(establishingSteps(128, 0.8)).toBe(320);
    expect(establishingSteps(64, 0.8)).toBe(160);
    expect(establishingSteps(128, 0.4)).toBe(640);
    expect(establishingSteps(128, 0)).toBe(0);
  });
});
