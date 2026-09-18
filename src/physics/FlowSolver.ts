import {
  Box3,
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  GLSL3,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { layoutAtlas, type AtlasLayout, type GridSize } from './gpu/atlas';
import {
  ADVECT_SHADER,
  CLEAR_SHADER,
  CONSTRAIN_SHADER,
  DIVERGENCE_SHADER,
  JACOBI_SHADER,
  PROJECT_SHADER,
  SEED_SHADER,
  VERTEX_SHADER,
} from './gpu/passes';
import type { SdfGrid } from './sdf/buildSdf';

/**
 * The flow solver.
 *
 * Incompressible Navier–Stokes on a regular grid: advect the velocity field along
 * itself, then project out whatever divergence that introduced. The grid is flattened
 * into a 2D texture so each pass is a single full-screen draw.
 *
 * Everything is solved non-dimensionally with the free stream at 1. The tunnel's speed
 * setting never reaches the solver — it scales the readouts and, later, how fast
 * particles are carried. Besides being ordinary practice, it fixes the CFL number, so
 * dragging the slider from nothing to Mach 1 cannot destabilise the solve.
 *
 * What this is not: a resolved simulation. A real airliner at cruise sits at Reynolds
 * 5e7 and its boundary layer is a hundred-thousandth of the chord. Nothing here resolves
 * that. What the solver does give is a single velocity field that everything else - the
 * streamlines, the surface pressure, the wake, the force estimates - is read from, so
 * they agree with each other and react to the actual shape of the aircraft.
 */

export interface FlowSolverOptions {
  renderer: WebGLRenderer;
  /** Cells along the streamwise axis. */
  resolution?: number;
  jacobiIterations?: number;
}

export interface SolverStats {
  grid: GridSize;
  cells: number;
  texture: { width: number; height: number };
  jacobiIterations: number;
  steps: number;
}

/** Advection step as a fraction of a cell. Below 1 keeps the trace inside its neighbours. */
const DT_CELLS = 0.8;
/** A touch of damping keeps the coarse grid from accumulating energy indefinitely. */
const DISSIPATION = 0.999;

function makeTarget(width: number, height: number): WebGLRenderTarget {
  const target = new WebGLRenderTarget(width, height, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  return target;
}

export class FlowSolver {
  readonly supported: boolean;
  readonly unsupportedReason: string | null = null;

  private renderer: WebGLRenderer;
  private quad = new FullScreenQuad();
  private layout: AtlasLayout;
  private domainBox = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  private resolution: number;
  private jacobiIterations: number;
  private steps = 0;

  private velocity: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private pressure: [WebGLRenderTarget, WebGLRenderTarget] | null = null;
  private divergence: WebGLRenderTarget | null = null;

  private materials: ShaderMaterial[] = [];
  private advect!: ShaderMaterial;
  private constrain!: ShaderMaterial;
  private divergenceMaterial!: ShaderMaterial;
  private jacobi!: ShaderMaterial;
  private project!: ShaderMaterial;
  private seed!: ShaderMaterial;
  private clear!: ShaderMaterial;

  private sdfTexture: DataTexture | null = null;
  private invModel = new Matrix4();

  constructor(options: FlowSolverOptions) {
    this.renderer = options.renderer;
    this.resolution = options.resolution ?? 128;
    this.jacobiIterations = options.jacobiIterations ?? 20;

    const probe = probeSupport(options.renderer);
    this.supported = probe === null;
    this.unsupportedReason = probe;

    this.layout = layoutAtlas({ x: 8, y: 8, z: 8 });
    this.buildMaterials();
  }

  private buildMaterials(): void {
    const make = (fragmentShader: string): ShaderMaterial => {
      const material = new ShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERTEX_SHADER,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uGrid: { value: new Vector3(8, 8, 8) },
          uTiles: { value: new Vector2(1, 1) },
          uTexSize: { value: new Vector2(1, 1) },
          uVelocity: { value: null },
          uPressure: { value: null },
          uDivergence: { value: null },
          uDt: { value: DT_CELLS },
          uDissipation: { value: DISSIPATION },
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
      this.materials.push(material);
      return material;
    };

    this.advect = make(ADVECT_SHADER);
    this.constrain = make(CONSTRAIN_SHADER);
    this.divergenceMaterial = make(DIVERGENCE_SHADER);
    this.jacobi = make(JACOBI_SHADER);
    this.project = make(PROJECT_SHADER);
    this.seed = make(SEED_SHADER);
    this.clear = make(CLEAR_SHADER);
  }

  private setUniform(name: string, apply: (value: never) => void): void {
    for (const material of this.materials) {
      const uniform = material.uniforms[name];
      if (uniform) apply(uniform.value as never);
    }
  }

  private assign(name: string, value: unknown): void {
    for (const material of this.materials) {
      const uniform = material.uniforms[name];
      if (uniform) uniform.value = value;
    }
  }

  get stats(): SolverStats {
    const { grid } = this.layout;
    return {
      grid,
      cells: grid.x * grid.y * grid.z,
      texture: this.layout.texture,
      jacobiIterations: this.jacobiIterations,
      steps: this.steps,
    };
  }

  get velocityTexture(): Texture | null {
    return this.velocity ? this.velocity[0].texture : null;
  }

  get atlas(): AtlasLayout {
    return this.layout;
  }

  get domain(): Box3 {
    return this.domainBox;
  }

  /**
   * Size the grid to the working section.
   *
   * Cells are kept as close to cubic as the domain allows: a stretched cell makes the
   * pressure solve anisotropic, and the flow would then diffuse faster across the grid
   * than along it for no physical reason.
   */
  configure(domain: Box3, maxTextureSize = 4096): void {
    if (!this.supported) return;
    this.domainBox = domain.clone();
    const size = domain.getSize(new Vector3());
    const cell = size.x / this.resolution;
    const grid: GridSize = {
      x: this.resolution,
      y: Math.max(8, Math.round(size.y / cell)),
      z: Math.max(8, Math.round(size.z / cell)),
    };

    this.layout = layoutAtlas(grid, maxTextureSize);
    this.allocate();

    const { width, height } = this.layout.texture;
    this.setUniform('uGrid', (v: Vector3) => v.set(grid.x, grid.y, grid.z));
    this.setUniform('uTiles', (v: Vector2) => v.set(this.layout.tiles.x, this.layout.tiles.y));
    this.setUniform('uTexSize', (v: Vector2) => v.set(width, height));
    this.setUniform('uDomainMin', (v: Vector3) => v.copy(domain.min));
    this.setUniform('uDomainSize', (v: Vector3) => v.copy(size));
    this.assign('uCellWorld', cell);

    this.reset();
  }

  private allocate(): void {
    const { width, height } = this.layout.texture;
    this.releaseTargets();
    this.velocity = [makeTarget(width, height), makeTarget(width, height)];
    this.pressure = [makeTarget(width, height), makeTarget(width, height)];
    this.divergence = makeTarget(width, height);
  }

  /** Upload a distance field as the obstacle, or clear it. */
  setObstacle(sdf: SdfGrid | null): void {
    this.sdfTexture?.dispose();
    this.sdfTexture = null;

    if (!sdf) {
      this.assign('uHasObstacle', 0);
      return;
    }

    const layout = layoutAtlas(sdf.resolution);
    const { width, height } = layout.texture;
    // Half float: linear filtering of it is core in WebGL2, which a full float texture
    // cannot rely on.
    const data = new Uint16Array(width * height * 4);
    const outside = DataUtils.toHalfFloat(sdf.band);
    for (let i = 0; i < data.length; i += 4) data[i] = outside;

    for (let z = 0; z < sdf.resolution.z; z++) {
      const tileX = z % layout.tiles.x;
      const tileY = Math.floor(z / layout.tiles.x);
      for (let y = 0; y < sdf.resolution.y; y++) {
        const py = tileY * sdf.resolution.y + y;
        for (let x = 0; x < sdf.resolution.x; x++) {
          const px = tileX * sdf.resolution.x + x;
          const source = x + sdf.resolution.x * (y + sdf.resolution.y * z);
          data[(py * width + px) * 4] = DataUtils.toHalfFloat(sdf.data[source]);
        }
      }
    }

    const texture = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
    texture.minFilter = LinearFilter;
    texture.magFilter = LinearFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.sdfTexture = texture;

    this.assign('uSdf', texture);
    this.setUniform('uSdfGrid', (v: Vector3) =>
      v.set(sdf.resolution.x, sdf.resolution.y, sdf.resolution.z),
    );
    this.setUniform('uSdfTiles', (v: Vector2) => v.set(layout.tiles.x, layout.tiles.y));
    this.setUniform('uSdfTexSize', (v: Vector2) => v.set(width, height));
    this.setUniform('uSdfOrigin', (v: Vector3) => v.set(sdf.origin.x, sdf.origin.y, sdf.origin.z));
    this.assign('uSdfCell', sdf.cell);
    this.assign('uSdfBand', sdf.band);
    this.assign('uHasObstacle', 1);
  }

  /**
   * The aircraft's placement. Rotating the model does not rebuild anything: the distance
   * field lives in the aircraft's own frame and this matrix takes query points into it.
   */
  setModelMatrix(matrix: Matrix4): void {
    this.invModel.copy(matrix).invert();
    this.setUniform('uInvModel', (m: Matrix4) => m.copy(this.invModel));
  }

  /** Fill the domain with undisturbed flow. */
  reset(): void {
    if (!this.supported || !this.velocity || !this.pressure || !this.divergence) return;
    this.steps = 0;
    this.run(this.seed, this.velocity[0]);
    this.run(this.seed, this.velocity[1]);
    this.run(this.clear, this.pressure[0]);
    this.run(this.clear, this.pressure[1]);
    this.run(this.clear, this.divergence);
  }

  /** Advance the flow by one step. */
  step(): void {
    if (!this.supported || !this.velocity || !this.pressure || !this.divergence) return;

    // Advect, then re-apply the boundaries the advection has just smeared.
    this.advect.uniforms.uVelocity.value = this.velocity[0].texture;
    this.run(this.advect, this.velocity[1]);
    this.swapVelocity();

    this.constrain.uniforms.uVelocity.value = this.velocity[0].texture;
    this.run(this.constrain, this.velocity[1]);
    this.swapVelocity();

    // Find the divergence the advection introduced, then the pressure that cancels it.
    this.divergenceMaterial.uniforms.uVelocity.value = this.velocity[0].texture;
    this.run(this.divergenceMaterial, this.divergence);

    // Start from the previous step's pressure rather than from zero.
    //
    // Jacobi converges slowly, and the pressure that steers flow around a body is a
    // long-range field: twenty sweeps from a cold start propagate information about
    // twenty cells and damp it heavily. Clearing each step threw that away, and the
    // result was a solver that blocked the flow instead of diverting it - nothing
    // anywhere in the domain ever went faster than the free stream, which cannot happen
    // around a real body. Carrying the field forward lets convergence accumulate across
    // steps, and the pressure is only defined up to a constant anyway, so an offset
    // riding along does no harm.
    this.jacobi.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.jacobiIterations; i++) {
      this.jacobi.uniforms.uPressure.value = this.pressure[0].texture;
      this.run(this.jacobi, this.pressure[1]);
      this.swapPressure();
    }

    this.project.uniforms.uVelocity.value = this.velocity[0].texture;
    this.project.uniforms.uPressure.value = this.pressure[0].texture;
    this.run(this.project, this.velocity[1]);
    this.swapVelocity();

    // The projection can push a little flow into the surface; put it back.
    this.constrain.uniforms.uVelocity.value = this.velocity[0].texture;
    this.run(this.constrain, this.velocity[1]);
    this.swapVelocity();

    this.steps++;
  }

  /** The pressure field, which later stages read to colour the aircraft. */
  get pressureTexture(): Texture | null {
    return this.pressure ? this.pressure[0].texture : null;
  }

  private run(material: ShaderMaterial, target: WebGLRenderTarget): void {
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.quad.material = material;
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(previous);
  }

  private swapVelocity(): void {
    if (!this.velocity) return;
    this.velocity = [this.velocity[1], this.velocity[0]];
  }

  private swapPressure(): void {
    if (!this.pressure) return;
    this.pressure = [this.pressure[1], this.pressure[0]];
  }

  setJacobiIterations(count: number): void {
    this.jacobiIterations = Math.max(1, Math.round(count));
  }

  /**
   * Change the streamwise cell count and rebuild at the new size.
   *
   * Cost scales with the cube of this, so it is the main lever for the quality tiers in
   * a later stage: halving it makes a step roughly eight times cheaper.
   */
  setResolution(cells: number, maxTextureSize = 4096): void {
    this.resolution = Math.max(16, Math.round(cells));
    if (this.supported) this.configure(this.domainBox, maxTextureSize);
  }

  get streamwiseResolution(): number {
    return this.resolution;
  }

  /**
   * Read the velocity field back to the CPU.
   *
   * Slow, and not for per-frame use. It exists so the solver can be checked against
   * things that must be true - the free stream is 1, the flow stagnates at the nose,
   * it accelerates where the aircraft is thickest, it is slower in the wake - rather
   * than being judged by whether the picture looks plausible.
   */
  readVelocity(): { data: Float32Array; grid: GridSize } | null {
    if (!this.supported || !this.velocity) return null;
    const { width, height } = this.layout.texture;
    const raw = new Uint16Array(width * height * 4);
    this.renderer.readRenderTargetPixels(this.velocity[0], 0, 0, width, height, raw);

    const { grid } = this.layout;
    const data = new Float32Array(grid.x * grid.y * grid.z * 3);
    for (let z = 0; z < grid.z; z++) {
      const tileX = z % this.layout.tiles.x;
      const tileY = Math.floor(z / this.layout.tiles.x);
      for (let y = 0; y < grid.y; y++) {
        for (let x = 0; x < grid.x; x++) {
          const px = tileX * grid.x + x;
          const py = tileY * grid.y + y;
          const src = (py * width + px) * 4;
          const dst = (x + grid.x * (y + grid.y * z)) * 3;
          data[dst] = DataUtils.fromHalfFloat(raw[src]);
          data[dst + 1] = DataUtils.fromHalfFloat(raw[src + 1]);
          data[dst + 2] = DataUtils.fromHalfFloat(raw[src + 2]);
        }
      }
    }
    return { data, grid };
  }

  private releaseTargets(): void {
    for (const target of [...(this.velocity ?? []), ...(this.pressure ?? []), this.divergence]) {
      target?.dispose();
    }
    this.velocity = null;
    this.pressure = null;
    this.divergence = null;
  }

  dispose(): void {
    this.releaseTargets();
    this.sdfTexture?.dispose();
    for (const material of this.materials) material.dispose();
    this.quad.dispose();
  }
}

/** Why this machine cannot run the solver, or null if it can. */
export function probeSupport(renderer: WebGLRenderer): string | null {
  const gl = renderer.getContext();
  if (!renderer.capabilities.isWebGL2) return 'WebGL2 is not available';
  if (
    !gl.getExtension('EXT_color_buffer_float') &&
    !gl.getExtension('EXT_color_buffer_half_float')
  ) {
    return 'this GPU cannot render to floating point textures';
  }
  return null;
}
