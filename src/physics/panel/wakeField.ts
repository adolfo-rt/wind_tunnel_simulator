import type { Vec3 } from './vlm';

/**
 * The velocity a trailing wake induces, from the circulation the lattice solved.
 *
 * Helmholtz's theorem says circulation cannot simply stop in the fluid: wherever the
 * bound circulation changes along the span, the difference leaves downstream as a
 * trailing filament. A wing with lift therefore *must* trail vorticity, the shedding is
 * strongest where the circulation falls fastest — at the tip — and the energy left in
 * that wake is the induced drag. The tip vortex is not a side effect of lift; it is the
 * bill for it, which is why this is the part of stage 6 worth getting right.
 *
 * The grid solver cannot produce this on its own, for the same reason it could not
 * produce a surface pressure in stage 5 and measured rather than assumed there too. A
 * tip vortex is a few centimetres across where it leaves the wing; the grid's cells are
 * a metre. What the grid has is a wake that is slow and broad and roughly the right
 * shape, with no rotation in it that survives more than a few cells. So the circulation
 * comes from the method that can resolve it, and is added to the field the grid solves,
 * which is the same division of labour stage 5 settled on.
 *
 * Adding it is legitimate rather than cosmetic: the field of a vortex filament is exactly
 * divergence-free, so the sum of the two is still an incompressible field and the
 * pressure projection has nothing to undo.
 */

/**
 * A trailing vortex leaving a lifting surface.
 *
 * `gamma` is the circulation about the stream direction, right-handed, carried
 * downstream from (x, y, z) to infinity.
 */
export interface WakeFilament {
  x: number;
  y: number;
  z: number;
  gamma: number;
}

/**
 * Velocity induced at `point` by a set of semi-infinite filaments trailing along
 * `streamDir` from each one's origin.
 *
 * Biot–Savart for a straight segment, with the far end taken to infinity:
 *
 *     v = (G / 4pi) * (u x r) / |u x r|^2 * (1 + u.r / |r|)
 *
 * where u is the unit stream direction and r points from the filament's origin to the
 * evaluation point. The last factor is what makes it semi-infinite rather than infinite,
 * and it is worth knowing what it does: far downstream it tends to two, far upstream to
 * zero, and in the plane of the origin to one. That is the textbook factor of two between
 * the downwash at the wing and the downwash in the far wake, falling straight out of the
 * geometry rather than being asserted.
 *
 * `core` replaces the singularity on the filament itself with a solid-body rotation of
 * that radius — the Rankine core, regularised smoothly rather than clipped. A real tip
 * vortex has a viscous core a few centimetres across; this one is sized to the grid
 * instead, because a vortex tighter than a cell cannot be drawn and an unregularised
 * filament would simply throw particles across the tunnel.
 */
export function wakeVelocity(
  point: Vec3,
  filaments: readonly WakeFilament[],
  streamDir: Vec3,
  core: number,
): Vec3 {
  const speed = Math.hypot(streamDir.x, streamDir.y, streamDir.z);
  if (speed < 1e-12 || filaments.length === 0) return { x: 0, y: 0, z: 0 };
  const ux = streamDir.x / speed;
  const uy = streamDir.y / speed;
  const uz = streamDir.z / speed;
  const coreSq = core * core;

  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const f of filaments) {
    const rx = point.x - f.x;
    const ry = point.y - f.y;
    const rz = point.z - f.z;

    // u x r is perpendicular to both, and its length is the distance from the filament.
    const cx = uy * rz - uz * ry;
    const cy = uz * rx - ux * rz;
    const cz = ux * ry - uy * rx;
    const perpSq = cx * cx + cy * cy + cz * cz;

    const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const along = r > 1e-12 ? (ux * rx + uy * ry + uz * rz) / r : 0;
    const k = (f.gamma * (1 + along)) / (4 * Math.PI * (perpSq + coreSq));

    vx += cx * k;
    vy += cy * k;
    vz += cz * k;
  }
  return { x: vx, y: vy, z: vz };
}

/**
 * The same evaluation in GLSL, reading the filaments out of a texture one per texel.
 *
 * Deliberately the same arithmetic as the function above, which is what the unit tests
 * exercise. A loop over a few dozen filaments per cell is nothing next to the twenty
 * Jacobi sweeps the pressure solve already does each step, and the result is static for
 * a given aircraft anyway, so it is evaluated once into a texture rather than per frame.
 */
export const WAKE_GLSL = /* glsl */ `
  uniform sampler2D uWake;
  uniform int uWakeCount;
  uniform float uWakeCore;
  uniform vec3 uWakeStream;

  /// Velocity induced at a world point by the whole trailing system.
  vec3 wakeVelocity(vec3 world) {
    if (uWakeCount < 1) return vec3(0.0);
    vec3 u = normalize(uWakeStream);
    float coreSq = uWakeCore * uWakeCore;
    vec3 v = vec3(0.0);
    for (int i = 0; i < uWakeCount; i++) {
      vec4 filament = texelFetch(uWake, ivec2(i, 0), 0);
      vec3 r = world - filament.xyz;
      vec3 c = cross(u, r);
      float rl = length(r);
      float along = rl > 1e-6 ? dot(u, r) / rl : 0.0;
      v += c * (filament.w * (1.0 + along) / (12.566370614 * (dot(c, c) + coreSq)));
    }
    return v;
  }
`;
