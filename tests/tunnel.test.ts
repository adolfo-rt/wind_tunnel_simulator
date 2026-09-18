import { describe, it, expect } from 'vitest';
import { Box3, Vector3 } from 'three';
import { WindTunnel } from '../src/tunnel/Tunnel';
import { buildAircraft } from '../src/aircraft/AircraftBuilder';
import { ROSTER } from '../src/aircraft/roster';

/**
 * The tunnel is sized around whichever aircraft is loaded, from a 28 m Comet to an
 * 80 m-span A380, and the aircraft sits at the origin. These hold the relationships
 * that make the working section usable: the model has to clear the walls, and the fans
 * have to stay well off its nose and tail.
 */
describe('tunnel proportions', () => {
  const fitted = (id: string) => {
    const spec = ROSTER.find((s) => s.id === id)!;
    const built = buildAircraft(spec, 'low');
    const bounds = built.bounds.clone();
    // main.ts centres the aircraft on the origin before fitting the tunnel.
    const centre = bounds.getCenter(new Vector3());
    bounds.translate(centre.negate());
    const tunnel = new WindTunnel();
    tunnel.fitTo(bounds);
    const size = bounds.getSize(new Vector3());
    built.dispose();
    return { tunnel, bounds, size, spec };
  };

  it.each(['comet1', 'boeing737-800', 'concorde', 'a380', 'boeing747-100'])(
    '%s clears the walls and keeps the fans off the aircraft',
    (id) => {
      const { tunnel, size } = fitted(id);
      const { radius, length } = tunnel.size;

      // The span has to fit across the tube with margin to spare.
      expect(radius * 2).toBeGreaterThan(size.z * 1.15);
      expect(radius * 2).toBeGreaterThan(size.y * 1.15);

      // And the fans, which sit just inside each end, have to stand clear of nose and
      // tail rather than crowding them.
      const clearancePerEnd = (length - size.x) / 2;
      expect(clearancePerEnd).toBeGreaterThan(size.x * 0.25);

      tunnel.dispose();
    },
  );

  it('keeps the working section centred on the aircraft', () => {
    const { tunnel, bounds } = fitted('boeing737-800');
    const centre = bounds.getCenter(new Vector3());
    // The aircraft is centred on the origin and so is the tunnel, so clearance upstream
    // and downstream is equal by construction. Extra length lands half at each end.
    expect(centre.x).toBeCloseTo(0, 6);
    expect(tunnel.size.length / 2).toBeGreaterThan(Math.abs(bounds.max.x));
    expect(tunnel.size.length / 2).toBeGreaterThan(Math.abs(bounds.min.x));
    tunnel.dispose();
  });

  it('never lets the tube get so long that the aircraft is lost in it', () => {
    for (const spec of ROSTER) {
      const built = buildAircraft(spec, 'low');
      const bounds = built.bounds.clone();
      bounds.translate(bounds.getCenter(new Vector3()).negate());
      const tunnel = new WindTunnel();
      tunnel.fitTo(bounds);
      const { radius, length } = tunnel.size;
      // Concorde is the case that forces this: long and narrow, it would otherwise get
      // a tube four times longer than it is wide.
      expect(length / (radius * 2)).toBeLessThan(4.2);
      tunnel.dispose();
      built.dispose();
    }
  });

  it('scales with the aircraft rather than being fixed', () => {
    const small = fitted('comet1');
    const large = fitted('a380');
    expect(large.tunnel.size.radius).toBeGreaterThan(small.tunnel.size.radius * 1.5);
    expect(large.tunnel.size.length).toBeGreaterThan(small.tunnel.size.length);
    small.tunnel.dispose();
    large.tunnel.dispose();
  });

  it('starts with the fans stopped and spins them up with speed', () => {
    const { tunnel } = fitted('a320');
    expect(tunnel.rpm).toBe(0);
    tunnel.setSpeed(250);
    // One long step is enough to get most of the way to the commanded speed.
    tunnel.update(3);
    expect(tunnel.rpm).toBeGreaterThan(100);
    const spooled = tunnel.rpm;
    tunnel.setSpeed(0);
    tunnel.update(3);
    expect(tunnel.rpm).toBeLessThan(spooled * 0.2);
    tunnel.dispose();
  });

  it('reports a Box3 fit that is stable when applied twice', () => {
    const { tunnel, bounds } = fitted('boeing777');
    const first = { ...tunnel.size };
    tunnel.fitTo(bounds);
    expect(tunnel.size.radius).toBeCloseTo(first.radius, 10);
    expect(tunnel.size.length).toBeCloseTo(first.length, 10);
    tunnel.dispose();
  });
});

describe('an empty tunnel', () => {
  it('can be disposed without ever being fitted', () => {
    const tunnel = new WindTunnel();
    expect(() => tunnel.dispose()).not.toThrow();
  });

  it('handles a degenerate bounding box without producing nonsense', () => {
    const tunnel = new WindTunnel();
    tunnel.fitTo(new Box3(new Vector3(0, 0, 0), new Vector3(0, 0, 0)));
    expect(Number.isFinite(tunnel.size.radius)).toBe(true);
    expect(Number.isFinite(tunnel.size.length)).toBe(true);
    tunnel.dispose();
  });
});
