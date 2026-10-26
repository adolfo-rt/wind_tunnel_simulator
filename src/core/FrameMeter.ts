import { type QualityTier, tierBelow } from './quality';

/**
 * How fast the thing is actually running, and when to stop asking so much of it.
 *
 * Picking a quality tier from the hardware is guesswork: the GPU string is unreliable,
 * tells you nothing about what else the machine is doing, and is routinely masked. The
 * only honest input is how long frames are taking, so that is the only input used here.
 *
 * Three things matter for this not to be worse than leaving it alone:
 *
 *   - It settles. The meter steps DOWN when the machine cannot keep up and never steps
 *     back up on its own. Automatic promotion needs a threshold above the demotion one,
 *     and any gap small enough to be useful is small enough to oscillate - which costs a
 *     solver rebuild and a visible hitch every time it changes its mind. Going up is the
 *     viewer's decision, and it sticks.
 *   - It ignores the opening. The first frames of a session compile shaders, upload
 *     textures and build an aircraft, so they are slow for reasons no tier would fix.
 *     Nothing is measured until `GRACE_FRAMES` have gone by, and the window is cleared
 *     whenever the scene is rebuilt.
 *   - It reads the middle, not the worst. One long frame is a garbage collection or
 *     another tab waking up. The median over a window is what gets compared, so a single
 *     stall cannot demote anybody.
 */

/**
 * Time skipped at the start, while shaders compile and the first aircraft is built.
 *
 * In seconds rather than frames. A frame count looks equivalent and is not: forty-five
 * frames is three quarters of a second on a fast machine and three quarters of a MINUTE
 * on one rendering at one frame a second - so the slowest machines, the ones the tiers
 * exist for, would sit at the top tier for a minute before anything was even measured.
 */
const GRACE_SECONDS = 1.5;

/** Longest window the median is taken over. */
const WINDOW = 90;

/**
 * What it takes to reach a verdict: this many frames AND this much wall time.
 *
 * Both, for the same reason the grace period is a time. Frames alone would decide off
 * four tenths of a second on a fast machine, which is one hitch; seconds alone would
 * decide off two frames on a slow one. Requiring both means a fast machine is judged on
 * ninety frames and a slow one on twenty, and neither waits longer than it has to.
 */
const MIN_SAMPLES = 20;
const MIN_SPAN_SECONDS = 1.5;

/**
 * Median frame time that counts as not keeping up, in seconds.
 *
 * A twentieth of a second - twenty frames per second. Not thirty: at thirty a heavy
 * scene on an integrated GPU would demote itself the moment the wake switched on, and
 * the viewer would rather have twenty-five frames of the full picture than sixty of a
 * coarse one. Below twenty the orbit controls start to feel disconnected from the mouse,
 * which is the point at which the trade stops being worth it.
 */
const SLOW_SECONDS = 1 / 20;

/**
 * Hopeless rather than marginal: demote on this with far less evidence.
 *
 * Five frames a second. A machine doing that does not need twenty samples to prove it,
 * and making it wait twenty of its own very long frames is a quarter of a minute of
 * treacle before anything improves. Eight samples is enough to rule out a single stall,
 * which is all this fast path has to be careful about.
 */
const URGENT_SECONDS = 1 / 5;
/*
 * Four, not eight. The evidence is weak in frames and strong in seconds: a machine
 * averaging worse than five frames a second has already spent most of a second on each
 * of them, so four of them is nearly a second of wall clock and the mean is a long way
 * past the threshold. Eight was costing the worst machines the most time - on a renderer
 * managing a frame every six seconds, waiting for eight meant fifty seconds of treacle
 * before anything got better, which is the opposite of what the tiers are for.
 */
const URGENT_SAMPLES = 4;

/**
 * The longest a single frame is allowed to count for, in seconds.
 *
 * A CLAMP, not a filter, and the distinction is the whole history of this constant.
 *
 * It began as a discard: anything longer than a second was taken to be a hidden tab
 * rather than a slow frame and thrown away. That silenced the meter on exactly the
 * machines it exists for, because a machine at one frame a second produces nothing but
 * discarded samples. Raising the cutoff to five seconds moved the problem rather than
 * fixing it - headless software rendering runs this scene at about a fifth of a frame a
 * second, every frame was thrown away, and what survived were the handful of unusually
 * quick ones. The meter looked at that and reported 37 fps on a machine managing 0.2.
 *
 * Any threshold that discards produces that bias: it selects the fast frames out of a
 * slow population. Clamping keeps every frame as evidence and merely bounds how much
 * one of them can say. A tab hidden for half a minute contributes a single five-second
 * sample, which the median absorbs; a genuinely slow frame contributes the truth up to
 * the clamp, which is far past any threshold that matters. The hidden-tab case is
 * handled where it belongs, by listening for the tab coming back and clearing the
 * window.
 *
 * One second, which is low, and that is the point. The clamp does not need to be large
 * to preserve the signal: once an interval is clamped it already reads as twenty times
 * slower than the threshold for "not keeping up", so a machine whose every frame takes
 * five seconds still reports one frame per second and still demotes. Keeping it low is
 * what stops a single stall from dominating the mean - at five seconds, one hidden tab
 * among ninety good frames dragged the average to fourteen frames a second and demoted
 * a machine that was managing sixty.
 */
const LONGEST_FRAME_SECONDS = 1;

export interface FrameStats {
  /** Mean frame time over the window, in milliseconds. Null before there is a window. */
  medianMs: number | null;
  /** Frames per second implied by that median. */
  fps: number | null;
  /** Longest frame in the window, in milliseconds. */
  worstMs: number | null;
  samples: number;
}

export interface FrameMeterOptions {
  /** Called when the meter decides the machine cannot sustain the current tier. */
  onDemote: (to: QualityTier, stats: FrameStats) => void;
  /**
   * Milliseconds since some fixed point. Injectable so the tests can drive time rather
   * than wait for it; the default is the real clock.
   */
  now?: () => number;
}

export class FrameMeter {
  private times: number[] = [];
  private grace = 0;
  private last: number | null = null;
  private now: () => number;
  private tier: QualityTier = 'high';
  /** Set once the viewer picks a tier by hand: the meter then measures and says nothing. */
  private automatic = true;

  constructor(private options: FrameMeterOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  /** Tell the meter which tier is running now, and clear the window. */
  setTier(tier: QualityTier): void {
    this.tier = tier;
    this.restart();
  }

  /** From here on the viewer has chosen; keep measuring, stop demoting. */
  stopAdjusting(): void {
    this.automatic = false;
  }

  get adjusting(): boolean {
    return this.automatic;
  }

  /**
   * Forget the window.
   *
   * Called whenever the scene changes out from under the meter - a new aircraft, a new
   * tier - because the frames either side of that are not measurements of the same thing.
   */
  restart(): void {
    this.times.length = 0;
    this.grace = 0;
    this.last = null;
  }

  /**
   * One frame, timed by the meter's own clock.
   *
   * NOT by the delta the render loop computes, which is the mistake this signature
   * exists to prevent. The viewer clamps its delta to a tenth of a second so that one
   * long frame cannot blow the simulation up - correct for stepping the physics, and
   * ruinous here: it makes every machine below ten frames a second report as exactly
   * ten. A tunnel running at one frame a second looked merely marginal instead of
   * hopeless, and the meter sat at the top tier waiting for evidence that had already
   * been clamped out of existence.
   */
  sample(): void {
    const now = this.now();
    const previous = this.last;
    this.last = now;
    if (previous === null) return;
    const elapsed = (now - previous) / 1000;
    if (!(elapsed > 0)) return;
    const seconds = Math.min(elapsed, LONGEST_FRAME_SECONDS);

    // Grace counts real time, not clamped time: it is answering "has the opening settled
    // down yet", which is a question about the wall clock. Counting it clamped made a
    // slow machine serve its grace period several frames over.
    if (this.grace < GRACE_SECONDS) {
      this.grace += elapsed;
      return;
    }

    this.times.push(seconds);
    if (this.times.length > WINDOW) this.times.shift();

    if (!this.automatic) return;
    if (!this.decided()) return;

    const next = tierBelow(this.tier);
    if (!next) {
      // Already at the bottom and still slow. Nothing left to give, so stop measuring
      // for a decision that cannot be made.
      this.automatic = false;
      return;
    }
    const stats = this.stats;
    this.tier = next;
    this.restart();
    this.options.onDemote(next, stats);
  }

  /**
   * Is there enough evidence, and does it say the machine cannot keep up?
   *
   * Two ways to qualify: the ordinary one wants a full window's worth of frames and of
   * seconds before calling anything slow, and the urgent one short-circuits that for a
   * machine so far behind that waiting is itself the problem.
   */
  private decided(): boolean {
    const samples = this.times.length;
    if (samples < URGENT_SAMPLES) return false;
    const typical = this.typical();

    if (typical > URGENT_SECONDS) return true;
    if (typical <= SLOW_SECONDS) return false;

    const span = this.times.reduce((sum, t) => sum + t, 0);
    return samples >= MIN_SAMPLES && span >= MIN_SPAN_SECONDS;
  }

  get stats(): FrameStats {
    if (this.times.length === 0) {
      return { medianMs: null, fps: null, worstMs: null, samples: 0 };
    }
    const typical = this.typical();
    return {
      medianMs: typical * 1000,
      fps: 1 / typical,
      worstMs: Math.max(...this.times) * 1000,
      samples: this.times.length,
    };
  }

  /**
   * The frame time the window represents: total time divided by frames in it.
   *
   * The MEAN of the clamped intervals, which is throughput - frames per second of wall
   * clock - and not the median, which this used to be.
   *
   * The median ignores gaps, and gaps are the thing being measured. Software rasterised
   * rendering delivers animation frames in bursts separated by long stalls, so most
   * intervals are short and the median reported 41 frames a second on a page genuinely
   * managing two. A viewer does not experience the middle interval; they experience how
   * many frames arrived while they waited, which is what this returns.
   *
   * The reason the mean is safe to use here is the clamp above: no single interval can
   * contribute more than five seconds, so one stall shifts the mean but cannot dominate
   * it, and the one case that could - a tab hidden for minutes - clears the window when
   * the tab comes back.
   */
  private typical(): number {
    let total = 0;
    for (const time of this.times) total += time;
    return total / this.times.length;
  }
}

/** Exposed so the tests describe the same numbers the meter uses. */
export const FRAME_METER = {
  GRACE_SECONDS,
  WINDOW,
  MIN_SAMPLES,
  MIN_SPAN_SECONDS,
  SLOW_SECONDS,
  URGENT_SECONDS,
  URGENT_SAMPLES,
  LONGEST_FRAME_SECONDS,
} as const;
