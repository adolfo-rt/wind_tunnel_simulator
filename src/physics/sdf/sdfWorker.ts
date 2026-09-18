/// <reference lib="webworker" />
import { buildSdf, type BuildSdfOptions } from './buildSdf';

/**
 * Builds the obstacle field off the main thread.
 *
 * A distance field for an airliner takes between a third and half a second to compute,
 * which is far too long to spend in a frame: on the main thread every aircraft change
 * would lock the page. The result comes back as a transferable buffer, so handing it
 * over costs nothing.
 */

export interface SdfRequest {
  id: string;
  positions: Float32Array;
  indices: Uint32Array;
  options?: BuildSdfOptions;
}

export interface SdfResponse {
  id: string;
  data: Float32Array;
  resolution: { x: number; y: number; z: number };
  origin: { x: number; y: number; z: number };
  cell: number;
  band: number;
  milliseconds: number;
}

self.onmessage = (event: MessageEvent<SdfRequest>) => {
  const { id, positions, indices, options } = event.data;
  const started = performance.now();
  const grid = buildSdf(positions, indices, options);
  const response: SdfResponse = {
    id,
    data: grid.data,
    resolution: grid.resolution,
    origin: grid.origin,
    cell: grid.cell,
    band: grid.band,
    milliseconds: performance.now() - started,
  };
  (self as unknown as Worker).postMessage(response, [grid.data.buffer]);
};
