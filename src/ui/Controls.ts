import { meanAerodynamicChord, type AircraftSpec } from '../aircraft/AircraftSpec';
import {
  atmosphereAt,
  KMH_PER_MS,
  kmhToMs,
  machNumber,
  reynoldsNumber,
} from '../core/atmosphere';

/**
 * The tunnel speed control and its readouts.
 *
 * The slider sets a speed, but the numbers underneath are the point. Mach says whether
 * compressibility is in play; Reynolds number says how far the tunnel is from the real
 * thing. Showing Reynolds prominently is deliberate — an airliner at cruise sits near
 * 5e7, and a browser cannot resolve that, so the honest move is to put the number on
 * screen rather than leave the impression that the simulation is the real thing.
 *
 * The tunnel runs at sea level, so the Mach shown is the tunnel's own. "Match cruise
 * Mach" sets the speed that reproduces the aircraft's design cruise Mach here at sea
 * level, which is a slower true airspeed than it flies at altitude because the speed of
 * sound falls with temperature.
 */

export interface ControlsOptions {
  panel: HTMLElement;
  slider: HTMLInputElement;
  value: HTMLElement;
  cruiseButton: HTMLButtonElement;
  readouts: HTMLElement;
  onSpeedChange: (kmh: number) => void;
}

/** The tunnel's own conditions. A ground-level tunnel, not the cruise environment. */
const TUNNEL_CONDITIONS = atmosphereAt(0);

export class Controls {
  private spec: AircraftSpec | null = null;
  private speedKmh: number;
  private rpm = 0;
  private rows = new Map<string, HTMLElement>();
  private lastPaint = 0;

  constructor(private options: ControlsOptions) {
    this.speedKmh = Number(options.slider.value);

    options.slider.addEventListener('input', () => {
      this.speedKmh = Number(options.slider.value);
      this.paintSpeed();
      this.options.onSpeedChange(this.speedKmh);
    });

    options.cruiseButton.addEventListener('click', () => {
      if (!this.spec) return;
      this.setSpeed(Math.min(this.cruiseSpeedKmh(), Number(options.slider.max)));
      this.options.onSpeedChange(this.speedKmh);
    });

    this.buildRows();
    this.paintSpeed();
  }

  private buildRows(): void {
    const labels = ['Airspeed', 'Mach, tunnel', 'Design cruise', 'Reynolds', 'Fan speed'];
    const fragment = document.createDocumentFragment();
    for (const label of labels) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = '—';
      this.rows.set(label, dd);
      fragment.append(dt, dd);
    }
    this.options.readouts.replaceChildren(fragment);
  }

  setAircraft(spec: AircraftSpec): void {
    this.spec = spec;
    this.options.panel.hidden = false;

    // Concorde cruises at Mach 2.02, which needs about 2,470 km/h at sea level and is
    // well past this tunnel's range. Say so rather than clamping quietly.
    const reachable = this.cruiseSpeedKmh() <= Number(this.options.slider.max);
    this.options.cruiseButton.disabled = !reachable;
    this.options.cruiseButton.title = reachable
      ? `Run the tunnel at Mach ${spec.cruiseMach.toFixed(2)}, this aircraft's design cruise Mach`
      : `Mach ${spec.cruiseMach.toFixed(2)} needs ${Math.round(this.cruiseSpeedKmh()).toLocaleString()} km/h at sea level, beyond this tunnel`;
    this.paintSpeed();
  }

  /**
   * Speed that reproduces the aircraft's design cruise Mach in the tunnel.
   *
   * Slower than the true airspeed it actually cruises at, because the tunnel is at sea
   * level and the speed of sound falls with temperature: the same Mach number is about
   * 15 per cent slower down here than at the tropopause.
   */
  private cruiseSpeedKmh(): number {
    if (!this.spec) return 0;
    return this.spec.cruiseMach * TUNNEL_CONDITIONS.speedOfSound * KMH_PER_MS;
  }

  setSpeed(kmh: number): void {
    this.speedKmh = kmh;
    this.options.slider.value = String(kmh);
    this.paintSpeed();
  }

  get speed(): number {
    return this.speedKmh;
  }

  /** Fan speed changes every frame; the readouts do not need to. */
  setRpm(rpm: number, elapsedSeconds: number): void {
    this.rpm = rpm;
    if (elapsedSeconds - this.lastPaint < 0.1) return;
    this.lastPaint = elapsedSeconds;
    this.paintSpeed();
  }

  private paintSpeed(): void {
    const ms = kmhToMs(this.speedKmh);
    this.options.value.textContent = String(Math.round(this.speedKmh));

    const mach = machNumber(ms, TUNNEL_CONDITIONS);
    this.set('Airspeed', `${ms.toFixed(0)} m/s`);
    this.set('Mach, tunnel', mach.toFixed(3));
    this.set('Fan speed', `${Math.round(this.rpm)} rpm`);

    if (this.spec) {
      const chord = meanAerodynamicChord(this.spec);
      const re = reynoldsNumber(ms, chord, TUNNEL_CONDITIONS);
      this.set('Reynolds', re > 0 ? formatReynolds(re) : '—');
      this.set('Design cruise', `Mach ${this.spec.cruiseMach.toFixed(2)}`);
    } else {
      this.set('Reynolds', '—');
      this.set('Design cruise', '—');
    }
  }

  private set(label: string, text: string): void {
    const cell = this.rows.get(label);
    if (cell) cell.textContent = text;
  }
}

/** Reynolds numbers run to tens of millions, so plain digits are unreadable. */
function formatReynolds(re: number): string {
  const exponent = Math.floor(Math.log10(re));
  const mantissa = re / Math.pow(10, exponent);
  return `${mantissa.toFixed(1)} × 10${superscript(exponent)}`;
}

function superscript(n: number): string {
  const digits = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  return String(n)
    .split('')
    .map((c) => (c >= '0' && c <= '9' ? digits[Number(c)] : c))
    .join('');
}
