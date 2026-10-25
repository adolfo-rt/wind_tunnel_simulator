import { Mesh, type Group } from 'three';

/**
 * Wetted area, measured off the aircraft's own triangles.
 *
 * Parasite drag is skin friction times the area the skin covers, so this number is half
 * of the answer. It could have come from a handbook formula - pi d l for a fuselage and
 * twice the planform for a wing - but it comes from the mesh instead, for the same reason
 * everything else here does: it is the same aeroplane the solver sees and the viewer
 * draws. Change the fuselage fineness and the drag moves, without anything having to
 * remember that it should.
 *
 * Two honest limitations. Surfaces buried inside other surfaces are counted - the wing
 * carry-through inside the fuselage, the root of a fin - because a triangle does not know
 * what is on the other side of it. And the fan face at the front of a nacelle is counted
 * as skin when it is really a streamtube. Both inflate the total by a few per cent, in
 * the same direction for every aircraft, so a comparison across the roster is affected
 * much less than any single figure.
 */

export interface WettedAreas {
  /** Square metres per named component. */
  byPart: Map<string, number>;
  total: number;
}

/** Surface area of one geometry, summed over its triangles. */
export function meshArea(mesh: Mesh): number {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  if (!position) return 0;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;

  let area = 0;
  const ax = [0, 0, 0];
  const ay = [0, 0, 0];
  const az = [0, 0, 0];
  for (let i = 0; i + 2 < count; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = index ? index.getX(i + c) : i + c;
      ax[c] = position.getX(v);
      ay[c] = position.getY(v);
      az[c] = position.getZ(v);
    }
    // Half the magnitude of the cross product of two edges.
    const e1x = ax[1] - ax[0];
    const e1y = ay[1] - ay[0];
    const e1z = az[1] - az[0];
    const e2x = ax[2] - ax[0];
    const e2y = ay[2] - ay[0];
    const e2z = az[2] - az[0];
    area +=
      0.5 *
      Math.hypot(
        e1y * e2z - e1z * e2y,
        e1z * e2x - e1x * e2z,
        e1x * e2y - e1y * e2x,
      );
  }
  return area;
}

/**
 * Wetted area of a whole aircraft, grouped by the part each mesh belongs to.
 *
 * The grouping follows the aerodynamic tags the builder already puts on its meshes for
 * the surface-pressure bake, so a part the panel model knows about is a part this knows
 * about. Anything untagged - pylons, fairings, the undercarriage doors - still counts
 * towards the total, under `other`: it is skin in the airflow whatever the panel model
 * thinks of it.
 */
export function wettedAreas(group: Group): WettedAreas {
  const byPart = new Map<string, number>();
  let total = 0;

  group.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const area = meshArea(mesh);
    if (!(area > 0)) return;

    const tag = mesh.userData.aero as
      | { kind: 'surface'; surface: string }
      | { kind: 'body'; body: string }
      | undefined;
    const name = tag
      ? tag.kind === 'surface'
        ? tag.surface
        : tag.body.replace(/\d+$/, '')
      : 'other';

    byPart.set(name, (byPart.get(name) ?? 0) + area);
    total += area;
  });

  return { byPart, total };
}
