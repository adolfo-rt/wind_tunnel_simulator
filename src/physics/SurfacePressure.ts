import type { IUniform, MeshStandardMaterial } from 'three';
import { PRESSURE_COLOUR_GLSL } from './gpu/colourRamp';
import { CP_ATTRIBUTE } from './surface/bakeCp';

/**
 * The aircraft's skin, coloured by pressure coefficient.
 *
 * This does not replace the aircraft's materials; it patches them, so the shading, the
 * shadows and the shape all survive and only the albedo changes. An unlit mesh coloured
 * straight from Cp reads as a flat cutout, and the whole point is to see where on a
 * three-dimensional shape the pressure is.
 *
 * The value comes from a vertex attribute that the panel model wrote, not from anything
 * sampled here. That is deliberate: the number the colour is drawn from is the same
 * number stage 8 will integrate into lift and drag, so the picture and the force balance
 * cannot disagree. The shader's whole job is to look it up and map it through the ramp.
 *
 * Cp does not change with the tunnel speed. It is a coefficient — the division by dynamic
 * pressure is what takes the speed out — so the surface colours are identical at every
 * slider setting. That is the opposite of the streamlines, where travel has to be scaled
 * by the slider deliberately, and the interface says which is which rather than leaving
 * the difference to be mistaken for a bug.
 */

const VERTEX_DECLARATIONS = /* glsl */ `
  attribute float ${CP_ATTRIBUTE};
  varying float vCp;
`;

const VERTEX_BODY = /* glsl */ `
  vCp = ${CP_ATTRIBUTE};
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
  varying float vCp;
  uniform float uCpAmount;
`;

/*
 * The colour replaces the lit result, not the albedo.
 *
 * Tinting the albedo and letting the physically based lighting have its way with it gave
 * a nearly white aeroplane: several lights, a bright environment and ACES tone mapping
 * between them washed a solid blue of Cp -0.9 out to a pale cast. The pressure is the
 * subject here, so it drives the output directly, with a soft view-space shading term
 * kept so the shape still reads as a shape. The ramp is written in display colours, so it
 * goes back to linear before the renderer's own output transform picks it up.
 */
const FRAGMENT_BODY = /* glsl */ `
  if (uCpAmount > 0.001) {
    float shade = 0.55 + 0.45 * clamp(normal.z, 0.0, 1.0);
    vec3 cpLinear = pow(pressureColour(vCp), vec3(2.2)) * shade;
    outgoingLight = mix(outgoingLight, cpLinear, uCpAmount);
  }
`;

export class SurfacePressure {
  readonly uniforms: Record<string, IUniform> = {
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
          .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BODY}`);

        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>\n${FRAGMENT_DECLARATIONS}${PRESSURE_COLOUR_GLSL}`,
          )
          .replace('#include <opaque_fragment>', `${FRAGMENT_BODY}\n#include <opaque_fragment>`);
      };
      material.needsUpdate = true;
      this.patched.add(material);
    }
    this.apply();
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
