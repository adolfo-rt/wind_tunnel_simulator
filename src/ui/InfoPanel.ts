import { aspectRatio, type AircraftSpec } from '../aircraft/AircraftSpec';

/**
 * The card describing the selected aircraft.
 *
 * Everything shown here is a published figure, and the card says so. Once the solver
 * lands, simulated quantities appear in their own panel with their own labelling, so
 * it is always obvious which numbers the app worked out and which it looked up.
 */

interface Elements {
  panel: HTMLElement;
  year: HTMLElement;
  name: HTMLElement;
  maker: HTMLElement;
  innovation: HTMLElement;
  stats: HTMLElement;
}

export class InfoPanel {
  constructor(private elements: Elements) {}

  show(spec: AircraftSpec): void {
    const { elements } = this;
    elements.year.textContent = `First flight ${spec.firstFlightYear}`;
    elements.name.textContent = spec.model;
    elements.maker.textContent = spec.manufacturer;
    elements.innovation.textContent = spec.innovation;

    const rows: Array<[string, string]> = [
      ['Length', `${spec.fuselage.length.toFixed(1)} m`],
      ['Wingspan', `${spec.reference.spanOverallM.toFixed(1)} m`],
      ['Wing area', `${spec.reference.wingAreaM2.toFixed(0)} m²`],
      ['Aspect ratio', aspectRatio(spec).toFixed(2)],
      ['Sweep', `${spec.wing.sweepQuarterChordDeg.toFixed(1)}°`],
      ['Engines', `${spec.engines.count} × ${describeEngine(spec)}`],
      ['Seats, typical', String(spec.reference.seatsTypical)],
      ['Cruise', `Mach ${spec.cruiseMach.toFixed(2)}`],
      ['Range', `${spec.reference.rangeKm.toLocaleString()} km`],
      ['Lift / drag', spec.reference.cruiseLD.toFixed(1)],
    ];

    const fragment = document.createDocumentFragment();
    for (const [label, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      fragment.append(dt, dd);
    }
    elements.stats.replaceChildren(fragment);
    elements.panel.hidden = false;
  }
}

function describeEngine(spec: AircraftSpec): string {
  switch (spec.engines.type) {
    case 'turbojet':
      return 'turbojet';
    case 'low-bypass':
      return `turbofan, BPR ${spec.engines.bypassRatio.toFixed(1)}`;
    case 'high-bypass':
      return `high-bypass, BPR ${spec.engines.bypassRatio.toFixed(1)}`;
    case 'ultra-high-bypass':
      return `high-bypass, BPR ${spec.engines.bypassRatio.toFixed(1)}`;
  }
}
