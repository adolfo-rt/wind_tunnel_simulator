import { describe, it, expect } from 'vitest';
import { Box3, Vector3, type ShaderMaterial } from 'three';
import { SliceView } from '../src/physics/SliceView';
import { layoutAtlas } from '../src/physics/gpu/atlas';

/**
 * The domain is centred on the aircraft, so the middle of the slider is the aircraft's
 * own centreline. The orientation buttons return there, which only helps if the middle
 * really is the middle on every axis.
 */
describe('flow slice placement', () => {
  const domain = new Box3(new Vector3(-50, -20, -20), new Vector3(50, 20, 20));
  const layout = layoutAtlas({ x: 64, y: 26, z: 26 });

  const fitted = () => {
    const slice = new SliceView();
    slice.configure(domain, layout, null);
    return slice;
  };

  it.each(['x', 'y', 'z'] as const)('puts the midpoint of the %s axis on the centreline', (axis) => {
    const slice = fitted();
    slice.setAxis(axis);
    slice.setPosition(0.5);
    expect(slice.mesh.position.x).toBeCloseTo(0, 6);
    expect(slice.mesh.position.y).toBeCloseTo(0, 6);
    expect(slice.mesh.position.z).toBeCloseTo(0, 6);
    slice.dispose();
  });

  it('moves along the chosen axis and no other', () => {
    const slice = fitted();
    slice.setAxis('z');
    slice.setPosition(0.9);
    expect(slice.mesh.position.z).toBeCloseTo(-20 + 0.9 * 40, 6);
    expect(slice.mesh.position.x).toBeCloseTo(0, 6);
    expect(slice.mesh.position.y).toBeCloseTo(0, 6);
    slice.dispose();
  });

  it('stays inside the domain however far the slider is pushed', () => {
    const slice = fitted();
    for (const axis of ['x', 'y', 'z'] as const) {
      slice.setAxis(axis);
      for (const fraction of [-3, 0, 0.5, 1, 4]) {
        slice.setPosition(fraction);
        expect(domain.containsPoint(slice.mesh.position)).toBe(true);
      }
    }
    slice.dispose();
  });

  it('spans the domain on the two axes it is not moving along', () => {
    const slice = fitted();
    slice.setAxis('z');
    const size = new Box3().setFromObject(slice.mesh).getSize(new Vector3());
    expect(size.x).toBeCloseTo(100, 4);
    expect(size.y).toBeCloseTo(40, 4);
    slice.dispose();
  });
});

/**
 * The solver runs non-dimensionally with the free stream at exactly 1, so the field it
 * holds is identical whatever the tunnel is set to. Turning it back into metres per
 * second is the display's job — without it the slice looks the same with the fans
 * stopped as at cruise, which is what it used to do.
 */
describe('the slice answers to the tunnel speed', () => {
  const domain = new Box3(new Vector3(-50, -20, -20), new Vector3(50, 20, 20));
  const layout = layoutAtlas({ x: 64, y: 26, z: 26 });

  const fitted = () => {
    const slice = new SliceView();
    slice.configure(domain, layout, null);
    return slice;
  };

  const uniforms = (slice: SliceView) =>
    (slice.mesh.material as ShaderMaterial).uniforms as Record<string, { value: number }>;

  it('scales the field by the free stream, so cruise reads as the reference', () => {
    const slice = fitted();
    slice.setFreeStream(SliceView.REFERENCE_SPEED);
    expect(uniforms(slice).uScale.value).toBeCloseTo(1, 6);
    slice.dispose();
  });

  it('shows nothing when the fans are stopped', () => {
    const slice = fitted();
    slice.setFreeStream(0);
    expect(uniforms(slice).uScale.value).toBe(0);
    expect(uniforms(slice).uFade.value).toBe(0);
    slice.dispose();
  });

  it('rises monotonically with speed rather than saturating', () => {
    const slice = fitted();
    let previous = -1;
    for (const kmh of [0, 100, 300, 600, 900, 1300]) {
      slice.setFreeStream(kmh / 3.6);
      const scale = uniforms(slice).uScale.value;
      expect(scale).toBeGreaterThan(previous);
      previous = scale;
    }
    slice.dispose();
  });

  it('labels the legend at the speeds the shader changes colour', () => {
    // The bar in the panel is drawn with these same fractions, so the two agree.
    expect(SliceView.LEGEND_STOPS[0]).toBe(0);
    expect(SliceView.LEGEND_STOPS[2]).toBe(SliceView.REFERENCE_SPEED);
    expect(SliceView.LEGEND_STOPS).toHaveLength(5);
    for (let i = 1; i < SliceView.LEGEND_STOPS.length; i++) {
      expect(SliceView.LEGEND_STOPS[i]).toBeGreaterThan(SliceView.LEGEND_STOPS[i - 1]);
    }
  });
});
