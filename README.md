# Wind Tunnel Simulator

An interactive 3D wind tunnel for commercial airliners, built to investigate **how
aerodynamics and engineering are used to increase the fuel efficiency of commercial
aircraft while maintaining passenger capacity, comfort and safety.**

Pick an airliner from the menu — ordered by the year the type first flew, from the 1949
de Havilland Comet to the 737 MAX — and inspect it in 3D. Later stages put it inside a
see-through wind tunnel and simulate the airflow around it.

## Running it

```bash
npm install
npm run dev
```

Then open the URL it prints. To build and preview the production bundle:

```bash
npm run build
npm run preview
```

## Publishing it

Pushing to `main` builds the app and deploys it to GitHub Pages, at
`https://<user>.github.io/wind_tunnel_simulator/`.

Pages has to be switched on once by hand before the first deploy will work: in the
repository, **Settings → Pages → Source → GitHub Actions**. A workflow cannot do this
for you — creating the Pages site needs admin rights the workflow's token does not have.
Until that is done the deploy job fails at `configure-pages` with "Get Pages site
failed", while the build and tests still pass.

## Project stages

The project is built in stages, each independently testable.

| Stage | What it adds | Status |
|---|---|---|
| 1 | Aircraft selector and 3D viewer | Done |
| 2 | Wind tunnel, fans, speed control | Done |
| 3 | Flow field solver | Done |
| 4 | Volumetric streamlines | Planned |
| 5 | Surface pressure visualisation | Planned |
| 6 | Turbulence and wake | Planned |
| 7 | Performance and quality tiers | Planned |
| 8 | Fuel-efficiency analytics | Planned |

## How the aircraft are made

There are no 3D model files in this repository. Every aircraft is generated in code from
a parameter set (`src/aircraft/AircraftSpec.ts`) describing its fuselage, wing, engines
and tail, with the roster in `src/aircraft/roster.ts`.

This is not a shortcut, it is the point. The same numbers that shape the mesh — sweep,
aspect ratio, thickness, airfoil family, winglet type — are the numbers the flow solver
will use. If the geometry and the aerodynamics came from different places, the
simulation would be decoration. Because they come from one description, changing
aircraft genuinely changes the flow.

- **Fuselages** are lofted from superellipse rings, with a power-law nose, an upswept
  tail cone, and support for the 747's partial upper deck and the A380's full double
  deck.
- **Wings, tailplanes and fins** are lofted from real airfoil sections carrying sweep,
  dihedral and washout. Three airfoil families cover the eras: classic NACA 4-digit,
  early-jet "peaky", and supercritical.
- **Wingtip devices** — fences, blended winglets, sharklets, raked tips and split-tip
  scimitars — are generated as the genuinely different shapes they are, because they are
  different answers to the same induced-drag problem.
- **Nacelles** loft a cowl that runs forward along the outside, rolls over the inlet lip
  and turns back inside to the fan face, giving an open intake that is still a closed
  solid for the solver.
- **Cabin windows, doors, cheatlines and cockpit glazing** are painted into a procedural
  canvas texture rather than modelled. A 737 has about eighty windows a side.

Concorde gets its own planform generator: its leading edge curves from roughly 80 degrees
of sweep at the root to 55 at the tip, the ogee shape that gives the ogival delta its
name.

## The wind tunnel

The working section is a transparent cylinder sized around whichever aircraft is
loaded, with a fan at each end: the upstream one drives air in, the downstream one draws
it out. Real closed-circuit tunnels put the drive fan downstream for that reason, so the
working section sees smoothly drawn air rather than the fan's own swirl. A honeycomb
straightener sits just behind the inlet fan, which is what removes the residual swirl and
makes the flow in the working section worth simulating at all.

The shell has to be see-through without disappearing, so it is drawn with a Fresnel
term: nearly clear where you look straight through it, brightest at the silhouette where
the surface turns away. Hoops and stringers give the eye something solid to judge the
tube by.

The speed slider drives both rotors, eased so they spool up and down like machinery with
rotating mass rather than snapping between speeds.

The rotors are motion blurred, and that is a correctness fix rather than a flourish. A
rotor with N blades is periodic every 2*pi/N, so at 60 fps its apparent rotation cannot
exceed half that per frame: with eleven blades the fan visually topped out near 164 rpm
and beyond that strobed, stopped, or ran backwards no matter how fast the shaft really
turned. The rotor is now drawn several times per frame across the arc it sweeps, which is
what motion blur physically is - an exposure integrating over time. Once the smear covers
a whole blade spacing the image is rotationally uniform and there is nothing left to
alias. Seven blades turning at a few hundred rpm, rather than eleven at over a thousand,
keeps the smear growing across the whole range of the slider. The readouts underneath are the
interesting part:

- **Mach** says whether compressibility is in play. The tunnel runs at sea level, so its
  Mach is its own; the aircraft's design cruise Mach is shown beside it for comparison.
  They differ because the speed of sound falls with temperature, so the same Mach number
  is roughly fifteen per cent slower down here than at the tropopause. Concorde's Mach
  2.02 is simply beyond this tunnel, and the interface says so rather than pretending.
- **Reynolds number** is the ratio of inertial to viscous forces, computed on the mean
  aerodynamic chord. It is shown prominently on purpose — see the note below on what the
  simulation can and cannot claim.

## The flow solver

Incompressible Navier–Stokes on a regular grid: move the velocity field along itself,
then find the pressure whose gradient cancels whatever divergence that introduced. The
grid is flattened into a 2D texture, its z slices tiled across it, so each pass is a
single full-screen draw — WebGL2 cannot render into one slice of a 3D texture without a
geometry shader it does not have.

The aircraft enters as a signed distance field built in a worker. Cells can be partly
solid, which is what keeps the surface smooth at a resolution where a hard in-or-out test
would make every boundary a staircase and the flow would separate off the steps rather
than off the shape. The field is built in the aircraft's own frame and query points are
transformed into it, so rotating the model costs a matrix multiply rather than a rebuild.

Everything is solved non-dimensionally with the free stream at 1. The speed slider never
reaches the solver; it scales the readouts and, from the next stage, how fast particles
are carried. Besides being ordinary practice in computational aerodynamics, it fixes the
CFL number, so dragging the slider from nothing to Mach 1 cannot destabilise the solve.
Compressibility will arrive as an analytic correction rather than being simulated.

A flow slice makes the field visible: a plane through the tunnel coloured by speed, which
can be moved and reoriented. It is how the stage was checked before any streamlines
existed to trace.

Because the solved field is non-dimensional, the slice scales it by the tunnel's actual
speed before colouring it, and the legend is in metres per second. Without that the
picture would be identical with the fans stopped as at cruise — the field the solver holds
is the same either way, and only the display knows how fast the air is really moving. The
colour ramp is anchored to a fixed reference rather than to the current speed, which
compresses the detail when the tunnel is running slowly. That is the honest trade: there
genuinely is less happening.

### What it is and is not

`npm run verify:flow` drives the built app in headless Chromium and asserts what must be
true of flow around a body: the free stream arrives undisturbed, it accelerates somewhere,
it slows markedly behind the aircraft, and momentum is not quietly draining away. Each of
those failed at some point during development, which is why they are checks rather than
claims.

What it is not is a resolved simulation. At 128 cells along the tunnel a 737's fuselage is
about four cells across and its wing is thinner than one, so the wing's section is
suggested rather than resolved. The boundary layer — a hundred-thousandth of the chord at
a real Reynolds number of 5 × 10⁷ — is not present at all. What the solver does give is a
single velocity and pressure field that every later stage reads from, so the streamlines,
the surface colours, the wake and the force estimates agree with one another and all react
to the actual shape of the aircraft.

## A note on the numbers

Dimensions in the roster are approximate published figures from manufacturer data and
standard references. Performance figures — cruise lift-to-drag ratio and thrust-specific
fuel consumption — are quoted book values, kept in a separate `reference` block in each
spec and labelled as published in the interface.

From Stage 3 onwards the app also computes quantities from the simulation. Those are
labelled separately. It should always be obvious which numbers the app worked out and
which it looked up.

The simulation's limitations will be documented here as it lands. In short: a real
airliner at cruise sits at a Reynolds number around 5 × 10⁷, and no browser is going to
resolve that. The claim this project makes is that the simulation is **qualitatively
correct and internally consistent** — the same velocity and pressure field drives the
streamlines, the surface colours, the wake and the force estimates — not that it is a
quantitatively accurate CFD prediction.

## Tests

```bash
npm test          # unit tests
npm run typecheck # TypeScript
```

The suite checks the airfoil generator against the published NACA 0012 ordinate table,
validates every aircraft in the roster for physical plausibility, and builds all 21
aircraft checking that the geometry is finite, correctly wound and watertight.

There are also two scripts that drive the built app in headless Chromium, for checking a
stage without a person in the loop:

```bash
npm run build && npm run preview
npm run shots  -- comet1 boeing747-100 concorde   # three-quarter views
npm run views  -- boeing747-100                   # side, top and front views
```

## Layout

```
src/
  aircraft/     specs, roster, airfoil maths, geometry builders
  core/         renderer, camera, shared state
  ui/           selector, info card, styles
scripts/        roster generator, headless screenshot tools
tests/          unit tests
```
