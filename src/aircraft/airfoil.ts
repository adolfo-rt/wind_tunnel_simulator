/**
 * Airfoil section generation.
 *
 * Wings in this simulator are lofted from genuine airfoil coordinates rather than
 * from flat wedges. That matters: the pressure distribution the solver produces is
 * only meaningful if the leading-edge radius, the thickness distribution and the
 * camber line are the real ones. The three families below cover the eras in the
 * roster:
 *
 *   naca4         - classic 4-digit section, front-loaded camber (1940s-50s wings)
 *   peaky         - "peaky" sections of the early jet age, camber pulled aft a little
 *   supercritical - flattened upper surface, blunt nose, strong aft camber. Delays
 *                   the shock that forms on a swept wing at high subsonic Mach, which
 *                   is precisely the innovation that let later airliners cruise faster
 *                   and thinner-winged for the same drag.
 */

export type AirfoilFamily = 'naca4' | 'peaky' | 'supercritical';

export interface AirfoilOptions {
  /** Maximum thickness as a fraction of chord, e.g. 0.12 for a 12% section. */
  thickness: number;
  /** Maximum camber as a fraction of chord. 0 gives a symmetric section. */
  camber: number;
  family: AirfoilFamily;
  /** Number of points per surface. The full contour has 2*resolution - 1 points. */
  resolution?: number;
  /** Close the trailing edge exactly (true) or leave the real finite-thickness TE. */
  closedTrailingEdge?: boolean;
}

export interface AirfoilPoint {
  x: number;
  y: number;
}

/**
 * NACA 4-digit half-thickness distribution.
 * The final coefficient is -0.1015 for the original (open) trailing edge and
 * -0.1036 for a mathematically closed one.
 */
export function nacaThickness(x: number, thickness: number, closedTrailingEdge = true): number {
  const a4 = closedTrailingEdge ? -0.1036 : -0.1015;
  const sx = Math.sqrt(Math.max(x, 0));
  return (
    5 *
    thickness *
    (0.2969 * sx - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x + a4 * x * x * x * x)
  );
}

/** Camber line height and slope at station x (0..1) for a given family. */
function camberLine(
  x: number,
  camber: number,
  family: AirfoilFamily,
): { y: number; dydx: number } {
  if (camber === 0) return { y: 0, dydx: 0 };

  if (family === 'supercritical') {
    // Aft-loaded camber: almost flat over the forward half, curving down towards the
    // trailing edge. Shape function x^2 * (1 - x), normalised so its peak equals `camber`.
    // Peak of x^2(1-x) is at x = 2/3 with value 4/27.
    const k = camber / (4 / 27);
    return { y: k * x * x * (1 - x), dydx: k * (2 * x - 3 * x * x) };
  }

  // Standard NACA mean line with the point of maximum camber at p.
  const p = family === 'peaky' ? 0.5 : 0.4;
  if (x < p) {
    const c = camber / (p * p);
    return { y: c * (2 * p * x - x * x), dydx: c * (2 * p - 2 * x) };
  }
  const c = camber / ((1 - p) * (1 - p));
  return { y: c * (1 - 2 * p + 2 * p * x - x * x), dydx: c * (2 * p - 2 * x) };
}

/**
 * Generate a closed airfoil contour.
 *
 * Points run from the trailing edge forward along the upper surface to the leading
 * edge, then back along the lower surface to the trailing edge. Cosine spacing packs
 * points near the leading edge where curvature (and the pressure peak) is greatest.
 */
export function generateAirfoil(options: AirfoilOptions): AirfoilPoint[] {
  const { thickness, camber, family } = options;
  const resolution = options.resolution ?? 48;
  const closedTE = options.closedTrailingEdge ?? true;

  // Supercritical sections have a noticeably blunter nose for the same thickness.
  const leBlunting = family === 'supercritical' ? 1.18 : 1.0;

  const upper: AirfoilPoint[] = [];
  const lower: AirfoilPoint[] = [];

  for (let i = 0; i < resolution; i++) {
    const beta = (Math.PI * i) / (resolution - 1);
    const x = 0.5 * (1 - Math.cos(beta));

    let yt = nacaThickness(x, thickness, closedTE);
    if (leBlunting !== 1 && x < 0.15) {
      // Blend the extra nose radius in over the forward 15% of the chord.
      const blend = 1 - x / 0.15;
      yt *= 1 + (leBlunting - 1) * blend * blend;
    }

    const { y: yc, dydx } = camberLine(x, camber, family);
    const theta = Math.atan(dydx);
    const sin = Math.sin(theta);
    const cos = Math.cos(theta);

    upper.push({ x: x - yt * sin, y: yc + yt * cos });
    lower.push({ x: x + yt * sin, y: yc - yt * cos });
  }

  // Trailing edge -> upper surface -> leading edge -> lower surface -> trailing edge.
  const contour: AirfoilPoint[] = [];
  for (let i = resolution - 1; i >= 0; i--) contour.push(upper[i]);
  for (let i = 1; i < resolution; i++) contour.push(lower[i]);
  return contour;
}

/** Cross-sectional area of a section of unit chord, by the shoelace formula. */
export function airfoilArea(contour: AirfoilPoint[]): number {
  let area = 0;
  for (let i = 0; i < contour.length; i++) {
    const a = contour[i];
    const b = contour[(i + 1) % contour.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}
