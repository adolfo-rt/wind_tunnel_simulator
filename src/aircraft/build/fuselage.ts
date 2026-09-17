import { BufferGeometry, Vector3 } from 'three';
import type { AircraftSpec } from '../AircraftSpec';
import { loftRings, superellipseRing, type Ring } from './loft';

/**
 * Fuselage generation.
 *
 * The body is lofted from superellipse rings along the x axis, from a rounded radome
 * at x = 0 to a swept-up tail cone at x = length. Three shape controls carry most of
 * the character:
 *
 *   noseFineness / tailFineness  how drawn-out the cones are. Concorde's nose is over
 *                                five diameters long; a 747's is one and a half.
 *   crossSectionExponent         how square the section is. Widebodies are not circles
 *                                but two arcs blended into an upright oval.
 *   deck                         a single tube, the 747's partial upper deck, or the
 *                                A380's full double deck.
 *
 * The rings are also what the flow solver eventually sees, so the station distribution
 * is denser where curvature is high (nose and tail) and the whole surface is closed.
 */

export interface FuselageSections {
  geometry: BufferGeometry;
  /** Half-height of the body at each station, for placing wings and tail surfaces. */
  halfHeightAt: (x: number) => number;
  /** Half-width of the body at each station, for placing wing roots and pylons. */
  halfWidthAt: (x: number) => number;
  /** Vertical position of the body centreline at each station. */
  centreYAt: (x: number) => number;
  /** Cross-sectional area at each station, used later by the slender-body flow model. */
  areaAt: (x: number) => number;
}

interface Station {
  x: number;
  centreY: number;
  halfWidth: number;
  upperHalfHeight: number;
  lowerHalfHeight: number;
}

/** Smooth 0..1 ramp with zero slope at both ends. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function buildStations(spec: AircraftSpec, count: number): Station[] {
  const f = spec.fuselage;
  const L = f.length;
  const D = f.diameter;

  // Preserve cross-sectional area while letting the section be taller than it is wide.
  const widthScale = Math.sqrt(f.widthRatio);
  const halfWidth0 = (D * widthScale) / 2;
  const halfHeight0 = D / (2 * widthScale);

  let noseLength = f.noseFineness * D;
  let tailLength = f.tailFineness * D;
  // Leave at least a short constant section even for the most drawn-out shapes.
  const maxCones = L * 0.9;
  if (noseLength + tailLength > maxCones) {
    const shrink = maxCones / (noseLength + tailLength);
    noseLength *= shrink;
    tailLength *= shrink;
  }

  // Power-law nose. A low exponent gives the blunt radome of a subsonic airliner;
  // a high one gives Concorde's long slender spike.
  const noseExponent = Math.min(0.92, Math.max(0.42, 0.35 + 0.075 * f.noseFineness));
  const upsweep = Math.tan((f.tailUpsweepDeg * Math.PI) / 180);

  const radiusFraction = (x: number): number => {
    if (x <= noseLength) {
      const t = noseLength > 0 ? x / noseLength : 1;
      return Math.pow(t, noseExponent);
    }
    if (x >= L - tailLength) {
      const s = (x - (L - tailLength)) / tailLength;
      return Math.max(0.05, Math.pow(Math.max(0, 1 - s * s), 0.55));
    }
    return 1;
  };

  const centreY = (x: number): number => {
    let y = 0;
    // The nose droops slightly below the body axis, as on every airliner.
    if (x < noseLength) {
      const t = x / noseLength;
      y -= 0.06 * D * Math.pow(1 - t, 1.5);
    }
    // The rear fuselage sweeps up so the tail clears the runway on rotation.
    if (x > L - tailLength) {
      const s = (x - (L - tailLength)) / tailLength;
      y += upsweep * tailLength * Math.pow(s, 1.7);
    }
    return y;
  };

  // The 747's upper deck: a hump that starts at the cockpit and fades out about a
  // third of the way back.
  const humpMultiplier = (x: number): number => {
    if (spec.fuselage.deck !== 'partial-upper') return 1;
    const rise = smoothstep(0.0, 0.07 * L, x);
    const fall = 1 - smoothstep(0.22 * L, 0.36 * L, x);
    return 1 + 0.42 * rise * fall;
  };

  // Station distribution: dense at the nose and tail where curvature is high.
  const xs: number[] = [];
  const noseCount = Math.round(count * 0.32);
  const tailCount = Math.round(count * 0.34);
  const midCount = count - noseCount - tailCount;
  for (let i = 0; i < noseCount; i++) {
    // Cosine spacing packs stations towards x = 0.
    const t = 1 - Math.cos((i / (noseCount - 1)) * Math.PI * 0.5);
    xs.push(t * noseLength);
  }
  for (let i = 1; i <= midCount; i++) {
    xs.push(noseLength + ((L - tailLength - noseLength) * i) / (midCount + 1));
  }
  for (let i = 0; i < tailCount; i++) {
    const t = Math.sin((i / (tailCount - 1)) * Math.PI * 0.5);
    xs.push(L - tailLength + t * tailLength);
  }

  return xs.map((x) => {
    const r = radiusFraction(x);
    return {
      x,
      centreY: centreY(x),
      halfWidth: halfWidth0 * r,
      upperHalfHeight: halfHeight0 * r * humpMultiplier(x),
      lowerHalfHeight: halfHeight0 * r,
    };
  });
}

/** Linear interpolation of a station property at an arbitrary x. */
function sampleStations(stations: Station[], x: number, pick: (s: Station) => number): number {
  if (x <= stations[0].x) return pick(stations[0]);
  const last = stations[stations.length - 1];
  if (x >= last.x) return pick(last);
  for (let i = 1; i < stations.length; i++) {
    if (stations[i].x >= x) {
      const a = stations[i - 1];
      const b = stations[i];
      const t = (x - a.x) / (b.x - a.x);
      return pick(a) + (pick(b) - pick(a)) * t;
    }
  }
  return pick(last);
}

export function buildFuselage(spec: AircraftSpec, segments = 28, stationCount = 44): FuselageSections {
  const stations = buildStations(spec, stationCount);
  const L = spec.fuselage.length;

  const rings: Ring[] = stations.map((s) => ({
    points: superellipseRing(
      s.x,
      s.centreY,
      Math.max(s.halfWidth, 1e-4),
      Math.max(s.upperHalfHeight, 1e-4),
      Math.max(s.lowerHalfHeight, 1e-4),
      spec.fuselage.crossSectionExponent,
      segments,
    ),
    v: s.x / L,
  }));

  const geometry = loftRings(rings, { closed: true, capStart: true, capEnd: true });

  return {
    geometry,
    halfHeightAt: (x) => sampleStations(stations, x, (s) => s.upperHalfHeight),
    halfWidthAt: (x) => sampleStations(stations, x, (s) => s.halfWidth),
    centreYAt: (x) => sampleStations(stations, x, (s) => s.centreY),
    areaAt: (x) => {
      const halfWidth = sampleStations(stations, x, (s) => s.halfWidth);
      const upper = sampleStations(stations, x, (s) => s.upperHalfHeight);
      const lower = sampleStations(stations, x, (s) => s.lowerHalfHeight);
      // Area of a superellipse, approximated by treating the upper and lower halves
      // as separate half-ellipses. Exact for exponent 2 and close enough above it.
      return (Math.PI * halfWidth * (upper + lower)) / 2;
    },
  };
}

/** Outline of the fuselage in the vertical plane, for quick side-view checks and tests. */
export function fuselageProfile(spec: AircraftSpec, samples = 60): Vector3[] {
  const sections = buildFuselage(spec, 8, samples);
  const points: Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = (spec.fuselage.length * i) / samples;
    points.push(new Vector3(x, sections.centreYAt(x) + sections.halfHeightAt(x), 0));
  }
  return points;
}
