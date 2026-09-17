import type { AircraftSpec } from '../aircraft/AircraftSpec';
import { rosterByDecade } from '../aircraft/roster';

/**
 * The aircraft selector.
 *
 * Grouped by decade and ordered by first flight, so scrolling the list is itself the
 * argument the project is making: the aeroplanes get cleaner, more slender and more
 * efficient as you go down.
 */

export interface SelectorPanelOptions {
  container: HTMLElement;
  onSelect: (spec: AircraftSpec) => void;
}

export class SelectorPanel {
  private buttons = new Map<string, HTMLButtonElement>();
  private currentId: string | null = null;

  constructor(private options: SelectorPanelOptions) {
    this.render();
  }

  private render(): void {
    const fragment = document.createDocumentFragment();

    for (const group of rosterByDecade()) {
      const heading = document.createElement('div');
      heading.className = 'decade';
      heading.textContent = group.decade;
      fragment.appendChild(heading);

      for (const spec of group.aircraft) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'aircraft-button';
        button.setAttribute('aria-current', 'false');

        const year = document.createElement('span');
        year.className = 'aircraft-year';
        year.textContent = String(spec.firstFlightYear);

        const name = document.createElement('span');
        name.className = 'aircraft-name';
        name.textContent = spec.model;

        button.append(year, name);
        button.title = `${spec.manufacturer} ${spec.model}`;
        button.addEventListener('click', () => this.options.onSelect(spec));

        this.buttons.set(spec.id, button);
        fragment.appendChild(button);
      }
    }

    this.options.container.replaceChildren(fragment);
  }

  setActive(id: string): void {
    if (this.currentId) {
      this.buttons.get(this.currentId)?.setAttribute('aria-current', 'false');
    }
    const button = this.buttons.get(id);
    if (!button) return;
    button.setAttribute('aria-current', 'true');
    this.currentId = id;
    button.scrollIntoView({ block: 'nearest' });
  }
}
