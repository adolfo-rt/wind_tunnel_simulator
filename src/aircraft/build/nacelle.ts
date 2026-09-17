import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { loftRings, type Ring } from './loft';

/**
 * Engine nacelles.
 *
 * The cowl is lofted as one continuous surface that runs forward along the outside,
 * rolls over the inlet lip and turns back inside to the fan face. That gives a genuinely
 * open intake you can see into, and it keeps the solid closed for the flow solver.
 *
 * The lip matters aerodynamically as well as visually. It is a small, highly curved
 * leading edge where the flow accelerates sharply, so it shows up clearly in the
 * pressure field, and it is one of the places a modern high-bypass engine differs most
 * from a 1950s turbojet: the bigger the fan, the blunter and more prominent the lip.
 */

export interface NacelleParams {
  /** Centre of the inlet plane. */
  inlet: Vector3;
  length: number;
  diameter: number;
  /** Higher bypass ratios give a fatter cowl around a much larger fan. */
  bypassRatio: number;
  segments?: number;
}

function circleRing(x: number, centre: Vector3, radius: number, segments: number): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(
      new Vector3(x, centre.y + Math.sin(theta) * radius, centre.z + Math.cos(theta) * radius),
    );
  }
  return points;
}

/** The cowl: outer surface, inlet lip and inner duct as a single closed solid. */
export function buildNacelleCowl(params: NacelleParams): BufferGeometry {
  const segments = params.segments ?? 24;
  const { inlet, length, diameter } = params;
  const outerRadius = diameter / 2;
  // A high-bypass engine is nearly all fan, so the duct fills most of the cowl.
  const ductFraction = 0.72 + 0.02 * Math.min(params.bypassRatio, 10);
  const ductRadius = outerRadius * ductFraction;
  const exitRadius = outerRadius * (params.bypassRatio > 3 ? 0.78 : 0.62);
  const lipRadius = outerRadius * 0.955;

  const rings: Ring[] = [];

  // Rear of the cowl forward along the outside, bulging just behind the lip.
  const outerProfile: Array<[number, number]> = [
    [1.0, exitRadius],
    [0.82, exitRadius * 1.06],
    [0.6, outerRadius * 0.95],
    [0.38, outerRadius * 0.995],
    [0.2, outerRadius],
    [0.08, outerRadius * 0.995],
    [0.02, lipRadius],
  ];
  for (const [t, radius] of outerProfile) {
    rings.push({ points: circleRing(inlet.x + t * length, inlet, radius, segments), v: 1 - t });
  }

  // Roll over the lip and turn back inside towards the fan face.
  const innerProfile: Array<[number, number]> = [
    [0.0, lipRadius * 0.985],
    [0.015, ductRadius * 1.04],
    [0.06, ductRadius],
    [0.2, ductRadius * 0.99],
  ];
  for (const [t, radius] of innerProfile) {
    rings.push({ points: circleRing(inlet.x + t * length, inlet, radius, segments), v: 1 + t });
  }

  return loftRings(rings, { closed: true, capStart: true, capEnd: true });
}

/** The core exhaust plug poking out of the back of the cowl. */
export function buildExhaustPlug(params: NacelleParams): BufferGeometry {
  const segments = params.segments ?? 24;
  const { inlet, length, diameter } = params;
  const baseRadius = diameter * 0.2;
  const rings: Ring[] = [];
  const stations = 6;
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const x = inlet.x + length * (0.86 + 0.24 * t);
    const radius = Math.max(diameter * 0.02, baseRadius * Math.sqrt(Math.max(0, 1 - t * t)));
    rings.push({ points: circleRing(x, inlet, radius, segments), v: t });
  }
  return loftRings(rings, { closed: true, capStart: true, capEnd: true });
}

/** The spinner at the centre of the fan. */
export function buildSpinner(params: NacelleParams): BufferGeometry {
  const segments = params.segments ?? 20;
  const { inlet, length, diameter } = params;
  const radius = diameter * 0.09;
  const rings: Ring[] = [];
  const stations = 6;
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const x = inlet.x + length * (0.07 + 0.16 * t);
    // A cone that is rounded at the tip rather than needle-sharp.
    rings.push({
      points: circleRing(x, inlet, Math.max(diameter * 0.005, radius * Math.sin((t * Math.PI) / 2)), segments),
      v: t,
    });
  }
  return loftRings(rings, { closed: true, capStart: true, capEnd: true });
}

/**
 * The fan disc: a ring of twisted blades at the fan face.
 *
 * Purely visual detail. It sits deep inside the duct and is excluded from the solid
 * the flow solver sees, because resolving individual blades is far beyond the grid.
 */
export function buildFanBlades(params: NacelleParams, bladeCount = 22): BufferGeometry {
  const { inlet, length, diameter } = params;
  const ductFraction = 0.72 + 0.02 * Math.min(params.bypassRatio, 10);
  const tipRadius = (diameter / 2) * ductFraction * 0.97;
  const hubRadius = diameter * 0.1;
  const x = inlet.x + length * 0.21;

  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let b = 0; b < bladeCount; b++) {
    const phase = (b / bladeCount) * Math.PI * 2;
    const base = positions.length / 3;
    // Each blade is a quad twisted from a steep angle at the hub to a shallow one at
    // the tip, which is how a real fan blade is shaped.
    const spanSteps = 3;
    for (let s = 0; s <= spanSteps; s++) {
      const t = s / spanSteps;
      const radius = hubRadius + (tipRadius - hubRadius) * t;
      const twist = (0.55 - 0.38 * t) * 1.2;
      const chord = diameter * (0.1 - 0.035 * t);
      for (const side of [-1, 1]) {
        const dx = side * chord * Math.cos(twist);
        const dTheta = (side * chord * Math.sin(twist)) / Math.max(radius, 1e-3);
        const theta = phase + dTheta;
        positions.push(x + dx, inlet.y + Math.sin(theta) * radius, inlet.z + Math.cos(theta) * radius);
        uvs.push(side * 0.5 + 0.5, t);
      }
    }
    for (let s = 0; s < spanSteps; s++) {
      const a = base + s * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
