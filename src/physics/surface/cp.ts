import type { Box3, Vector3 } from 'three';
import type { GridSize } from '../gpu/atlas';

/**
 * Pressure on the aircraft's skin, read from the velocity field.
 *
 * ## Why not the solver's pressure field
 *
 * The solver has a pressure field, and using it would seem the obvious thing. It is a
 * projection pseudo-pressure: the time step is folded into it, and because it is warm
 * started from the previous step it carries an arbitrary additive constant that drifts.
 * Turning that into a coefficient would need a calibration factor with nothing to fix it
 * except the answer it is supposed to produce, and surface colours that slowly shifted as
 * the constant wandered.
 *
 * Bernoulli needs no such factor. For steady incompressible flow the total pressure along
 * a streamline is constant, so
 *
 *     Cp = (p - p∞) / (½ρU∞²) = 1 - (V/U∞)²
 *
 * and the solver already works with U∞ = 1, which makes it exactly `1 - |v|²` with
 * nothing to calibrate. It also reads correctly on its own terms: Cp is 1 where the flow
 * stops, 0 in the undisturbed stream, and negative wherever the air has been sped up.
 *
 * What it costs is the wake. Bernoulli assumes no total-pressure loss, and a separated
 * wake is exactly where that assumption fails, so behind the aircraft this over-reads —
 * it reports the pressure recovering more than it really does. The streamlines and the
 * flow slice show the wake honestly, and the README says so.
 *
 * ## Why Cp does not change with the tunnel speed
 *
 * It is a coefficient: the division by dynamic pressure is what takes the speed out.
 * Doubling the tunnel speed doubles the pressure everywhere and doubles ½ρU², so the
 * ratio is unchanged. The surface colours are therefore identical at every slider
 * setting, which is the opposite of the streamlines, where travel has to be scaled by the
 * slider deliberately. Both are right; the difference has to be intended, and the
 * interface says which is which.
 */

/** Cp from a non-dimensional speed, where the free stream is 1. */
export function pressureCoefficient(speed: number): number {
  return 1 - speed * speed;
}

/**
 * How far off the skin the field is sampled, in flow cells.
 *
 * It cannot be zero. The solver brings the air to rest inside the aircraft, so a sample
 * taken on the surface returns nothing moving and reports Cp = 1 — a uniformly
 * stagnating aeroplane, which looks like a result and is an artefact of asking the wrong
 * place. The sample has to come from the first cell that is genuinely fluid.
 *
 * It cannot be large either, or the reading stops being about the surface. Solidity ramps
 * to zero half a cell out, and trilinear sampling blends over a cell either side, so a
 * little over one cell is the first offset that is clear of the obstacle without having
 * left the surface behind.
 */
export const CP_SAMPLE_CELLS = 1.2;

/**
 * Trilinear sample of the velocity field, in the same convention the shader's atlas
 * sampler uses: the centre of cell c sits at c + 0.5.
 *
 * This exists so the surface pressure can be checked, and so stage 8 can integrate forces
 * from the same numbers the colours are drawn from rather than a second estimate.
 */
export function sampleVelocity(
  field: Float32Array,
  grid: GridSize,
  domain: Box3,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const size = {
    x: domain.max.x - domain.min.x,
    y: domain.max.y - domain.min.y,
    z: domain.max.z - domain.min.z,
  };
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0.5, v));
  const fx = clamp(((x - domain.min.x) / size.x) * grid.x, grid.x - 0.5) - 0.5;
  const fy = clamp(((y - domain.min.y) / size.y) * grid.y, grid.y - 0.5) - 0.5;
  const fz = clamp(((z - domain.min.z) / size.z) * grid.z, grid.z - 0.5) - 0.5;

  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const i1 = Math.min(i + 1, grid.x - 1);
  const j1 = Math.min(j + 1, grid.y - 1);
  const k1 = Math.min(k + 1, grid.z - 1);
  const tx = fx - i, ty = fy - j, tz = fz - k;

  const at = (a: number, b: number, c: number, component: number) =>
    field[(a + grid.x * (b + grid.y * c)) * 3 + component];

  const lerp = (component: number) => {
    const c00 = at(i, j, k, component) * (1 - tx) + at(i1, j, k, component) * tx;
    const c10 = at(i, j1, k, component) * (1 - tx) + at(i1, j1, k, component) * tx;
    const c01 = at(i, j, k1, component) * (1 - tx) + at(i1, j, k1, component) * tx;
    const c11 = at(i, j1, k1, component) * (1 - tx) + at(i1, j1, k1, component) * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  };

  return { x: lerp(0), y: lerp(1), z: lerp(2) };
}

/**
 * Cp on a piece of skin, given where it is and which way it faces.
 *
 * Mirrors what the aircraft's fragment shader does, step for step, so that a headless
 * check can ask the same question the picture is answering.
 */
export function surfaceCp(
  field: Float32Array,
  grid: GridSize,
  domain: Box3,
  point: Vector3,
  normal: Vector3,
  cellWorld: number,
): number {
  const offset = CP_SAMPLE_CELLS * cellWorld;
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const v = sampleVelocity(
    field,
    grid,
    domain,
    point.x + (normal.x / length) * offset,
    point.y + (normal.y / length) * offset,
    point.z + (normal.z / length) * offset,
  );
  return pressureCoefficient(Math.hypot(v.x, v.y, v.z));
}

/**
 * The fragment-shader half of the same thing.
 *
 * Needs `uVelocity` and the atlas sampler from ATLAS_GLSL, the domain uniforms, and the
 * two varyings the vertex half sets up.
 */
export const SURFACE_CP_GLSL = /* glsl */ `
  uniform sampler2D uVelocity;
  uniform vec3 uDomainMin;
  uniform vec3 uDomainSize;
  uniform float uCpOffset;

  float surfaceCp(vec3 world, vec3 normal) {
    // Off the skin, because the solver holds the air still inside the aircraft and a
    // sample taken on the surface would report a stagnation point everywhere.
    vec3 p = world + normalize(normal) * uCpOffset;
    vec3 cell = (p - uDomainMin) / uDomainSize * uGrid;
    vec3 v = sampleAtlas(uVelocity, cell).xyz;
    // Bernoulli, with the free stream at 1 because the solve is non-dimensional.
    return 1.0 - dot(v, v);
  }
`;
