import type { SliceField } from '../physics/SliceView';

/**
 * Which legends belong on screen, and what each one is the key for.
 *
 * Pulled out of the click handlers and made pure because that is where it went wrong.
 * Two layers draw from the velocity field - the streamlines and the flow slice - either
 * can be switched off independently, and the slice can be measuring a different quantity
 * from the streamlines, so a bar may serve both, one, or neither. Expressed inline as a
 * chain of booleans it read plausibly and was wrong in one of its eight cases: with the
 * streamlines off and the slice on speed, the caption still read "streamlines and slice
 * alike", naming a layer that was not being drawn.
 *
 * Nothing here touches the DOM, so every case can be checked.
 */

export interface LegendInputs {
  /** The flow slice is switched on. */
  sliceVisible: boolean;
  /** What the slice is measuring. */
  sliceField: SliceField;
  /** The streamlines are switched on. */
  streamlines: boolean;
  /** Both layers read the grid, so neither has a legend without a solver. */
  solverSupported: boolean;
}

export interface LegendState {
  /** The airspeed bar, shared by anything measuring local speed. */
  showSpeed: boolean;
  /** The cross-flow bar, which only the slice ever uses. */
  showCrossFlow: boolean;
  /** What the airspeed bar is the key for, named in its caption. */
  speedOwner: 'Streamlines' | 'Flow slice' | 'Streamlines and flow slice';
}

export function legendState(inputs: LegendInputs): LegendState {
  const { sliceVisible, sliceField, streamlines, solverSupported } = inputs;
  const sliceOnSpeed = sliceVisible && sliceField === 'speed';
  const sliceOnCrossFlow = sliceVisible && sliceField === 'crossflow';

  // Only ever name what is actually drawn from this bar.
  const speedOwner =
    sliceOnSpeed && streamlines
      ? 'Streamlines and flow slice'
      : sliceOnSpeed
        ? 'Flow slice'
        : 'Streamlines';

  return {
    showSpeed: solverSupported && (sliceOnSpeed || streamlines),
    showCrossFlow: solverSupported && sliceOnCrossFlow,
    speedOwner,
  };
}
