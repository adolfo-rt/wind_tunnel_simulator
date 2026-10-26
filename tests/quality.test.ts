import { describe, it, expect } from 'vitest';
import { QUALITY, TIERS, relativeSolverCost, tierBelow, type QualityTier } from '../src/core/quality';
import { FRAME_METER, FrameMeter } from '../src/core/FrameMeter';
import { buildAircraft } from '../src/aircraft/AircraftBuilder';
import { specById } from '../src/aircraft/roster';
import { analyseAircraft, AERO_DETAIL } from '../src/physics/performance/analyse';
import { STREAMLINE_COUNTS } from '../src/physics/Streamlines';

/**
 * The quality tiers, and the one rule they must not break.
 *
 * A tier changes what the grid resolves and how the picture looks. It must never change
 * a number the application reports. That rule has been broken twice in this project and
 * both times it cost real time to find - a lattice taking its station count from the
 * visual detail gave a 737 MAX a lift-to-drag ratio of 16.9 at high detail and 14.6 at
 * low, and a filament core measured in panel widths grew at low detail until it lifted a
 * 777's tip section above its root. Stage 7 hands the viewer a control that changes the
 * detail level on purpose, so the rule needs a test rather than a comment.
 */

describe('the tiers are ordered', () => {
  it('gets cheaper going down and never equal', () => {
    for (let i = 1; i < TIERS.length; i++) {
      const lower = QUALITY[TIERS[i - 1]];
      const higher = QUALITY[TIERS[i]];
      expect(lower.flowResolution).toBeLessThan(higher.flowResolution);
      expect(lower.sdfResolution).toBeLessThan(higher.sdfResolution);
      expect(lower.maxPixelRatio).toBeLessThanOrEqual(higher.maxPixelRatio);
      expect(STREAMLINE_COUNTS[lower.streamlines]).toBeLessThan(
        STREAMLINE_COUNTS[higher.streamlines],
      );
      expect(relativeSolverCost(TIERS[i - 1])).toBeLessThan(relativeSolverCost(TIERS[i]));
    }
  });

  /**
   * The point of the bottom tier is that it is much cheaper, not slightly. If the spread
   * ever narrows to the point where dropping a tier does not buy a frame rate, the
   * control is doing nothing but costing a rebuild.
   */
  it('spans enough to be worth having', () => {
    expect(relativeSolverCost('high') / relativeSolverCost('low')).toBeGreaterThan(5);
  });

  it('knows what is below each tier', () => {
    expect(tierBelow('high')).toBe('balanced');
    expect(tierBelow('balanced')).toBe('low');
    expect(tierBelow('low')).toBeNull();
  });

  /** The top tier is what every stage before this one ran at, so nothing silently moved. */
  it('leaves the top tier at what the app used to do unconditionally', () => {
    expect(QUALITY.high.flowResolution).toBe(128);
    expect(QUALITY.high.sdfResolution).toBe(96);
    expect(QUALITY.high.meshDetail).toBe('high');
    expect(QUALITY.high.maxPixelRatio).toBe(1.5);
  });
});

describe('a tier never changes a reported number', () => {
  /**
   * The whole reason this file exists. Wetted area is measured off real triangles, so a
   * finer mesh has more of it - a 787 at high detail reads 1.6% more wetted area than at
   * low, and used to report 1.6% less lift-to-drag with it. `AERO_DETAIL` pins the
   * measurement, so the two must now agree exactly rather than approximately.
   */
  it('gives identical cruise figures at every mesh detail', () => {
    for (const id of ['boeing787', 'comet1', 'boeing737max', 'a350']) {
      const spec = specById(id)!;
      const low = buildAircraft(spec, 'low');
      const high = buildAircraft(spec, 'high');
      const a = analyseAircraft(spec, low);
      const b = analyseAircraft(spec, high);
      low.dispose();
      high.dispose();

      expect(b.cruise.liftToDrag, `${id} lift-to-drag moved with mesh detail`).toBe(
        a.cruise.liftToDrag,
      );
      expect(b.cruise.fuelPerSeat100km, `${id} fuel moved with mesh detail`).toBe(
        a.cruise.fuelPerSeat100km,
      );
      expect(b.spanEfficiency, `${id} span efficiency moved with mesh detail`).toBe(
        a.spanEfficiency,
      );
      expect(b.cruise.wettedAreaM2, `${id} wetted area moved with mesh detail`).toBe(
        a.cruise.wettedAreaM2,
      );
    }
  }, 600000);

  /**
   * And the tiers really do use both detail levels, or the test above proves nothing.
   */
  it('on tiers that genuinely differ in mesh detail', () => {
    const details = new Set(TIERS.map((t) => QUALITY[t].meshDetail));
    expect(details.size).toBeGreaterThan(1);
    expect(details.has(AERO_DETAIL)).toBe(true);
  });

  /** No tier may name the lattice or the analysis; those are not rendering settings. */
  it('carries no aerodynamic knob at all', () => {
    for (const tier of TIERS) {
      const keys = Object.keys(QUALITY[tier]);
      for (const forbidden of ['stations', 'aeroStations', 'spanwise', 'chordwise', 'cg']) {
        expect(keys, `${tier} exposes an aerodynamic knob`).not.toContain(forbidden);
      }
    }
  });
});

describe('the frame meter', () => {
  /**
   * A meter on a clock the test drives.
   *
   * The meter times itself rather than trusting a delta handed in, because the viewer
   * clamps its delta to a tenth of a second and that clamp hid every machine slower than
   * ten frames a second. Driving a fake clock here keeps the tests instant and tests the
   * real code path.
   */
  function meter() {
    const demotions: QualityTier[] = [];
    const clock = { ms: 0 };
    const m = new FrameMeter({ onDemote: (to) => demotions.push(to), now: () => clock.ms });
    return { m, demotions, clock };
  }

  type Harness = ReturnType<typeof meter>;

  /** Advance the clock by `seconds` and take a sample, `count` times. */
  function run({ m, clock }: Harness, seconds: number, count: number): void {
    for (let i = 0; i < count; i++) {
      clock.ms += seconds * 1000;
      m.sample();
    }
  }

  /**
   * Exactly enough frames at this rate to clear the grace period and reach one verdict.
   *
   * Not a full window: a verdict needs `MIN_SAMPLES` frames spanning `MIN_SPAN_SECONDS`,
   * and feeding a whole window past that point buys a second demotion the test did not
   * ask for - which is how this helper first read, and why three tests reported two
   * demotions where they expected one.
   */
  function enough(seconds: number): number {
    return SEED + graceFrames(seconds) + verdictFrames(seconds) + 1;
  }

  /** Samples the ordinary rule needs at this frame time: enough frames AND enough seconds. */
  function verdictFrames(seconds: number): number {
    return Math.max(
      FRAME_METER.MIN_SAMPLES,
      Math.ceil(FRAME_METER.MIN_SPAN_SECONDS / seconds),
    );
  }

  /** The first call only starts the clock; there is no interval to measure yet. */
  const SEED = 1;

  /**
   * Frames needed to clear the grace period at this frame time.
   *
   * Real seconds, not clamped ones: the grace period asks whether the opening has
   * settled, which is a question about the wall clock, so one six-second frame clears it.
   */
  function graceFrames(seconds: number): number {
    return Math.ceil(FRAME_METER.GRACE_SECONDS / seconds);
  }

  const FAST = 1 / 60;
  const SLOW = 1 / 10;

  it('says nothing while the machine keeps up', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, FAST, enough(FAST) * 3);
    expect(demotions).toEqual([]);
  });

  it('steps down when it does not', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, SLOW, enough(SLOW));
    expect(demotions).toEqual(['balanced']);
  });

  /**
   * The case that was broken, and the reason the window is measured in seconds as well
   * as frames. A machine rendering at one frame a second is the whole point of having a
   * low tier, and the first version of this meter stayed silent on it twice over: it
   * discarded every frame longer than a second as impossible, and wanted 135 of them
   * before deciding anything.
   */
  it('demotes a machine rendering at about one frame a second', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, 1.1, SEED + graceFrames(1.1) + FRAME_METER.URGENT_SAMPLES);
    expect(demotions).toEqual(['balanced']);
  });

  /** And reaches that verdict quickly, rather than after twenty of its very long frames. */
  it('does not make a hopeless machine wait for a full window', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    let frames = 0;
    while (demotions.length === 0 && frames < 200) {
      h.clock.ms += 1000 / 3;
      m.sample();
      frames++;
    }
    expect(demotions).toEqual(['balanced']);
    expect(frames).toBeLessThan(SEED + graceFrames(1 / 3) + FRAME_METER.MIN_SAMPLES);
  });

  /**
   * A merely marginal frame rate does get the full window, because at twenty-five frames
   * a second the difference between keeping up and not is a judgement rather than a fact.
   */
  it('takes its time over a marginal frame rate', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    const marginal = 1 / 18;
    run(h, marginal, SEED + graceFrames(marginal) + FRAME_METER.URGENT_SAMPLES);
    expect(demotions, 'demoted before it had the evidence').toEqual([]);
    // Enough to satisfy both halves of the ordinary rule: the sample count and the span.
    run(h, marginal, verdictFrames(marginal));
    expect(demotions).toEqual(['balanced']);
  });

  /**
   * One tier at a time, and only after a fresh window at the new one. Demoting twice off
   * a single window would skip a tier the machine might have been able to hold.
   */
  it('drops one tier per window', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, SLOW, enough(SLOW));
    expect(demotions).toEqual(['balanced']);
    run(h, SLOW, enough(SLOW));
    expect(demotions).toEqual(['balanced', 'low']);
  });

  /** And it stops at the bottom rather than asking for a tier that does not exist. */
  it('gives up at the bottom', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('low');
    run(h, SLOW, enough(SLOW) * 3);
    expect(demotions).toEqual([]);
    expect(m.adjusting).toBe(false);
  });

  /**
   * It never promotes. Any upward threshold close enough to be useful is close enough to
   * oscillate, and each change of mind costs a solver rebuild and a visible hitch.
   */
  it('never steps back up, however fast the machine turns out to be', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, SLOW, enough(SLOW));
    run(h, FAST, enough(FAST) * 5);
    expect(demotions).toEqual(['balanced']);
  });

  it('leaves the viewer alone once they have chosen', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    m.stopAdjusting();
    run(h, SLOW, enough(SLOW) * 3);
    expect(demotions).toEqual([]);
  });

  /**
   * The opening frames compile shaders and build an aircraft. Judging a machine on those
   * would demote everybody.
   */
  it('ignores the opening of a session', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    // A second and a half of slow frames, then a machine that is actually fine.
    run(h, SLOW, SEED + graceFrames(SLOW));
    run(h, FAST, FRAME_METER.WINDOW);
    expect(demotions).toEqual([]);
  });

  /** A rebuild resets the window, so frames from two different scenes are never mixed. */
  it('forgets the window when the scene changes', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, SLOW, SEED + graceFrames(SLOW) + FRAME_METER.MIN_SAMPLES - 2);
    m.restart();
    run(h, FAST, FRAME_METER.WINDOW);
    expect(demotions, 'the grace period should have applied again').toEqual([]);
  });

/**
   * An occasional garbage collection is not a verdict on the machine.
   *
   * A quarter of a second, twice in a window of ninety sixteen-millisecond frames: the
   * throughput that comes out is still about forty-six frames a second, which is what a
   * viewer would experience and is nowhere near slow.
   */
  it('is not moved by the occasional garbage collection', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, FAST, SEED + graceFrames(FAST));
    for (let i = 0; i < FRAME_METER.WINDOW * 2; i++) {
      h.clock.ms += (i % 50 === 0 ? 0.25 : FAST) * 1000;
      m.sample();
    }
    expect(demotions).toEqual([]);
  });

  /**
   * But frames arriving in bursts separated by long stalls IS slow, however quick the
   * bursts are. This is what software rasterised rendering does, and judging it on the
   * middle interval reported 41 frames a second on a page managing two.
   */
  it('sees through bursts separated by stalls', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, FAST, SEED + graceFrames(FAST));
    // Nine quick frames, then nothing for four seconds: about eight a second overall,
    // against a median interval that would read as sixty.
    for (let burst = 0; burst < 3; burst++) {
      run(h, FAST, 9);
      run(h, 4, 1);
    }
    expect(demotions).toEqual(['balanced']);
  });

  /**
   * A huge gap - a hidden tab, a laptop waking up - is clamped rather than thrown away.
   *
   * Discarding is what the first two versions did, and it biases the measurement towards
   * whatever is fast: on a machine rendering at a fifth of a frame a second every real
   * frame was discarded and the meter reported 37 fps off the few quick ones. Clamping
   * keeps the sample and bounds what it can claim.
   */
  it('clamps an enormous gap rather than discarding it', () => {
    const h = meter();
    const { m } = h;
    m.setTier('high');
    m.stopAdjusting();
    run(h, FAST, SEED + graceFrames(FAST));
    run(h, 30, 1);
    expect(m.stats.samples).toBeGreaterThan(0);
    expect(m.stats.worstMs).toBe(FRAME_METER.LONGEST_FRAME_SECONDS * 1000);
  });

  /** One such gap among a window of good frames must not move the verdict. */
  it('is not demoted by one hidden tab', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, FAST, SEED + graceFrames(FAST));
    run(h, FAST, FRAME_METER.WINDOW / 2);
    run(h, 30, 1);
    run(h, FAST, FRAME_METER.WINDOW / 2);
    expect(demotions).toEqual([]);
  });

  /**
   * And the case the clamp was written for: a machine far slower than the clamp is still
   * seen as slow, rather than vanishing from the measurement entirely.
   */
  it('demotes a machine slower than the clamp itself', () => {
    const h = meter();
    const { m, demotions } = h;
    m.setTier('high');
    run(h, 6, SEED + graceFrames(6) + FRAME_METER.URGENT_SAMPLES);
    expect(demotions).toEqual(['balanced']);
  });

  it('reports what it measured', () => {
    const h = meter();
    const { m } = h;
    m.setTier('high');
    m.stopAdjusting();
    expect(m.stats.fps).toBeNull();
    run(h, FAST, enough(FAST));
    expect(m.stats.fps).toBeCloseTo(60, 0);
    expect(m.stats.medianMs).toBeCloseTo(1000 / 60, 1);
  });
});
