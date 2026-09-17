import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { AircraftSpec } from '../AircraftSpec';

/**
 * Procedural livery textures.
 *
 * Cabin windows, doors, the cheatline and the cockpit glazing are painted into a canvas
 * rather than modelled, which is what makes the "higher visual detail" affordable: a
 * 737 has about eighty windows a side, and eighty modelled window frames would cost
 * more triangles than the rest of the aeroplane put together while telling the flow
 * solver nothing it can resolve.
 *
 * The fuselage UV runs u around the section (0 starboard, 0.25 top, 0.5 port,
 * 0.75 bottom) and v along the body from nose to tail, so the canvas is laid out with
 * circumference across and length down.
 */

const AROUND = 512;
const ALONG = 2048;

/**
 * Positions of the features that run down each side, measured on the STARBOARD side as
 * a fraction of the way around the section (u = 0 is the starboard equator, u = 0.25 the
 * crown, u = 0.5 the port equator). The port copy is derived by mirroring, never written
 * out by hand.
 */
const WINDOW_U = 0.055;
const WINDOW_SPAN = 0.012;
const STRIPE_U = 0.077;
const STRIPE_SPAN = 0.016;
const DOOR_U = 0.043;
const DOOR_SPAN = 0.05;
/** The upper deck's window line sits above the main one, not below it. */
const UPPER_DECK_U = 0.11;

/**
 * A band on the starboard side and its mirror image on the port side.
 *
 * The section's mirror plane maps u to 0.5 - u, so a band occupying [u, u + span] to
 * starboard must occupy [0.5 - u - span, 0.5 - u] to port. The earlier code added the
 * same offset to both sides instead, which pushed the starboard feature up and the port
 * feature down by the same amount: the cheatline ended up 21.6 degrees out of true,
 * visibly tilting the whole livery when seen head-on.
 */
export function mirroredBand(u: number, span: number): Array<{ u: number; span: number }> {
  return [
    { u, span },
    { u: 0.5 - u - span, span },
  ];
}

/** Pixel x and width on the canvas for a band. */
function bandRect(band: { u: number; span: number }): { x: number; w: number } {
  return { x: band.u * AROUND, w: band.span * AROUND };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paint the fuselage livery.
 *
 * Returns null when there is no DOM, so the geometry builders stay usable in tests and
 * in the worker that voxelises the mesh.
 */
export function buildFuselageTexture(spec: AircraftSpec): Texture | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = AROUND;
  canvas.height = ALONG;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const { livery, fuselage } = spec;

  // Base coat: light over the crown, darker towards the belly. u = 0.75 is the keel.
  const base = ctx.createLinearGradient(0, 0, AROUND, 0);
  base.addColorStop(0.0, livery.fuselage);
  base.addColorStop(0.25, '#ffffff');
  base.addColorStop(0.5, livery.fuselage);
  base.addColorStop(0.72, '#b9c0c8');
  base.addColorStop(0.78, '#aab2bb');
  base.addColorStop(1.0, livery.fuselage);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, AROUND, ALONG);

  const noseEnd = ALONG * 0.1;
  const tailStart = ALONG * 0.88;
  const cabinStart = ALONG * 0.13;
  const cabinEnd = ALONG * 0.86;

  // Cheatline just above the window row, the way most airline schemes are laid out.
  ctx.fillStyle = livery.stripe;
  for (const band of mirroredBand(STRIPE_U, STRIPE_SPAN)) {
    const { x, w } = bandRect(band);
    ctx.fillRect(x, noseEnd * 0.5, w, ALONG - noseEnd * 0.5);
  }

  // Cabin windows. Spacing follows the real seat pitch of about 0.79 m.
  const windowPitchMetres = 0.79;
  const windowCount = Math.floor(((cabinEnd - cabinStart) / ALONG) * fuselage.length / windowPitchMetres);
  const pitch = (cabinEnd - cabinStart) / Math.max(windowCount, 1);
  const windowHeight = pitch * 0.42;

  for (const band of mirroredBand(WINDOW_U, WINDOW_SPAN)) {
    const { x, w } = bandRect(band);
    for (let i = 0; i < windowCount; i++) {
      const y = cabinStart + i * pitch + (pitch - windowHeight) / 2;
      ctx.fillStyle = 'rgba(20, 26, 34, 0.92)';
      roundedRect(ctx, x, y, w, windowHeight, w * 0.35);
      // A thin bright edge reads as the window surround at a distance.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(x, y, w, 1);
    }
  }

  // The A380 carries a second window line for its upper deck; the 747 has one over
  // the forward third only.
  if (fuselage.deck !== 'single') {
    const upperEnd = fuselage.deck === 'full-double' ? cabinEnd : ALONG * 0.36;
    for (const band of mirroredBand(UPPER_DECK_U, WINDOW_SPAN)) {
      const { x, w } = bandRect(band);
      for (let i = 0; i < windowCount; i++) {
        const y = cabinStart + i * pitch + (pitch - windowHeight) / 2;
        if (y > upperEnd) break;
        ctx.fillStyle = 'rgba(20, 26, 34, 0.9)';
        roundedRect(ctx, x, y, w, windowHeight, w * 0.35);
      }
    }
  }

  // Passenger doors, spaced down the cabin.
  const doorCount = fuselage.length > 55 ? 5 : fuselage.length > 40 ? 4 : 3;
  ctx.strokeStyle = 'rgba(40, 48, 58, 0.55)';
  ctx.lineWidth = 2;
  for (const band of mirroredBand(DOOR_U, DOOR_SPAN)) {
    const { x, w } = bandRect(band);
    for (let i = 0; i < doorCount; i++) {
      const t = (i + 0.5) / doorCount;
      const y = cabinStart + (cabinEnd - cabinStart) * t;
      const doorHeight = pitch * 2.1;
      ctx.strokeRect(x, y, w, doorHeight);
    }
  }

  // Cockpit glazing.
  //
  // The panes sit high on the nose, wrapping over the crown rather than sitting on the
  // flanks: u = 0.25 is the top of the section, so the windscreen straddles it and the
  // side windows run down towards u = 0.16 and u = 0.34. Drawn at a small v, which with
  // flipY disabled is the nose.
  ctx.fillStyle = 'rgba(16, 22, 30, 0.95)';
  const cockpitY = noseEnd * 0.5;
  const paneHeight = ALONG * 0.019;
  const CROWN = 0.25;
  for (const side of [-1, 1]) {
    for (let pane = 0; pane < 3; pane++) {
      // Panes march away from the centreline, shrinking and sloping aft as the
      // windscreen wraps round towards the side windows.
      const u = CROWN + side * (0.028 + pane * 0.031);
      const slantBack = pane * paneHeight * 0.42;
      const shrink = pane * paneHeight * 0.14;
      roundedRect(
        ctx,
        u * AROUND - AROUND * 0.013,
        cockpitY + slantBack + shrink * 0.5,
        AROUND * 0.026,
        paneHeight - shrink,
        3,
      );
    }
  }
  // The dark anti-glare panel ahead of the windscreen.
  ctx.fillStyle = 'rgba(34, 40, 48, 0.75)';
  ctx.fillRect(
    (CROWN - 0.1) * AROUND,
    cockpitY - paneHeight * 0.85,
    AROUND * 0.2,
    paneHeight * 0.75,
  );

  // Radome and the unpainted area around the tail cone.
  ctx.fillStyle = 'rgba(70, 78, 88, 0.45)';
  ctx.fillRect(0, 0, AROUND, noseEnd * 0.22);
  ctx.fillStyle = 'rgba(150, 158, 168, 0.3)';
  ctx.fillRect(0, tailStart, AROUND, ALONG - tailStart);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  /**
   * Canvas row 0 is the NOSE.
   *
   * Three.js flips textures vertically by default, which mapped row 0 to v = 1. The
   * fuselage sets v = x / length, so v = 0 is the nose, and everything drawn at the top
   * of this canvas - the radome, the cockpit glazing - came out on the tail of every
   * aircraft in the roster. Disabling the flip lines the canvas up with the body.
   */
  texture.flipY = false;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  return texture;
}
