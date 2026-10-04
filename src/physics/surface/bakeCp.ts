import { BufferAttribute, type Group, type Mesh } from 'three';
import type { AeroTag } from '../../aircraft/AircraftBuilder';
import {
  bodyPressureAt,
  surfacePressureAt,
  type PanelAircraft,
} from '../panel/aircraftModel';

/**
 * Write the panel model's pressure onto the aircraft's own vertices.
 *
 * Per vertex on the CPU rather than per fragment in a shader, for one reason that matters
 * more than the others: the number the colour is drawn from is then the same number stage
 * 8 will integrate into lift and drag. A shader could read the panel solution too, but
 * only the picture would ever see the result, and a picture is not something a force
 * balance can be checked against.
 *
 * It costs nothing per frame. The solution changes when the aircraft does, which is when
 * the mesh is built anyway.
 */

/** Attribute the aircraft's materials read to colour themselves. */
export const CP_ATTRIBUTE = 'aCp';

/**
 * Where a vertex sits along the chord, from its position around the airfoil contour.
 *
 * The loft stores that position directly in u: the contour runs from the trailing edge
 * forward along the upper surface to the leading edge and back along the lower, so u
 * below a half is the upper surface and above it the lower. The stations are cosine
 * spaced, which is how the airfoil was drawn, so this inverts that spacing rather than
 * assuming the contour is uniform — getting it wrong would smear the suction peak, which
 * sits in the first tenth of the chord where the points are densest.
 */
export function chordPositionFromContour(
  u: number,
  resolution: number,
): { chordFraction: number; upper: boolean } {
  const perRing = 2 * resolution - 1;
  const index = Math.min(perRing - 1, Math.max(0, Math.round(u * perRing)));
  const leadingEdge = resolution - 1;
  const steps = Math.abs(leadingEdge - index);
  const chordFraction = 0.5 * (1 - Math.cos((Math.PI * steps) / Math.max(1, leadingEdge)));
  return { chordFraction, upper: index <= leadingEdge };
}

/**
 * Fill, or refresh, the Cp attribute on every mesh of an aircraft.
 *
 * Meshes the panel model knows nothing about — a pylon, a spinner, a fan disc — are left
 * at the free-stream value rather than given a guess. Neutral is the honest colour for a
 * surface the simulation has never seen.
 */
export function bakeSurfacePressure(group: Group, model: PanelAircraft): void {
  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;

    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const count = position.count;

    let values = mesh.geometry.getAttribute(CP_ATTRIBUTE) as BufferAttribute | undefined;
    if (!values || values.count !== count) {
      values = new BufferAttribute(new Float32Array(count), 1);
      mesh.geometry.setAttribute(CP_ATTRIBUTE, values);
    }

    const tag = mesh.userData.aero as AeroTag | undefined;
    const array = values.array as Float32Array;

    if (!tag) {
      array.fill(0);
      values.needsUpdate = true;
      return;
    }

    if (tag.kind === 'body') {
      const body = model.bodies.find((b) => b.name === tag.body);
      if (!body) {
        array.fill(0);
      } else {
        for (let i = 0; i < count; i++) array[i] = bodyPressureAt(body.solution, position.getX(i));
      }
      values.needsUpdate = true;
      return;
    }

    const surface = model.surfaces.find((s) => s.name === tag.surface);
    const uv = mesh.geometry.getAttribute('uv');
    if (!surface || !uv) {
      array.fill(0);
      values.needsUpdate = true;
      return;
    }

    for (let i = 0; i < count; i++) {
      const { chordFraction, upper } = chordPositionFromContour(uv.getX(i), tag.resolution);
      array[i] = surfacePressureAt(model, surface, uv.getY(i), chordFraction, upper);
    }
    values.needsUpdate = true;
  });
}
