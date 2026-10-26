import type { AircraftSpec } from '../aircraft/AircraftSpec';
import { specById } from '../aircraft/roster';
import { CRUISE_DATASET, cruiseDatumFor, type CruiseDatum } from '../physics/performance/cruiseDataset';

/**
 * Stage 8: what the aircraft costs to fly, and how that changed over seventy years.
 *
 * The panel is a sheet rather than another card in the corner, because the chart it
 * carries is the point of the whole project and a chart squeezed into 300 pixels is a
 * decoration. It opens over the tunnel and closes again.
 *
 * Every figure is labelled by where it came from. There are three kinds and they are not
 * interchangeable:
 *
 *   simulated - the vortex lattice solved it, trimmed to this aircraft's cruise weight
 *   derived   - a published correlation turned it into drag, because an inviscid method
 *               cannot produce skin friction or wave drag
 *   published - a book figure, shown for comparison and never adjusted to agree
 *
 * The roster figures are precomputed (see `cruiseDataset.ts`) because a trimmed solve is
 * about a second and a half and the chart needs all twenty-one at once. They come from
 * the same code path the application runs, and a test recomputes the lot on every run.
 */

/* Validated against the panel surface #161b23 in dark mode: lightness band, chroma
 * floor, adjacent CVD separation (worst 9.4), normal-vision separation (worst 26.5)
 * and contrast all pass. Do not re-pick these by eye. */
const SERIES = {
  induced: '#3987e5',
  parasite: '#d95926',
  wave: '#199e70',
};

/*
 * The chart is an emphasis form, not a categorical one: one aircraft in the accent and
 * the rest as context. The de-emphasis grey is deliberately chromaless, which is the one
 * categorical check it is meant to fail - what matters for an emphasis pair is that the
 * two separate, and they do (CVD dE 18.9, normal-vision 19.8, both over 3:1 on surface).
 */
const EMPHASIS = '#4da3ff';
const CONTEXT = '#6b7583';

const SURFACE = '#161b23';

interface Elements {
  panel: HTMLElement;
  openButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  title: HTMLElement;
  body: HTMLElement;
}

export interface AnalysisPanelOptions extends Elements {
  /** Selecting an aircraft from the chart changes the one in the tunnel. */
  onSelect: (spec: AircraftSpec) => void;
}

export class AnalysisPanel {
  private current: AircraftSpec | null = null;
  private asTable = false;

  constructor(private options: AnalysisPanelOptions) {
    options.openButton.addEventListener('click', () => this.toggle());
    options.closeButton.addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !options.panel.hidden) this.close();
    });
  }

  show(spec: AircraftSpec): void {
    this.current = spec;
    if (!this.options.panel.hidden) this.render();
  }

  private toggle(): void {
    if (this.options.panel.hidden) this.open();
    else this.close();
  }

  private open(): void {
    this.options.panel.hidden = false;
    this.options.openButton.setAttribute('aria-expanded', 'true');
    this.render();
  }

  private close(): void {
    this.options.panel.hidden = true;
    this.options.openButton.setAttribute('aria-expanded', 'false');
    this.options.openButton.focus();
  }

  private render(): void {
    const spec = this.current;
    if (!spec) return;
    const datum = cruiseDatumFor(spec.id);
    this.options.title.textContent = `${spec.manufacturer} ${spec.model}`;

    const body = document.createElement('div');
    body.className = 'analysis-body';

    if (!datum || !datum.applicable) {
      body.append(notEstimated(datum));
    } else {
      body.append(statRow(datum));
    }
    body.append(this.chartSection(spec));
    if (datum && datum.applicable) body.append(dragSection(datum));
    body.append(provenance());
    this.options.body.replaceChildren(body);
  }

  private chartSection(spec: AircraftSpec): HTMLElement {
    const section = document.createElement('section');
    section.className = 'analysis-section';

    const head = document.createElement('div');
    head.className = 'analysis-section-head';
    const heading = document.createElement('h3');
    heading.textContent = 'Fuel per seat, across the eras';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'chip chip-small';
    toggle.textContent = this.asTable ? 'Show chart' : 'Show table';
    toggle.addEventListener('click', () => {
      this.asTable = !this.asTable;
      this.render();
    });
    head.append(heading, toggle);

    const caption = document.createElement('p');
    caption.className = 'analysis-caption';
    caption.textContent =
      'Kilograms of fuel to carry one seat one hundred kilometres at cruise, against the ' +
      'year the type first flew. Lower is better. Each point is one aircraft; the ' +
      'highlighted one is in the tunnel. Click a point to load it.';

    section.append(head, caption);
    section.append(this.asTable ? fuelTable(spec) : this.fuelChart(spec));
    return section;
  }

  private fuelChart(spec: AircraftSpec): HTMLElement {
    const points = CRUISE_DATASET.filter((d) => d.applicable);
    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';

    const width = 720;
    const height = 300;
    // The top padding carries the unit label clear of the topmost tick, which it used to
    // sit on top of.
    const pad = { top: 30, right: 20, bottom: 34, left: 52 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const years = points.map((d) => d.year);
    const minYear = Math.min(...years) - 3;
    const maxYear = Math.max(...years) + 3;
    // Round the top of the scale up to a whole tick, so the axis actually contains the
    // data instead of leaving the worst aircraft floating above the last gridline.
    const largest = Math.max(...points.map((d) => d.fuelPerSeat100km));
    const step = tickStep(largest);
    const maxFuel = Math.ceil(largest / step) * step;

    const x = (year: number) => pad.left + ((year - minYear) / (maxYear - minYear)) * plotW;
    const y = (fuel: number) => pad.top + plotH - (fuel / maxFuel) * plotH;

    const svg = el('svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'fuel-chart');
    svg.setAttribute('role', 'img');
    svg.setAttribute(
      'aria-label',
      `Fuel per seat per hundred kilometres against first flight year, ${points.length} aircraft. ` +
        'A table of the same figures is available from the Show table button.',
    );

    // Recessive gridlines, horizontal only: the reading is vertical.
    const ticks = gridTicks(maxFuel);
    for (const value of ticks) {
      const line = el('line');
      line.setAttribute('x1', String(pad.left));
      line.setAttribute('x2', String(width - pad.right));
      line.setAttribute('y1', String(y(value)));
      line.setAttribute('y2', String(y(value)));
      line.setAttribute('class', 'chart-grid');
      svg.appendChild(line);

      const label = el('text');
      label.setAttribute('x', String(pad.left - 10));
      label.setAttribute('y', String(y(value) + 4));
      label.setAttribute('class', 'chart-axis-label');
      label.setAttribute('text-anchor', 'end');
      label.textContent = String(value);
      svg.appendChild(label);
    }

    const unit = el('text');
    unit.setAttribute('x', String(pad.left - 42));
    unit.setAttribute('y', '12');
    unit.setAttribute('class', 'chart-axis-label');
    unit.setAttribute('text-anchor', 'start');
    unit.textContent = 'kg per seat / 100 km';
    svg.appendChild(unit);

    for (const decade of decadeTicks(minYear, maxYear)) {
      const label = el('text');
      label.setAttribute('x', String(x(decade)));
      label.setAttribute('y', String(height - 12));
      label.setAttribute('class', 'chart-axis-label');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = String(decade);
      svg.appendChild(label);
    }

    // Context first, emphasis last, so the selected mark is never overdrawn.
    const ordered = [...points].sort((a, b) =>
      a.id === spec.id ? 1 : b.id === spec.id ? -1 : 0,
    );
    for (const point of ordered) {
      const selected = point.id === spec.id;
      const dot = el('circle');
      dot.setAttribute('cx', String(x(point.year)));
      dot.setAttribute('cy', String(y(point.fuelPerSeat100km)));
      dot.setAttribute('r', selected ? '7' : '5');
      dot.setAttribute('fill', selected ? EMPHASIS : CONTEXT);
      // A 2px ring in the surface colour, so overlapping points stay countable.
      dot.setAttribute('stroke', SURFACE);
      dot.setAttribute('stroke-width', '2');
      dot.setAttribute('class', selected ? 'chart-dot chart-dot-on' : 'chart-dot');
      dot.setAttribute('tabindex', '0');
      dot.setAttribute('role', 'button');

      const named = specById(point.id);
      const title = el('title');
      title.textContent =
        `${named ? `${named.manufacturer} ${named.model}` : point.id} (${point.year}): ` +
        `${point.fuelPerSeat100km.toFixed(2)} kg per seat per 100 km`;
      dot.appendChild(title);

      const load = () => {
        if (named && !selected) this.options.onSelect(named);
      };
      dot.addEventListener('click', load);
      dot.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          load();
        }
      });
      svg.appendChild(dot);
    }

    // The selected aircraft is direct-labelled; nothing else is, or the chart is a wall
    // of text. Flipped to the left near the right edge so it cannot run off.
    const chosen = points.find((d) => d.id === spec.id);
    if (chosen) {
      const cx = x(chosen.year);
      const flip = cx > width - 140;
      const label = el('text');
      label.setAttribute('x', String(cx + (flip ? -12 : 12)));
      label.setAttribute('y', String(y(chosen.fuelPerSeat100km) - 10));
      label.setAttribute('text-anchor', flip ? 'end' : 'start');
      label.setAttribute('class', 'chart-direct-label');
      label.textContent = `${spec.model} · ${chosen.fuelPerSeat100km.toFixed(2)} kg`;
      svg.appendChild(label);
    }

    wrap.appendChild(svg);
    return wrap;
  }
}

/* ---- pieces ------------------------------------------------------------ */

function el(tag: string): SVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function tickStep(largest: number): number {
  return largest <= 4 ? 1 : largest <= 12 ? 2 : 5;
}

function gridTicks(max: number): number[] {
  const step = tickStep(max);
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function decadeTicks(min: number, max: number): number[] {
  const ticks: number[] = [];
  for (let year = Math.ceil(min / 10) * 10; year <= max; year += 10) ticks.push(year);
  return ticks;
}

/** The headline numbers. Stat tiles, not a one-bar bar chart. */
function statRow(datum: CruiseDatum): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stat-row';

  const error = (datum.liftToDrag - datum.publishedLiftToDrag) / datum.publishedLiftToDrag;
  const tiles: Array<[string, string, string, string]> = [
    [
      datum.fuelPerSeat100km.toFixed(2),
      'kg fuel per seat per 100 km',
      'derived',
      'Drag times specific fuel consumption, divided by seats.',
    ],
    [
      datum.liftToDrag.toFixed(1),
      `lift / drag · published ${datum.publishedLiftToDrag.toFixed(1)}`,
      'derived',
      `${error >= 0 ? '+' : '−'}${Math.abs(100 * error).toFixed(0)}% against the book figure.`,
    ],
    [
      datum.spanEfficiency.toFixed(3),
      'span efficiency',
      'simulated',
      'From the trimmed wake in the Trefftz plane. Uncertain by about ±0.03 at this lattice resolution.',
    ],
    [
      `${datum.angleDeg.toFixed(1)}°`,
      `angle of attack · stabiliser ${datum.stabiliserDeg.toFixed(1)}°`,
      'simulated',
      `Trimmed: lift equals weight and no pitching moment is left over. The tail carries ${(
        100 * Math.abs(datum.tailLiftFraction)
      ).toFixed(1)}% of the weight ${datum.tailLiftFraction < 0 ? 'downward' : 'upward'}.`,
    ],
  ];

  for (const [value, label, kind, note] of tiles) {
    const tile = document.createElement('div');
    tile.className = 'stat-tile';
    tile.title = note;

    const v = document.createElement('div');
    v.className = 'stat-value';
    v.textContent = value;

    const l = document.createElement('div');
    l.className = 'stat-label';
    l.textContent = label;

    tile.append(v, l, tag(kind));
    row.appendChild(tile);
  }
  return row;
}

/** Where the drag goes: one stacked bar, then the parasite split as a table. */
function dragSection(datum: CruiseDatum): HTMLElement {
  const section = document.createElement('section');
  section.className = 'analysis-section';

  const heading = document.createElement('h3');
  heading.textContent = 'Where the drag goes';
  section.appendChild(heading);

  const segments: Array<[string, number, string, string]> = [
    ['Induced', datum.induced, SERIES.induced, 'simulated'],
    ['Parasite', datum.parasite, SERIES.parasite, 'derived'],
    ['Wave', datum.wave, SERIES.wave, 'derived'],
  ];
  const total = datum.totalDrag || 1;

  const bar = document.createElement('div');
  bar.className = 'drag-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute(
    'aria-label',
    segments
      .map(([name, force]) => `${name} ${((100 * force) / total).toFixed(0)}%`)
      .join(', '),
  );
  for (const [name, force, colour] of segments) {
    const share = force / total;
    if (share <= 0.0005) continue;
    const piece = document.createElement('div');
    piece.className = 'drag-piece';
    piece.style.flexGrow = String(share);
    piece.style.background = colour;
    piece.title = `${name}: ${Math.round(force).toLocaleString()} N, ${(100 * share).toFixed(1)}% of cruise drag`;
    // Big enough to carry its own number, or it stays blank and the legend says it.
    if (share > 0.12) {
      const text = document.createElement('span');
      text.textContent = `${(100 * share).toFixed(0)}%`;
      piece.appendChild(text);
    }
    bar.appendChild(piece);
  }
  section.appendChild(bar);

  const legend = document.createElement('ul');
  legend.className = 'chart-legend';
  for (const [name, force, colour, kind] of segments) {
    const item = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = colour;
    const text = document.createElement('span');
    text.textContent = `${name} — ${(100 * force / total).toFixed(1)}%`;
    item.append(swatch, text, tag(kind));
    legend.appendChild(item);
  }
  section.appendChild(legend);

  const caption = document.createElement('p');
  caption.className = 'analysis-caption';
  caption.textContent =
    `Total cruise drag ${Math.round(datum.totalDrag).toLocaleString()} N over ` +
    `${Math.round(datum.wettedAreaM2).toLocaleString()} m² of wetted area. ` +
    (datum.wave > 0
      ? `Drag divergence begins at Mach ${datum.divergenceMach.toFixed(3)}, which this aircraft is flying past.`
      : `Drag divergence begins at Mach ${datum.divergenceMach.toFixed(3)}, which this aircraft stays below.`);
  section.appendChild(caption);

  const table = document.createElement('table');
  table.className = 'analysis-table';
  table.innerHTML =
    '<caption>Parasite drag by component — derived from wetted area measured off the ' +
    'aircraft’s own mesh</caption>' +
    '<thead><tr><th scope="col">Component</th><th scope="col">Force</th>' +
    '<th scope="col">Share of cruise drag</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const part of datum.parasiteParts) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.setAttribute('scope', 'row');
    th.textContent = partName(part.name);
    const force = document.createElement('td');
    force.textContent = `${Math.round(part.force).toLocaleString()} N`;
    const share = document.createElement('td');
    share.textContent = `${((100 * part.force) / total).toFixed(1)}%`;
    tr.append(th, force, share);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  section.appendChild(table);

  return section;
}

function partName(name: string): string {
  switch (name) {
    case 'other':
      return 'Pylons and fairings';
    case 'leakage':
      return 'Leakage and protuberances';
    case 'fin':
      return 'Fin';
    case 'tailplane':
      return 'Tailplane';
    default:
      return name.charAt(0).toUpperCase() + name.slice(1);
  }
}

/** The chart's data, for anyone who would rather read it than look at it. */
function fuelTable(spec: AircraftSpec): HTMLElement {
  const table = document.createElement('table');
  table.className = 'analysis-table';
  table.innerHTML =
    '<thead><tr><th scope="col">Aircraft</th><th scope="col">First flight</th>' +
    '<th scope="col">Fuel per seat per 100 km</th><th scope="col">Lift / drag</th>' +
    '<th scope="col">Published</th></tr></thead>';
  const tbody = document.createElement('tbody');
  for (const datum of CRUISE_DATASET) {
    const named = specById(datum.id);
    const tr = document.createElement('tr');
    if (datum.id === spec.id) tr.className = 'is-current';
    const th = document.createElement('th');
    th.setAttribute('scope', 'row');
    th.textContent = named ? `${named.manufacturer} ${named.model}` : datum.id;
    const year = document.createElement('td');
    year.textContent = String(datum.year);
    const fuel = document.createElement('td');
    const ld = document.createElement('td');
    const pub = document.createElement('td');
    if (datum.applicable) {
      fuel.textContent = `${datum.fuelPerSeat100km.toFixed(2)} kg`;
      ld.textContent = datum.liftToDrag.toFixed(1);
    } else {
      fuel.textContent = 'not estimated';
      ld.textContent = '—';
    }
    pub.textContent = datum.publishedLiftToDrag.toFixed(1);
    tr.append(th, year, fuel, ld, pub);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function notEstimated(datum: CruiseDatum | undefined): HTMLElement {
  const note = document.createElement('p');
  note.className = 'analysis-limitation';
  note.textContent =
    datum?.limitation ??
    'No cruise estimate for this aircraft. Rebuild the dataset with `npm run dataset`.';
  return note;
}

function tag(kind: string): HTMLElement {
  const span = document.createElement('span');
  span.className = `provenance provenance-${kind}`;
  span.textContent = kind;
  return span;
}

function provenance(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'analysis-section analysis-provenance';
  const heading = document.createElement('h3');
  heading.textContent = 'Where these numbers come from';
  const list = document.createElement('dl');
  const rows: Array<[string, string]> = [
    [
      'simulated',
      'Solved here. The vortex lattice is trimmed to this aircraft’s cruise weight ' +
        'with no pitching moment left over, and the wake integrated in the Trefftz plane.',
    ],
    [
      'derived',
      'Published correlations applied to simulated or measured quantities. Skin friction ' +
        'over the wetted area of the actual mesh, with form and interference factors; ' +
        'wave drag from the drag-divergence Mach. An inviscid method cannot produce either.',
    ],
    [
      'published',
      'Book figures — mass, seats, fuel consumption, wing area. Never adjusted to improve ' +
        'agreement.',
    ],
  ];
  for (const [kind, text] of rows) {
    const dt = document.createElement('dt');
    dt.appendChild(tag(kind));
    const dd = document.createElement('dd');
    dd.textContent = text;
    list.append(dt, dd);
  }
  const caveat = document.createElement('p');
  caveat.className = 'analysis-caption';
  caveat.textContent =
    'Mean error against published lift-to-drag is 7.4% across the roster. Aircraft from ' +
    'the 1980s on land within a few per cent; the 1950s types read 12 to 24% high, ' +
    'because the model gives every airframe a modern skin and does not carry the ' +
    'excrescence drag of a riveted one. That is an omission, not a correction waiting ' +
    'to be tuned.';
  section.append(heading, list, caveat);
  return section;
}
