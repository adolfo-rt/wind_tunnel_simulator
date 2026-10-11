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
  /**
   * Where this filament has merged into the rolled-up vortex.
   *
   * A trailing sheet does not stay a sheet. Every element of it is in the others' induced
   * field, the edge curls over fastest, and within a span or so the whole sheet has wound
   * itself into one concentrated vortex per side - Betz, 1932, and the reason photographs
   * of wakes show two ropes rather than a ribbon. The circulation of each rope is the
   * total shed on its side, and it sits at the centroid of that side's shed vorticity.
   *
   * So the filament runs straight from where it left the wing to this point, and
   * semi-infinitely downstream from there. All the filaments on one side share the point,
   * which is what makes them add up into a single vortex beyond it. Set it equal to the
   * departure point and the filament is straight, which is the classical rigid wake.
   *
   * This matters for more than appearance. Spread over the span, the trailing vorticity
   * is weaker than the solver's own numerical noise - measured at 0.03 against a wake
   * noise floor of 0.05 to 0.15 - so the tip vortex is in the field but not visible in
   * it. Rolled up, the same circulation is concentrated into one core and stands clear.
   * Munk's stagger theorem says the induced drag is indifferent to all of this, so the
   * forces do not move: only where the vorticity is.
   */
  roll: Vec3;
}

/**
 * Velocity induced at `point` by the trailing system.
 *
 * Each filament is two pieces of one continuous vortex line: a straight leg from where
 * it left the wing to where it has rolled up, and a semi-infinite leg running downstream
 * from there. Continuous, so the field is still exactly divergence-free, and the
 * circulation still cannot end in the fluid.
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
  const u = { x: streamDir.x / speed, y: streamDir.y / speed, z: streamDir.z / speed };
  const coreSq = core * core;

  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (const f of filaments) {
    // The leg that converges on the roll-up point, as an ordinary straight segment.
    const ax = f.x;
    const ay = f.y;
    const az = f.z;
    const bx = f.roll.x;
    const by = f.roll.y;
    const bz = f.roll.z;
    const r0x = bx - ax;
    const r0y = by - ay;
    const r0z = bz - az;
    const legSq = r0x * r0x + r0y * r0y + r0z * r0z;
    if (legSq > 1e-18) {
      const r1x = point.x - ax;
      const r1y = point.y - ay;
      const r1z = point.z - az;
      const r2x = point.x - bx;
      const r2y = point.y - by;
      const r2z = point.z - bz;
      const cx = r1y * r2z - r1z * r2y;
      const cy = r1z * r2x - r1x * r2z;
      const cz = r1x * r2y - r1y * r2x;
      const l1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
      const l2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
      if (l1 > 1e-12 && l2 > 1e-12) {
        // |r1 x r2| is the segment length times the perpendicular distance, so the core
        // enters the denominator scaled by the segment length - the same regularisation
        // as the semi-infinite leg below, written for a segment.
        const ends =
          (r0x * r1x + r0y * r1y + r0z * r1z) / l1 - (r0x * r2x + r0y * r2y + r0z * r2z) / l2;
        const k =
          (f.gamma * ends) / (4 * Math.PI * (cx * cx + cy * cy + cz * cz + legSq * coreSq));
        vx += cx * k;
        vy += cy * k;
        vz += cz * k;
      }
    }

    // The semi-infinite leg, running downstream from the roll-up point.
    const rx = point.x - bx;
    const ry = point.y - by;
    const rz = point.z - bz;
    const sx = u.y * rz - u.z * ry;
    const sy = u.z * rx - u.x * rz;
    const sz = u.x * ry - u.y * rx;
    const r = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const along = r > 1e-12 ? (u.x * rx + u.y * ry + u.z * rz) / r : 0;
    const k = (f.gamma * (1 + along)) / (4 * Math.PI * (sx * sx + sy * sy + sz * sz + coreSq));
    vx += sx * k;
    vy += sy * k;
    vz += sz * k;
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
  /// Departure point and circulation in row 0, roll-up point in row 1.
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
      vec4 shed = texelFetch(uWake, ivec2(i, 0), 0);
      vec3 roll = texelFetch(uWake, ivec2(i, 1), 0).xyz;

      vec3 leg = roll - shed.xyz;
      float legSq = dot(leg, leg);
      if (legSq > 1e-18) {
        vec3 r1 = world - shed.xyz;
        vec3 r2 = world - roll;
        vec3 c = cross(r1, r2);
        float l1 = length(r1);
        float l2 = length(r2);
        if (l1 > 1e-6 && l2 > 1e-6) {
          float ends = dot(leg, r1) / l1 - dot(leg, r2) / l2;
          v += c * (shed.w * ends / (12.566370614 * (dot(c, c) + legSq * coreSq)));
        }
      }

      vec3 r = world - roll;
      vec3 s = cross(u, r);
      float rl = length(r);
      float along = rl > 1e-6 ? dot(u, r) / rl : 0.0;
      v += s * (shed.w * (1.0 + along) / (12.566370614 * (dot(s, s) + coreSq)));
    }
    return v;
  }
`;
