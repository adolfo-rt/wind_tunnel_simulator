import {
  Box3,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  FloatType,
  Float32BufferAttribute,
  GLSL3,
  Group,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LineSegments,
  Matrix4,
  NearestFilter,
  Points,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type TextureDataType,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { REFERENCE_SPEED } from './gpu/colourRamp';
import { VERTEX_SHADER } from './gpu/passes';
import {
  HEAD_FRAGMENT_SHADER,
  HEAD_VERTEX_SHADER,
  HISTORY_CLEAR_SHADER,
  HISTORY_RECORD_SHADER,
  PARTICLE_INIT_SHADER,
  PARTICLE_UPDATE_SHADER,
  TRAIL_FRAGMENT_SHADER,
  TRAIL_VERTEX_SHADER,
} from './particles/passes';
import {
  cellsPerStep,
  chordCells,
  discSeeds,
  particleTextureSize,
  recordCount,
  startFractions,
  substepCount,
  trailSegmentVertices,
} from './particles/seeding';

/**
 * Streamlines through the solved field.
 *
 * Massless tracers released across the whole inlet disc and carried by the velocity the
 * solver produced — no separate model, no decorative noise. Where a streamline bends, it
 * bends because the pressure field bent the air there; where they crowd together the air
 * really is going faster, because the same volume is passing through a narrower gap.
 * That is the point of doing it this way rather than drawing plausible curves: the
 * picture cannot flatter the aerodynamics, because it is not drawn from anything else.
 *
 * Two honest limitations, both inherited from the solver. The field is coarse, so a
 * streamline follows the shape of the aircraft but not its boundary layer, which at this
 * resolution is thinner than a cell. And the flow is displayed in slow motion — see
 * SLOW_MOTION below.
 */

/** Trail samples per particle. One is recorded per frame. */
const TRAIL_LENGTH = 24;

/**
 * How much slower than real time the streamlines are drawn.
 *
 * At cruise the air crosses this tunnel in about a third of a second, which is not
 * something an eye can follow: the streaks would be a blur with no direction to them.
 * Everything is therefore shown at a twelfth of real speed.
 *
 * What matters is that this is a constant. Doubling the tunnel speed still doubles how
 * fast the particles travel, so the slider means what it says, and the colours are scaled
 * back out to real airspeed before they reach the legend. A speed-dependent factor would
 * have been the same mistake the flow slice made in stage 3, where the display did not
 * answer to the slider at all.
 */
export const SLOW_MOTION = 12;

/** Line opacity at the head of a trail, before the taper and the low-speed fade. */
const TRAIL_OPACITY = 0.5;
/** The dot at the head is brighter, since there is only one of it per streamline. */
const HEAD_OPACITY = 0.85;

/** How far outside the surface a particle is held, as a fraction of a flow cell. */
const MARGIN_CELLS = 0.35;

/** Lifetime as a multiple of the time a free-stream particle takes to cross the tunnel. */
const LIFE_TRANSITS = 2.5;

/** Where along the tunnel particles are released, past the cells the inlet condition holds. */
const INLET_FRACTION = 0.02;

/**
 * A long frame must not teleport a particle across the aircraft. Anything slower than
 * this is treated as this, which makes the flow lag rather than jump.
 */
const MAX_FRAME_SECONDS = 1 / 20;

export const STREAMLINE_COUNTS = {
  low: 1024,
  medium: 4096,
  high: 16384,
} as const;

export type StreamlineDensity = keyof typeof STREAMLINE_COUNTS;

export interface StreamlinesOptions {
  renderer: WebGLRenderer;
  count?: number;
}

function makeTarget(width: number, height: number, type: TextureDataType): WebGLRenderTarget {
  return new WebGLRenderTarget(width, height, {
    type,
    format: RGBAFormat,
    // Every read is a texelFetch, which ignores filtering; nearest says so.
    minFilter: NearestFilter,
    magFilter: NearestFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

export class Streamlines {
  readonly group = new Group();

  private renderer: WebGLRenderer;
  private quad = new FullScreenQuad();
  private type: TextureDataType;

  private count: number;
  private texture = { width: 1, height: 1 };
  private domain = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  private freeStream = 0;
  private maxTextureSize = 4096;

  private particles: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private history: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private seeds: DataTexture | null = null;

  private init: ShaderMaterial;
  private update: ShaderMaterial;
  private record: ShaderMaterial;
  private clear: ShaderMaterial;
  private trailMaterial: ShaderMaterial;
  private headMaterial: ShaderMaterial;

  private trails: LineSegments | null = null;
  private heads: Points | null = null;

  /** Steps taken since the last reseed, so a half-filled trail can be left undrawn. */
  private recorded = 0;

  constructor(options: StreamlinesOptions) {
    this.renderer = options.renderer;
    this.count = options.count ?? STREAMLINE_COUNTS.medium;
    this.type = preferredType(options.renderer);

    const compute = (fragmentShader: string): ShaderMaterial =>
      new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX_SHADER,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uGrid: { value: new Vector3(1, 1, 1) },
          uTiles: { value: new Vector2(1, 1) },
          uTexSize: { value: new Vector2(1, 1) },
          uParticles: { value: null },
          uHistory: { value: null },
          uSeeds: { value: null },
          uVelocity: { value: null },
          uParticleHeight: { value: 1 },
          uAdvance: { value: 0 },
          uDt: { value: 0 },
          uSubsteps: { value: 1 },
          uMaxAge: { value: 10 },
          uMargin: { value: 0 },
          uInvDomain: { value: new Vector3(1, 1, 1) },
          uSdf: { value: null },
          uSdfGrid: { value: new Vector3(1, 1, 1) },
          uSdfTiles: { value: new Vector2(1, 1) },
          uSdfTexSize: { value: new Vector2(1, 1) },
          uSdfOrigin: { value: new Vector3() },
          uSdfCell: { value: 1 },
          uSdfBand: { value: 1 },
          uHasObstacle: { value: 0 },
          uInvModel: { value: new Matrix4() },
          uDomainMin: { value: new Vector3() },
          uDomainSize: { value: new Vector3(1, 1, 1) },
          uCellWorld: { value: 1 },
        },
      });

    this.init = compute(PARTICLE_INIT_SHADER);
    this.update = compute(PARTICLE_UPDATE_SHADER);
    this.record = compute(HISTORY_RECORD_SHADER);
    this.clear = compute(HISTORY_CLEAR_SHADER);

    const drawUniforms = () => ({
      uHistory: { value: null as Texture | null },
      uParticleSize: { value: new Vector2(1, 1) },
      uDomainMin: { value: new Vector3() },
      uDomainSize: { value: new Vector3(1, 1, 1) },
      uTrail: { value: TRAIL_LENGTH },
      // The particles move at a twelfth of real speed, so what they measure has to be
      // scaled back up before it is coloured, or every streamline would read as a stall.
      uSpeedScale: { value: SLOW_MOTION / REFERENCE_SPEED },
      uFade: { value: 0 },
      uOpacity: { value: 1 },
      uPointSize: { value: 2.4 },
    });

    this.trailMaterial = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: TRAIL_VERTEX_SHADER,
      fragmentShader: TRAIL_FRAGMENT_SHADER,
      uniforms: drawUniforms(),
      transparent: true,
      depthWrite: false,
    });

    this.headMaterial = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: HEAD_VERTEX_SHADER,
      fragmentShader: HEAD_FRAGMENT_SHADER,
      uniforms: drawUniforms(),
      transparent: true,
      depthWrite: false,
    });

    /*
     * Ordinary compositing rather than additive.
     *
     * Additive was the obvious choice - bunched streamlines brighten, which is where the
     * air is being squeezed - but it does not survive four thousand of them: the tunnel
     * washes out to white and every feature in the flow goes with it. Compositing keeps
     * a dense region readable as dense instead of saturated.
     */
    this.trailMaterial.uniforms.uOpacity.value = TRAIL_OPACITY;
    this.headMaterial.uniforms.uOpacity.value = HEAD_OPACITY;

    this.group.name = 'streamlines';
    this.group.visible = false;
  }

  /**
   * World size of one flow cell, taken from the solver's own grid rather than remembered.
   *
   * The quality tiers in a later stage will resize that grid underneath us, and a
   * remembered cell size would then be wrong in exactly the way that matters: it is what
   * decides how many integration steps a frame is split into, so a stale value would let
   * particles start cutting corners the moment the resolution changed.
   */
  private get cellWorld(): number {
    const grid = this.update.uniforms.uGrid.value as Vector3;
    const size = this.update.uniforms.uDomainSize.value as Vector3;
    return size.x / Math.max(1, grid.x);
  }

  /** The uniforms the solver should keep in step with its own. */
  get sharedMaterials(): ShaderMaterial[] {
    return [this.update, this.trailMaterial, this.headMaterial];
  }

  get particleCount(): number {
    return this.count;
  }

  /**
   * Size everything to a working section and release the particles into it.
   *
   * The inlet radius is the tunnel's, not the domain's: the domain is the box around the
   * tube, so seeding across it would start a fifth of the particles outside the tunnel
   * wall, where the solver's free-slip boundary would hold them against the corner.
   *
   * The grid is not a parameter. It arrives through the uniforms borrowed from the
   * solver, which is the only way to be sure the two cannot disagree about it.
   */
  configure(
    domain: Box3,
    velocity: Texture | null,
    inletRadius: number,
    maxTextureSize = 4096,
  ): void {
    this.domain = domain.clone();
    this.maxTextureSize = maxTextureSize;
    const size = domain.getSize(new Vector3());

    this.allocate();
    this.seedParticles(inletRadius);

    for (const material of [this.update, this.trailMaterial, this.headMaterial]) {
      const uniforms = material.uniforms;
      if (uniforms.uDomainMin) (uniforms.uDomainMin.value as Vector3).copy(domain.min);
      if (uniforms.uDomainSize) (uniforms.uDomainSize.value as Vector3).copy(size);
    }
    (this.update.uniforms.uInvDomain.value as Vector3).set(1 / size.x, 1 / size.y, 1 / size.z);

    // gl_PointSize is in device pixels, so a retina display would otherwise halve it.
    this.headMaterial.uniforms.uPointSize.value = 2.2 * this.renderer.getPixelRatio();

    this.setVelocity(velocity);
    this.buildDrawables();
    this.reset();
  }

  setVelocity(texture: Texture | null): void {
    this.update.uniforms.uVelocity.value = texture;
  }

  /**
   * The tunnel's free-stream speed in metres per second.
   *
   * This is the whole reason the streamlines answer to the slider. The solved field is
   * the same at every setting, so without this they would drift along at a fixed rate
   * with the fans stopped.
   */
  setFreeStream(metresPerSecond: number): void {
    this.freeStream = Math.max(0, metresPerSecond);
    // Matches the flow slice, so the two fade together rather than one lingering.
    const fade = Math.min(1, this.freeStream / 6);
    this.trailMaterial.uniforms.uFade.value = fade;
    this.headMaterial.uniforms.uFade.value = fade;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  get visible(): boolean {
    return this.group.visible;
  }

  /** Change how many streamlines are drawn, rebuilding at the new count. */
  setCount(count: number, inletRadius: number): void {
    this.count = Math.max(1, Math.round(count));
    this.allocate();
    this.seedParticles(inletRadius);
    this.buildDrawables();
    this.reset();
  }

  private allocate(): void {
    this.releaseTargets();

    // The trail is stored as one block of rows per sample, so a tall stack of particles
    // is what runs into the hardware's texture limit first.
    const slots = Math.max(1, Math.floor(this.maxTextureSize / TRAIL_LENGTH));
    let size = particleTextureSize(this.count);
    while (size.height > slots && this.count > 1) {
      this.count = Math.floor(this.count / 2);
      size = particleTextureSize(this.count);
    }
    this.texture = size;

    this.particles = [
      makeTarget(size.width, size.height, this.type),
      makeTarget(size.width, size.height, this.type),
    ];
    const historyHeight = size.height * TRAIL_LENGTH;
    this.history = [
      makeTarget(size.width, historyHeight, this.type),
      makeTarget(size.width, historyHeight, this.type),
    ];

    this.record.uniforms.uParticleHeight.value = size.height;
    for (const material of [this.trailMaterial, this.headMaterial]) {
      (material.uniforms.uParticleSize.value as Vector2).set(size.width, size.height);
    }
  }

  /**
   * Fixed spawn points, one per particle.
   *
   * Fixed rather than drawn afresh each time so that a particle retraces the same
   * streamline every life. The picture is then a stable set of lines through the flow
   * that you can watch change as the aircraft or the speed changes, instead of a cloud
   * that reshuffles faster than the thing it is meant to show.
   */
  private seedParticles(inletRadius: number): void {
    this.seeds?.dispose();

    const { width, height } = this.texture;
    const total = width * height;
    const size = this.domain.getSize(new Vector3());
    const points = discSeeds(total, inletRadius * 0.97);
    const stagger = startFractions(total);

    const data = new Float32Array(total * 4);
    for (let i = 0; i < total; i++) {
      data[i * 4] = INLET_FRACTION;
      data[i * 4 + 1] = (points[i].y - this.domain.min.y) / size.y;
      data[i * 4 + 2] = (points[i].z - this.domain.min.z) / size.z;
      data[i * 4 + 3] = stagger[i];
    }

    const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
    texture.minFilter = NearestFilter;
    texture.magFilter = NearestFilter;
    texture.needsUpdate = true;
    this.seeds = texture;
    this.init.uniforms.uSeeds.value = texture;
    this.update.uniforms.uSeeds.value = texture;
  }

  /**
   * The geometry that draws the trails.
   *
   * One instance per particle over a fixed run of segments, so changing the count changes
   * an instance count rather than rebuilding a vertex buffer per frame. The `position`
   * attribute is never read by the shader — every vertex looks its position up in the
   * history texture — but three.js counts vertices from it, so it has to be there.
   */
  private buildDrawables(): void {
    this.disposeDrawables();

    const { slot, segment, count: vertices } = trailSegmentVertices(TRAIL_LENGTH);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(vertices * 3), 3));
    geometry.setAttribute('aSlot', new Float32BufferAttribute(slot, 1));
    geometry.setAttribute('aSegment', new Float32BufferAttribute(segment, 1));
    geometry.setAttribute('aIndex', new InstancedBufferAttribute(this.indices(), 1));
    geometry.instanceCount = this.count;

    this.trails = new LineSegments(geometry, this.trailMaterial);
    this.trails.frustumCulled = false;
    // After the flow slice, so the fine detail is not washed out by the plane behind it.
    this.trails.renderOrder = 3;
    this.group.add(this.trails);

    const headGeometry = new BufferGeometry();
    headGeometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(this.count * 3), 3));
    headGeometry.setAttribute('aIndex', new Float32BufferAttribute(this.indices(), 1));

    this.heads = new Points(headGeometry, this.headMaterial);
    this.heads.frustumCulled = false;
    this.heads.renderOrder = 4;
    this.group.add(this.heads);
  }

  private indices(): Float32Array {
    const indices = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) indices[i] = i;
    return indices;
  }

  /** Put every particle back on its seed point and empty the trails. */
  reset(): void {
    if (!this.particles || !this.history) return;
    this.recorded = 0;
    this.run(this.init, this.particles[0]);
    this.run(this.init, this.particles[1]);
    this.run(this.clear, this.history[0]);
    this.run(this.clear, this.history[1]);
    this.pushHistory();
  }

  /**
   * Carry the particles one frame forward.
   *
   * `seconds` is wall-clock time, not simulation time: the solver's own step is fixed,
   * but the particles have to keep pace with the display or the streaks would speed up
   * on a fast machine.
   */
  step(seconds: number): void {
    if (!this.particles || !this.history || !this.group.visible) return;
    if (!this.update.uniforms.uVelocity.value) return;

    const dt = Math.min(Math.max(seconds, 0), MAX_FRAME_SECONDS);
    const shown = this.freeStream / SLOW_MOTION;
    const advance = shown * dt;
    const cellWorld = this.cellWorld;

    const size = this.domain.getSize(new Vector3());
    // A particle that is going nowhere has no transit time; give it a long life rather
    // than an infinite one so the arithmetic stays finite.
    const transit = shown > 1e-3 ? size.x / shown : Infinity;
    const uniforms = this.update.uniforms;
    uniforms.uMaxAge.value = Math.min(120, LIFE_TRANSITS * transit);
    uniforms.uMargin.value = cellWorld * MARGIN_CELLS;

    // A long frame is carried in more than one piece, and each piece leaves its own trail
    // sample, so the drawn line stays on the streamline however slowly the display is
    // running. At a normal frame rate this loop runs once.
    const records = recordCount(advance / cellWorld);
    uniforms.uAdvance.value = advance / records;
    uniforms.uDt.value = dt / records;
    uniforms.uSubsteps.value = substepCount(advance / records / cellWorld);

    for (let i = 0; i < records; i++) {
      uniforms.uParticles.value = this.particles[0].texture;
      this.run(this.update, this.particles[1]);
      this.particles = [this.particles[1], this.particles[0]];
      this.pushHistory();
    }
  }

  private pushHistory(): void {
    if (!this.particles || !this.history) return;
    this.record.uniforms.uParticles.value = this.particles[0].texture;
    this.record.uniforms.uHistory.value = this.history[0].texture;
    this.run(this.record, this.history[1]);
    this.history = [this.history[1], this.history[0]];

    const texture = this.history[0].texture;
    this.trailMaterial.uniforms.uHistory.value = texture;
    this.headMaterial.uniforms.uHistory.value = texture;
    this.recorded = Math.min(this.recorded + 1, TRAIL_LENGTH);
  }

  /**
   * How the longest frame the app will take would be integrated, at the current tunnel
   * speed and grid.
   *
   * The worst case rather than the last frame, because that is the one that decides
   * whether a streamline follows the field or cuts the corner off it — and it is not
   * something a screenshot can be read for. This is the same class of limit that made the
   * fans strobe in stage 2, stated as a number instead of discovered from a picture.
   *
   * Two separate limits: `cellsPerStep` is how far the integration moves a particle
   * between samples of the field, and `chordCells` how far apart the points the trail is
   * drawn through are. The first governs whether the path is right, the second whether
   * the line drawn through it is.
   */
  get stepping(): {
    substeps: number;
    cellsPerStep: number;
    records: number;
    chordCells: number;
    cellWorld: number;
  } {
    const cells = ((this.freeStream / SLOW_MOTION) * MAX_FRAME_SECONDS) / this.cellWorld;
    const records = recordCount(cells);
    return {
      substeps: substepCount(cells / records),
      cellsPerStep: cellsPerStep(cells / records),
      records,
      chordCells: chordCells(cells),
      cellWorld: this.cellWorld,
    };
  }

  /** How much of the trail buffer has been filled since the last reset. */
  get trailFill(): number {
    return this.recorded / TRAIL_LENGTH;
  }

  private run(material: ShaderMaterial, target: WebGLRenderTarget): void {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(previous);
  }

  /** Particle positions in world space, for checks that cannot be made from a picture. */
  readPositions(): Float32Array | null {
    if (!this.particles) return null;
    const { width, height } = this.texture;
    const half = this.type === HalfFloatType;
    const raw = half ? new Uint16Array(width * height * 4) : new Float32Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.particles[0], 0, 0, width, height, raw);
    const at = (i: number) => (half ? DataUtils.fromHalfFloat(raw[i]) : raw[i]);

    const size = this.domain.getSize(new Vector3());
    const out = new Float32Array(this.count * 3);
    for (let i = 0; i < this.count; i++) {
      out[i * 3] = this.domain.min.x + at(i * 4) * size.x;
      out[i * 3 + 1] = this.domain.min.y + at(i * 4 + 1) * size.y;
      out[i * 3 + 2] = this.domain.min.z + at(i * 4 + 2) * size.z;
    }
    return out;
  }

  private releaseTargets(): void {
    for (const target of [...(this.particles ?? []), ...(this.history ?? [])]) target.dispose();
    this.particles = null;
    this.history = null;
  }

  private disposeDrawables(): void {
    for (const object of [this.trails, this.heads]) {
      if (!object) continue;
      this.group.remove(object);
      object.geometry.dispose();
    }
    this.trails = null;
    this.heads = null;
  }

  dispose(): void {
    this.releaseTargets();
    this.disposeDrawables();
    this.seeds?.dispose();
    for (const material of [
      this.init,
      this.update,
      this.record,
      this.clear,
      this.trailMaterial,
      this.headMaterial,
    ]) {
      material.dispose();
    }
    this.quad.dispose();
  }
}

/**
 * Full float for the particle state where the GPU will render to it, half otherwise.
 *
 * Position is accumulated, not recomputed, so its rounding error accumulates too. Half
 * float carries about three decimal digits, which over a few hundred steps is a visible
 * wander off the streamline; positions are stored as a fraction of the domain partly to
 * keep the magnitudes near 1 where that fallback is least bad.
 */
function preferredType(renderer: WebGLRenderer): TextureDataType {
  return renderer.getContext().getExtension('EXT_color_buffer_float')
    ? FloatType
    : HalfFloatType;
}
