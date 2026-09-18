import { describe, it, expect } from 'vitest';
import { cellToPixel, layoutAtlas, pixelToCell } from '../src/physics/gpu/atlas';

describe('atlas layout', () => {
  it('holds every slice', () => {
    for (const grid of [
      { x: 128, y: 55, z: 55 },
      { x: 96, y: 40, z: 40 },
      { x: 64, y: 32, z: 32 },
      { x: 17, y: 5, z: 3 },
    ]) {
      const layout = layoutAtlas(grid);
      expect(layout.tiles.x * layout.tiles.y).toBeGreaterThanOrEqual(grid.z);
      expect(layout.texture.width).toBe(layout.tiles.x * grid.x);
      expect(layout.texture.height).toBe(layout.tiles.y * grid.y);
    }
  });

  it('keeps the texture roughly square rather than a long strip', () => {
    const layout = layoutAtlas({ x: 128, y: 55, z: 55 });
    const { width, height } = layout.texture;
    expect(Math.max(width, height) / Math.min(width, height)).toBeLessThan(2.5);
  });

  it('stays inside the hardware texture limit', () => {
    const layout = layoutAtlas({ x: 128, y: 64, z: 64 }, 2048);
    expect(layout.texture.width).toBeLessThanOrEqual(2048);
    expect(layout.texture.height).toBeLessThanOrEqual(2048);
  });

  it('refuses a grid that cannot fit, rather than silently truncating it', () => {
    expect(() => layoutAtlas({ x: 512, y: 512, z: 512 }, 1024)).toThrow(/does not fit/);
  });

  it('rejects a degenerate grid', () => {
    expect(() => layoutAtlas({ x: 0, y: 4, z: 4 })).toThrow(/at least one cell/);
  });
});

describe('cell and pixel addressing', () => {
  /**
   * The solver writes a cell per fragment and reads neighbours by cell coordinate, so
   * these two have to be exact inverses. If they drift, slices silently read each
   * other's edges and the flow field is quietly wrong rather than obviously broken.
   */
  it('round-trips every cell in a grid', () => {
    const grid = { x: 13, y: 7, z: 11 };
    const layout = layoutAtlas(grid);
    for (let z = 0; z < grid.z; z++) {
      for (let y = 0; y < grid.y; y++) {
        for (let x = 0; x < grid.x; x++) {
          const { px, py } = cellToPixel(layout, x, y, z);
          expect(pixelToCell(layout, px, py)).toEqual({ x, y, z });
        }
      }
    }
  });

  it('gives every cell its own pixel', () => {
    const grid = { x: 9, y: 6, z: 10 };
    const layout = layoutAtlas(grid);
    const seen = new Set<string>();
    for (let z = 0; z < grid.z; z++) {
      for (let y = 0; y < grid.y; y++) {
        for (let x = 0; x < grid.x; x++) {
          const { px, py } = cellToPixel(layout, x, y, z);
          expect(px).toBeLessThan(layout.texture.width);
          expect(py).toBeLessThan(layout.texture.height);
          const key = `${px},${py}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
    expect(seen.size).toBe(grid.x * grid.y * grid.z);
  });
});
