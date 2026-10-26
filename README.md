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
| 7 | Performance and quality tiers | Done |
| 8 | Fuel-efficiency analytics | Done |

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
reaches the solver; it scales the readouts, how fast the streamlines are carried, and how
many solver steps a frame is worth. Besides being ordinary practice in computational
aerodynamics, it fixes the CFL number, so dragging the slider from nothing to Mach 1
cannot destabilise the solve. Compressibility will arrive as an analytic correction rather
than being simulated.

That last one — how many steps a frame is worth — was got wrong first and is worth
recording. The solver has no idea how much *time* a step represents, because it works at a
free stream of exactly 1, so only the display can say. Stepping once per frame made the
wake shed at the same rate at taxi speed as at cruise, when shedding frequency follows a
roughly constant Strouhal number and should scale with airspeed; it also tied the flow's
rate to the frame rate, so the same wake evolved more slowly on a slower machine. Measured
on a 737 at 128 cells, one step per frame ran the field at 0.68× real time at 100 km/h —
*faster* than reality — and 6.1× slow at 900 km/h, while the tracers it carried were drawn
at a fixed twelfth of real time throughout. The number of steps is now worked out from the
elapsed time and the airspeed, and the whole flow runs on one clock.

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
the model would report that airliners got *less* efficient with time.

Stage 8 followed that up and the answer turned out to be no. Spanwise camber was added to
the builder and measured, and at plausible section cambers it buys about two to three
degrees of zero-lift angle at the tip — which cannot pay for five degrees of washout. The
capability is in `camberTip` and no aircraft in the roster sets it, because using it to
cancel twist would be fitting the geometry to the answer. What actually fixed the era
comparison was elsewhere: the Trefftz rewrite below, and trimming the aircraft in pitch.

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

The wake is small and the tunnel is not, so it needs an instrument.

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

## Quality tiers

Everything that trades frame rate against fidelity is on one dial, in
`src/core/quality.ts`: the solver grid, the pressure sweeps, the obstacle field, the
aircraft tessellation, the tracer count and the render scale.

| | Low | Balanced | High |
|---|---|---|---|
| Flow grid | 64 cells | 96 | 128 |
| Cells total | 62k | 212k | 508k |
| Pressure sweeps | 20 | 30 | 40 |
| Obstacle field | 64³ | 80³ | 96³ |
| Aircraft mesh | low | high | high |
| Tracers | 1,024 | 4,096 | 16,384 |
| Render scale | 1.0× | 1.25× | 1.5× |

High is what every stage before this one ran at unconditionally, so the top tier is not
new behaviour — it is the old behaviour, named and no longer compulsory. The spread is
worth having: a step from High to Low is about thirty times less solver work.

### The rule the tiers must not break

**A tier changes what the grid resolves and how the picture looks. It never changes a
number the application reports.** Lift-to-drag, span efficiency and fuel per seat come
from the panel method and the vortex lattice on the CPU, at a station count fixed by
`AERO_STATIONS` and a tessellation fixed by `AERO_DETAIL`.

That rule had already been broken twice, both times expensively. A lattice taking its
station count from the visual detail gave a 737 MAX a lift-to-drag ratio of 16.9 at high
detail and 14.6 at low. A filament core radius measured in panel widths grew at low
detail until it lifted a 777's tip section above its root, which washout makes
impossible. Building this stage found a third: wetted area is measured off real
triangles, so a finer mesh has more of it, and a 787 at high detail reported 1.6% more
wetted area and 1.6% less lift-to-drag than the same aircraft at low. Handing the viewer
a control that changes mesh detail would have made that a user-visible inconsistency, so
the measurement is now pinned to one tessellation regardless of what is on screen.
`tests/quality.test.ts` holds the line, and `npm run verify:quality` checks it again in
the real app.

### Choosing a tier

The app starts at High and measures. If the machine cannot hold it the frame meter steps
down a tier and says why; a tier chosen by hand is remembered and stops the meter
adjusting. It only ever steps **down** — any promotion threshold close enough to be
useful is close enough to oscillate, and each change of mind costs a solver rebuild and a
visible hitch.

Getting that measurement right took three attempts, and each failure was the same shape:
a rule that looked like it was rejecting noise was actually rejecting the signal.

- **It read the viewer's frame delta**, which is clamped to a tenth of a second so one
  long frame cannot blow the simulation up. Correct for stepping the physics, ruinous for
  measuring: every machine below ten frames a second reported as exactly ten. The meter
  now times itself.
- **It discarded frames longer than a cutoff** as "a hidden tab, not a slow frame". That
  discards the whole population on a slow machine and keeps the handful of quick ones —
  on headless software rendering it reported 37 fps on a page managing 0.2. Long frames
  are now clamped rather than dropped, so they still count; the hidden-tab case is handled
  by clearing the window when the tab comes back.
- **It compared the median frame interval**, which ignores gaps, and gaps are the thing
  being measured. Frames arriving in bursts separated by stalls have a fast median and a
  terrible throughput. It now uses throughput — total time over frames in it — which is
  what a viewer actually experiences.

## Cruise performance

Stage 8 asks the question the project exists for: how much fuel does each of these
aircraft burn per seat, and what did the engineering buy. The answer is assembled from
three different kinds of number, and the interface labels each one.

**Simulated** — the induced drag. The vortex lattice is trimmed to the aircraft's cruise
weight, the wake is integrated in the Trefftz plane, and the span efficiency that falls
out is the model's own answer. Nothing about it is looked up.

**Derived** — the parasite and wave drag, from published correlations, because an
inviscid method cannot produce either. Skin friction is Prandtl–Schlichting over the
wetted area that is measured off the actual triangle mesh, raised by a form factor for
each component's thickness (Hoerner for bodies, Raymer for nacelles, Shevell for
surfaces) and an interference factor for the junctions it makes, plus four per cent for
leakage and protuberances. Wave drag starts at the Korn drag-divergence Mach and rises as
Mason's fourth power.

**Published** — mass, seat count, thrust-specific fuel consumption, wing area and span.
These are book values and are never adjusted to improve agreement.

### The analysis sheet

**Cruise analysis**, bottom left, opens a sheet over the tunnel. It carries the headline
figures for the aircraft on screen, the chart of fuel per seat across the eras, and the
drag broken down by where it goes.

It is a sheet rather than a fourth card in a corner because the chart is the argument the
whole project is making, and a chart squeezed into a 300-pixel column is a decoration.
Every figure wears a badge saying whether it was simulated, derived or published, and the
sheet ends with what those three words mean. Points on the chart are clickable: picking
one loads that aircraft into the tunnel.

The roster's figures are precomputed into `src/physics/performance/cruiseDataset.ts`,
because a trimmed solve is about a second and a half per aircraft and the chart needs all
twenty-one at once. They come from the same code the application runs, and
`tests/cruiseDataset.test.ts` recomputes the whole roster on every test run and fails if
the committed numbers have drifted — a cache nobody checks is a lie waiting to happen.
Rebuild it with `npm run dataset`.

### Trimming, and why it mattered

The aircraft is solved for the angle of attack *and* the stabiliser incidence that
together carry the weight with no pitching moment left over, about a centre of gravity
assumed at 25% of the mean aerodynamic chord for every aircraft in the roster.

That assumption is stated rather than researched because cruise centre of gravity is
rarely published, and twenty-one estimates dressed as sources would be worse than one
honest constant. It is not a detail: moving the centre of gravity aft unloads the
tailplane and cuts trim drag, which is exactly why large aircraft pump fuel into a tail
tank.

Trimming only for lift — which is what the first version did — leaves the tailplane at
whatever incidence the geometry gives it, and for every aircraft here that is zero to the
body axis. The tail load then tracks angle of attack instead of balance: a Comet cruising
at 0.65° carried 8% of its lift *downward*, a 737 MAX at 4.87° carried 7% *upward*. A
short-span surface carrying several per cent of the lift is expensive in induced drag, and
it was wrecking the modern, highly loaded aircraft in particular. An A350 reported a span
efficiency of 0.733 against 0.912 for its wing alone, while a near-identical 787 wing
reported 0.938 against 0.902 — a difference between the models, not between the
aeroplanes. Trimmed, every aircraft carries a download — two to six per cent of its
weight for nineteen of the twenty, and the A350 reads 0.982. The Comet is the exception
at 12%, which is more than a transport should need and is still open; its tail is small
and its wing root chord long, so the moment arm the model gives it is short.

The removal uncovered a second error that had been hiding behind the first. With the
spurious tail upload gone, all twenty aircraft reported a lift-to-drag ratio *above* the
published figure — twenty out of twenty, which is a missing term and not scatter. The
component build-up had no interference factors and no leakage allowance, and the induced
drag of the bogus tail load had been standing in for them. Adding both, with Raymer's
published values and no tuning, took the mean error from 12.8% to 7.4%.

### How close it gets

Simulated cruise lift-to-drag against published, at 22 spanwise stations:

| Aircraft | Simulated | Published | Error |
|---|---|---|---|
| de Havilland Comet 1 | 15.8 | 13.5 | +17% |
| Sud Aviation Caravelle III | 16.1 | 13.0 | +24% |
| Boeing 707-120 | 17.8 | 15.5 | +15% |
| Douglas DC-8-10 | 17.7 | 15.8 | +12% |
| Boeing 727-200 | 16.3 | 15.0 | +9% |
| Boeing 737-200 | 15.9 | 15.0 | +6% |
| Boeing 747-100 | 18.2 | 17.0 | +7% |
| Airbus A300B4 | 17.5 | 16.5 | +6% |
| McDonnell Douglas MD-82 | 17.0 | 16.0 | +6% |
| Boeing 767-200 | 17.8 | 17.5 | +2% |
| Boeing 757-200 | 17.7 | 17.0 | +4% |
| Airbus A320-200 | 18.0 | 17.0 | +6% |
| Airbus A340-300 | 21.5 | 18.0 | +19% |
| Boeing 777-200 | 18.7 | 19.0 | −1% |
| Boeing 737-800 | 18.2 | 18.0 | +1% |
| Airbus A380-800 | 20.6 | 19.0 | +8% |
| Boeing 787-8 | 20.4 | 20.5 | −1% |
| Airbus A350-900 | 21.2 | 21.0 | +1% |
| Airbus A320neo | 18.2 | 18.0 | +1% |
| Boeing 737 MAX 8 | 18.3 | 18.5 | −1% |

Mean absolute error 7.4%. Concorde is not estimated: at Mach 2.02 the drag correlations
here describe the start of the transonic rise and not supersonic flight, where wave drag
comes from the volume distribution along the aircraft and needs a different calculation.

The residual error has a shape, and the shape is informative. Aircraft from 1980 onwards
land within a few per cent. The 1950s aircraft are over-predicted by 12 to 24%, and the
likeliest reason is that the model gives every aircraft a modern skin. Excrescence drag —
protruding rivet heads, unsealed panel joints, the thousand small roughnesses of a 1949
airframe — is not modelled, and it was a far larger share of drag then than now. That is
a real omission rather than noise, and it is **not** corrected by an era factor, because
an era factor tuned until the chart looks right is not a measurement. The A340 at +19% is
the outlier that era does not explain and is still open.

### What the span efficiency is worth

Span efficiency is converged in method but not in grid. The elliptical and rectangular
planform checks converge cleanly at first order, and the multi-surface case reproduces
Prandtl's biplane interference at both exact limits. But at the 22 stations the
application runs, refinement is not clean for a real aircraft: a DC-8 reads 0.976, 1.027,
0.992, 1.003 at 22, 30, 40 and 56 stations, and a 787 oscillates 0.924, 0.983, 0.956,
0.954. The scatter comes from where planform breaks happen to fall relative to grid
points, so Richardson extrapolation does not remove it.

The honest figure is therefore **±0.03 on span efficiency**, which is about ±1% on
lift-to-drag. Values slightly above 1.0 in the table are inside that band and are
discretisation, not a wing beating the elliptical minimum. Refining is not the answer:
going from 22 to 56 stations costs five times the solve time (1.4 to 7.1 seconds per
aircraft) and moves the mean error by 0.8 of a percentage point.

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

The aerodynamics is held to results that were known long before anyone could compute
them: an elliptical planform reaching the minimum induced drag, a lift slope approaching
2π, Prandtl's biplane interference at both of its exact limits, and a trimmed aircraft
carrying a tail download rather than an upload.

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
npm run verify:clock                              # the simulation runs on one clock
npm run verify:analysis                           # the cruise analysis sheet and its chart
npm run verify:quality                            # the quality tiers, and what they must not touch
```

`verify:analysis` is the one that keeps the chart honest. A chart is the part of a
project that can be entirely wrong and still look finished, so it measures rather than
looks: every mark carries the value it was drawn from, more fuel has to plot higher, a
later aircraft has to plot further right, the axis has to contain the data, exactly one
mark may be emphasised, the stacked bar's segments have to add up to the bar, and every
headline figure has to carry its provenance badge.

```bash
npm run dataset   # recompute the precomputed cruise figures
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
