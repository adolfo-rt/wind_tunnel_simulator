import './ui/styles.css';
import { Viewer } from './core/Viewer';
import { DEFAULT_STATE, Store, type AppState } from './core/Store';
import { SelectorPanel } from './ui/SelectorPanel';
import { InfoPanel } from './ui/InfoPanel';
import { Controls } from './ui/Controls';
import { WindTunnel } from './tunnel/Tunnel';
import { kmhToMs } from './core/atmosphere';
import { FlowSolver } from './physics/FlowSolver';
import { SliceView, type SliceAxis } from './physics/SliceView';
import {
  SLOW_MOTION,
  STREAMLINE_COUNTS,
  Streamlines,
  type StreamlineDensity,
} from './physics/Streamlines';
import { SdfBuilder } from './physics/sdf/SdfBuilder';
import { sampleSdf, type SdfGrid } from './physics/sdf/buildSdf';
import { Box3, Sphere, Vector3 } from 'three';
import { buildAircraft, type BuiltAircraft } from './aircraft/AircraftBuilder';
import { ROSTER, specById } from './aircraft/roster';
import type { AircraftSpec } from './aircraft/AircraftSpec';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const loading = document.getElementById('loading') as HTMLElement;

const viewer = new Viewer({ canvas });
const store = new Store<AppState>({ ...DEFAULT_STATE });

const infoPanel = new InfoPanel({
  panel: document.getElementById('info') as HTMLElement,
  year: document.getElementById('info-year') as HTMLElement,
  name: document.getElementById('info-name') as HTMLElement,
  maker: document.getElementById('info-maker') as HTMLElement,
  innovation: document.getElementById('info-innovation') as HTMLElement,
  stats: document.getElementById('info-stats') as HTMLElement,
});

const selector = new SelectorPanel({
  container: document.getElementById('aircraft-list') as HTMLElement,
  onSelect: (spec) => select(spec.id),
});

const tunnel = new WindTunnel();
viewer.world.add(tunnel.group);

const controls = new Controls({
  panel: document.getElementById('controls') as HTMLElement,
  slider: document.getElementById('speed-slider') as HTMLInputElement,
  value: document.getElementById('speed-value') as HTMLElement,
  cruiseButton: document.getElementById('speed-cruise') as HTMLButtonElement,
  readouts: document.getElementById('readouts') as HTMLElement,
  onSpeedChange: (kmh) => store.set({ speedKmh: kmh }),
});

store.subscribe((state) => {
  tunnel.setSpeed(kmhToMs(state.speedKmh));
  // The solver runs non-dimensionally and never sees this. Everything drawn from its
  // field does: the slice turns it back into metres per second, and the streamlines use
  // it to decide how far a particle travels.
  slice.setFreeStream(kmhToMs(state.speedKmh));
  streamlines.setFreeStream(kmhToMs(state.speedKmh));
});
tunnel.setSpeed(kmhToMs(store.get().speedKmh));

// ---- Flow solver ------------------------------------------------------------

const solver = new FlowSolver({ renderer: viewer.renderer });
const sdfBuilder = new SdfBuilder();
const slice = new SliceView();
viewer.world.add(slice.mesh);

const streamlines = new Streamlines({ renderer: viewer.renderer });
viewer.world.add(streamlines.group);
// The streamlines have to agree with the solver about the grid, the domain and where the
// aircraft is, down to the metre. Borrowing the uniforms rather than copying them means
// they cannot fall out of step later.
for (const material of streamlines.sharedMaterials) solver.shareUniforms(material);

const flowStatus = document.getElementById('flow-status') as HTMLElement;
const legendTicks = document.getElementById('legend-ticks') as HTMLElement;
const sliceLegend = document.getElementById('slice-legend') as HTMLElement;

legendTicks.replaceChildren(
  ...SliceView.LEGEND_STOPS.map((speed) => {
    const tick = document.createElement('span');
    tick.textContent = String(Math.round(speed));
    return tick;
  }),
);
const sliceEnabled = document.getElementById('slice-enabled') as HTMLInputElement;
const slicePosition = document.getElementById('slice-position') as HTMLInputElement;
const axisButtons = [...document.querySelectorAll<HTMLButtonElement>('#slice-axes .axis')];
const streamlinesEnabled = document.getElementById('streamlines-enabled') as HTMLInputElement;
const streamlineNote = document.getElementById('streamline-note') as HTMLElement;
const densityButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('#streamline-density .axis'),
];

slice.setVisible(sliceEnabled.checked);
slice.setPosition(Number(slicePosition.value) / 1000);
slice.setFreeStream(kmhToMs(store.get().speedKmh));

/**
 * One legend for both. The streamlines and the slice are coloured from the same field
 * through the same ramp, so the bar means the same thing for either, and it should be
 * there whenever there is something on screen to read it against.
 */
const updateLegendVisibility = () => {
  const showing = sliceEnabled.checked || streamlinesEnabled.checked;
  sliceLegend.hidden = !showing || !solver.supported;
};

sliceEnabled.addEventListener('change', () => {
  slice.setVisible(sliceEnabled.checked);
  updateLegendVisibility();
});
slicePosition.addEventListener('input', () =>
  slice.setPosition(Number(slicePosition.value) / 1000),
);
/**
 * The domain is centred on the aircraft, so the middle of the slider is the aircraft's
 * own centreline - the cut worth seeing most of the time. Picking an orientation returns
 * there, and so does clicking the orientation already selected, which makes the buttons
 * double as a way back to the middle after exploring.
 */
const SLICE_CENTRE = 0.5;

function recentreSlice(): void {
  slicePosition.value = String(Math.round(SLICE_CENTRE * Number(slicePosition.max)));
  slice.setPosition(SLICE_CENTRE);
}

for (const button of axisButtons) {
  button.addEventListener('click', () => {
    for (const other of axisButtons) other.setAttribute('aria-pressed', String(other === button));
    slice.setAxis(button.dataset.axis as SliceAxis);
    recentreSlice();
  });
}

updateLegendVisibility();

// ---- Streamlines ------------------------------------------------------------

let density: StreamlineDensity = 'medium';

/**
 * Say what the picture is doing.
 *
 * The slow motion is the one thing on screen that is not a property of the flow, and
 * leaving it unstated would make every reading of the animation wrong by a factor of
 * twelve. The count is here because it is the main thing to turn down on a slow machine.
 */
function describeStreamlines(): void {
  streamlineNote.textContent = streamlinesEnabled.checked
    ? `${streamlines.particleCount.toLocaleString()} tracers, drawn at 1/${SLOW_MOTION} real time.`
    : '';
}

streamlines.setVisible(streamlinesEnabled.checked);
streamlines.setFreeStream(kmhToMs(store.get().speedKmh));

streamlinesEnabled.addEventListener('change', () => {
  streamlines.setVisible(streamlinesEnabled.checked);
  updateLegendVisibility();
  // Restart rather than resume: the trails would otherwise be stitched across however
  // long they were switched off, drawing lines the air never took.
  if (streamlinesEnabled.checked) streamlines.reset();
  describeStreamlines();
});

for (const button of densityButtons) {
  button.addEventListener('click', () => {
    for (const other of densityButtons) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    density = button.dataset.density as StreamlineDensity;
    streamlines.setCount(STREAMLINE_COUNTS[density], tunnel.size.radius);
    describeStreamlines();
  });
}

describeStreamlines();
updateLegendVisibility();

if (!solver.supported) {
  flowStatus.dataset.state = 'unsupported';
  flowStatus.textContent = `Flow solver unavailable: ${solver.unsupportedReason}. An analytic model arrives in stage 7.`;
  sliceEnabled.disabled = true;
  slicePosition.disabled = true;
  streamlinesEnabled.disabled = true;
  streamlines.setVisible(false);
  for (const button of densityButtons) button.disabled = true;
  streamlineNote.textContent = '';
  updateLegendVisibility();
}

viewer.onFrame((delta, elapsed) => {
  tunnel.update(delta);
  controls.setRpm(tunnel.rpm, elapsed);

  if (solver.supported && current) {
    solver.step();
    // The solver ping-pongs its targets, so the finished field is a different texture
    // each step and has to be handed over again rather than bound once.
    slice.setVelocity(solver.velocityTexture);
    streamlines.setVelocity(solver.velocityTexture);
    streamlines.step(delta);
    if (elapsed - lastStatusPaint > 0.25) {
      lastStatusPaint = elapsed;
      const { grid, cells, jacobiIterations, steps } = solver.stats;
      flowStatus.textContent =
        `${grid.x}×${grid.y}×${grid.z} cells (${(cells / 1000).toFixed(0)}k) · ` +
        `${jacobiIterations} pressure iterations · ${steps} steps`;
    }
  }
});

let lastStatusPaint = 0;

let current: BuiltAircraft | null = null;
/** Kept so the streamlines can be checked against the same surface the solver sees. */
let obstacle: SdfGrid | null = null;
let pendingId: string | null = null;

/** Wait for the browser to paint, so the loading indicator is actually seen. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function load(spec: AircraftSpec): Promise<void> {
  pendingId = spec.id;
  store.set({ building: true });
  loading.hidden = false;

  // Generating a whole airliner takes a few tens of milliseconds. Yielding first lets
  // the spinner paint, so a slower machine shows progress rather than a frozen frame.
  await nextPaint();

  // A rapid series of clicks should only ever build the last one asked for.
  if (pendingId !== spec.id) return;

  const built = buildAircraft(spec, 'high');

  if (current) {
    viewer.world.remove(current.group);
    current.dispose();
  }
  current = built;

  // Centre the aircraft on the origin so later stages can put a tunnel around it.
  const centre = built.bounds.getCenter(built.group.position.clone());
  built.group.position.set(-centre.x, -centre.y, -centre.z);
  viewer.world.add(built.group);

  const bounds = built.bounds.clone().translate(built.group.position);
  tunnel.fitTo(bounds);

  // Frame the whole working section, so both fans are in shot. The aeroplane ends up
  // smaller than it was on its own, which is the right trade for this stage: the tunnel
  // and its fans are the subject, and the aircraft can be zoomed into.
  const { radius, length } = tunnel.size;
  const framing = new Box3(
    new Vector3(-length / 2, -radius, -radius),
    new Vector3(length / 2, radius, radius),
  );
  viewer.frameBounds(framing, true);

  infoPanel.show(spec);
  controls.setAircraft(spec);

  // Hand the aircraft to the solver: size the grid to the working section, then build
  // the obstacle field off-thread and drop it in when it is ready.
  if (solver.supported) {
    const domain = new Box3(
      new Vector3(-length / 2, -radius, -radius),
      new Vector3(length / 2, radius, radius),
    );
    const maxTexture = viewer.renderer.capabilities.maxTextureSize;
    solver.configure(domain, maxTexture);
    slice.configure(domain, solver.atlas, solver.velocityTexture);
    streamlines.configure(domain, solver.velocityTexture, radius, maxTexture);
    describeStreamlines();

    built.group.updateMatrixWorld(true);
    solver.setModelMatrix(built.group.matrixWorld);
    solver.setObstacle(null);
    obstacle = null;
    flowStatus.textContent = 'Building the obstacle field…';

    sdfBuilder
      .build(built.solid, { resolution: 96 })
      .then((sdf) => {
        if (current !== built) return;
        solver.setObstacle(sdf);
        obstacle = sdf;
        solver.reset();
        // Particles released before the aircraft existed are inside it now.
        streamlines.reset();
      })
      .catch((error: unknown) => {
        // A superseded build is the normal case when clicking down the list.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        flowStatus.dataset.state = 'unsupported';
        flowStatus.textContent = 'Could not build the obstacle field.';
      });
  }
  selector.setActive(spec.id);
  store.set({ aircraftId: spec.id, building: false });
  loading.hidden = true;
}

function select(id: string): void {
  const spec = specById(id);
  if (!spec) return;
  if (window.location.hash !== `#${id}`) {
    window.history.replaceState(null, '', `#${id}`);
  }
  void load(spec);
}

window.addEventListener('hashchange', () => {
  const id = window.location.hash.replace(/^#/, '');
  if (id && id !== store.get().aircraftId) select(id);
});

/**
 * A handle for debugging and for the automated screenshot checks: it lets a script
 * drive the camera to exact side, top and front views so generated geometry can be
 * inspected properly instead of guessed at from a three-quarter view.
 */
declare global {
  interface Window {
    windTunnel: {
      viewer: Viewer;
      tunnel: WindTunnel;
      solver: FlowSolver;
      slice: SliceView;
      streamlines: Streamlines;
      /** How much slower than real time the streamlines are drawn. */
      slowMotion: number;
      store: Store<AppState>;
      /**
       * Distance from a world point to the aircraft's surface, negative inside.
       *
       * The same field the solver and the streamlines use, read from the outside so a
       * headless check can assert that no particle is inside the aeroplane — which is
       * not something a screenshot can settle.
       */
      distanceToAircraft: (x: number, y: number, z: number) => number | null;
      select: (id: string) => void;
      current: () => BuiltAircraft | null;
      /** Point the camera down one axis at the current aircraft. */
      view: (which: 'side' | 'top' | 'front' | 'threeQuarter') => void;
    };
  }
}

window.windTunnel = {
  viewer,
  tunnel,
  solver,
  slice,
  streamlines,
  slowMotion: SLOW_MOTION,
  store,
  select,
  distanceToAircraft: (x, y, z) => {
    if (!obstacle || !current) return null;
    const local = current.group.worldToLocal(new Vector3(x, y, z));
    return sampleSdf(obstacle, local.x, local.y, local.z);
  },
  current: () => current,
  view: (which) => {
    if (!current) return;
    viewer.cancelCameraAnimation();
    const bounds = current.bounds.clone().translate(current.group.position);
    const centre = bounds.getCenter(new Vector3());
    const radius = bounds.getBoundingSphere(new Sphere()).radius;
    const directions: Record<string, Vector3> = {
      side: new Vector3(0, 0, 1),
      top: new Vector3(0, 1, 0.0001),
      front: new Vector3(-1, 0, 0),
      threeQuarter: new Vector3(0.62, 0.34, 0.71),
    };
    const direction = directions[which].clone().normalize();
    const distance = (radius / Math.sin((viewer.camera.fov * Math.PI) / 360)) * 1.06;
    viewer.camera.position.copy(centre).addScaledVector(direction, distance);
    viewer.controls.target.copy(centre);
    viewer.controls.update();
  },
};

viewer.start();

// Open on whatever the URL names, so a specific aircraft can be linked to directly.
const initialId = window.location.hash.replace(/^#/, '');
select(specById(initialId) ? initialId : ROSTER[0].id);
