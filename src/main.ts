import './ui/styles.css';
import { Viewer } from './core/Viewer';
import { DEFAULT_STATE, Store, type AppState } from './core/Store';
import { SelectorPanel } from './ui/SelectorPanel';
import { InfoPanel } from './ui/InfoPanel';
import { AnalysisPanel } from './ui/AnalysisPanel';
import { Controls } from './ui/Controls';
import { WindTunnel } from './tunnel/Tunnel';
import { kmhToMs } from './core/atmosphere';
import { FlowSolver } from './physics/FlowSolver';
import { SLOW_MOTION, SimulationClock, establishingSteps } from './physics/clock';
import { SliceView, type SliceAxis, type SliceField } from './physics/SliceView';
import { legendState } from './ui/legends';
import {
  STREAMLINE_COUNTS,
  Streamlines,
  type StreamlineDensity,
} from './physics/Streamlines';
import { SurfacePressure } from './physics/SurfacePressure';
import { CP_LEGEND_STOPS } from './physics/gpu/colourRamp';
import { bakeSurfacePressure } from './physics/surface/bakeCp';
import { solveAircraft, type PanelAircraft } from './physics/panel/aircraftModel';
import { SdfBuilder } from './physics/sdf/SdfBuilder';
import { sampleSdf, type SdfGrid } from './physics/sdf/buildSdf';
import { Box3, Sphere, Vector3 } from 'three';
import { buildAircraft, type BuiltAircraft } from './aircraft/AircraftBuilder';
import { QUALITY, type QualityTier } from './core/quality';
import { FrameMeter } from './core/FrameMeter';
import { ROSTER, specById } from './aircraft/roster';
import type { AircraftSpec } from './aircraft/AircraftSpec';

const canvas = document.getElementById('viewport') as HTMLCanvasElement;
const loading = document.getElementById('loading') as HTMLElement;

/**
 * The tier to start at.
 *
 * A choice made by hand is remembered, because being measured and demoted again on every
 * visit would be both wrong and irritating - the viewer has already said what they want.
 * With nothing remembered the app starts at the top and lets the frame meter decide.
 */
function rememberedTier(): QualityTier | null {
  try {
    const saved = localStorage.getItem('windtunnel.quality');
    return saved === 'low' || saved === 'balanced' || saved === 'high' ? saved : null;
  } catch {
    // Private browsing, or storage disabled. Not a reason to fail to start.
    return null;
  }
}

const startingTier = rememberedTier();
let tier: QualityTier = startingTier ?? DEFAULT_STATE.quality;

const viewer = new Viewer({ canvas, maxPixelRatio: QUALITY[tier].maxPixelRatio });
const store = new Store<AppState>({ ...DEFAULT_STATE, quality: tier });

const infoCard = document.getElementById('info') as HTMLElement;

/**
 * Tell the stylesheet where the specification card ends.
 *
 * The controls sit underneath it in the same column, and the card's height depends on how
 * long this aircraft's description runs, so the ceiling cannot be a constant in the CSS.
 * Watched rather than set once, because the card is re-filled whenever the selection
 * changes and re-flows whenever the window does.
 */
const trackInfoHeight = () => {
  const bottom = infoCard.hidden ? 0 : infoCard.getBoundingClientRect().bottom;
  document.documentElement.style.setProperty('--info-bottom', `${Math.round(bottom)}px`);
};
new ResizeObserver(trackInfoHeight).observe(infoCard);
window.addEventListener('resize', trackInfoHeight);
trackInfoHeight();

const infoPanel = new InfoPanel({
  panel: infoCard,
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

const analysisPanel = new AnalysisPanel({
  panel: document.getElementById('analysis') as HTMLElement,
  openButton: document.getElementById('analysis-open') as HTMLButtonElement,
  closeButton: document.getElementById('analysis-close') as HTMLButtonElement,
  title: document.getElementById('analysis-title') as HTMLElement,
  body: document.getElementById('analysis-body') as HTMLElement,
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

const solver = new FlowSolver({
  renderer: viewer.renderer,
  resolution: QUALITY[tier].flowResolution,
  jacobiIterations: QUALITY[tier].jacobiIterations,
});
const clock = new SimulationClock();
const sdfBuilder = new SdfBuilder();
const slice = new SliceView();
viewer.world.add(slice.mesh);

const streamlines = new Streamlines({ renderer: viewer.renderer });
viewer.world.add(streamlines.group);

// The streamlines have to agree with the solver about the grid, the domain and where the
// aircraft is, down to the metre. Borrowing the uniforms rather than copying them means
// they cannot fall out of step later.
for (const material of streamlines.sharedMaterials) solver.shareUniforms(material);

/**
 * Surface pressure comes from the panel model, not from the grid.
 *
 * The grid cannot resolve a surface at this scale - measured, and documented in
 * `physics/surface/cp.ts` - so the skin gets a surface method and the volume keeps the
 * solver. The two are honest about which is which in the interface.
 */
const pressure = new SurfacePressure();

const flowStatus = document.getElementById('flow-status') as HTMLElement;
const legendTicks = document.getElementById('legend-ticks') as HTMLElement;
const sliceLegend = document.getElementById('slice-legend') as HTMLElement;
const legendCaption = document.getElementById('legend-caption') as HTMLElement;
const crossflowLegend = document.getElementById('crossflow-legend') as HTMLElement;
const crossflowTicks = document.getElementById('crossflow-ticks') as HTMLElement;

const labelTicks = (into: HTMLElement, stops: readonly number[]) =>
  into.replaceChildren(
    ...stops.map((speed) => {
      const tick = document.createElement('span');
      // To the precision the stop actually has. Rounding 12.5 to 13 beside a 6.3 reads
      // as two different scales on one bar.
      tick.textContent = Number.isInteger(speed) ? String(speed) : speed.toFixed(1);
      return tick;
    }),
  );

labelTicks(legendTicks, SliceView.LEGEND_STOPS);
labelTicks(crossflowTicks, SliceView.CROSSFLOW_LEGEND_STOPS);
const pressureEnabled = document.getElementById('pressure-enabled') as HTMLInputElement;
const pressureLegend = document.getElementById('pressure-legend') as HTMLElement;
const pressureTicks = document.getElementById('pressure-ticks') as HTMLElement;

pressureTicks.replaceChildren(
  ...CP_LEGEND_STOPS.map((cp) => {
    const tick = document.createElement('span');
    tick.textContent = cp > 0 ? `+${cp}` : String(cp);
    return tick;
  }),
);

const sliceEnabled = document.getElementById('slice-enabled') as HTMLInputElement;
const slicePosition = document.getElementById('slice-position') as HTMLInputElement;
const axisButtons = [...document.querySelectorAll<HTMLButtonElement>('#slice-axes .axis')];
const fieldButtons = [...document.querySelectorAll<HTMLButtonElement>('#slice-fields .axis')];
const streamlinesEnabled = document.getElementById('streamlines-enabled') as HTMLInputElement;
const streamlineNote = document.getElementById('streamline-note') as HTMLElement;
const densityButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('#streamline-density .axis'),
];
const tierButtons = [...document.querySelectorAll<HTMLButtonElement>('#quality-tiers .axis')];
const qualityNote = document.getElementById('quality-note') as HTMLElement;
const perfReadouts = document.getElementById('perf-readouts') as HTMLElement;

slice.setVisible(sliceEnabled.checked);
slice.setPosition(Number(slicePosition.value) / 1000);
slice.setFreeStream(kmhToMs(store.get().speedKmh));

/**
 * One legend for both, until the slice stops measuring the same thing.
 *
 * The streamlines and the slice are coloured from the same field through the same ramp,
 * so one bar means the same thing for either and belongs on screen whenever there is
 * something to read it against. Switch the slice to cross-flow and that stops being true:
 * it is then a different quantity on a different anchor, and sharing the bar would be
 * tidier and untrue — the same mistake Cp was given its own legend to avoid. So the
 * cross-flow bar replaces the speed bar when nothing else is using it, and joins it when
 * the streamlines are still on the speed ramp.
 */
const updateLegendVisibility = () => {
  const legends = legendState({
    sliceVisible: sliceEnabled.checked,
    sliceField: slice.showing,
    streamlines: streamlinesEnabled.checked,
    solverSupported: solver.supported,
  });
  sliceLegend.hidden = !legends.showSpeed;
  crossflowLegend.hidden = !legends.showCrossFlow;
  legendCaption.textContent = legends.speedOwner;
  // Its own legend, because Cp is a different quantity on a different scale. Sharing the
  // speed bar would have been tidier and would have said something untrue. It does not
  // depend on the grid solver, because the panel model runs on the CPU and works on any
  // machine that can draw the aeroplane at all.
  pressureLegend.hidden = !pressureEnabled.checked;
};

pressureEnabled.addEventListener('change', () => {
  pressure.setEnabled(pressureEnabled.checked);
  updateLegendVisibility();
});

/*
 * The slice's own controls follow the slice.
 *
 * Its orientation, its position and what it measures are meaningless while it is hidden,
 * but they stayed fully live: a highlighted Cross-flow button and a slider that moved a
 * plane nobody could see. They are disabled with it, and stay disabled when there is no
 * solver to drive them at all.
 */
function syncSliceControls(): void {
  const usable = sliceEnabled.checked && solver.supported;
  slicePosition.disabled = !usable;
  for (const button of axisButtons) button.disabled = !usable;
  for (const button of fieldButtons) button.disabled = !usable;
}

sliceEnabled.addEventListener('change', () => {
  slice.setVisible(sliceEnabled.checked);
  syncSliceControls();
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

for (const button of fieldButtons) {
  button.addEventListener('click', () => {
    for (const other of fieldButtons) other.setAttribute('aria-pressed', String(other === button));
    slice.setField(button.dataset.field as SliceField);
    updateLegendVisibility();
  });
}

syncSliceControls();
updateLegendVisibility();

// ---- Streamlines ------------------------------------------------------------

let density: StreamlineDensity = QUALITY[tier].streamlines;

/**
 * Say what the picture is doing.
 *
 * The slow motion is the one thing on screen that is not a property of the flow, and
 * leaving it unstated would make every reading of the animation wrong by a factor of
 * twelve. The count is here because it is the main thing to turn down on a slow machine.
 */
function describeStreamlines(): void {
  if (!streamlinesEnabled.checked) {
    streamlineNote.textContent = '';
    return;
  }
  const count = streamlines.particleCount.toLocaleString();
  // One clock for the whole flow now, not just for the tracers: the solver is stepped
  // the number of times this frame's elapsed time and airspeed are worth.
  streamlineNote.textContent =
    `${count} tracers. The whole flow runs at 1/${SLOW_MOTION} real time, so the wake ` +
    `sheds faster as the tunnel speeds up, as it does in life.`;
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

// ---- Quality tiers ----------------------------------------------------------

/*
 * One dial over the solver grid, the obstacle field, the mesh, the tracers and the pixel
 * ratio. What it must NOT touch is anything the app reports: the lift-to-drag ratio, the
 * span efficiency and the fuel figures come from the panel method at a fixed station
 * count and a fixed tessellation, and `tests/quality.test.ts` holds that line.
 */

/** True once the viewer has chosen by hand, which stops the meter second-guessing them. */
let tierChosenByHand = startingTier !== null;

const frameMeter = new FrameMeter({
  onDemote: (to, stats) => {
    const was = QUALITY[tier].label;
    const reason = `${was} was running at ${Math.round(stats.fps ?? 0)} fps`;
    /*
     * Deferred out of the frame it was decided in.
     *
     * `onDemote` is called from inside the render callback, and applying a tier
     * reallocates the solver's render targets. Doing that halfway through a frame would
     * pull the velocity target out from under the slice and the streamlines, which are
     * holding it for this frame's draw. A timeout puts it in the next task, after the
     * frame has finished with everything it borrowed.
     */
    setTimeout(() => applyQuality(to, { reason }), 0);
  },
});
frameMeter.setTier(tier);
if (tierChosenByHand) frameMeter.stopAdjusting();

function paintTierButtons(): void {
  for (const button of tierButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.tier === tier));
  }
  for (const button of densityButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.density === density));
  }
}

function describeQuality(reason?: string): void {
  const settings = QUALITY[tier];
  const auto = frameMeter.adjusting ? ' Measuring; it will drop a tier if this is too much.' : '';
  qualityNote.textContent = reason
    ? `Dropped to ${settings.label}: ${reason}. ${settings.cost} Pick one yourself to stop it adjusting.`
    : `${settings.cost}${auto}`;
}

/**
 * Switch tiers.
 *
 * The solver resolution and the pixel ratio change in place. The mesh tessellation and
 * the obstacle field cannot - both are baked when the aircraft is built - so a tier that
 * changes either reloads the aircraft. That is a visible hitch, which is why the meter
 * only ever demotes, and only on a median over ninety frames.
 */
function applyQuality(next: QualityTier, options: { byHand?: boolean; reason?: string } = {}): void {
  const previous = QUALITY[tier];
  const settings = QUALITY[next];
  const needsRebuild =
    previous.meshDetail !== settings.meshDetail || previous.sdfResolution !== settings.sdfResolution;

  tier = next;
  store.set({ quality: next });

  if (options.byHand) {
    tierChosenByHand = true;
    frameMeter.stopAdjusting();
    try {
      localStorage.setItem('windtunnel.quality', next);
    } catch {
      // Nothing to do about it, and not worth failing a click over.
    }
  }

  viewer.setMaxPixelRatio(settings.maxPixelRatio);
  solver.setJacobiIterations(settings.jacobiIterations);
  if (solver.supported) {
    solver.setResolution(settings.flowResolution, viewer.renderer.capabilities.maxTextureSize);
  }
  density = settings.streamlines;
  streamlines.setCount(STREAMLINE_COUNTS[density], tunnel.size.radius);

  frameMeter.setTier(next);
  paintTierButtons();
  describeQuality(options.reason);
  describeStreamlines();

  const spec = current?.spec ?? specById(store.get().aircraftId ?? '');
  if (needsRebuild && spec) void load(spec);
  else if (solver.supported) solver.reset();
}

for (const button of tierButtons) {
  button.addEventListener('click', () => {
    const next = button.dataset.tier as QualityTier;
    if (next !== tier) applyQuality(next, { byHand: true });
    else {
      // Clicking the tier already running is how you say "stop adjusting" without
      // changing anything.
      tierChosenByHand = true;
      frameMeter.stopAdjusting();
      describeQuality();
    }
  });
}

/** Frame rate, and what it is being spent on. */
function paintPerformance(): void {
  const stats = frameMeter.stats;
  const rows: Array<[string, string, boolean]> = [
    [
      'Frame rate',
      stats.fps === null ? 'measuring…' : `${Math.round(stats.fps)} fps`,
      stats.fps !== null && stats.fps < 20,
    ],
    [
      'Frame time',
      stats.medianMs === null
        ? '—'
        : `${stats.medianMs.toFixed(1)} ms · worst ${stats.worstMs?.toFixed(0)} · ${stats.samples} frames`,
      false,
    ],
    ['Render scale', `${viewer.pixelRatio.toFixed(2)}×`, false],
  ];
  const fragment = document.createDocumentFragment();
  for (const [label, value, slow] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (slow) dd.dataset.state = 'slow';
    fragment.append(dt, dd);
  }
  perfReadouts.replaceChildren(fragment);
}

/*
 * Coming back to a backgrounded tab produces one enormous frame and then a few slow ones
 * while the GPU wakes up. The meter discards the enormous one, but the window either
 * side of a hidden tab is still two different measurements stitched together, so it is
 * thrown away rather than averaged.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') frameMeter.restart();
});

paintTierButtons();
describeQuality();
paintPerformance();

if (!solver.supported) {
  flowStatus.dataset.state = 'unsupported';
  /*
   * This used to promise an analytic model "in stage 7". Stage 7 turned out to be the
   * quality tiers, and a CPU field good enough to drive the streamlines is a different
   * and much larger job, so the promise is withdrawn rather than left standing. What is
   * true is worth saying instead: two of the three things on this panel never needed the
   * grid, because the panel method and the vortex lattice run on the CPU.
   */
  flowStatus.textContent =
    `Flow solver unavailable: ${solver.unsupportedReason}. Surface pressure and the ` +
    `cruise analysis still work — both are solved on the CPU. The streamlines and the ` +
    `flow slice read the grid, so they are off.`;
  sliceEnabled.disabled = true;
  slicePosition.disabled = true;
  for (const button of fieldButtons) button.disabled = true;
  streamlinesEnabled.disabled = true;
  streamlines.setVisible(false);
  for (const button of densityButtons) button.disabled = true;
  streamlineNote.textContent = '';
  updateLegendVisibility();
  // The tier buttons stay live: without a solver they still drive the mesh tessellation
  // and the pixel ratio, which is most of what a slow machine needs turned down.
}

/**
 * Let the flow establish itself before the clock applies.
 *
 * Two transits of the working section, run flat out. Until the free stream has reached
 * the far end and the pressure field has settled behind it there is no physical state
 * whose rate of change means anything, so there is nothing for a clock to scale - and at
 * 100 km/h the honest rate is a twentieth of a step a frame, which would be correct and
 * leave the tunnel empty for half a minute.
 */
function settleFlow(): void {
  clock.establish(establishingSteps(solver.stats.grid.x, FlowSolver.STEP_CELLS));
}

solver.onReset(settleFlow);

viewer.onFrame((delta, elapsed) => {
  tunnel.update(delta);
  controls.setRpm(tunnel.rpm, elapsed);
  // Measured every frame, read a few times a second: the median is what decides, and
  // rewriting the DOM at sixty hertz would be its own performance problem. The meter
  // times itself rather than taking `delta`, which the viewer clamps to a tenth of a
  // second and which would therefore hide every machine slower than ten frames a second.
  frameMeter.sample();

  if (solver.supported && current) {
    /*
     * How many steps this frame is worth, rather than one and hope.
     *
     * The solver has no idea how much time a step represents - it works at a free stream
     * of exactly 1 - so the display has to say, because only the display knows the
     * airspeed. Stepping once a frame made the wake shed at the same rate at taxi speed
     * as at cruise, and tied its rate to the frame rate as well.
     */
    // Asked once and held: the clock consumes the frame's elapsed time when asked, so
    // calling it from the loop condition spends a fresh frame on every iteration. It did,
    // and the flow ran about sixty per cent fast at mid throttle.
    const steps = clock.stepsFor({
      seconds: delta,
      freeStream: kmhToMs(store.get().speedKmh),
      cellWorld: solver.cellWorld,
      stepCells: FlowSolver.STEP_CELLS,
    });
    for (let i = 0; i < steps; i++) solver.step();
    // Handed over every frame rather than bound once: the published field is a target
    // of its own now, but it is still reallocated whenever the grid is resized, and a
    // borrower holding the old one would quietly draw a field nothing is writing to.
    slice.setVelocity(solver.velocityTexture);
    streamlines.setVelocity(solver.velocityTexture);
    streamlines.step(delta);
    if (elapsed - lastStatusPaint > 0.25) {
      lastStatusPaint = elapsed;
      const { grid, cells, jacobiIterations, steps } = solver.stats;
      flowStatus.textContent =
        `${grid.x}×${grid.y}×${grid.z} cells (${(cells / 1000).toFixed(0)}k) · ` +
        `${jacobiIterations} pressure iterations · ${steps} steps`;
      paintPerformance();
    }
  } else if (elapsed - lastStatusPaint > 0.25) {
    // No solver, but the frame rate is still worth showing - it is the only thing that
    // says whether the tier is right for this machine.
    lastStatusPaint = elapsed;
    paintPerformance();
  }
});

let lastStatusPaint = 0;

let current: BuiltAircraft | null = null;
/** Kept so the streamlines can be checked against the same surface the solver sees. */
let obstacle: SdfGrid | null = null;
/** The panel solution for the aircraft on screen, which the skin is coloured from. */
let panelModel: PanelAircraft | null = null;
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

  const built = buildAircraft(spec, QUALITY[tier].meshDetail);
  // Before the group is ever rendered: three.js caches a compiled program the first time
  // it draws a material, and a patch applied afterwards would not be in it.
  pressure.attach(built.surfaces);

  // Solve the aircraft as a panel model and write the result onto its own vertices. A
  // few tens of milliseconds, once, when the aircraft changes.
  panelModel = solveAircraft(built.aero);
  bakeSurfacePressure(built.group, panelModel);

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
  trackInfoHeight();
  controls.setAircraft(spec);
  analysisPanel.show(spec);

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

    built.group.updateMatrixWorld(true);
    // The wake before the attitude: setting the model matrix evaluates the induced field,
    // and there is no point evaluating an empty one and then doing it again.
    solver.setWake(panelModel.wake);
    solver.setModelMatrix(built.group.matrixWorld);
    describeStreamlines();
    solver.setObstacle(null);
    obstacle = null;
    flowStatus.textContent = 'Building the obstacle field…';

    sdfBuilder
      .build(built.solid, { resolution: QUALITY[tier].sdfResolution })
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
  // The frames either side of a rebuild are not measurements of the same scene.
  frameMeter.restart();
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
      /** The panel solution the aircraft's skin is coloured from. */
      panelModel: () => PanelAircraft | null;
      /**
       * Cp at every vertex of every mesh, exactly as baked.
       *
       * The values the picture is drawn from, read back without going through the
       * picture, so a headless check can ask what the colours actually mean.
       */
      surfacePressures: () => Array<{ aero: string; cp: Float32Array }>;
      readPressure: () => { data: Float32Array; grid: { x: number; y: number; z: number } } | null;
      setWallSlip: (slip: boolean) => void;
      setConfinement: (strength: number) => void;
      readVorticity: () => { data: Float32Array; grid: { x: number; y: number; z: number } } | null;
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
  readPressure: () => solver.readPressure(),
  setWallSlip: (slip: boolean) => solver.setWallSlip(slip),
  setConfinement: (strength: number) => solver.setConfinement(strength),
  readVorticity: () => solver.readVorticity(),
  panelModel: () => panelModel,
  surfacePressures: () => {
    const out: Array<{ aero: string; cp: Float32Array }> = [];
    current?.group.traverse((object) => {
      const mesh = object as { isMesh?: boolean; geometry?: { getAttribute: (n: string) => { array: ArrayLike<number> } | undefined }; userData?: Record<string, unknown> };
      if (!mesh.isMesh) return;
      const attribute = mesh.geometry?.getAttribute('aCp');
      if (!attribute) return;
      const tag = mesh.userData?.aero as { kind: string; surface?: string; body?: string } | undefined;
      out.push({
        aero: tag ? (tag.surface ?? tag.body ?? tag.kind) : 'untagged',
        cp: Float32Array.from(attribute.array),
      });
    });
    return out;
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
