import {
  Vector2,
  Vector3,
  type IUniform,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import { ATLAS_GLSL } from './gpu/atlas';
import { PRESSURE_COLOUR_GLSL } from './gpu/colourRamp';
import { CP_SAMPLE_CELLS, SURFACE_CP_GLSL } from './surface/cp';

/**
 * The aircraft's skin, coloured by pressure coefficient.
 *
 * This does not replace the aircraft's materials; it patches them, so the shading, the
 * shadows and the shape all survive and only the albedo changes. The alternative — an
 * unlit mesh coloured straight from Cp — reads as a flat cutout, and the whole point is
 * to see where on a three-dimensional shape the pressure is.
 *
 * The field it reads is the solver's own velocity texture, through the solver's own
 * uniforms, so the colours on the aeroplane and the streamlines passing it cannot
 * disagree about what the air is doing. See `surface/cp.ts` for why Cp is taken from
 * velocity rather than from the solver's pressure field, and for why it does not change
 * with the tunnel speed.
 */

const VERTEX_DECLARATIONS = /* glsl */ `
  varying vec3 vCpWorld;
  varying vec3 vCpNormal;
`;

/*
 * `transformed` and `objectNormal` are three.js's own locals, set up by the chunks that
 * run before this point. The world normal uses the model matrix rather than the normal
 * matrix because the sample has to be offset in world space, and the aircraft carries no
 * scale, only a translation.
 */
const VERTEX_BODY = /* glsl */ `
  vCpWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vCpNormal = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
  varying vec3 vCpWorld;
  varying vec3 vCpNormal;
  uniform float uCpAmount;
`;

const FRAGMENT_BODY = /* glsl */ `
  if (uCpAmount > 0.001) {
    diffuseColor.rgb = mix(
      diffuseColor.rgb,
      pressureColour(surfaceCp(vCpWorld, vCpNormal)),
      uCpAmount
    );
  }
`;

export class SurfacePressure {
  /**
   * Shared with every patched material, and with the solver.
   *
   * The grid, domain and atlas entries are replaced wholesale by
   * `FlowSolver.shareUniforms`, so a new aircraft or a resized grid reaches the skin with
   * nothing having to forward it.
   */
  readonly uniforms: Record<string, IUniform> = {
    uGrid: { value: new Vector3(1, 1, 1) },
    uTiles: { value: new Vector2(1, 1) },
    uTexSize: { value: new Vector2(1, 1) },
    uVelocity: { value: null },
    uDomainMin: { value: new Vector3() },
    uDomainSize: { value: new Vector3(1, 1, 1) },
    uCpOffset: { value: 1 },
    uCpAmount: { value: 0 },
  };

  private patched = new Set<MeshStandardMaterial>();
  private enabled = false;

  /**
   * Take over an aircraft's surfaces.
   *
   * Patching has to happen before the material is first rendered, or three.js will have
   * cached a program compiled without it. A custom cache key keeps the patched and
   * unpatched programs apart: without one, two materials that differ only in having been
   * patched hash to the same key and whichever compiled first is used for both.
   */
  attach(materials: MeshStandardMaterial[]): void {
    this.patched.clear();
    for (const material of materials) {
      material.customProgramCacheKey = () => 'surface-pressure';
      material.onBeforeCompile = (shader) => {
        for (const [name, uniform] of Object.entries(this.uniforms)) {
          shader.uniforms[name] = uniform;
        }

        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\n${VERTEX_DECLARATIONS}`)
          .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${VERTEX_BODY}`);

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            '#include <common>\n' +
              FRAGMENT_DECLARATIONS +
              ATLAS_GLSL +
              SURFACE_CP_GLSL +
              PRESSURE_COLOUR_GLSL,
          )
          .replace('#include <map_fragment>', `#include <map_fragment>\n${FRAGMENT_BODY}`);
      };
      material.needsUpdate = true;
      this.patched.add(material);
    }
    this.apply();
  }

  setVelocity(texture: Texture | null): void {
    this.uniforms.uVelocity.value = texture;
    this.refreshOffset();
  }

  /**
   * How far off the skin to sample, recomputed from the solver's own grid rather than
   * remembered, so a resolution change carries it along.
   */
  private refreshOffset(): void {
    const grid = this.uniforms.uGrid.value as Vector3;
    const size = this.uniforms.uDomainSize.value as Vector3;
    this.uniforms.uCpOffset.value = CP_SAMPLE_CELLS * (size.x / Math.max(1, grid.x));
  }

  /** World size of one flow cell, which is what the sample offset is measured in. */
  get cellWorld(): number {
    const grid = this.uniforms.uGrid.value as Vector3;
    const size = this.uniforms.uDomainSize.value as Vector3;
    return size.x / Math.max(1, grid.x);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.apply();
  }

  get active(): boolean {
    return this.enabled;
  }

  private apply(): void {
    this.uniforms.uCpAmount.value = this.enabled ? 1 : 0;
  }

  /** Hand the materials back as they were, in case the aircraft outlives this. */
  detach(): void {
    for (const material of this.patched) {
      material.onBeforeCompile = () => {};
      material.customProgramCacheKey = () => '';
      material.needsUpdate = true;
    }
    this.patched.clear();
  }
}
