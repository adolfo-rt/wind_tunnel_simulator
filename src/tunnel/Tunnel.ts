import {
  AdditiveBlending,
  BackSide,
  Box3,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  RingGeometry,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { Fan } from './Fan';

/**
 * The wind tunnel: a transparent working section with a fan at each end.
 *
 * The hard requirement is that the tunnel never hides the aeroplane, since the whole
 * point of later stages is watching air move around it. A plain translucent cylinder
 * fails at that from the inside — the near wall washes over everything. So the shell is
 * drawn with a Fresnel term: nearly clear where you look straight through it, brightest
 * at the silhouette where the surface turns away. That reads as glass, defines the tube's
 * shape, and costs almost nothing.
 *
 * The rest of the structure — hoops, stringers, the honeycomb straightener — is there so
 * the eye has something solid to judge the tube by, and because a real tunnel's
 * straightener is what makes the flow in the working section worth simulating at all.
 */

/** Cross-stream clearance between the aircraft and the tunnel wall. */
const WALL_CLEARANCE = 1.3;
/** Working section length as a multiple of the aircraft's length. */
const LENGTH_FACTOR = 2.3;
/** ...but never shorter than this multiple of the span, for very wide aircraft. */
const MIN_LENGTH_SPAN_FACTOR = 1.5;
/**
 * ...and never longer than this multiple of the tunnel's own diameter.
 *
 * Length follows the aircraft's length while radius follows its span, so a long slender
 * type like Concorde would otherwise get a tube four times longer than it is wide, and
 * the aeroplane would sit lost in the middle of it.
 */
const MAX_LENGTH_DIAMETER_FACTOR = 3.2;

export interface TunnelDimensions {
  radius: number;
  length: number;
}

const shellVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vToCamera = normalize(cameraPosition - worldPosition.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const shellFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBase;
  uniform float uRim;
  varying vec3 vNormal;
  varying vec3 vToCamera;
  void main() {
    // Grazing angles are opaque, head-on is nearly clear. abs() so the effect works
    // from inside the tube as well as outside.
    float facing = abs(dot(normalize(vNormal), normalize(vToCamera)));
    float fresnel = pow(1.0 - facing, 3.0);
    gl_FragColor = vec4(uColor, uBase + fresnel * uRim);
  }
`;

/** A hexagonal mesh, drawn once and used as the straightener's alpha pattern. */
function honeycombTexture(): Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;

  const r = size / 8;
  const h = r * Math.sqrt(3);
  for (let row = -1; row < 10; row++) {
    for (let col = -1; col < 10; col++) {
      const cx = col * r * 1.5;
      const cy = row * h + (col % 2 === 0 ? 0 : h / 2);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(6, 6);
  return texture;
}

export class WindTunnel {
  readonly group = new Group();
  private fans: Fan[] = [];
  private geometries: BufferGeometry[] = [];
  private materials: Material[] = [];
  private honeycomb: Texture | null = null;
  private dimensions: TunnelDimensions = { radius: 10, length: 40 };

  constructor() {
    this.group.name = 'wind-tunnel';
    this.honeycomb = honeycombTexture();
  }

  get size(): TunnelDimensions {
    return this.dimensions;
  }

  /**
   * Size the tunnel around an aircraft and rebuild it.
   *
   * The roster runs from a 28 m Comet to an 80 m-span A380, so the tunnel is derived
   * from the aircraft rather than fixed: wide enough to clear the span with margin,
   * long enough to leave room upstream and downstream for a wake to develop.
   */
  fitTo(bounds: Box3): void {
    const size = bounds.getSize(new Vector3());
    const crossExtent = Math.max(size.z, size.y) / 2;
    const radius = crossExtent * WALL_CLEARANCE;
    const length = Math.min(
      Math.max(size.x * LENGTH_FACTOR, size.z * MIN_LENGTH_SPAN_FACTOR),
      radius * 2 * MAX_LENGTH_DIAMETER_FACTOR,
    );
    this.dimensions = { radius, length };
    this.rebuild();
  }

  private clear(): void {
    for (const fan of this.fans) fan.dispose();
    this.fans = [];
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries = [];
    for (const material of this.materials) material.dispose();
    this.materials = [];
    this.group.clear();
  }

  private track<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private trackMaterial<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  private rebuild(): void {
    this.clear();
    const { radius, length } = this.dimensions;
    const half = length / 2;

    // The glass working section. Drawn without writing depth and after the aircraft,
    // so nothing inside is ever occluded by it.
    const shellGeometry = this.track(new CylinderGeometry(radius, radius, length, 64, 1, true));
    shellGeometry.rotateZ(Math.PI / 2);
    const shellMaterial = this.trackMaterial(
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Vector3(0.62, 0.79, 1.0) },
          uBase: { value: 0.035 },
          uRim: { value: 0.5 },
        },
        vertexShader: shellVertex,
        fragmentShader: shellFragment,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    );
    const shell = new Mesh(shellGeometry, shellMaterial);
    shell.renderOrder = 3;
    this.group.add(shell);

    // Structural hoops, which give the eye something solid to read the tube by.
    const hoopMaterial = this.trackMaterial(
      new MeshStandardMaterial({ color: 0x5b6773, roughness: 0.45, metalness: 0.75 }),
    );
    const hoopCount = 9;
    const hoopGeometry = this.track(new TorusGeometry(radius, radius * 0.012, 6, 64));
    for (let i = 0; i <= hoopCount; i++) {
      const hoop = new Mesh(hoopGeometry, hoopMaterial);
      hoop.rotation.y = Math.PI / 2;
      hoop.position.x = -half + (length * i) / hoopCount;
      this.group.add(hoop);
    }

    // Longitudinal stringers along the wall.
    const stringerGeometry = this.track(
      new CylinderGeometry(radius * 0.008, radius * 0.008, length, 6, 1),
    );
    stringerGeometry.rotateZ(Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const theta = (i / 8) * Math.PI * 2;
      const stringer = new Mesh(stringerGeometry, hoopMaterial);
      stringer.position.set(0, Math.sin(theta) * radius, Math.cos(theta) * radius);
      this.group.add(stringer);
    }

    // Honeycomb flow straightener just downstream of the inlet fan. In a real tunnel
    // this is what removes the swirl the fan puts in, so the working section sees
    // something close to uniform flow.
    if (this.honeycomb) {
      const straightenerGeometry = this.track(new RingGeometry(radius * 0.1, radius * 0.985, 48, 1));
      const straightenerMaterial = this.trackMaterial(
        new MeshStandardMaterial({
          color: 0x93a2b3,
          alphaMap: this.honeycomb,
          transparent: true,
          opacity: 0.55,
          side: DoubleSide,
          depthWrite: false,
          roughness: 0.7,
          metalness: 0.3,
        }),
      );
      const straightener = new Mesh(straightenerGeometry, straightenerMaterial);
      straightener.rotation.y = Math.PI / 2;
      straightener.position.x = -half + length * 0.1;
      straightener.renderOrder = 2;
      this.group.add(straightener);
    }

    // End collars, so the tube reads as having a mouth rather than just stopping.
    const collarMaterial = this.trackMaterial(
      new MeshStandardMaterial({
        color: 0x39424d,
        roughness: 0.55,
        metalness: 0.6,
        side: BackSide,
      }),
    );
    const collarGeometry = this.track(
      new CylinderGeometry(radius * 1.04, radius * 1.04, length * 0.045, 48, 1, true),
    );
    collarGeometry.rotateZ(Math.PI / 2);
    for (const x of [-half + length * 0.022, half - length * 0.022]) {
      const collar = new Mesh(collarGeometry, collarMaterial);
      collar.position.x = x;
      this.group.add(collar);
    }

    // A fan at each end: the upstream one drives air in, the downstream one draws it
    // out. Real closed-circuit tunnels put the drive fan downstream for that reason,
    // so the working section sees smoothly drawn air rather than the fan's own swirl.
    const inlet = new Fan({ radius: radius * 0.96, x: -half + length * 0.035 });
    const outlet = new Fan({ radius: radius * 0.96, x: half - length * 0.035, reversed: true });
    this.fans = [inlet, outlet];
    this.group.add(inlet.group, outlet.group);
  }

  /** Free-stream speed in metres per second. */
  setSpeed(metresPerSecond: number): void {
    for (const fan of this.fans) fan.setSpeed(metresPerSecond);
  }

  update(deltaSeconds: number): void {
    for (const fan of this.fans) fan.update(deltaSeconds);
  }

  /** Shaft speed of the fans in rpm, for the readout. */
  get rpm(): number {
    return this.fans.length ? this.fans[0].rpm : 0;
  }

  dispose(): void {
    this.clear();
    this.honeycomb?.dispose();
    this.honeycomb = null;
  }
}
