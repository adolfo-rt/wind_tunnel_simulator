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
| 4 | Volumetric streamlines | Done |
| 5 | Surface pressure visualisation | Done |
| 6 | Turbulence and wake | Done |
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
reaches the solver; it scales the readouts and how fast the streamlines are carried.
Besides being ordinary practice in computational aerodynamics, it fixes the CFL number, so
dragging the slider from nothing to Mach 1 cannot destabilise the solve.
Compressibility will arrive as an analytic correction rather than being simulated.

A flow slice makes the field visible: a plane through the tunnel coloured by speed, which
can be moved and reoriented. It is how the solver was checked before any streamlines
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

Two things the grid cannot resolve are supplied by surface methods instead, and in both
cases that was measured rather than assumed: the pressure on the skin, in stage 5, and the
trailing vortices, in stage 6. The wake is added back into this same field, so what the
rest of the application reads is still one field — see **The wake** below.

## The streamlines

Up to sixteen thousand massless tracers, released across the whole inlet disc and carried
by the solved field. Nothing about them is drawn from a second model: where a streamline
bends it is because the pressure field bent the air there, and where they crowd together
the air really is going faster, because the same volume is passing through a narrower gap.

Three things about them are deliberate.

**They are drawn at a twelfth of real time.** At cruise the air crosses this tunnel in
about a third of a second, which no eye can follow — the streaks would be a blur with no
direction in them. The factor is a constant, so doubling the tunnel speed still doubles
how fast the tracers travel and the slider means what it says; and the colours are scaled
back out to real airspeed before they reach the legend, which is the same legend the flow
slice uses. The interface states the factor rather than leaving the animation to be
misread by a factor of twelve.

**They cannot pass through the aircraft.** The velocity inside a solid is zero, and on top
of that every tracer is pushed back out along the distance field's own gradient if it ends
a step inside the surface. `npm run verify:streamlines` asserts this by reading the
positions back off the GPU and sampling the same distance field the solver uses — the one
failure a screenshot would never show.

**Step length is watched, because this stage has the same sampling trap the fans had.** A
tracer that covers most of a cell in one step draws a chord across whatever it is flowing
around, and near a wing that chord goes through the wing. So each frame's travel is split
into as many integration steps as it takes to keep every one under about a third of a
cell, and on a slow frame the trail is sampled more than once so the line drawn through
the path stays on it too. Both limits are asserted rather than eyeballed.

Seeding is deterministic: a fixed sunflower spiral across the inlet, so a tracer retraces
the same streamline every time it restarts and the picture is a stable set of lines you
can watch change as the aircraft or the speed changes, rather than a cloud that reshuffles
faster than the thing it is showing. The first release is staggered along the tunnel by a
radical-inverse sequence — a golden-ratio one, which would have matched the seeding,
turned out to be the golden angle's own sequence reflected, and the tracers came out as a
spiral sheet sweeping down the tunnel instead of an even field.

## Surface pressure

The aircraft's skin can be coloured by pressure coefficient: red where the air is brought
to rest, blue where it is pulled below free-stream pressure. It does not change with the
tunnel speed, and that is not a bug — C<sub>p</sub> is a coefficient, and the division by
dynamic pressure is exactly what takes the speed out. The streamlines are the opposite
case and have to be scaled by the slider deliberately. The interface says which is which.

### Why this does not come from the grid

It is the obvious thing to try, and it was tried and measured. Sampling the solved
velocity just off the skin produces a map that tracks how thick the body is rather than
what the air is doing: the crown of the fuselage reads C<sub>p</sub> +0.63 where it should
be about −0.1, higher than the nose, and doubling the grid resolution makes it worse
(+0.83).

The cause is the no-slip wall. At this scale it does not grow a boundary layer; it grows a
numerical shear layer about three cells thick, and that layer thickens as √(Δx·L) — so
measured in cells it gets *relatively* worse as the grid is refined, while the body only
gains cells linearly. A 737's fuselage is 1.1 cells in radius at 64 cells and 2.2 at 128;
its wing is under one cell thick at both. An inviscid wall removes the mechanism but
destroys the wake, and a converged resolution sweep with one does not converge: 32, 48, 64
and 96 cells give crown C<sub>p</sub> of −0.147, +0.649, +0.322 and +0.904. It is not a
resolution problem, and no setting fixes it.

So the surface gets a surface method, and the grid keeps the volume. That split is stated
in the interface rather than hidden.

### The panel model

Three solvers, each checked against a result known long before computers, because a panel
method will return a confident, smooth, entirely wrong answer if a sign is backwards and
nothing in the output looks wrong.

- **A vortex lattice** over the lifting surfaces gives the span loading — where sweep,
  taper, twist and tip devices make their difference. Lift slope 5.514 per radian against
  lifting-line theory's 5.585 at aspect ratio 16, converging as the span grows; span
  efficiency converges onto the elliptical minimum at first order.
- **A Hess–Smith section solve** at each spanwise station turns that into a chordwise
  pressure distribution — where the airfoil family makes its difference. On NACA 0012,
  the most measured section in existence: minimum C<sub>p</sub> −0.413 at 11.6% of chord,
  against a published −0.41 at about 12%.
- **Bodies of revolution** cover the fuselage and nacelles, against the exact Rankine
  ovoid: mean error in C<sub>p</sub> of 0.007.

The whole aircraft solves in 70 to 170 milliseconds, once, when the aircraft changes. The
result is written onto the aircraft's own vertices, so the number the colour is drawn from
is the same number Stage 8 will integrate into lift and drag — a picture is not something
a force balance can be checked against, but a vertex attribute is.

The geometry is handed over from the builder rather than rebuilt from the specification.
Deriving the planform a second time would agree today and drift later, and then the
pressure map would describe a wing that is not the one on screen.

### What it does not know

It is inviscid, incompressible and linear. No boundary layer, so no separation and no
stall: push the lift high enough and it will report a suction peak no real section could
hold. No compressibility, so the shock that forms on a swept wing near its cruise Mach is
absent — which matters, because delaying that shock is precisely what the supercritical
section was invented to do. What the picture shows is the pressure distribution that makes
a shock more or less likely, not the shock. Parts the model has never seen — pylons,
spinners, fan blades — are left at the free-stream value rather than given a guess.

One limitation is worth stating on its own, because it affects conclusions rather than
pictures. Washout costs inviscid span efficiency, and these wings carry one camber value
from root to tip, so there is nothing to compensate it: the 787's five degrees of washout
takes its span efficiency from 1.01 to 0.61. A real wing is twisted and cambered together
so the two come out elliptical at cruise, which is what modern wings do best. Left alone,
the model would report that airliners got *less* efficient with time. Stage 8 has to vary
camber along the span before publishing any comparison of induced drag across the eras.

## The wake

A wing that lifts must trail vorticity. Circulation cannot stop in the fluid, so wherever
the bound circulation changes along the span, the difference leaves downstream — strongest
at the tip, where it falls to nothing over the last few feet of wing. The energy left in
that wake *is* the induced drag. It is not a kind of friction and it is not a defect of
manufacture: it is the price of making lift with a wing of finite span, and the tip vortex
is what it looks like.

Two things make the wake visible here, and they are solved differently because the grid
can do one and not the other.

### Holding the rotation together

Semi-Lagrangian advection is unconditionally stable and badly diffusive, and the first
thing it smears is the tightest structure in the domain. Measured on a 737, the wake loses
a quarter of its rotation between 55% and 92% of the tunnel's length — numerical
diffusion, not air.

Vorticity confinement puts it back. It measures where vorticity is concentrating, by
taking the gradient of its magnitude, and adds a small force that pushes rotation back up
that gradient. It creates nothing; it resists the scheme's tendency to smear what is
already there. The force is gated on the magnitude of the vorticity itself, and that gate
is the whole reason it is safe: a uniform stream has no rotation at all, so however hard
the force is driven it cannot reach the air arriving at the aircraft.

The strength is 0.05, from a sweep recorded in the source. At that setting the wake holds
its rotation and the upstream flow is numerically identical to confinement switched off.
At fourteen times it, the force outruns the dissipation, rotation grows all the way to the
outlet, and the domain gains a sixth of its energy from nowhere — which is what the gate
exists to prevent and what the sweep was run to find.

### The tip vortices

These do not come from the grid, for the reason stage 5's surface pressure did not: a tip
vortex is centimetres across where it leaves the wing, and a cell here is about a metre.
So the vortex lattice, which already solved the span loading, sheds the trailing system
from it directly. Wherever its circulation changes between one strip and the next, a
filament leaves carrying the difference.

Those filaments do not stay where they are shed. Every element of a trailing sheet sits in
the others' induced field, the edge curls over fastest, and within a span or so the sheet
has wound itself into one concentrated vortex per side — Betz, 1932, and the reason
photographs of wakes show two ropes rather than a ribbon. Each rope carries its side's
whole shed circulation and sits at the centroid of that side's shed vorticity, which for
elliptical loading is at π/4 of the semi-span: the wake is narrower than the wing that
made it.

This is modelled rather than simulated, and it is worth being plain about why it is in
here. Left as a flat sheet, the trailing vorticity is spread so thinly that it is weaker
than the solver's own numerical noise in the wake — present in the field, invisible in it.
Rolled up, the same circulation sits in one core and stands clear. Munk's stagger theorem
says the induced drag depends on the vorticity left in the far field and not on how it got
there, so winding it up moves no force; the test suite holds the model to that by checking
that the rolled and unrolled wakes agree further and further out, at a rate which says
their circulation and their centroid both match.

### Seeing it

Two instruments, because the wake is small and the tunnel is not.

A **cross-flow slice**. The flow slice can colour itself by the part of the velocity at
right angles to the tunnel instead of by speed, which is how a real tunnel surveys a wake
— a rake of yaw probes, because that is the only quantity that shows rotation. Put a
*Cross* slice behind the wing and the two cores show as a symmetric pair of bright spots.

How well they show depends entirely on the grid, and the numbers are worth stating because
the honest answer is "at the default resolution, yes, but they are not the brightest thing
there". Ranking every cell on a plane fifteen metres behind a 747's roll-up station: at
128 cells the cores read 0.139 and 0.145 of the free stream and rank 45th and 33rd of
2,209 — the top two per cent — while the strongest cells on the plane, at 0.28, are the
fuselage-and-fin wake on the centreline. At 64 cells the cores fall to about 0.04 and do
not make the top ten at all. Halving the cell size halves the vortex core, which roughly
triples its swirl, while the body wake grows by half; that is the whole difference.

Colouring that same plane by **speed** shows nothing of the vortex, and the reason is
worth knowing rather than discovering. The swirl is at right angles to the free stream, so
it adds in quadrature: eight per cent of cross-flow changes the magnitude of the velocity
by three parts in ten thousand. The slow core of the wake shows up; the rotation in it
does not.

A **streamline rake**. A row of release points up a vertical line in one spanwise plane,
each drawing a single continuous ribbon — the oldest picture in the subject, and still the
clearest way to see where the air is pushed aside, where it is squeezed and sped up, and
where it never recovers. The plane slides across the span, so you can take it through the
fuselage, through an engine, or out at the tip.

These are *streamlines*, tangent to the field at one instant, where the tracers above are
*pathlines* showing where particles have been. In the steady part of the flow the two
coincide; in the unsteady wake they do not, and neither is wrong. They are traced on the
CPU, which is what makes drawing them as thick ribbons possible — a line with width has to
be expanded into real geometry from points something can see — and they are rebuilt rather
than animated, because the solve is non-dimensional: a streamline's shape is identical at
every setting of the speed slider, and only its colour changes.

### One field, not two

The wake's induced velocity is evaluated once into the same grid the solver uses and added
to the solved field. Everything downstream — the streamlines, the slice, the colour
legend, the readbacks — reads that sum and does not know the two were ever separate. That
is deliberate: this project's one firm rule is that everything is drawn from the same
underlying field. Adding them is legitimate rather than a composite, because a vortex
filament's field is exactly divergence-free, so the sum is still an incompressible flow
and the pressure projection has nothing to undo.

### What limits it

The core radius, and nothing else. A vortex filament is singular on its own axis, so
something has to set the radius at which it turns over into solid-body rotation; in a real
tip vortex that is viscosity and the core is a few centimetres, while here it is the grid,
at one and a half cells. Once the wake has rolled up, that single number sets how strong
the vortex looks: its fastest air is Γ/2πr at the core radius, which on a 737 at 64 cells
is 4% of the free stream against a measured 4.3%, and at the default 128 cells about 8% —
the right magnitude for an airliner at cruise.

What the core does not touch is the circulation, and so nothing outside the core: the
downwash across the span, the upwash beyond the tips and the induced drag are right at any
resolution. The strength of the vortex is correct; only its concentration is as tight as
the grid allows.

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

There are also scripts that drive the built app in headless Chromium, for checking a stage
without a person in the loop:

```bash
npm run build && npm run preview
npm run shots  -- comet1 boeing747-100 concorde   # three-quarter views
npm run views  -- boeing747-100                   # side, top and front views
npm run verify:flow                               # physics of the solved field
npm run verify:streamlines                        # physics of the tracers
npm run verify:pressure                           # physics of the surface pressure
npm run verify:wake                               # physics of the trailing wake
npm run verify:rake                               # physics of the streamline rake
```

## Layout

```
src/
  aircraft/     specs, roster, airfoil maths, geometry builders
  core/         renderer, camera, shared state
  physics/      flow solver, streamlines, panel methods, distance fields, GPU passes
  tunnel/       working section, fans
  ui/           selector, info card, styles
scripts/        roster generator, headless screenshot and verification tools
tests/          unit tests
```
