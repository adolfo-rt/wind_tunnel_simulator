import { describe, it, expect } from 'vitest';
import { ROSTER, rosterByDecade, specById } from '../src/aircraft/roster';
import { aspectRatio, taperRatio, meanAerodynamicChord } from '../src/aircraft/AircraftSpec';

describe('roster integrity', () => {
  it('has a useful spread of aircraft', () => {
    expect(ROSTER.length).toBeGreaterThanOrEqual(18);
  });

  it('uses unique ids', () => {
    const ids = ROSTER.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is ordered by first flight year', () => {
    for (let i = 1; i < ROSTER.length; i++) {
      expect(ROSTER[i].firstFlightYear).toBeGreaterThanOrEqual(ROSTER[i - 1].firstFlightYear);
    }
  });

  it('spans the jet age from the Comet to the present', () => {
    expect(ROSTER[0].firstFlightYear).toBeLessThanOrEqual(1950);
    expect(ROSTER[ROSTER.length - 1].firstFlightYear).toBeGreaterThanOrEqual(2013);
  });

  it('covers both major manufacturers plus others', () => {
    const makers = new Set(ROSTER.map((s) => s.manufacturer));
    expect([...makers].some((m) => m.includes('Boeing'))).toBe(true);
    expect([...makers].some((m) => m.includes('Airbus'))).toBe(true);
    expect(makers.size).toBeGreaterThanOrEqual(5);
  });
});

describe('aircraft geometry is physically plausible', () => {
  it.each(ROSTER.map((s) => [s.id, s] as const))('%s has sane proportions', (_id, spec) => {
    const { fuselage: f, wing: w, tail: t, reference: r } = spec;

    expect(f.length).toBeGreaterThan(20);
    expect(f.length).toBeLessThan(80);
    // Fuselage fineness ratio: airliners sit between about 7 and 13.
    expect(f.length / f.diameter).toBeGreaterThan(6);
    expect(f.length / f.diameter).toBeLessThan(25);

    expect(w.tipChord).toBeLessThan(w.rootChord);
    expect(taperRatio(spec)).toBeGreaterThan(0.03);
    expect(taperRatio(spec)).toBeLessThan(0.6);
    // Washout: tips are twisted nose-down so the root stalls first.
    expect(w.twistDeg).toBeLessThanOrEqual(0);
    expect(w.thicknessTipRatio).toBeLessThanOrEqual(w.thicknessRootRatio);
    expect(w.rootStationFrac).toBeGreaterThan(0.2);
    expect(w.rootStationFrac).toBeLessThan(0.6);

    expect(r.cruiseMassKg).toBeLessThan(r.mtowKg);
    expect(r.seatsTypical).toBeGreaterThan(30);

    for (const station of spec.engines.spanStations) {
      expect(station).toBeGreaterThan(0);
      expect(station).toBeLessThan(1);
    }

    if (t.config === 'delta') {
      expect(t.hStabSpan).toBe(0);
    } else {
      // A conventional tailplane is roughly a third of the wing span.
      expect(t.hStabSpan / w.span).toBeGreaterThan(0.2);
      expect(t.hStabSpan / w.span).toBeLessThan(0.5);
    }
  });

  it('gives subsonic airliners aspect ratios in the expected band', () => {
    for (const spec of ROSTER) {
      if (spec.cruiseMach > 1) continue;
      expect(aspectRatio(spec)).toBeGreaterThan(6);
      expect(aspectRatio(spec)).toBeLessThan(11);
    }
  });

  it('gives Concorde a very low aspect ratio, as a slender delta must have', () => {
    const concorde = specById('concorde');
    expect(concorde).toBeDefined();
    expect(aspectRatio(concorde!)).toBeLessThan(3);
    expect(concorde!.cruiseMach).toBeGreaterThan(1.8);
  });

  it('has chord values consistent with the published wing area', () => {
    for (const spec of ROSTER) {
      const trapezoidArea = (spec.wing.span * (spec.wing.rootChord + spec.wing.tipChord)) / 2;
      const ratio = trapezoidArea / spec.reference.wingAreaM2;
      // Real wings have kinks, fillets and a carry-through section, so an exact match
      // is not expected; a gross mismatch means a data-entry error.
      expect(ratio).toBeGreaterThan(0.85);
      expect(ratio).toBeLessThan(1.15);
    }
  });

  it('produces a mean aerodynamic chord between the tip and root chords', () => {
    for (const spec of ROSTER) {
      const mac = meanAerodynamicChord(spec);
      expect(mac).toBeGreaterThan(spec.wing.tipChord);
      expect(mac).toBeLessThan(spec.wing.rootChord);
    }
  });
});

describe('the efficiency story the roster is meant to tell', () => {
  it('shows published lift-to-drag improving across the jet age', () => {
    const subsonic = ROSTER.filter((s) => s.cruiseMach < 1);
    const early = subsonic.filter((s) => s.firstFlightYear < 1970);
    const modern = subsonic.filter((s) => s.firstFlightYear >= 2000);
    const mean = (xs: typeof ROSTER) => xs.reduce((a, s) => a + s.reference.cruiseLD, 0) / xs.length;
    expect(mean(modern)).toBeGreaterThan(mean(early) + 3);
  });

  it('shows published engine fuel consumption falling across the jet age', () => {
    const early = ROSTER.filter((s) => s.firstFlightYear < 1970 && s.cruiseMach < 1);
    const modern = ROSTER.filter((s) => s.firstFlightYear >= 2000);
    const mean = (xs: typeof ROSTER) => xs.reduce((a, s) => a + s.reference.tsfcCruise, 0) / xs.length;
    expect(mean(modern)).toBeLessThan(mean(early) * 0.75);
  });

  it('gives every aircraft an innovation note', () => {
    for (const spec of ROSTER) {
      expect(spec.innovation.length).toBeGreaterThan(40);
    }
  });
});

describe('rosterByDecade', () => {
  it('groups every aircraft exactly once, in chronological order', () => {
    const groups = rosterByDecade();
    const total = groups.reduce((n, g) => n + g.aircraft.length, 0);
    expect(total).toBe(ROSTER.length);
    const decades = groups.map((g) => parseInt(g.decade, 10));
    expect([...decades].sort((a, b) => a - b)).toEqual(decades);
  });

  it('starts in the 1940s with the Comet', () => {
    const groups = rosterByDecade();
    expect(groups[0].decade).toBe('1940s');
    expect(groups[0].aircraft[0].id).toBe('comet1');
  });
});
