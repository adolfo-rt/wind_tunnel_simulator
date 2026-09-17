import { BufferGeometry, BufferAttribute, Vector3 } from 'three';

/**
 * Surface lofting helpers.
 *
 * Every part of an aircraft here is a loft: a sequence of closed or open cross-section
 * rings joined by quads. Fuselages loft superellipse rings along the body axis; wings,
 * fins and winglets loft airfoil sections along the span; nacelles loft circles along
 * the engine axis.
 *
 * The geometry has to serve two masters. It is rendered, so it needs sensible normals
 * and UVs. It is also voxelised into the signed distance field the flow solver treats
 * as a solid obstacle, so consistent outward-facing winding matters: an inside-out
 * patch would punch a hole in the aeroplane as far as the airflow is concerned.
 */

export interface Ring {
  /** Points around the section. Every ring in a loft must have the same length. */
  points: Vector3[];
  /** Texture coordinate along the loft direction. */
  v: number;
}

export interface LoftOptions {
  /** True when the rings are closed loops (fuselage, nacelle); false for open sheets. */
  closed?: boolean;
  /** Triangulate the first ring into a flat cap. */
  capStart?: boolean;
  /** Triangulate the last ring into a flat cap. */
  capEnd?: boolean;
}

/**
 * Signed volume of a closed triangle mesh, via the divergence theorem.
 * Positive when triangles wind counter-clockwise seen from outside.
 */
export function signedVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    // a . (b x c)
    total +=
      ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return total / 6;
}

/**
 * Flip triangle winding in place if the mesh is inside out.
 * Only meaningful for closed shapes; harmless on open ones (volume is near zero,
 * so nothing is flipped).
 */
export function ensureOutwardWinding(geometry: BufferGeometry): BufferGeometry {
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  if (!index) return geometry;
  const volume = signedVolume(position.array as ArrayLike<number>, index.array as ArrayLike<number>);
  if (volume < 0) {
    const array = index.array as Uint32Array | Uint16Array;
    for (let i = 0; i < array.length; i += 3) {
      const tmp = array[i + 1];
      array[i + 1] = array[i + 2];
      array[i + 2] = tmp;
    }
    index.needsUpdate = true;
  }
  return geometry;
}

/**
 * Join a sequence of rings into a triangle mesh.
 *
 * UVs run u around the section and v along the loft, so a fuselage livery texture can
 * be painted in a flat strip and wrapped on.
 */
export function loftRings(rings: Ring[], options: LoftOptions = {}): BufferGeometry {
  const closed = options.closed ?? true;
  if (rings.length < 2) throw new Error('a loft needs at least two rings');
  const perRing = rings[0].points.length;
  for (const ring of rings) {
    if (ring.points.length !== perRing) {
      throw new Error('every ring in a loft must have the same number of points');
    }
  }

  const ringCount = rings.length;
  /**
   * Closed rings carry one extra vertex per ring, coincident with the first but with
   * u = 1 instead of u = 0.
   *
   * Without it there is nowhere for u to reach 1, so the quad that closes the loop runs
   * from u = 0.97 back to u = 0 and squeezes the entire texture, backwards, into a
   * single segment. On a fuselage that shows up as a compressed mirrored band down one
   * side, which reads as the whole livery being twisted around the body.
   */
  const stride = closed ? perRing + 1 : perRing;
  const vertexCount = ringCount * stride;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  for (let r = 0; r < ringCount; r++) {
    const ring = rings[r];
    for (let j = 0; j < stride; j++) {
      const index = r * stride + j;
      // The seam vertex repeats the first point of the ring.
      const p = ring.points[j % perRing];
      positions[index * 3] = p.x;
      positions[index * 3 + 1] = p.y;
      positions[index * 3 + 2] = p.z;
      uvs[index * 2] = j / (stride - 1);
      uvs[index * 2 + 1] = ring.v;
    }
  }

  const indices: number[] = [];
  const segments = stride - 1;
  for (let r = 0; r < ringCount - 1; r++) {
    for (let j = 0; j < segments; j++) {
      const a = r * stride + j;
      const b = r * stride + j + 1;
      const c = (r + 1) * stride + j + 1;
      const d = (r + 1) * stride + j;
      // Wound so the face normal points away from the loft axis, matching the caps
      // below. Getting this backwards is not merely a rendering problem: the solver
      // reads this mesh as a solid, and a reversed face inverts the inside/outside
      // test at that point.
      indices.push(a, d, c, a, c, b);
    }
  }

  // Flat caps, as a triangle fan around the ring's centroid.
  const extraPositions: number[] = [];
  const extraUvs: number[] = [];
  const addCap = (ringIndex: number, reverse: boolean) => {
    const ring = rings[ringIndex];
    const centroid = new Vector3();
    for (const p of ring.points) centroid.add(p);
    centroid.multiplyScalar(1 / perRing);
    const centreIndex = vertexCount + extraPositions.length / 3;
    extraPositions.push(centroid.x, centroid.y, centroid.z);
    extraUvs.push(0.5, ring.v);
    for (let j = 0; j < perRing; j++) {
      // On a closed ring the seam vertex sits at j = perRing, so the fan can simply
      // step forward; an open one has to wrap.
      const jNext = closed ? j + 1 : (j + 1) % perRing;
      const a = ringIndex * stride + j;
      const b = ringIndex * stride + jNext;
      if (reverse) indices.push(centreIndex, b, a);
      else indices.push(centreIndex, a, b);
    }
  };
  if (options.capStart) addCap(0, false);
  if (options.capEnd) addCap(ringCount - 1, true);

  const geometry = new BufferGeometry();
  if (extraPositions.length > 0) {
    const merged = new Float32Array(positions.length + extraPositions.length);
    merged.set(positions);
    merged.set(extraPositions, positions.length);
    const mergedUvs = new Float32Array(uvs.length + extraUvs.length);
    mergedUvs.set(uvs);
    mergedUvs.set(extraUvs, uvs.length);
    geometry.setAttribute('position', new BufferAttribute(merged, 3));
    geometry.setAttribute('uv', new BufferAttribute(mergedUvs, 2));
  } else {
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  }
  geometry.setIndex(indices);
  ensureOutwardWinding(geometry);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A superellipse ring in the YZ plane, centred on (x, centreY, 0).
 *
 * The exponent controls how square the section is: 2 gives a true ellipse, higher
 * values square it off the way a widebody's double-bubble section does. Separate
 * upper and lower half-heights let one call describe a circular narrowbody, the
 * A380's tall oval, and the 747's upper-deck hump.
 */
export function superellipseRing(
  x: number,
  centreY: number,
  halfWidth: number,
  upperHalfHeight: number,
  lowerHalfHeight: number,
  exponent: number,
  segments: number,
): Vector3[] {
  const points: Vector3[] = [];
  const power = 2 / exponent;
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    const halfHeight = s >= 0 ? upperHalfHeight : lowerHalfHeight;
    const y = centreY + Math.sign(s) * Math.pow(Math.abs(s), power) * halfHeight;
    const z = Math.sign(c) * Math.pow(Math.abs(c), power) * halfWidth;
    points.push(new Vector3(x, y, z));
  }
  return points;
}
