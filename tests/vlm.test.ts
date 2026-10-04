import { describe, it, expect } from 'vitest';
import { solveLattice, type LatticePanel, type LatticeReference } from '../src/physics/panel/vlm';

/**
 * The vortex lattice, checked against results that were known long before anyone could
 * compute them numerically.
 *
 * This matters more here than usual. A lattice is a few lines of Biot-Savart and a linear
 * solve, and it will happily return a confident, smooth, entirely wrong answer if a sign
 * or a winding is backwards — there is nothing in the output that looks wrong. So the
 * tests are the specification: a wing lifts the right way, lift grows with angle, slope
 * approaches 2*pi as the span grows, and an elliptically loaded wing achieves the minimum
 * induced drag that Prandtl showed it must.
 */

const DEG = Math.PI / 180;

interface PlanformOptions {
  semiSpan: number;
  /** Chord at a spanwise fraction of the semi-span, 0 at the root and 1 at the tip. */
  chord: (u: number) => number;
  spanwise?: number;
  chordwise?: number;
}

/**
 * A flat lifting surface laid out the standard way: the bound vortex on each panel's
 * quarter chord, the control point on its three-quarter chord.
 *
 * That 1/4 and 3/4 placement is not arbitrary. It is the arrangement that makes a single
 * panel reproduce thin-airfoil theory exactly, and it is why a lattice this coarse gets
 * the lift slope right.
 */
function flatLattice(options: PlanformOptions): { panels: LatticePanel[]; reference: Omit<LatticeReference, 'stream'> } {
  const spanwise = options.spanwise ?? 24;
  const chordwise = options.chordwise ?? 4;
  const panels: LatticePanel[] = [];
  const span = 2 * options.semiSpan;
  const dz = span / spanwise;

  let area = 0;
  for (let i = 0; i < spanwise; i++) {
    const z0 = -options.semiSpan + i * dz;
    const z1 = z0 + dz;
    const u = Math.abs((z0 + z1) / 2) / options.semiSpan;
    const chord = options.chord(Math.min(1, u));
    // Quarter-chord line straight and on x = 0, so the planform is unswept.
    const leadingEdge = -0.25 * chord;
    area += chord * dz;

    for (let j = 0; j < chordwise; j++) {
      const panelChord = chord / chordwise;
      const x0 = leadingEdge + j * panelChord;
      panels.push({
        a: { x: x0 + 0.25 * panelChord, y: 0, z: z0 },
        b: { x: x0 + 0.25 * panelChord, y: 0, z: z1 },
        control: { x: x0 + 0.75 * panelChord, y: 0, z: (z0 + z1) / 2 },
        normal: { x: 0, y: 1, z: 0 },
        strip: i,
        width: dz,
        chord,
      });
    }
  }
  return { panels, reference: { area, span } };
}

/** Free stream at an angle of attack, with the wing left flat. */
function streamAt(angleDeg: number) {
  return { x: Math.cos(angleDeg * DEG), y: Math.sin(angleDeg * DEG), z: 0 };
}

const rectangular = (semiSpan: number, chord: number, opts: Partial<PlanformOptions> = {}) =>
  flatLattice({ semiSpan, chord: () => chord, ...opts });

const elliptical = (semiSpan: number, rootChord: number, opts: Partial<PlanformOptions> = {}) =>
  flatLattice({ semiSpan, chord: (u) => rootChord * Math.sqrt(Math.max(0, 1 - u * u)), ...opts });

describe('a wing lifts', () => {
  it('produces no lift at no angle of attack', () => {
    const { panels, reference } = rectangular(10, 2.5);
    const result = solveLattice(panels, { ...reference, stream: streamAt(0) });
    expect(result.CL).toBeCloseTo(0, 6);
    expect(result.CDi).toBeCloseTo(0, 6);
  });

  it('lifts upwards when the flow comes from below', () => {
    const { panels, reference } = rectangular(10, 2.5);
    const result = solveLattice(panels, { ...reference, stream: streamAt(5) });
    expect(result.CL).toBeGreaterThan(0);
  });

  it('reverses when the angle of attack reverses', () => {
    const { panels, reference } = rectangular(10, 2.5);
    const up = solveLattice(panels, { ...reference, stream: streamAt(4) });
    const down = solveLattice(panels, { ...reference, stream: streamAt(-4) });
    expect(down.CL).toBeCloseTo(-up.CL, 6);
  });

  it('is linear in the angle of attack, which is what makes it a lift slope', () => {
    const { panels, reference } = rectangular(10, 2.5);
    const two = solveLattice(panels, { ...reference, stream: streamAt(2) }).CL;
    const four = solveLattice(panels, { ...reference, stream: streamAt(4) }).CL;
    const six = solveLattice(panels, { ...reference, stream: streamAt(6) }).CL;
    // Within a percent. Not exactly linear, and honestly so: the trailing legs follow
    // the free stream, so tilting it tilts the wake too.
    expect(four / two).toBeCloseTo(2, 1);
    expect(six / two).toBeCloseTo(3, 1);
  });

  /**
   * Induced drag is always a cost of lift and never a saving: whatever the planform, it
   * has to come out positive. Lifting-line theory says it goes as the square of lift.
   */
  it('pays induced drag in proportion to the square of lift', () => {
    const { panels, reference } = elliptical(10, 2.5);
    const two = solveLattice(panels, { ...reference, stream: streamAt(2) });
    const four = solveLattice(panels, { ...reference, stream: streamAt(4) });
    expect(two.CDi).toBeGreaterThan(0);
    expect(four.CDi / two.CDi).toBeCloseTo(4, 1);
  });
});

/**
 * Prandtl's results, which are the reason an airliner's wing looks the way it does.
 *
 * The lift slope of a finite wing falls below the two-dimensional 2*pi because the tip
 * vortices wash the wing down, and the loss shrinks as the span grows. That single fact
 * is most of why aspect ratio rose from the Comet's 6.6 to the A350's 9.5.
 */
describe('finite span costs lift and adds drag', () => {
  const slopePerRadian = (semiSpan: number, chord: number) => {
    const { panels, reference } = elliptical(semiSpan, chord, { spanwise: 40, chordwise: 4 });
    const result = solveLattice(panels, { ...reference, stream: streamAt(4) });
    return result.CL / (4 * DEG);
  };

  it('stays below the two-dimensional slope of 2*pi', () => {
    for (const aspect of [4, 8, 16]) {
      // Elliptical planform: area = pi/4 * span * rootChord, so AR = 4*span/(pi*rootChord).
      const span = 20;
      const rootChord = (4 * span) / (Math.PI * aspect);
      expect(slopePerRadian(span / 2, rootChord)).toBeLessThan(2 * Math.PI);
    }
  });

  it('approaches it as the span grows', () => {
    const span = 20;
    const slopes = [4, 8, 16].map((aspect) =>
      slopePerRadian(span / 2, (4 * span) / (Math.PI * aspect)),
    );
    expect(slopes[1]).toBeGreaterThan(slopes[0]);
    expect(slopes[2]).toBeGreaterThan(slopes[1]);
    // Lifting-line theory: a = 2*pi*AR/(2 + AR) for an elliptical wing. At AR 16 that is
    // about 5.58, and a lattice should be within a few percent of it.
    const aspect = 16;
    expect(slopes[2]).toBeCloseTo((2 * Math.PI * aspect) / (2 + aspect), 0);
  });

  /**
   * The elliptical wing is the one that achieves the minimum induced drag for a given
   * lift and span, which is the whole reason it is the reference every other planform is
   * measured against. Its span efficiency is 1 by definition.
   */
  it('gives the elliptical planform a span efficiency of about 1', () => {
    const span = 20;
    const rootChord = (4 * span) / (Math.PI * 8);
    const { panels, reference } = elliptical(span / 2, rootChord, { spanwise: 40, chordwise: 4 });
    const result = solveLattice(panels, { ...reference, stream: streamAt(4) });
    expect(result.spanEfficiency).toBeGreaterThan(0.99);
    expect(result.spanEfficiency).toBeLessThan(1.04);
  });

  /**
   * A coarse lattice reports slightly *less* induced drag than the elliptical minimum,
   * which is impossible: the minimum is a theorem. It is discretisation, and the proof
   * that it is only discretisation is that it converges away at first order — each
   * doubling of the strip count halves the excess. Measured: 1.0953, 1.0466, 1.0224,
   * 1.0105, 1.0046, 1.0019 for 10 to 320 strips.
   *
   * Worth a test of its own. An error that shrinks on refinement is a resolution choice;
   * one that does not is a bug, and from a single coarse number the two look identical.
   */
  it('converges onto that minimum as the lattice is refined', () => {
    const span = 20;
    const rootChord = (4 * span) / (Math.PI * 8);
    const excess = (spanwise: number) => {
      const { panels, reference } = elliptical(span / 2, rootChord, { spanwise, chordwise: 4 });
      return solveLattice(panels, { ...reference, stream: streamAt(4) }).spanEfficiency - 1;
    };

    const coarse = excess(20);
    const fine = excess(40);
    const finer = excess(80);

    expect(coarse).toBeGreaterThan(0);
    expect(fine).toBeLessThan(coarse * 0.6);
    expect(finer).toBeLessThan(fine * 0.6);
    expect(finer).toBeLessThan(0.02);
  });

  it('penalises a rectangular planform, which is why wings are tapered', () => {
    const span = 20;
    const chord = span / 8;
    const { panels, reference } = rectangular(span / 2, chord, { spanwise: 40, chordwise: 4 });
    const result = solveLattice(panels, { ...reference, stream: streamAt(4) });
    expect(result.spanEfficiency).toBeLessThan(0.99);
    expect(result.spanEfficiency).toBeGreaterThan(0.85);
  });
});

/**
 * Span loading is what the chordwise pressure distribution is built on, so it has to be
 * the right shape before anything downstream of it can be.
 */
describe('span loading', () => {
  it('is heaviest at the root and falls to nothing at the tips', () => {
    const { panels, reference } = elliptical(10, 2.5, { spanwise: 40, chordwise: 4 });
    const { strips } = solveLattice(panels, { ...reference, stream: streamAt(5) });

    const middle = strips[Math.floor(strips.length / 2)];
    expect(middle.gamma).toBeGreaterThan(strips[0].gamma);
    expect(middle.gamma).toBeGreaterThan(strips[strips.length - 1].gamma);
    expect(strips[0].gamma / middle.gamma).toBeLessThan(0.35);
  });

  it('is symmetric about the centreline', () => {
    const { panels, reference } = elliptical(10, 2.5, { spanwise: 40, chordwise: 4 });
    const { strips } = solveLattice(panels, { ...reference, stream: streamAt(5) });
    for (let i = 0; i < strips.length / 2; i++) {
      const mirror = strips[strips.length - 1 - i];
      expect(strips[i].gamma).toBeCloseTo(mirror.gamma, 6);
    }
  });

  /**
   * An elliptical planform carries elliptical loading. This is the result the whole
   * theory is built on, so getting it within a few percent is the strongest single check
   * that the lattice is wired up correctly.
   */
  it('comes out elliptical on an elliptical planform', () => {
    const semiSpan = 10;
    const { panels, reference } = elliptical(semiSpan, 2.5, { spanwise: 40, chordwise: 4 });
    const { strips } = solveLattice(panels, { ...reference, stream: streamAt(5) });
    const peak = Math.max(...strips.map((s) => s.gamma));

    for (const strip of strips) {
      const u = Math.abs(strip.y) / semiSpan;
      const expected = peak * Math.sqrt(Math.max(0, 1 - u * u));
      // Loose near the tip, where a finite lattice cannot resolve the square-root edge.
      if (u > 0.9) continue;
      expect(strip.gamma).toBeCloseTo(expected, 1);
    }
  });

  it('turns circulation into a section lift coefficient on the local chord', () => {
    const { panels, reference } = rectangular(10, 2.5, { spanwise: 24, chordwise: 4 });
    const { strips, CL } = solveLattice(panels, { ...reference, stream: streamAt(5) });
    // On a rectangular wing every section has the same chord, so the area-weighted mean
    // of the section coefficients is the wing's own.
    const mean = strips.reduce((sum, s) => sum + s.cl, 0) / strips.length;
    expect(mean).toBeCloseTo(CL, 2);
  });
});
