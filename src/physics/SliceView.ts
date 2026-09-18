import {
  DoubleSide,
  GLSL3,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Box3,
  type Texture,
} from 'three';
import { ATLAS_GLSL, type AtlasLayout } from './gpu/atlas';
import { LEGEND_STOPS, REFERENCE_SPEED, SPEED_COLOUR_GLSL } from './gpu/colourRamp';

/**
 * A cutting plane through the solved velocity field.
 *
 * Stage 3 produces a flow field but nothing yet draws it, so this is how the solver gets
 * inspected: a plane that samples the velocity at every fragment and colours it by
 * speed. It is what makes the stage testable — you can see the flow stagnate at the
 * nose, accelerate over the wing and slow in the wake, before any particles exist to
 * trace it.
 */

export type SliceAxis = 'x' | 'y' | 'z';

const SLICE_FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler2D;

  uniform sampler2D uVelocity;
  uniform float uOpacity;
  uniform float uScale;
  uniform float uFade;

  in vec3 vWorld;
  out vec4 fragColor;

  uniform vec3 uDomainMin;
  uniform vec3 uDomainSize;

  void main() {
    vec3 cell = (vWorld - uDomainMin) / uDomainSize * uGrid;
    if (any(lessThan(cell, vec3(0.0))) || any(greaterThan(cell, uGrid))) discard;

    vec3 v = sampleAtlas(uVelocity, cell).xyz;
    // The solved field is non-dimensional, with the free stream at exactly 1. Scaling
    // by the tunnel's actual speed turns it back into metres per second, which is what
    // makes the slice answer to the slider: with the fans stopped there is no flow, and
    // the slice should say so rather than showing the shape of a flow that is not there.
    float speed = length(v) * uScale;
    fragColor = vec4(speedColour(speed), uOpacity * uFade);
  }
`;

const SLICE_VERTEX = /* glsl */ `
  out vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export class SliceView {
  readonly mesh: Mesh;
  private material: ShaderMaterial;
  private geometry = new PlaneGeometry(1, 1);
  private axis: SliceAxis = 'z';
  /** Where the plane sits along its axis, 0 to 1 across the domain. */
  private position = 0.5;
  private domain: Box3 | null = null;

  constructor() {
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: SLICE_VERTEX,
      fragmentShader: ATLAS_GLSL + SPEED_COLOUR_GLSL + SLICE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uGrid: { value: new Vector3(1, 1, 1) },
        uTiles: { value: new Vector2(1, 1) },
        uTexSize: { value: new Vector2(1, 1) },
        uVelocity: { value: null },
        uDomainMin: { value: new Vector3() },
        uDomainSize: { value: new Vector3(1, 1, 1) },
        uOpacity: { value: 0.92 },
        uScale: { value: 1 },
        uFade: { value: 1 },
      },
    });

    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'flow-slice';
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  configure(domain: Box3, layout: AtlasLayout, velocity: Texture | null): void {
    this.domain = domain.clone();
    const size = domain.getSize(new Vector3());
    const uniforms = this.material.uniforms;
    (uniforms.uGrid.value as Vector3).set(layout.grid.x, layout.grid.y, layout.grid.z);
    (uniforms.uTiles.value as Vector2).set(layout.tiles.x, layout.tiles.y);
    (uniforms.uTexSize.value as Vector2).set(layout.texture.width, layout.texture.height);
    (uniforms.uDomainMin.value as Vector3).copy(domain.min);
    (uniforms.uDomainSize.value as Vector3).copy(size);
    uniforms.uVelocity.value = velocity;
    this.place();
  }

  setVelocity(texture: Texture | null): void {
    this.material.uniforms.uVelocity.value = texture;
  }

  /**
   * The tunnel's actual free-stream speed, which turns the solved field back into real
   * units for display.
   *
   * The colour ramp is anchored to a fixed reference rather than to the current speed.
   * Anchoring it to the current speed would keep the pattern maximally readable but make
   * the picture identical at every setting, which is the thing being fixed here. A fixed
   * anchor compresses the detail at low speed, which is honest: there genuinely is less
   * happening.
   */
  setFreeStream(metresPerSecond: number): void {
    this.material.uniforms.uScale.value = metresPerSecond / SliceView.REFERENCE_SPEED;
    // Below a walking pace there is nothing worth looking at; fade out rather than
    // leaving a flat dark rectangle across the tunnel.
    this.material.uniforms.uFade.value = Math.min(1, metresPerSecond / 6);
  }

  /** Speed the colour ramp is anchored to, in m/s. Shared with the streamlines. */
  static readonly REFERENCE_SPEED = REFERENCE_SPEED;

  /** Where the ramp's colours sit, in m/s, which is what the legend labels. */
  static readonly LEGEND_STOPS = LEGEND_STOPS;

  setAxis(axis: SliceAxis): void {
    this.axis = axis;
    this.place();
  }

  setPosition(fraction: number): void {
    this.position = Math.min(1, Math.max(0, fraction));
    this.place();
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  private place(): void {
    if (!this.domain) return;
    const size = this.domain.getSize(new Vector3());
    const min = this.domain.min;

    // The plane geometry lies in xy; rotate it to face along the chosen axis.
    if (this.axis === 'x') {
      this.geometry.dispose();
      this.geometry = new PlaneGeometry(size.z, size.y);
      this.mesh.geometry = this.geometry;
      this.mesh.rotation.set(0, Math.PI / 2, 0);
      this.mesh.position.set(min.x + size.x * this.position, min.y + size.y / 2, min.z + size.z / 2);
    } else if (this.axis === 'y') {
      this.geometry.dispose();
      this.geometry = new PlaneGeometry(size.x, size.z);
      this.mesh.geometry = this.geometry;
      this.mesh.rotation.set(-Math.PI / 2, 0, 0);
      this.mesh.position.set(min.x + size.x / 2, min.y + size.y * this.position, min.z + size.z / 2);
    } else {
      this.geometry.dispose();
      this.geometry = new PlaneGeometry(size.x, size.y);
      this.mesh.geometry = this.geometry;
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.position.set(min.x + size.x / 2, min.y + size.y / 2, min.z + size.z * this.position);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
