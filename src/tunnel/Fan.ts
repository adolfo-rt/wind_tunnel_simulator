import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { loftRings, type Ring } from '../aircraft/build/loft';

/**
 * A wind tunnel fan assembly.
 *
 * Each end of the tunnel carries one: the upstream fan drives air into the working
 * section, the downstream fan draws it out. Real closed-circuit tunnels place the drive
 * fan downstream for exactly that reason, so the working section sees smoothly drawn
 * air rather than the fan's own swirl.
 *
 * Only the rotor turns. The hub, the shroud and the stator vanes behind the rotor are
 * fixed: the stators are there to straighten the swirl the rotor puts into the flow,
 * which is what a real tunnel does and what makes the airflow in the working section
 * worth simulating.
 */

export interface FanOptions {
  /** Outer radius of the shroud. */
  radius: number;
  /** Position of the fan plane along the tunnel axis. */
  x: number;
  bladeCount?: number;
  /** Reverse the blade twist, so an outlet fan pulls rather than pushes. */
  reversed?: boolean;
}

function circleRing(x: number, radius: number, segments: number): Vector3[] {
  const points: Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(new Vector3(x, Math.sin(theta) * radius, Math.cos(theta) * radius));
  }
  return points;
}

/**
 * The spinning rotor: a hub plus twisted blades.
 *
 * Each blade is swept between a leading and a trailing edge separated by an angle about
 * the shaft. The angular half-width is the blade's chord divided by the local radius,
 * capped so neighbouring blades cannot overlap — which is also what real blades look
 * like, since a constant chord would need an impossible arc near the hub and so the root
 * narrows instead.
 *
 * Blades are twisted: steep near the hub where the local blade speed is low, shallow at
 * the tip where it is high, so the angle the blade meets the air stays roughly constant
 * along its length. Turning that twist into geometry is just an axial offset, because
 * moving along the chord tangentially by an arc also moves you downstream by that arc
 * times the tangent of the pitch angle.
 */
export function buildRotor(options: FanOptions): BufferGeometry {
  const bladeCount = options.bladeCount ?? 11;
  const tipRadius = options.radius * 0.95;
  // A generous hub, as on a real tunnel fan. Too small a hub forces the root arc to be
  // capped hard, which pinches the blade where it should be widest.
  const hubRadius = options.radius * 0.28;
  const rootChord = options.radius * 0.26;
  const direction = options.reversed ? -1 : 1;
  const spanSteps = 6;
  // Leave a gap between neighbours rather than letting the root arcs collide.
  const maxHalfAngle = (Math.PI / bladeCount) * 0.85;

  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];

  for (let b = 0; b < bladeCount; b++) {
    const phase = (b / bladeCount) * Math.PI * 2;
    const base = positions.length / 3;
    for (let s = 0; s <= spanSteps; s++) {
      const t = s / spanSteps;
      const radius = hubRadius + (tipRadius - hubRadius) * t;
      const chord = rootChord * (1 - 0.35 * t);
      const halfAngle = Math.min(chord / (2 * radius), maxHalfAngle);
      // Pitch measured from the disc plane: steep at the root, shallow at the tip.
      const pitch = (45 - 27 * t) * (Math.PI / 180);
      const axial = halfAngle * radius * Math.tan(pitch);
      for (const side of [-1, 1]) {
        const theta = phase + side * halfAngle * direction;
        positions.push(
          options.x - side * axial * direction,
          Math.sin(theta) * radius,
          Math.cos(theta) * radius,
        );
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

/** The fixed spinner and hub the rotor turns on. */
function buildHub(options: FanOptions): BufferGeometry {
  const radius = options.radius * 0.28;
  const length = options.radius * 0.6;
  const direction = options.reversed ? -1 : 1;
  const rings: Ring[] = [];
  const stations = 8;
  for (let i = 0; i <= stations; i++) {
    const t = i / stations;
    const x = options.x - direction * length * (0.45 - t);
    rings.push({ points: circleRing(x, Math.max(radius * 0.06, radius * Math.sin(t * Math.PI)), 20), v: t });
  }
  return loftRings(rings, { closed: true, capStart: true, capEnd: true });
}

/** Fixed stator vanes downstream of the rotor, which take the swirl out of the flow. */
function buildStators(options: FanOptions, count = 11): BufferGeometry {
  const tipRadius = options.radius * 0.93;
  const hubRadius = options.radius * 0.28;
  const direction = options.reversed ? -1 : 1;
  const x = options.x + direction * options.radius * 0.42;

  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const chord = options.radius * 0.26;

  for (let v = 0; v < count; v++) {
    const theta = (v / count) * Math.PI * 2;
    const base = positions.length / 3;
    for (let s = 0; s <= 1; s++) {
      const radius = hubRadius + (tipRadius - hubRadius) * s;
      for (const side of [-1, 1]) {
        positions.push(
          x + side * chord * 0.5,
          Math.sin(theta) * radius,
          Math.cos(theta) * radius,
        );
        uvs.push(side * 0.5 + 0.5, s);
      }
    }
    indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export class Fan {
  readonly group = new Group();
  private rotor: Mesh;
  private materials: MeshStandardMaterial[] = [];
  private geometries: BufferGeometry[] = [];
  /** Current shaft speed in radians per second. */
  private angularVelocity = 0;
  private targetAngularVelocity = 0;
  private direction: number;

  constructor(options: FanOptions) {
    this.direction = options.reversed ? -1 : 1;

    // Darker than the airframe on purpose: the aeroplane is the subject, and a bright
    // rotor filling each end of the tube pulls the eye away from it.
    const bladeMaterial = new MeshStandardMaterial({
      color: 0x6f7883,
      roughness: 0.4,
      metalness: 0.8,
      side: DoubleSide,
    });
    const frameMaterial = new MeshStandardMaterial({
      color: 0x3d444d,
      roughness: 0.55,
      metalness: 0.6,
    });
    const statorMaterial = new MeshStandardMaterial({
      color: 0x525a64,
      roughness: 0.6,
      metalness: 0.4,
      side: DoubleSide,
    });
    this.materials.push(bladeMaterial, frameMaterial, statorMaterial);

    const rotorGeometry = buildRotor(options);
    this.rotor = new Mesh(rotorGeometry, bladeMaterial);
    this.group.add(this.rotor);

    const hubGeometry = buildHub(options);
    this.group.add(new Mesh(hubGeometry, frameMaterial));

    const statorGeometry = buildStators(options);
    this.group.add(new Mesh(statorGeometry, statorMaterial));

    // Shroud ring around the fan.
    const shroud = new TorusGeometry(options.radius * 0.99, options.radius * 0.035, 8, 48);
    const shroudMesh = new Mesh(shroud, frameMaterial);
    shroudMesh.rotation.y = Math.PI / 2;
    shroudMesh.position.x = options.x;
    this.group.add(shroudMesh);

    this.geometries.push(rotorGeometry, hubGeometry, statorGeometry, shroud);
  }

  /**
   * Set the shaft speed from the tunnel's free-stream speed.
   *
   * The mapping is a visual one, not a fan law: the point is that the rotor visibly
   * tracks the slider. It is eased rather than applied instantly so the fan spools up
   * and down like a machine with rotating mass rather than snapping between speeds.
   */
  setSpeed(metresPerSecond: number): void {
    this.targetAngularVelocity = metresPerSecond * 0.46;
  }

  update(deltaSeconds: number): void {
    // Spool towards the target with a time constant of about a second.
    const rate = 1 - Math.exp(-deltaSeconds / 0.9);
    this.angularVelocity += (this.targetAngularVelocity - this.angularVelocity) * rate;
    this.rotor.rotation.x += this.direction * this.angularVelocity * deltaSeconds;
  }

  /** Current shaft speed in revolutions per minute, for the readout. */
  get rpm(): number {
    return (Math.abs(this.angularVelocity) * 60) / (Math.PI * 2);
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
