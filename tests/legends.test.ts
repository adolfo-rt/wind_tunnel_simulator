import { describe, it, expect } from 'vitest';
import { legendState, type LegendInputs } from '../src/ui/legends';

/**
 * Every combination of what is on screen, and what the legends must say about it.
 *
 * Two layers read the velocity field and either can be off, so there are eight cases and
 * one of them used to be wrong in a way nobody would notice from the picture: the
 * caption named the streamlines while the streamlines were switched off. A legend that
 * describes a layer which is not being drawn is worse than no legend, because it is the
 * part of the interface whose whole job is saying what the colours mean.
 */

const base: LegendInputs = {
  sliceVisible: false,
  sliceField: 'speed',
  streamlines: false,
  solverSupported: true,
};

const state = (patch: Partial<LegendInputs>) => legendState({ ...base, ...patch });

describe('the airspeed legend appears when something is drawn from it', () => {
  it('for the streamlines alone', () => {
    const s = state({ streamlines: true });
    expect(s.showSpeed).toBe(true);
    expect(s.speedOwner).toBe('Streamlines');
    expect(s.showCrossFlow).toBe(false);
  });

  it('for the slice alone, when the slice is measuring speed', () => {
    const s = state({ sliceVisible: true, sliceField: 'speed' });
    expect(s.showSpeed).toBe(true);
    expect(s.speedOwner).toBe('Flow slice');
  });

  it('for both at once, named as both', () => {
    const s = state({ sliceVisible: true, sliceField: 'speed', streamlines: true });
    expect(s.showSpeed).toBe(true);
    expect(s.speedOwner).toBe('Streamlines and flow slice');
  });

  it('and not at all when neither is drawn', () => {
    expect(state({}).showSpeed).toBe(false);
    expect(state({ sliceVisible: true, sliceField: 'crossflow' }).showSpeed).toBe(false);
  });

  /**
   * The case that was wrong. The slice is the only thing drawing from this bar, so it
   * must not claim the streamlines, which are off.
   */
  it('never names a layer that is switched off', () => {
    expect(state({ sliceVisible: true, sliceField: 'speed', streamlines: false }).speedOwner).toBe(
      'Flow slice',
    );
    expect(state({ sliceVisible: false, streamlines: true }).speedOwner).toBe('Streamlines');
  });
});

describe('the cross-flow legend belongs to the slice alone', () => {
  it('appears only when the slice is measuring cross-flow', () => {
    expect(state({ sliceVisible: true, sliceField: 'crossflow' }).showCrossFlow).toBe(true);
    expect(state({ sliceVisible: true, sliceField: 'speed' }).showCrossFlow).toBe(false);
    expect(state({ sliceVisible: false, sliceField: 'crossflow' }).showCrossFlow).toBe(false);
  });

  /**
   * And the two coexist. Both bars are drawn from the same blue-to-red ramp but measure
   * different quantities on different scales, so with the streamlines on and the slice
   * on cross-flow BOTH are needed - which is why each caption names its owner rather
   * than one of them being hidden.
   */
  it('alongside the airspeed legend when the streamlines are on', () => {
    const s = state({ sliceVisible: true, sliceField: 'crossflow', streamlines: true });
    expect(s.showCrossFlow).toBe(true);
    expect(s.showSpeed).toBe(true);
    expect(s.speedOwner).toBe('Streamlines');
  });
});

describe('without a solver there is nothing to put a key against', () => {
  it('hides both legends however the controls are set', () => {
    for (const sliceVisible of [true, false]) {
      for (const streamlines of [true, false]) {
        for (const sliceField of ['speed', 'crossflow'] as const) {
          const s = legendState({ sliceVisible, sliceField, streamlines, solverSupported: false });
          expect(s.showSpeed, 'speed legend survived an unsupported solver').toBe(false);
          expect(s.showCrossFlow, 'cross-flow legend survived an unsupported solver').toBe(false);
        }
      }
    }
  });
});

describe('across every combination', () => {
  /** A legend is on screen if and only if some layer is drawing from it. */
  it('a bar is shown exactly when something uses it', () => {
    for (const sliceVisible of [true, false]) {
      for (const streamlines of [true, false]) {
        for (const sliceField of ['speed', 'crossflow'] as const) {
          const s = legendState({ sliceVisible, sliceField, streamlines, solverSupported: true });
          const sliceOnSpeed = sliceVisible && sliceField === 'speed';
          const where = `slice=${sliceVisible}/${sliceField} tracers=${streamlines}`;
          expect(s.showSpeed, where).toBe(sliceOnSpeed || streamlines);
          expect(s.showCrossFlow, where).toBe(sliceVisible && sliceField === 'crossflow');
          /*
           * And when the bar IS shown, its caption names only layers that are on.
           * Guarded on `showSpeed` because the owner is not meaningful otherwise - with
           * the bar hidden it keeps whatever the expression last produced, and nobody
           * reads a caption on a legend that is not there.
           */
          if (s.showSpeed) {
            if (s.speedOwner.includes('Streamlines')) expect(streamlines, where).toBe(true);
            if (s.speedOwner.toLowerCase().includes('flow slice')) {
              expect(sliceOnSpeed, where).toBe(true);
            }
          }
        }
      }
    }
  });
});
