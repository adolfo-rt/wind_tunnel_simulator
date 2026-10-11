/**
 * How fast the simulation is allowed to run.
 *
 * The solver works non-dimensionally: the free stream is exactly 1, and one step advances
 * the flow by a fixed fraction of a cell whatever the tunnel is set to. That is the right
 * way to solve it — it fixes the CFL number, so dragging the slider cannot destabilise
 * anything — but it means the solver has no idea how much *time* a step represents. Only
 * the display knows that, because only the display knows the airspeed.
 *
 * Left alone, the consequence is a wake that sheds at the same rate at taxi speed as at
 * Mach 0.8, which is wrong: shedding frequency follows a roughly constant Strouhal
 * number, so f scales with U. Measured on a 737 at 128 cells, stepping once per frame put
 * the field at 0.68x real time at 100 km/h — faster than reality — and 6.1x slow at
 * 900 km/h, while the tracers it carries were drawn at a fixed twelfth of real time
 * throughout. Two clocks, and the gap between them moved with the slider.
 *
 * So the number of steps per frame is worked out here instead, from the elapsed time and
 * the airspeed, and the whole flow — field and tracers together — runs on one clock.
 *
 * This is the same lesson as stage 4's: a non-dimensional solve needs a dimensional
 * display. It was applied there to how fast tracers travel and to what the colours mean,
 * and time is the dimension that was missed.
 */

/**
 * How much slower than real time the flow is shown.
 *
 * Air crosses the working section in about a third of a second at cruise. Slowing
 * everything by one fixed factor keeps the slider meaningful — double the speed and
 * everything doubles — rather than making the simulation pick its own pace.
 */
export const SLOW_MOTION = 12;

/**
 * Longest frame the clock will honour.
 *
 * A frame that took longer than this is not a slow frame, it is a stall: a tab that was
 * in the background, or a garbage collection. Honouring it would advance the flow by a
 * visible jump at the moment the window came back.
 */
export const MAX_FRAME_SECONDS = 1 / 20;

export interface ClockFrame {
  /** Wall-clock seconds since the last frame. */
  seconds: number;
  /** The tunnel's free-stream speed, in metres per second. */
  freeStream: number;
  /** World size of one grid cell, in metres. */
  cellWorld: number;
  /** How far the free stream travels in one solver step, in cells. */
  stepCells: number;
}

/**
 * Most steps in one frame.
 *
 * The clock asks for well under one step per frame across the whole slider — 0.06 at
 * 100 km/h up to 0.74 at 1300 — so this is not a budget that normally binds. It is here
 * to stop a long stall being repaid all at once.
 */
const MAX_STEPS_PER_FRAME = 4;

export class SimulationClock {
  /** Fractions of a step left over from previous frames. */
  private carried = 0;
  /** Steps still owed to the cold start, before the physical clock applies. */
  private establishing = 0;

  /**
   * Run flat out for this many steps before the clock takes over.
   *
   * A field that has never seen the aircraft is not a physical state whose rate of change
   * means anything, so there is nothing to scale until the flow is established. At low
   * speed the honest clock is very slow — a twentieth of a step a frame at 100 km/h — and
   * waiting half a minute to see any flow at all would be correct and useless.
   */
  establish(steps: number): void {
    this.establishing = Math.max(0, Math.round(steps));
    this.carried = 0;
  }

  get establishingSteps(): number {
    return this.establishing;
  }

  /**
   * How many solver steps this frame is worth.
   *
   * Call this exactly once per frame. Asking consumes the elapsed time it is given, so a
   * second call in the same frame spends the frame twice - which is easy to do by putting
   * it in a loop condition, and was done, and ran the flow about sixty per cent fast at
   * mid throttle before a measurement caught it.
   */
  stepsFor(frame: ClockFrame): number {
    if (this.establishing > 0) {
      this.establishing--;
      return 1;
    }

    const { cellWorld, stepCells } = frame;
    if (!(cellWorld > 0) || !(stepCells > 0) || !(frame.freeStream > 0)) return 0;

    const seconds = Math.min(Math.max(frame.seconds, 0), MAX_FRAME_SECONDS);
    // Metres of air the display is showing this frame, then how many steps cover it.
    const shown = (frame.freeStream / SLOW_MOTION) * seconds;
    this.carried += shown / (stepCells * cellWorld);

    const steps = Math.min(MAX_STEPS_PER_FRAME, Math.floor(this.carried));
    // Whatever is left beyond the cap is dropped rather than owed, so a stall is a pause
    // and not a debt that arrives as a lurch.
    this.carried = steps >= MAX_STEPS_PER_FRAME ? 0 : this.carried - steps;
    return steps;
  }
}

/**
 * How long the flow needs to establish itself, in solver steps.
 *
 * Two transits of the working section: the free stream has to reach the far end once to
 * fill the domain and again for the pressure field, which is long-range, to settle behind
 * it. Derived from the grid rather than chosen, so a finer grid — where a step is a
 * shorter distance — waits proportionally longer.
 */
export function establishingSteps(cellsAlongTunnel: number, stepCells: number): number {
  if (!(stepCells > 0)) return 0;
  return Math.round((2 * cellsAlongTunnel) / stepCells);
}
