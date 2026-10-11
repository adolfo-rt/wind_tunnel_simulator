import { Box3, Color, Group, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { REFERENCE_SPEED, rampColour } from './gpu/colourRamp';
import { rakeStations, traceStreamline, type Field } from './particles/trace';

/**
 * A rake of streamlines in one spanwise plane.
 *
 * The oldest picture in the subject: a row of smoke probes across the tunnel, each
 * drawing one continuous line, so you can see at a glance where the air is pushed aside,
 * where it is squeezed and sped up, and where it never recovers. The tracers in
 * `Streamlines.ts` answer a different question — they fill the volume and show the flow
 * as a whole — and the two are complementary rather than alternatives.
 *
 * These are true streamlines, tangent to the field at one instant, where the tracers are
 * pathlines showing where particles have been. In the steady part of the flow the two
 * coincide; in the unsteady wake they do not, and neither is wrong.
 *
 * Drawn as thick ribbons, which is the whole reason this is traced on the CPU: a line
 * with width has to be expanded into real geometry from points something can see, and a
 * one-pixel line at this scale disappears into the tunnel's own structure.
 *
 * Rebuilt rather than animated. The solve is non-dimensional, so the shape of a
 * streamline does not depend on the tunnel speed at all — only its colour does. The
 * geometry therefore has to change when the aircraft, the grid or the plane moves, and at
 * no other time.
 */

/** Lines in the rake. Enough to read the deflection, few enough to see between them. */
const LINE_COUNT = 22;

/** Thickness in pixels, independent of how far the camera is. */
const LINE_WIDTH = 2.6;

/** How far across the tunnel's height the rake reaches, as a fraction of the radius. */
const SPREAD = 0.92;

/** Where the lines are released, as a fraction of the way down the tunnel. */
const RELEASE = 0.015;

export class StreamlineRake {
  readonly group = new Group();

  private material: LineMaterial;
  private lines: Line2[] = [];
  private domain = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  private plane = 0.5;
  private enabled = false;
  private scale = 0;

  constructor() {
    this.material = new LineMaterial({
      linewidth: LINE_WIDTH,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      dashed: false,
    });
    this.group.name = 'streamline-rake';
    this.group.renderOrder = 3;
    this.group.visible = false;
  }

  configure(domain: Box3): void {
    this.domain = domain.clone();
  }

  setVisible(visible: boolean): void {
    this.enabled = visible;
    this.group.visible = visible && this.lines.length > 0;
  }

  get visible(): boolean {
    return this.enabled;
  }

  /** Where the plane sits across the span, 0 to 1 across the domain. */
  setPlane(fraction: number): void {
    this.plane = Math.min(1, Math.max(0, fraction));
  }

  get planePosition(): number {
    return this.plane;
  }

  /** World position of the plane, which the UI reports in metres from the centreline. */
  get planeWorld(): number {
    return this.domain.min.z + this.plane * (this.domain.max.z - this.domain.min.z);
  }

  /**
   * Thick lines are expanded in screen space, so the material has to be told how many
   * pixels there are. Without this the width is right at one window size and wrong at
   * every other, which reads as the lines thickening when the window is made smaller.
   */
  setResolution(width: number, height: number): void {
    this.material.resolution = new Vector2(width, height);
  }

  /**
   * The tunnel's free-stream speed, for the colours only.
   *
   * The same ramp and the same anchor as the slice and the tracers, so a colour means one
   * thing everywhere. The geometry is untouched: a streamline's shape is the same at
   * every setting of the slider, which is what a non-dimensional solve means.
   */
  setFreeStream(metresPerSecond: number): void {
    const scale = metresPerSecond / REFERENCE_SPEED;
    if (Math.abs(scale - this.scale) < 1e-4) return;
    this.scale = scale;
    this.recolour();
  }

  private speeds: Float32Array[] = [];

  /** Trace the rake through a field that has been read back from the solver. */
  rebuild(field: Field): void {
    this.dispose();

    const size = this.domain.getSize(new Vector3());
    const radius = Math.min(size.y, size.z) / 2;
    const z = this.planeWorld;
    const x = this.domain.min.x + RELEASE * size.x;
    const centreY = (this.domain.min.y + this.domain.max.y) / 2;

    for (const y of rakeStations(LINE_COUNT, centreY - SPREAD * radius, centreY + SPREAD * radius)) {
      const line = traceStreamline(field, { x, y, z });
      // Two points make a segment; one makes nothing, and LineGeometry dislikes it.
      if (line.points.length < 2) continue;

      const positions = new Float32Array(line.points.length * 3);
      for (let i = 0; i < line.points.length; i++) {
        positions[i * 3] = line.points[i].x;
        positions[i * 3 + 1] = line.points[i].y;
        positions[i * 3 + 2] = line.points[i].z;
      }

      const geometry = new LineGeometry();
      geometry.setPositions(positions);
      const mesh = new Line2(geometry, this.material);
      mesh.computeLineDistances();
      mesh.frustumCulled = false;
      this.lines.push(mesh);
      this.speeds.push(new Float32Array(line.speeds));
      this.group.add(mesh);
    }

    this.recolour();
    this.group.visible = this.enabled && this.lines.length > 0;
  }

  /**
   * Colours only, which is all that changes when the tunnel speed does.
   *
   * The ramp is written in display colours and this material runs through the renderer's
   * output transform, so the values have to be converted into the working space rather
   * than assigned. Skipping that step is how a deliberately chosen blue arrives on screen
   * as a washed-out grey — the same trap stage 5's surface pressure fell into.
   */
  private recolour(): void {
    const swatch = { r: 0, g: 0, b: 0 };
    const colour = new Color();
    for (let i = 0; i < this.lines.length; i++) {
      const speeds = this.speeds[i];
      const colours = new Float32Array(speeds.length * 3);
      for (let j = 0; j < speeds.length; j++) {
        rampColour(speeds[j] * this.scale, swatch);
        colour.setRGB(swatch.r, swatch.g, swatch.b, SRGBColorSpace);
        colours[j * 3] = colour.r;
        colours[j * 3 + 1] = colour.g;
        colours[j * 3 + 2] = colour.b;
      }
      this.lines[i].geometry.setColors(colours);
    }
  }

  get lineCount(): number {
    return this.lines.length;
  }

  /**
   * Every point of every ribbon, for checking rather than drawing.
   *
   * A streamline that passes through the aeroplane is the most convincing wrong picture
   * this code could draw - it looks entirely orderly - so `verify:rake` reads these back
   * and measures them against the distance field rather than trusting that the velocity
   * being zero inside a solid was enough to stop the trace.
   */
  paths(): Array<Array<[number, number, number]>> {
    return this.lines.map((line) => {
      const attribute = line.geometry.getAttribute('instanceStart');
      const out: Array<[number, number, number]> = [];
      for (let i = 0; i < attribute.count; i++) {
        out.push([attribute.getX(i), attribute.getY(i), attribute.getZ(i)]);
      }
      const end = line.geometry.getAttribute('instanceEnd');
      if (end.count > 0) {
        const last = end.count - 1;
        out.push([end.getX(last), end.getY(last), end.getZ(last)]);
      }
      return out;
    });
  }

  dispose(): void {
    for (const line of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
    }
    this.lines = [];
    this.speeds = [];
  }
}
