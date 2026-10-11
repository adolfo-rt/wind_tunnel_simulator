import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Sphere,
  Vector3,
  WebGLRenderer,
  type Box3,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * The renderer, camera and orbit controls.
 *
 * Deliberately conservative by default: the pixel ratio is capped and shadows use a
 * single modest-resolution map, because the simulator is meant to stay smooth on an
 * ordinary school laptop rather than to look its best on a workstation.
 */

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  /** Upper bound on device pixel ratio. Lower trades sharpness for frame rate. */
  maxPixelRatio?: number;
}

export type FrameCallback = (deltaSeconds: number, elapsedSeconds: number) => void;

export class Viewer {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  /** Everything that represents the aircraft and, later, the tunnel. */
  readonly world = new Group();

  private callbacks = new Set<FrameCallback>();
  private cameraAnimation: FrameCallback | null = null;
  private lastTime = 0;
  private elapsed = 0;
  private running = false;
  private resizeObserver: ResizeObserver;

  constructor(options: ViewerOptions) {
    const { canvas } = options;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene = new Scene();
    this.scene.background = new Color(0x0b0e13);
    this.scene.fog = new Fog(0x0b0e13, 200, 1200);
    this.scene.add(this.world);

    // A neutral studio environment so the metallic surfaces have something to reflect.
    // Without it, aluminium reads as flat grey.
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.camera = new PerspectiveCamera(42, 1, 0.1, 5000);
    this.camera.position.set(60, 26, 70);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.75;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.maxPolarAngle = Math.PI * 0.92;

    this.addLights();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  private addLights(): void {
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 1.6, 0.9).normalize().multiplyScalar(140);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0009;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 420;
    const extent = 90;
    key.shadow.camera.left = -extent;
    key.shadow.camera.right = extent;
    key.shadow.camera.top = extent;
    key.shadow.camera.bottom = -extent;
    this.scene.add(key);

    // A cool rim from behind separates the aeroplane from the dark background.
    const rim = new DirectionalLight(0x9fc4ff, 0.9);
    rim.position.set(-1, 0.35, -0.8).normalize().multiplyScalar(120);
    this.scene.add(rim);

    this.scene.add(new HemisphereLight(0xbcd4ff, 0x20252e, 0.85));
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * Frame the camera on a bounding box.
   *
   * Aircraft in the roster range from a 28 m Comet to an 80 m-span A380, so every
   * selection reframes rather than assuming a fixed distance.
   */
  /**
   * Stop any in-flight camera move.
   *
   * A new camera command always supersedes the old one. Without this, switching
   * aircraft twice in quick succession leaves two eased moves running at once and they
   * fight over the camera. The per-frame step is also clamped, so on a slow renderer an
   * animation takes longer in wall-clock time than its nominal duration, which widens
   * the window in which that can happen.
   */
  cancelCameraAnimation(): void {
    if (!this.cameraAnimation) return;
    this.callbacks.delete(this.cameraAnimation);
    this.cameraAnimation = null;
  }

  frameBounds(bounds: Box3, animate = true): void {
    this.cancelCameraAnimation();
    const sphere = bounds.getBoundingSphere(new Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.12;

    const target = sphere.center.clone();
    // Look down the aircraft's shoulder: enough side-on to read the planform, enough
    // above to show the wing.
    const direction = new Vector3(0.62, 0.34, 0.71).normalize();
    const position = target.clone().addScaledVector(direction, distance);

    this.controls.minDistance = sphere.radius * 0.35;
    this.controls.maxDistance = sphere.radius * 9;
    this.camera.near = Math.max(0.05, sphere.radius * 0.01);
    this.camera.far = sphere.radius * 60;
    this.camera.updateProjectionMatrix();

    if (this.scene.fog instanceof Fog) {
      this.scene.fog.near = sphere.radius * 4;
      this.scene.fog.far = sphere.radius * 22;
    }

    if (!animate) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    // A short eased move, so switching aircraft reads as a change of subject rather
    // than a teleport.
    const startPosition = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const duration = 0.55;
    let time = 0;
    const step: FrameCallback = (delta) => {
      time += delta;
      const t = Math.min(1, time / duration);
      const eased = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(startPosition, position, eased);
      this.controls.target.lerpVectors(startTarget, target, eased);
      if (t >= 1) this.cancelCameraAnimation();
    };
    this.cameraAnimation = step;
    this.callbacks.add(step);
  }

  onFrame(callback: FrameCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick(): void {
    const now = performance.now();
    // Clamp the step so a backgrounded tab does not resume with one enormous frame.
    const delta = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    this.elapsed += delta;

    for (const callback of [...this.callbacks]) callback(delta, this.elapsed);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
