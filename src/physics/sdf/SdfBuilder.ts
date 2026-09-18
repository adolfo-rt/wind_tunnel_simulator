import type { BufferGeometry } from 'three';
import type { BuildSdfOptions, SdfGrid } from './buildSdf';
import type { SdfRequest, SdfResponse } from './sdfWorker';

/**
 * Main-thread side of the obstacle field build.
 *
 * Only the most recent request matters. Clicking down the aircraft list starts a build
 * per click, and all but the last are wasted work whose results would arrive out of
 * order; each new request supersedes the one before it.
 */
export class SdfBuilder {
  private worker: Worker | null = null;
  private pending = new Map<string, { resolve: (grid: SdfGrid) => void; reject: (e: unknown) => void }>();
  private latest: string | null = null;
  private counter = 0;

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./sdfWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SdfResponse>) => {
      const { id, data, resolution, origin, cell, band } = event.data;
      const entry = this.pending.get(id);
      this.pending.delete(id);
      if (!entry) return;
      if (id !== this.latest) {
        // Superseded by a later request; the caller no longer wants it.
        entry.reject(new DOMException('superseded', 'AbortError'));
        return;
      }
      entry.resolve({ data, resolution, origin, cell, band });
    };
    worker.onerror = (event) => {
      for (const entry of this.pending.values()) entry.reject(event);
      this.pending.clear();
    };
    this.worker = worker;
    return worker;
  }

  /**
   * Build the field for a geometry. The geometry's buffers are copied rather than
   * transferred, because the same mesh is still being rendered.
   */
  build(geometry: BufferGeometry, options?: BuildSdfOptions): Promise<SdfGrid> {
    const index = geometry.getIndex();
    if (!index) return Promise.reject(new Error('the solid needs an index buffer'));

    const positions = Float32Array.from(geometry.getAttribute('position').array as ArrayLike<number>);
    const indices = Uint32Array.from(index.array as ArrayLike<number>);
    const id = `sdf-${this.counter++}`;
    this.latest = id;

    const request: SdfRequest = { id, positions, indices, options };
    return new Promise<SdfGrid>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ensureWorker().postMessage(request, [positions.buffer, indices.buffer]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
