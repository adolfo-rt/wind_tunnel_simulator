/**
 * Storing a 3D grid in a 2D texture.
 *
 * WebGL2 can sample a 3D texture but cannot render into one slice at a time without a
 * geometry shader, which it does not have. Rendering slice by slice into a 2D-array
 * texture means one draw call per slice — sixty draw calls per pass, times twenty
 * pressure iterations, is hundreds of draws a frame for nothing.
 *
 * So the grid is flattened: the z slices are tiled across a single 2D texture, and every
 * solver pass is one full-screen quad. The cost is that trilinear filtering has to be
 * done by hand, two hardware-bilinear taps blended along z, which is a few instructions
 * and worth it.
 */

export interface GridSize {
  x: number;
  y: number;
  z: number;
}

export interface AtlasLayout {
  grid: GridSize;
  /** Slices laid out this many across and down. */
  tiles: { x: number; y: number };
  /** Size of the backing texture in pixels. */
  texture: { width: number; height: number };
}

/**
 * Tile the slices into as square a texture as possible, so neither dimension runs into
 * the hardware's maximum texture size before the other.
 */
export function layoutAtlas(grid: GridSize, maxTextureSize = 4096): AtlasLayout {
  if (grid.x < 1 || grid.y < 1 || grid.z < 1) {
    throw new Error('a grid needs at least one cell on every axis');
  }

  let best: AtlasLayout | null = null;
  for (let tilesX = 1; tilesX <= grid.z; tilesX++) {
    const tilesY = Math.ceil(grid.z / tilesX);
    const width = tilesX * grid.x;
    const height = tilesY * grid.y;
    if (width > maxTextureSize || height > maxTextureSize) continue;
    // Prefer the layout closest to square, then the one wasting fewest slots.
    const squareness = Math.max(width, height) / Math.min(width, height);
    const waste = tilesX * tilesY - grid.z;
    const score = squareness + waste * 0.01;
    if (!best || score < bestScore(best, grid)) {
      best = { grid, tiles: { x: tilesX, y: tilesY }, texture: { width, height } };
    }
  }
  if (!best) {
    throw new Error(
      `a ${grid.x}x${grid.y}x${grid.z} grid does not fit in a ${maxTextureSize}px texture`,
    );
  }
  return best;
}

function bestScore(layout: AtlasLayout, grid: GridSize): number {
  const { width, height } = layout.texture;
  const squareness = Math.max(width, height) / Math.min(width, height);
  const waste = layout.tiles.x * layout.tiles.y - grid.z;
  return squareness + waste * 0.01;
}

/** Where cell (x, y, z) lands in the atlas, in pixels. */
export function cellToPixel(layout: AtlasLayout, x: number, y: number, z: number): { px: number; py: number } {
  const tileX = z % layout.tiles.x;
  const tileY = Math.floor(z / layout.tiles.x);
  return { px: tileX * layout.grid.x + x, py: tileY * layout.grid.y + y };
}

/** The cell a given atlas pixel belongs to. The inverse of cellToPixel. */
export function pixelToCell(
  layout: AtlasLayout,
  px: number,
  py: number,
): { x: number; y: number; z: number } {
  const tileX = Math.floor(px / layout.grid.x);
  const tileY = Math.floor(py / layout.grid.y);
  return {
    x: px - tileX * layout.grid.x,
    y: py - tileY * layout.grid.y,
    z: tileY * layout.tiles.x + tileX,
  };
}

/**
 * GLSL for reading and writing the atlas.
 *
 * Sampling clamps to the middle of a tile before taking each bilinear tap, so hardware
 * filtering can never bleed a neighbouring slice's edge into the result — the one way a
 * flattened grid can go quietly wrong.
 */
export const ATLAS_GLSL = /* glsl */ `
  uniform vec3 uGrid;
  uniform vec2 uTiles;
  uniform vec2 uTexSize;

  /// Explicit-parameter forms, so a pass can read a second atlas with its own layout -
  /// the obstacle field is a different resolution from the flow grid.
  vec4 sampleSliceOf(sampler2D tex, vec2 xy, float z, vec3 grid, vec2 tiles, vec2 texSize) {
    z = clamp(z, 0.0, grid.z - 1.0);
    vec2 tile = vec2(mod(z, tiles.x), floor(z / tiles.x));
    vec2 local = clamp(xy, vec2(0.5), grid.xy - 0.5);
    return texture(tex, (tile * grid.xy + local) / texSize);
  }

  vec4 sampleAtlasOf(sampler2D tex, vec3 p, vec3 grid, vec2 tiles, vec2 texSize) {
    p = clamp(p, vec3(0.5), grid - 0.5);
    float z0 = floor(p.z - 0.5);
    float fz = p.z - 0.5 - z0;
    return mix(
      sampleSliceOf(tex, p.xy, z0, grid, tiles, texSize),
      sampleSliceOf(tex, p.xy, z0 + 1.0, grid, tiles, texSize),
      fz
    );
  }

  /// The cell this fragment is responsible for.
  vec3 fragmentCell() {
    vec2 px = floor(gl_FragCoord.xy);
    vec2 tile = floor(px / uGrid.xy);
    return vec3(px - tile * uGrid.xy, tile.y * uTiles.x + tile.x);
  }

  /// True for fragments in tiles past the last slice, which have no cell to compute.
  bool isPaddingCell(vec3 cell) {
    return cell.z > uGrid.z - 0.5;
  }

  vec4 sampleSlice(sampler2D tex, vec2 xy, float z) {
    z = clamp(z, 0.0, uGrid.z - 1.0);
    vec2 tile = vec2(mod(z, uTiles.x), floor(z / uTiles.x));
    vec2 local = clamp(xy, vec2(0.5), uGrid.xy - 0.5);
    return texture(tex, (tile * uGrid.xy + local) / uTexSize);
  }

  /// Trilinear sample at a position in cell coordinates.
  vec4 sampleAtlas(sampler2D tex, vec3 p) {
    p = clamp(p, vec3(0.5), uGrid - 0.5);
    float z0 = floor(p.z - 0.5);
    float fz = p.z - 0.5 - z0;
    return mix(sampleSlice(tex, p.xy, z0), sampleSlice(tex, p.xy, z0 + 1.0), fz);
  }

  /// Nearest-cell read, for stencils where interpolation would smear the answer.
  vec4 readCell(sampler2D tex, vec3 cell) {
    vec3 c = clamp(cell, vec3(0.0), uGrid - 1.0);
    vec2 tile = vec2(mod(c.z, uTiles.x), floor(c.z / uTiles.x));
    return texture(tex, (tile * uGrid.xy + c.xy + 0.5) / uTexSize);
  }
`;
