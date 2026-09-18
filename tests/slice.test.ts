import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
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
