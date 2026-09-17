import { describe, it, expect } from 'vitest';
import { buildAircraft } from '../src/aircraft/AircraftBuilder';
import { ROSTER } from '../src/aircraft/roster';
import { signedVolume, loftRings, superellipseRing } from '../src/aircraft/build/loft';
import { buildLiftingSurface } from '../src/aircraft/build/wing';
import { buildFuselage } from '../src/aircraft/build/fuselage';
import { Vector3 } from 'three';

describe('lofting primitives', () => {
  it('builds a cylinder with the right volume and outward-facing winding', () => {
    const radius = 2;
    const height = 5;
    const rings = [];
    for (let i = 0; i <= 10; i++) {
      const x = (height * i) / 10;
      rings.push({ points: superellipseRing(x, 0, radius, radius, radius, 2, 64), v: i / 10 });
    }
    const geometry = loftRings(rings, { closed: true, capStart: true, capEnd: true });
    const volume = signedVolume(
      geometry.getAttribute('position').array as ArrayLike<number>,
      geometry.getIndex()!.array as ArrayLike<number>,
    );
    // Positive means outward winding; a 64-gon slightly under-estimates a true circle.
    expect(volume).toBeGreaterThan(0);
    expect(volume).toBeCloseTo(Math.PI * radius * radius * height, 0);
  });

  it('winds every face outward, not just the mesh as a whole', () => {
    // A global volume check can be satisfied by a mesh whose walls and caps disagree,
    // with one set inside out. On a convex shape every face normal must point away
    // from the centroid, which catches that.
    const rings = [];
    for (let i = 0; i <= 8; i++) {
      rings.push({ points: superellipseRing((4 * i) / 8, 0, 1.5, 1.5, 1.5, 2, 32), v: i / 8 });
    }
    const geometry = loftRings(rings, { closed: true, capStart: true, capEnd: true });
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex()!;
    const centre = { x: 2, y: 0, z: 0 };

    for (let t = 0; t < index.count; t += 3) {
      const i0 = index.getX(t);
      const i1 = index.getX(t + 1);
      const i2 = index.getX(t + 2);
      const ax = position.getX(i0), ay = position.getY(i0), az = position.getZ(i0);
      const bx = position.getX(i1), by = position.getY(i1), bz = position.getZ(i1);
      const cx = position.getX(i2), cy = position.getY(i2), cz = position.getZ(i2);
      const e1 = [bx - ax, by - ay, bz - az];
      const e2 = [cx - ax, cy - ay, cz - az];
      const normal = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const outward = [
        (ax + bx + cx) / 3 - centre.x,
        (ay + by + cy) / 3 - centre.y,
        (az + bz + cz) / 3 - centre.z,
      ];
      const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('makes a superellipse squarer as the exponent rises', () => {
    const area = (exponent: number) => {
      const points = superellipseRing(0, 0, 1, 1, 1, exponent, 512);
      let sum = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a.z * b.y - b.z * a.y;
      }
      return Math.abs(sum) / 2;
    };
    expect(area(2)).toBeCloseTo(Math.PI, 2);
    expect(area(4)).toBeGreaterThan(Math.PI);
    expect(area(8)).toBeGreaterThan(area(4));
    expect(area(8)).toBeLessThan(4);
  });

  it('rejects a loft whose rings do not match', () => {
    expect(() =>
      loftRings([
        { points: superellipseRing(0, 0, 1, 1, 1, 2, 8), v: 0 },
        { points: superellipseRing(1, 0, 1, 1, 1, 2, 12), v: 1 },
      ]),
    ).toThrow(/same number of points/);
  });
});

describe('wingtip devices continue from the wing tip', () => {
  const DEG = Math.PI / 180;
  const base = {
    rootLE: new Vector3(0, 0, 0),
    semiSpan: 17,
    rootChord: 6,
    tipChord: 1.5,
    sweepQuarterChordDeg: 25,
    dihedralDeg: 6,
    thicknessRoot: 0.12,
    thicknessTip: 0.1,
    camber: 0.02,
    family: 'supercritical' as const,
    axis: 'z' as const,
  };

  const extent = (geometry: ReturnType<typeof buildLiftingSurface>, filter: (z: number) => boolean) => {
    const position = geometry.getAttribute('position');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (!filter(position.getZ(i))) continue;
      const y = position.getY(i);
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    return { min, max };
  };

  it.each(['blended', 'sharklet', 'fence', 'scimitar'] as const)(
    'a %s winglet rises from the tip rather than restarting at the root plane',
    (type) => {
      const height = 2.4;
      const geometry = buildLiftingSurface({ ...base, winglet: { type, height } });
      const tipRise = base.semiSpan * Math.tan(base.dihedralDeg * DEG);

      // Nothing outboard of the structural tip should sit below the tip's own height.
      // Before this was fixed, every winglet began with a step back down to the root
      // plane, putting a kink in the wing.
      const outboard = extent(geometry, (z) => z > base.semiSpan * 0.995);
      expect(outboard.min).toBeGreaterThan(tipRise - base.tipChord * base.thicknessTip);

      // And the device should reach roughly its nominal height above the tip.
      expect(outboard.max).toBeGreaterThan(tipRise + height * 0.7);
      expect(outboard.max).toBeLessThan(tipRise + height * 1.3);
    },
  );

  it('keeps a raked tip in the plane of the wing rather than turning it up', () => {
    const geometry = buildLiftingSurface({ ...base, winglet: { type: 'raked', height: 0 } });
    const tipRise = base.semiSpan * Math.tan(base.dihedralDeg * DEG);
    const outboard = extent(geometry, (z) => z > base.semiSpan * 0.95);
    // A raked tip does not turn up; it stays on the wing's dihedral line.
    expect(outboard.min).toBeGreaterThan(tipRise - 0.6);
    expect(outboard.max).toBeLessThan(tipRise + 0.6);
  });

  it('makes a raked tip consume span rather than add to it', () => {
    const plain = buildLiftingSurface(base);
    const raked = buildLiftingSurface({ ...base, winglet: { type: 'raked', height: 0 } });
    const spanOf = (g: ReturnType<typeof buildLiftingSurface>) => {
      const position = g.getAttribute('position');
      let max = -Infinity;
      for (let i = 0; i < position.count; i++) max = Math.max(max, position.getZ(i));
      return max;
    };
    // Published spans for the 787 and A350 already include their raked tips, so a rake
    // that extended the wing put them several metres too wide and inflated the aspect
    // ratio with them. The rake is the outer part of the span, not an addition.
    expect(spanOf(raked)).toBeCloseTo(spanOf(plain), 5);
    expect(spanOf(raked)).toBeCloseTo(base.semiSpan, 5);
  });

  it.each(['blended', 'sharklet', 'scimitar', 'fence'] as const)(
    'keeps a %s winglet over the wing tip rather than trailing far behind it',
    (type) => {
      const geometry = buildLiftingSurface({ ...base, winglet: { type, height: 2.4 } });
      const position = geometry.getAttribute('position');
      let tipTrailingEdgeX = -Infinity;
      let deviceAftX = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const z = position.getZ(i);
        if (z > base.semiSpan * 0.98 && z < base.semiSpan * 1.02) {
          tipTrailingEdgeX = Math.max(tipTrailingEdgeX, position.getX(i));
        }
        if (z > base.semiSpan * 1.02) deviceAftX = Math.max(deviceAftX, position.getX(i));
      }
      // Sweep used to be ADDED to the wing's, giving a 737 winglet 63 degrees and
      // marching it about sixteen of its own chords downstream. Bounded in tip chords so
      // the limit means the same thing on any wing.
      const trailInTipChords = (deviceAftX - tipTrailingEdgeX) / base.tipChord;
      expect(trailInTipChords).toBeLessThan(2.5);
    },
  );
});

describe('texture coordinates', () => {
  it('lets u reach 1 on a closed loft, with no wrap-around triangle', () => {
    const rings = [];
    for (let i = 0; i <= 6; i++) {
      rings.push({ points: superellipseRing(i, 0, 2, 2, 2, 2, 24), v: i / 6 });
    }
    const geometry = loftRings(rings, { closed: true, capStart: true, capEnd: true });
    const uv = geometry.getAttribute('uv');
    const index = geometry.getIndex()!;

    let minU = Infinity;
    let maxU = -Infinity;
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i));
      maxU = Math.max(maxU, uv.getX(i));
    }
    expect(minU).toBeCloseTo(0, 6);
    expect(maxU).toBeCloseTo(1, 6);

    // The real defect: without a seam vertex, u could only reach 1 - 1/segments, and the
    // closing quad ran from 0.96 back to 0 - squeezing the whole texture, backwards,
    // into one segment. That shows up here as a triangle spanning most of the u range.
    for (let t = 0; t < index.count; t += 3) {
      const us = [uv.getX(index.getX(t)), uv.getX(index.getX(t + 1)), uv.getX(index.getX(t + 2))];
      // Cap fans radiate from a centre vertex at u = 0.5, so exclude those.
      if (us.includes(0.5)) continue;
      expect(Math.max(...us) - Math.min(...us)).toBeLessThan(0.5);
    }
  });

  it('runs the fuselage texture from nose to tail', () => {
    // The livery canvas is authored with row 0 at the nose and flipY disabled, which is
    // only correct if v increases aft. Pin the convention down here so it cannot invert
    // silently and put the cockpit windows on the tail again.
    const spec = ROSTER.find((s) => s.id === 'a320')!;
    const sections = buildFuselage(spec, 12, 20);
    const uv = sections.geometry.getAttribute('uv');
    const position = sections.geometry.getAttribute('position');
    let noseV = Infinity;
    let tailV = -Infinity;
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) < spec.fuselage.length * 0.05) noseV = Math.min(noseV, uv.getY(i));
      if (position.getX(i) > spec.fuselage.length * 0.95) tailV = Math.max(tailV, uv.getY(i));
    }
    expect(noseV).toBeLessThan(0.1);
    expect(tailV).toBeGreaterThan(0.9);
  });
});

describe('every aircraft in the roster builds', () => {
  it.each(ROSTER.map((s) => [s.id, s] as const))('%s', (_id, spec) => {
    const built = buildAircraft(spec, 'high');
    try {
      const position = built.solid.getAttribute('position');
      const index = built.solid.getIndex();
      expect(position.count).toBeGreaterThan(500);
      expect(index).not.toBeNull();

      const array = position.array as Float32Array;
      for (let i = 0; i < array.length; i++) {
        expect(Number.isFinite(array[i])).toBe(true);
      }

      expect(built.solid.getAttribute('normal')).toBeDefined();

      // A union of closed solids has positive volume when the winding is outward.
      const volume = signedVolume(array, index!.array as ArrayLike<number>);
      expect(volume).toBeGreaterThan(0);

      const size = built.bounds.getSize(new (built.bounds.min.constructor as any)());
      // Overall length is set by the fuselage.
      expect(size.x).toBeGreaterThan(spec.fuselage.length * 0.9);
      expect(size.x).toBeLessThan(spec.fuselage.length * 1.15);
      // Overall width is the wing span, plus whatever the tip device adds.
      expect(size.z).toBeGreaterThan(spec.wing.span * 0.97);
      expect(size.z).toBeLessThan(spec.wing.span * 1.2);
      // Height covers the fuselage plus the fin.
      expect(size.y).toBeGreaterThan(spec.tail.vStabHeight);

      // The mesh has to stay light enough to voxelise and render smoothly.
      expect(index!.count / 3).toBeLessThan(60000);

      // The geometry must agree with the specification the interface displays. The 727
      // was built with two engines while its card said three, because the centre engine
      // was gated on the tail shape rather than counted.
      expect(built.parts.nacelles).toBe(spec.engines.count);

      // Built span must match the published overall span, which is what the card shows.
      const builtSpan = Math.max(Math.abs(built.bounds.min.z), Math.abs(built.bounds.max.z)) * 2;
      expect(builtSpan).toBeGreaterThan(spec.reference.spanOverallM * 0.97);
      expect(builtSpan).toBeLessThan(spec.reference.spanOverallM * 1.03);
    } finally {
      built.dispose();
    }
  });
});

describe('geometry reflects the design differences that matter aerodynamically', () => {
  const build = (id: string) => {
    const spec = ROSTER.find((s) => s.id === id)!;
    return buildAircraft(spec, 'high');
  };

  it('gives winglet-equipped aircraft more span than their structural span', () => {
    const plain = build('boeing737-200');
    const winglets = build('boeing737-800');
    try {
      const plainSize = plain.bounds.getSize(new (plain.bounds.min.constructor as any)());
      const wingletSize = winglets.bounds.getSize(new (winglets.bounds.min.constructor as any)());
      // A wingtip device stands proud of the structural span in height terms; the 737NG
      // blended winglet reaches well above the wing plane.
      expect(wingletSize.z / winglets.spec.wing.span).toBeGreaterThan(
        plainSize.z / plain.spec.wing.span,
      );
    } finally {
      plain.dispose();
      winglets.dispose();
    }
  });

  it('makes Concorde far more slender than a subsonic widebody', () => {
    const concorde = build('concorde');
    const a350 = build('a350');
    try {
      const slenderness = (b: typeof concorde) => {
        const size = b.bounds.getSize(new (b.bounds.min.constructor as any)());
        return size.x / size.z;
      };
      expect(slenderness(concorde)).toBeGreaterThan(2);
      expect(slenderness(a350)).toBeLessThan(1.3);
    } finally {
      concorde.dispose();
      a350.dispose();
    }
  });

  it('puts the 747 upper deck above a plain single-deck fuselage line', () => {
    const jumbo = build('boeing747-100');
    try {
      // The hump raises the crown well above the nominal radius over the forward third.
      const position = jumbo.solid.getAttribute('position');
      const L = jumbo.spec.fuselage.length;
      let crownForward = -Infinity;
      let crownAft = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = Math.abs(position.getZ(i));
        if (z > jumbo.spec.fuselage.diameter * 0.3) continue;
        if (x > 0.12 * L && x < 0.28 * L) crownForward = Math.max(crownForward, y);
        if (x > 0.5 * L && x < 0.62 * L) crownAft = Math.max(crownAft, y);
      }
      expect(crownForward).toBeGreaterThan(crownAft * 1.15);
    } finally {
      jumbo.dispose();
    }
  });
});
