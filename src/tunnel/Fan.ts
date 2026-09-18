import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
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
  const bladeCount = options.bladeCount ?? DEFAULT_BLADES;
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
function buildStators(options: FanOptions, count = STATOR_VANES): BufferGeometry {
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

/**
 * Angular copies used to smear the rotor across the angle it sweeps during a frame.
 *
 * This is motion blur done the only way that works here. A rotor with N blades is
 * periodic every 2*pi/N, so at 60 fps its apparent rotation cannot exceed half that per
 * frame: with eleven blades the fan visually tops out near 164 rpm, and above that it
 * strobes, appears to stop, or runs backwards, regardless of the true shaft speed.
 *
 * Screen-space velocity blur cannot rescue that. At cruise the rotor turns about 110
 * degrees between frames, so a blade's displacement is comparable to the fan's own
 * radius and follows an arc, not a line; a linear streak kernel of a dozen taps
 * represents neither. Sampling the geometry itself at several angles within the frame
 * does, because that is what motion blur physically is - an exposure integrating over
 * time rather than a filter applied afterwards.
 */
const MAX_BLUR_COPIES = 12;

/**
 * Seven blades, turning slowly.
 *
 * Both numbers are chosen against the sampling limit. A rotor is periodic every
 * 2*pi/blades, so fewer blades means a coarser pattern and a higher speed before it
 * strobes; and a large tunnel fan genuinely does turn slowly, a few hundred rpm rather
 * than a few thousand. Together they put the point where the smear stops widening at
 * about 1,600 km/h, beyond the top of the slider, so the fan goes on visibly gaining
 * speed across the whole usable range instead of saturating a third of the way up.
 */
const DEFAULT_BLADES = 7;
/**
 * Stator vanes, kept coprime with the blade count. Rotor and stator numbers sharing a
 * factor make their wakes line up once per revolution and beat, which is why real
 * machines avoid it.
 */
const STATOR_VANES = 13;
/** Shaft speed per unit of free-stream speed, rad/s per m/s. */
const SHAFT_GAIN = 0.18;
/** Samples per blade spacing needed before the smear reads as continuous. */
const SAMPLES_PER_SPACING = 6;

/**
 * How wide to smear the rotor, given how far it turns in one frame.
 *
 * Below about a third of a blade spacing per frame the rotation is unambiguous and the
 * blades can stay crisp. Approaching half a spacing - the Nyquist limit for an
 * eleven-fold pattern - the image starts to strobe, so the smear is opened out to a full
 * spacing, which puts a blade at every angle and leaves nothing to alias. The widening
 * is ramped rather than switched so dragging the slider through that speed does not
 * snap from sharp blades to a disc.
 */
export function blurArcFor(sweptAngle: number, spacing: number): number {
  const spacings = sweptAngle / spacing;
  const ramp = Math.min(1, Math.max(0, (spacings - 0.3) / 0.15));
  const target = spacing * (0.3 + 0.7 * ramp);
  return Math.max(sweptAngle, spacings < 0.3 ? 0 : target);
}

export class Fan {
  readonly group = new Group();
  private rotor: InstancedMesh;
  private bladeMaterial: MeshStandardMaterial;
  private bladeCount: number;
  private materials: MeshStandardMaterial[] = [];
  private geometries: BufferGeometry[] = [];
  /** Current shaft speed in radians per second. */
  private angularVelocity = 0;
  private targetAngularVelocity = 0;
  private direction: number;
  /** Shaft angle, accumulated. */
  private angle = 0;
  private matrix = new Matrix4();

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

    this.bladeMaterial = bladeMaterial;
    this.bladeCount = options.bladeCount ?? DEFAULT_BLADES;
    const rotorGeometry = buildRotor(options);
    this.rotor = new InstancedMesh(rotorGeometry, bladeMaterial, MAX_BLUR_COPIES);
    this.rotor.count = 1;
    this.rotor.frustumCulled = false;
    // Blended copies have to draw over the hub behind them rather than fight it for
    // depth, so the rotor goes in after the opaque parts of the tunnel.
    this.rotor.renderOrder = 1;
    this.group.add(this.rotor);
    this.writeBlur(0);

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
    this.targetAngularVelocity = metresPerSecond * SHAFT_GAIN;
  }

  update(deltaSeconds: number): void {
    // Spool towards the target with a time constant of about a second.
    const rate = 1 - Math.exp(-deltaSeconds / 0.9);
    this.angularVelocity += (this.targetAngularVelocity - this.angularVelocity) * rate;
    this.angle += this.direction * this.angularVelocity * deltaSeconds;
    this.writeBlur(Math.abs(this.angularVelocity) * deltaSeconds);
  }

  /**
   * Lay the rotor's copies across the arc it sweeps during this frame.
   *
   * The arc is capped at a little over one blade spacing. Once the smear covers a whole
   * spacing every blade position is occupied, so the image is rotationally uniform:
   * consecutive frames look identical and there is nothing left to alias. Past that
   * point extra arc changes nothing, which is also true of a real fan - beyond a certain
   * speed it is simply a blurred disc and the eye cannot read it either. The rpm figure
   * on the panel is what stays honest at the top of the range.
   */
  private writeBlur(sweptAngle: number): void {
    const spacing = (Math.PI * 2) / this.bladeCount;
    const arc = Math.min(blurArcFor(sweptAngle, spacing), spacing * 1.5);
    const copies = Math.max(
      1,
      Math.min(MAX_BLUR_COPIES, Math.ceil(arc / (spacing / SAMPLES_PER_SPACING))),
    );

    for (let i = 0; i < copies; i++) {
      // Trail the copies behind the current angle, the way an exposure would.
      const offset = copies === 1 ? 0 : -this.direction * arc * (i / (copies - 1));
      this.matrix.makeRotationX(this.angle + offset);
      this.rotor.setMatrixAt(i, this.matrix);
    }
    this.rotor.count = copies;
    this.rotor.instanceMatrix.needsUpdate = true;

    // How solid the disc looks is driven by the TRUE sweep, not by the arc the copies
    // were placed over. The two are different concerns and were previously conflated:
    // the number of copies exists to cover the arc without gaps, while opacity is the
    // speed cue. Tying opacity to the copy count left a dead band between roughly 500
    // and 900 km/h where the anti-strobe floor pinned the arc and nothing changed on
    // screen however far the slider moved.
    //
    // Physically this is dwell time: the faster a blade sweeps, the smaller the
    // fraction of the exposure it spends at any given angle, so the disc thins out.
    const trueSamples = sweptAngle / (spacing / SAMPLES_PER_SPACING);
    this.bladeMaterial.opacity =
      copies === 1 ? 1 : Math.max(0.06, 1 / (1 + trueSamples));
    this.bladeMaterial.transparent = copies > 1;
    this.bladeMaterial.depthWrite = copies === 1;
  }

  /** Shaft angle in radians, for tests and debugging. */
  get shaftAngle(): number {
    return this.angle;
  }

  /** Number of angular copies currently drawn. One means the blades are sharp. */
  get blurCopies(): number {
    return this.rotor.count;
  }

  /** The angles at which blades are actually drawn this frame. */
  get renderedAngles(): number[] {
    const out: number[] = [];
    const m = new Matrix4();
    for (let i = 0; i < this.rotor.count; i++) {
      this.rotor.getMatrixAt(i, m);
      // A rotation about x: recover the angle from the y/z block.
      out.push(Math.atan2(m.elements[6], m.elements[5]));
    }
    return out;
  }

  /** How far the rotor is smeared this frame, in radians. Zero when it is stopped. */
  get blurArc(): number {
    const spacing = (Math.PI * 2) / this.bladeCount;
    return Math.min(blurArcFor(Math.abs(this.angularVelocity) / 60, spacing), spacing * 1.5);
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
