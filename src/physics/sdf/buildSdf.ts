/**
 * Turning an aircraft mesh into a signed distance field.
 *
 * The flow solver needs to know, for any point in the tunnel, whether it is inside the
 * aeroplane and how far it is from the surface. A distance field answers both, and it
 * does so smoothly, which matters: a hard in/out test gives staircased walls, whereas a
 * distance lets a cell be partly solid and the boundary comes out smooth at a resolution
 * where it otherwise would not be.
 *
 * Two things make this harder than a textbook distance transform.
 *
 * The mesh is a UNION of overlapping closed solids - fuselage, wings, nacelles, pylons -
 * not one watertight surface. The usual inside test, counting ray crossings and taking
 * the parity, is wrong for a union: a ray through a wing where it passes into the
 * fuselage crosses four faces, an even number, and would call the interior empty.
 * Counting crossings with their orientation instead gives the winding number, which is
 * one or more anywhere inside any part and zero outside, so overlaps take care of
 * themselves.
 *
 * And distances only need to be accurate near the surface. The solver uses them for the
 * boundary condition and to push stray particles out; nothing cares whether a point far
 * upstream is thirty or forty metres from a wing. Distances are therefore exact within a
 * narrow band and clamped beyond it, which keeps the whole build to a fraction of a
 * second.
 */

export interface SdfGrid {
  /** Signed distance per cell, negative inside. Indexed x fastest, then y, then z. */
  data: Float32Array;
  resolution: { x: number; y: number; z: number };
  /** Object-space position of the centre of cell (0, 0, 0). */
  origin: { x: number; y: number; z: number };
  /** Cell size; cells are cubic. */
  cell: number;
  /** Distances are exact within this band of the surface and clamped beyond it. */
  band: number;
}

export interface BuildSdfOptions {
  /** Cells along the longest axis of the mesh's bounding box. */
  resolution?: number;
  /** Fraction of the bounding box added as margin on every side. */
  margin?: number;
  /** Width of the exact band, in cells. */
  bandCells?: number;
}

/** Squared distance from a point to a triangle. The standard region-based solution. */
export function pointTriangleDistanceSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const qx = apx - v * abx, qy = apy - v * aby, qz = apz - v * abz;
    return qx * qx + qy * qy + qz * qz;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const qx = apx - w * acx, qy = apy - w * acy, qz = apz - w * acz;
    return qx * qx + qy * qy + qz * qz;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    // Closest point is B + w(C - B), so the offset from P is (P - B) - w(C - B).
    const qx = bpx - w * (cx - bx), qy = bpy - w * (cy - by), qz = bpz - w * (cz - bz);
    return qx * qx + qy * qy + qz * qz;
  }

  // Inside the face region; project onto the plane.
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const qx = apx - (v * abx + w * acx);
  const qy = apy - (v * aby + w * acy);
  const qz = apz - (v * abz + w * acz);
  return qx * qx + qy * qy + qz * qz;
}

export function buildSdf(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: BuildSdfOptions = {},
): SdfGrid {
  const resolution = options.resolution ?? 128;
  const margin = options.margin ?? 0.08;
  const bandCells = options.bandCells ?? 3;

  // ---- Grid ------------------------------------------------------------------
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const longest = Math.max(spanX, spanY, spanZ);
  const pad = longest * margin;

  const cell = (longest + 2 * pad) / resolution;
  const nx = Math.max(2, Math.ceil((spanX + 2 * pad) / cell));
  const ny = Math.max(2, Math.ceil((spanY + 2 * pad) / cell));
  const nz = Math.max(2, Math.ceil((spanZ + 2 * pad) / cell));
  const origin = { x: minX - pad, y: minY - pad, z: minZ - pad };
  const band = bandCells * cell;

  const count = nx * ny * nz;
  const data = new Float32Array(count);
  data.fill(band);

  const triangles = indices.length / 3;
  const at = (x: number, y: number, z: number) => x + nx * (y + ny * z);

  // ---- Distance, exact within the band ---------------------------------------
  for (let t = 0; t < triangles; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];

    const loX = Math.max(0, Math.floor((Math.min(ax, bx, cx) - band - origin.x) / cell));
    const hiX = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) + band - origin.x) / cell));
    const loY = Math.max(0, Math.floor((Math.min(ay, by, cy) - band - origin.y) / cell));
    const hiY = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) + band - origin.y) / cell));
    const loZ = Math.max(0, Math.floor((Math.min(az, bz, cz) - band - origin.z) / cell));
    const hiZ = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) + band - origin.z) / cell));

    for (let k = loZ; k <= hiZ; k++) {
      const pz = origin.z + k * cell;
      for (let j = loY; j <= hiY; j++) {
        const py = origin.y + j * cell;
        for (let i = loX; i <= hiX; i++) {
          const px = origin.x + i * cell;
          const index = at(i, j, k);
          const current = data[index];
          if (current <= 0) continue;
          const d2 = pointTriangleDistanceSq(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
          if (d2 < current * current) data[index] = Math.sqrt(d2);
        }
      }
    }
  }

  // ---- Sign, by accumulating oriented crossings along each x line -------------
  applySign(data, positions, indices, { nx, ny, nz, origin, cell });

  return { data, resolution: { x: nx, y: ny, z: nz }, origin, cell, band };
}

interface GridInfo {
  nx: number;
  ny: number;
  nz: number;
  origin: { x: number; y: number; z: number };
  cell: number;
}

/**
 * Mark interior cells by walking each grid line along x and accumulating the winding
 * number: a face turned away from the direction of travel is an entry, one turned
 * towards it is an exit. Zero means outside, whatever the mesh overlaps itself.
 */
function applySign(
  data: Float32Array,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  grid: GridInfo,
): void {
  const { nx, ny, nz, origin, cell } = grid;
  const triangles = indices.length / 3;

  // Bucket triangles by the y range they project onto, so each line only tests the
  // triangles that could possibly cross it.
  const buckets: number[][] = Array.from({ length: ny }, () => []);
  for (let t = 0; t < triangles; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const minY = Math.min(positions[ia + 1], positions[ib + 1], positions[ic + 1]);
    const maxY = Math.max(positions[ia + 1], positions[ib + 1], positions[ic + 1]);
    const loJ = Math.max(0, Math.floor((minY - origin.y) / cell));
    const hiJ = Math.min(ny - 1, Math.ceil((maxY - origin.y) / cell));
    for (let j = loJ; j <= hiJ; j++) buckets[j].push(t);
  }

  const hits: Array<{ x: number; winding: number }> = [];

  for (let j = 0; j < ny; j++) {
    const py = origin.y + j * cell;
    const candidates = buckets[j];
    if (candidates.length === 0) continue;

    for (let k = 0; k < nz; k++) {
      const pz = origin.z + k * cell;
      hits.length = 0;

      for (const t of candidates) {
        const ia = indices[t * 3] * 3;
        const ib = indices[t * 3 + 1] * 3;
        const ic = indices[t * 3 + 2] * 3;
        const ay = positions[ia + 1], az = positions[ia + 2];
        const by = positions[ib + 1], bz = positions[ib + 2];
        const cy = positions[ic + 1], cz = positions[ic + 2];

        // Barycentric test in the yz plane. A triangle edge-on to x projects to a line
        // and has no area here, which is exactly the case that cannot be crossed.
        const area = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        if (area === 0) continue;
        const inv = 1 / area;
        const w1 = ((py - ay) * (cz - az) - (pz - az) * (cy - ay)) * inv;
        const w2 = ((by - ay) * (pz - az) - (bz - az) * (py - ay)) * inv;
        const w0 = 1 - w1 - w2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;

        const ax = positions[ia], bx = positions[ib], cx = positions[ic];
        const x = w0 * ax + w1 * bx + w2 * cx;

        // Only the x component of the triangle's normal matters here: it says whether
        // the face is turned towards or away from the direction of travel.
        const normalX = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        if (normalX === 0) continue;
        hits.push({ x, winding: normalX < 0 ? 1 : -1 });
      }

      if (hits.length === 0) continue;
      hits.sort((p, q) => p.x - q.x);

      let winding = 0;
      let hit = 0;
      for (let i = 0; i < nx; i++) {
        const px = origin.x + i * cell;
        while (hit < hits.length && hits[hit].x <= px) {
          winding += hits[hit].winding;
          hit++;
        }
        if (winding > 0) {
          const index = i + nx * (j + ny * k);
          data[index] = -data[index];
        }
      }
    }
  }
}

/** Trilinear sample of the field, in the same object space the grid was built in. */
export function sampleSdf(grid: SdfGrid, x: number, y: number, z: number): number {
  const { origin, cell, resolution, data, band } = grid;
  const fx = (x - origin.x) / cell;
  const fy = (y - origin.y) / cell;
  const fz = (z - origin.z) / cell;
  if (
    fx < 0 || fy < 0 || fz < 0 ||
    fx > resolution.x - 1 || fy > resolution.y - 1 || fz > resolution.z - 1
  ) {
    // Outside the grid is outside the aircraft, by construction of the margin.
    return band;
  }

  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const i1 = Math.min(i + 1, resolution.x - 1);
  const j1 = Math.min(j + 1, resolution.y - 1);
  const k1 = Math.min(k + 1, resolution.z - 1);
  const tx = fx - i, ty = fy - j, tz = fz - k;
  const at = (a: number, b: number, c: number) => data[a + resolution.x * (b + resolution.y * c)];

  const c00 = at(i, j, k) * (1 - tx) + at(i1, j, k) * tx;
  const c10 = at(i, j1, k) * (1 - tx) + at(i1, j1, k) * tx;
  const c01 = at(i, j, k1) * (1 - tx) + at(i1, j, k1) * tx;
  const c11 = at(i, j1, k1) * (1 - tx) + at(i1, j1, k1) * tx;
  const c0 = c00 * (1 - ty) + c10 * ty;
  const c1 = c01 * (1 - ty) + c11 * ty;
  return c0 * (1 - tz) + c1 * tz;
}
