/**
 * A very small reactive store.
 *
 * The app has a handful of pieces of shared state (which aircraft is selected, the
 * tunnel speed, the quality tier) that several unrelated panels need to read and
 * write. That is not enough to justify a framework, but it is more than enough to
 * justify not passing callbacks around by hand.
 */

export type Listener<T> = (state: T, previous: T) => void;

export class Store<T extends object> {
  private state: T;
  private listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): Readonly<T> {
    return this.state;
  }

  set(patch: Partial<T>): void {
    const previous = this.state;
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof T>) {
      const value = patch[key];
      if (value !== undefined && value !== previous[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;

    this.state = { ...previous, ...patch };
    for (const listener of this.listeners) listener(this.state, previous);
  }

  subscribe(listener: Listener<T>, callImmediately = false): () => void {
    this.listeners.add(listener);
    if (callImmediately) listener(this.state, this.state);
    return () => this.listeners.delete(listener);
  }
}

export interface AppState {
  /** Id of the selected aircraft, or null before anything is chosen. */
  aircraftId: string | null;
  /** Free-stream speed in km/h, used from Stage 2 onwards. */
  speedKmh: number;
  /** True while geometry is being generated. */
  building: boolean;
}

export const DEFAULT_STATE: AppState = {
  aircraftId: null,
  speedKmh: 900,
  building: false,
};
