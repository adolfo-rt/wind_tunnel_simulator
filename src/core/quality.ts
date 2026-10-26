import type { DetailLevel } from '../aircraft/AircraftBuilder';
import type { StreamlineDensity } from '../physics/Streamlines';

/**
 * Quality tiers: one dial for everything that trades frame rate against fidelity.
 *
 * The knobs were all pinned at their top values and spread across four files, which made
 * the simulator unusable on a laptop without an editor open. They are gathered here so
 * that there is exactly one place where the trade is made and exactly one list to reason
 * about when something is slow.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a tier changes what the grid resolves and how
 * the picture looks. It never changes a number the application reports. The lift-to-drag
 * ratio, the span efficiency and the fuel per seat come from the panel method and the
 * vortex lattice on the CPU, at a station count fixed by `AERO_STATIONS` and a mesh
 * tessellation fixed by `AERO_DETAIL`, and none of them appears below.
 *
 * That rule has been broken twice already and both times it was expensive to find. A
 * lattice taking its station count from the visual detail gave a 737 MAX a lift-to-drag
 * ratio of 16.9 at high detail and 14.6 at low. A filament core radius measured in panel
 * widths grew at low detail until it lifted a 777's tip section above its root, which
 * washout makes impossible. `tests/quality.test.ts` now holds the line.
 */

export type QualityTier = 'low' | 'balanced' | 'high';

export interface QualitySettings {
  /** Cells along the tunnel's streamwise axis. The solver's cost goes as the cube. */
  flowResolution: number;
  /** Pressure-projection sweeps per step. Fewer leaves more divergence in the field. */
  jacobiIterations: number;
  /** Resolution of the signed-distance field the aircraft is voxelised into. */
  sdfResolution: number;
  /** Tessellation of the aircraft on screen. Never reaches the aerodynamics. */
  meshDetail: DetailLevel;
  /** How many tracers the streamlines start with. */
  streamlines: StreamlineDensity;
  /** Upper bound on device pixel ratio: the cheapest large saving on a retina screen. */
  maxPixelRatio: number;
  /** What to call it in the interface. */
  label: string;
  /** What the viewer gives up, in one line. */
  cost: string;
}

/*
 * The three tiers.
 *
 * The flow resolutions are 64, 96 and 128 because the solver's cost is cubic in them and
 * those are roughly a factor of three apart in work: 262 thousand cells, 885 thousand and
 * 2.1 million. Anything finer than 128 is not worth having at this grid's accuracy, and
 * anything coarser than 64 stops resolving the wake behind a wing at all.
 *
 * `high` is what every previous stage ran at, so the top tier is not new behaviour - it
 * is the old behaviour, now named and no longer compulsory.
 */
export const QUALITY: Record<QualityTier, QualitySettings> = {
  low: {
    flowResolution: 64,
    jacobiIterations: 20,
    sdfResolution: 64,
    meshDetail: 'low',
    streamlines: 'low',
    maxPixelRatio: 1,
    label: 'Low',
    cost: 'A coarse grid and a softer aircraft. The wake is there but blurred.',
  },
  balanced: {
    flowResolution: 96,
    jacobiIterations: 30,
    sdfResolution: 80,
    meshDetail: 'high',
    streamlines: 'medium',
    maxPixelRatio: 1.25,
    label: 'Balanced',
    cost: 'Most of the detail at about a third of the solver cost.',
  },
  high: {
    flowResolution: 128,
    jacobiIterations: 40,
    sdfResolution: 96,
    meshDetail: 'high',
    streamlines: 'high',
    maxPixelRatio: 1.5,
    label: 'High',
    cost: 'Everything on. Wants a discrete GPU.',
  },
};

export const TIERS: QualityTier[] = ['low', 'balanced', 'high'];

/** The tier below this one, or null at the bottom. */
export function tierBelow(tier: QualityTier): QualityTier | null {
  const index = TIERS.indexOf(tier);
  return index > 0 ? TIERS[index - 1] : null;
}

/**
 * Roughly what the solver costs per step, relative to the cheapest tier.
 *
 * Cells times sweeps. It is not a timing - the real cost depends on the machine and on
 * how much of the grid the aircraft occupies - but it is the right shape, and it is what
 * the tier ordering is checked against.
 */
export function relativeSolverCost(tier: QualityTier): number {
  const settings = QUALITY[tier];
  const cells = settings.flowResolution ** 3;
  const base = QUALITY.low.flowResolution ** 3 * QUALITY.low.jacobiIterations;
  return (cells * settings.jacobiIterations) / base;
}
