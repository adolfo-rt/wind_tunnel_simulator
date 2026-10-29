# Glossary

Everything this simulator shows, in plain language. Terms are grouped by what they are
about rather than alphabetically, because most of them only make sense next to their
neighbours. Where a number helps, it is a real one from this project — usually the
Boeing 787-8, which the app will happily show you.

---

## The four forces

**Lift** — the upward force that holds the aircraft up. A wing makes it by turning air
downwards; the reaction pushes the wing up. In cruise it exactly equals the weight.

**Weight** — what lift has to balance. A 787 at cruise weighs 1.94 million newtons
(198 tonnes).

**Drag** — the backward force resisting motion. In cruise it exactly equals thrust. The
whole project is about making this number smaller.

**Thrust** — the forward force from the engines. Because thrust equals drag in level
flight, **drag is what you burn fuel to overcome** — which is why a drag figure can be
turned straight into a fuel figure.

---

## The two kinds of drag

These are physically unrelated and happen to share a word. The distinction is the single
most important idea in the project.

**Induced drag** — the price of making lift. A wing of finite span throws air downwards,
which tilts its lift vector backwards; the backward part is induced drag. It would exist
even in a frictionless fluid. It depends on **lift, wingspan and how evenly the lift is
spread** — not on wing area.

> Falls as you fly faster (∝ 1/V²). Improved by more **span**: winglets, raked tips.

**Parasite drag** — the price of merely existing. Everything you would pay to drag the
shape through the air even if it made no lift at all. It depends on **wetted area**, not
span. It breaks into:

- **Skin friction** — air rubbing along every exposed surface. The largest single
  component on an airliner.
- **Form (pressure) drag** — the penalty for having thickness rather than being a
  flat plate.
- **Interference drag** — extra loss where components meet, e.g. a nacelle on a pylon
  under a wing.
- **Excrescence / leakage drag** — rivet heads, panel gaps, door seals, antennas. Each
  negligible, and there are thousands. *Not modelled here*, which is why the 1950s
  aircraft read optimistically.

> Rises as you fly faster (∝ V²). Improved by **smoother, smaller surfaces**.

**Wave drag** — a third kind, appearing only near the speed of sound, when the airflow
over the wing goes supersonic and forms shock waves. Zero below a certain speed (see
*drag-divergence Mach*), then rises very steeply.

**Why the split matters:** induced drag falls with speed and parasite drag rises, so
total drag is **minimised where the two are equal**. The A380 in this roster cruises at
50.0% induced / 50.0% parasite — essentially exactly at its best point. The 1949 Comet
sits at 21% induced, far from the balance, wasting most of its drag on friction.

**Lift-to-drag ratio (L/D)** — lift divided by drag; the headline measure of
aerodynamic efficiency. A 787 reads **20.4**: it produces 20.4 newtons of lift for every
1 newton of drag. The Comet managed 15.8. Higher is better, and it is dimensionless, so
it compares aircraft of any size fairly.

---

## Describing the air

**Free stream** — the undisturbed air far from the aircraft, before the aircraft has
affected it. The reference everything else is measured against.

**Streamline** — the path a particle of air follows through the flow. The moving traces
in the tunnel are streamlines; where they bunch together the air is moving faster.

**Angle of attack (α)** — the angle between the wing and the oncoming air. More angle
means more lift, up to the point of stall. A 787 cruises at about **5.4°**.

**Dynamic pressure (q)** — the "pushing power" of moving air, ½ρV². It scales with
density and the *square* of speed, which is why doubling speed quadruples the force.

**Surface pressure / pressure coefficient (C_p)** — how much the pressure on the
aircraft's skin differs from the free stream, expressed as a dimensionless number.

- **Negative C_p (blue)** = *suction*, air moving faster than the free stream. The upper
  surface of a wing is strongly negative — **lift is mostly suction from above**, not
  push from below.
- **Positive C_p (red)** = air slowed down, e.g. on the nose.
- **C_p = 1** = air brought completely to rest.

Because it is a coefficient, it does **not** change when you move the speed slider. That
is the point of a coefficient.

**Stagnation point** — where the flow comes to a complete stop, on the nose and the wing
leading edge. C_p = 1 there.

**Boundary layer** — the very thin film of air right against the skin, slowed by
friction. It is where skin friction drag comes from. *Not resolved in this simulation* —
it is far too thin.

**Wake** — the disturbed, slower air trailing behind the aircraft.

**Vortex** — a rotating mass of air. **Tip vortices** form at the wingtips because
high-pressure air beneath the wing escapes around the tip into the low-pressure region
above. They are the visible signature of induced drag, and they are what the *cross-flow*
slice is designed to reveal.

**Circulation (Γ)** — a measure of how much the air rotates around the wing section. It
is the mathematical quantity that *generates* lift, and it is what this simulator
actually solves for.

**Downwash** — the downward deflection of air behind a lifting wing. The cause of induced
drag.

**Separation / stall** — when the airflow detaches from the wing surface and lift
collapses. *Not modelled here* — this simulation has no viscosity, so it cannot predict
stall and will happily report lift no real wing could produce.

---

## The dimensionless numbers

These let you compare aircraft of wildly different sizes. That is their whole purpose.

**Mach number (M)** — speed as a fraction of the speed of sound. M 0.85 is a modern
airliner's cruise. Above about M 0.8 compressibility starts to matter.

**Reynolds number (Re)** — the ratio of inertial to viscous forces; effectively "how big
and fast relative to how sticky the air is". A real airliner at cruise sits near
**5 × 10⁷**. This matters enormously: a browser cannot resolve that, which is the
central honest limitation of the project.

**Lift coefficient (C_L)** — lift made dimensionless by dynamic pressure and wing area.
A 787 cruises at **C_L 0.544**; the Comet at 0.270. Higher means the wing is working
harder for its size.

**Drag-divergence Mach (M_dd)** — the speed at which wave drag begins to appear. A 787's
is **0.883**, and it cruises at 0.85 — about 0.03 in hand. Airliners are deliberately
designed to cruise just below this line.

---

## Wing shape

**Chord** — the distance from the leading edge to the trailing edge of a wing section.

**Mean aerodynamic chord (MAC)** — the single chord length that represents the whole
wing. Centre of gravity is quoted as a percentage of it.

**Span (b)** — wingtip to wingtip. 60.1 m on a 787.

**Wing area (S)** — the plan-view area of the wing. 377 m² on a 787.

**Aspect ratio (AR)** — span² / area; effectively "how long and thin the wing is".
A 787 is **9.59**, the 1949 Comet only 6.56. **High aspect ratio means low induced
drag**, which is why modern wings are so slender — and why they need composites to be
stiff enough.

**Taper** — how much the wing narrows from root to tip.

**Sweep** — how far the wing is angled backwards (32.2° on a 787). Sweep delays the
onset of wave drag, which is what makes high-subsonic cruise possible.

**Dihedral** — the upward V-angle of the wings seen from the front. It provides roll
stability.

**Twist / washout** — the tip set at a lower angle than the root, so the tip stalls last.
It costs some efficiency, which the simulator measures.

**Camber** — the curvature of the wing section. A cambered section makes lift even at
zero angle of attack.

**Thickness ratio (t/c)** — thickness as a fraction of chord. Thinner delays wave drag
but is structurally harder.

**Airfoil / section** — the 2-D cross-sectional shape of the wing. A **supercritical**
section is specially shaped to delay shock formation, worth ~0.10 in M_dd over a 1940s
section — the single biggest aerodynamic advance in the roster.

**Winglet / raked tip** — devices that extend effective span to cut induced drag without
a wider wingspan (airport gates limit span to 80 m).

**Wetted area** — the total surface area actually in contact with air. **2,112 m²** on a
787, against 377 m² of wing. This is what sets skin friction drag.

**Span efficiency (e)** — how close the lift distribution is to the ideal elliptical
shape. 1.0 is perfect; a 787 reads **0.924**. Lower means more induced drag for the same
lift.

---

## Balance and trim

**Pitching moment** — the tendency to rotate nose-up or nose-down.

**Centre of gravity (CG)** — the balance point. This project assumes 25% of MAC for every
aircraft.

**Tailplane / horizontal stabiliser** — the small wing at the tail that balances the
aircraft in pitch.

**Trim** — setting the controls so the aircraft balances: lift equals weight *and* the
pitching moment is zero. A conventional airliner trims with a small **download** on the
tail — 4.5% of weight on a 787, with the stabiliser set to −3.5°.

**Trim drag** — the extra drag from carrying that balancing load. It is why large
aircraft pump fuel into a tail tank: moving the CG aft unloads the tail and saves fuel.

---

## How the simulation works

**Navier–Stokes equations** — the fundamental equations of fluid motion. This simulator
solves the **incompressible** form: it assumes air density does not change, which is good
up to about M 0.3 and increasingly approximate above it.

**Inviscid / potential flow** — flow without viscosity. Fast to compute, but it cannot
produce friction.

**d'Alembert's paradox** — the proof that steady inviscid flow around a closed body
produces **exactly zero drag**. This is not a bug; it is why parasite drag here must come
from experimental correlations rather than from the simulation.

**Panel method** — representing a surface as many small panels, each carrying a
mathematical singularity, and solving for their strengths. This produces the surface
pressure map.

**Vortex lattice method (VLM)** — the wing modelled as a grid of horseshoe-shaped
vortices. This produces lift and induced drag.

**Trefftz plane** — an imaginary plane far downstream where induced drag is measured by
the energy left in the wake. Easier and more accurate than summing forces on the wing.

**Grid / cell / resolution** — the simulation divides the tunnel into a 3-D grid of cells.
More cells means finer detail and much more computation: cost scales with the **cube** of
resolution, which is what the quality tiers control (62k cells at Low, 508k at High).

**Non-dimensional solve** — the solver runs with the free-stream speed set to exactly 1,
and the display converts back to m/s. This keeps the simulation stable at any slider
setting.

---

## Fuel and efficiency

**TSFC (thrust-specific fuel consumption)** — how much fuel an engine burns per unit of
thrust per hour. The engine's efficiency, separate from the airframe's.

**Breguet range equation** — the classical relation linking range to L/D, fuel
consumption and weight. This project uses its differential form: *fuel flow = TSFC ×
drag*.

**Fuel per seat per 100 km** — the project's headline measure, and the fairest
comparison across eras because it accounts for aircraft size. The Comet 1 burned
**8.48 kg**; a 737 MAX burns **1.34 kg** — a sixfold improvement in seventy years.

---

## Reading the numbers in the app

Every figure in the cruise analysis is labelled with where it came from:

| Label | Meaning |
|---|---|
| **simulated** | Solved here, by the vortex lattice. Induced drag and span efficiency. |
| **derived** | From published correlations applied to simulated or measured quantities. Parasite and wave drag. |
| **published** | Book figures — mass, seats, fuel consumption, wing area. Never adjusted to improve agreement. |

The model's mean error against published L/D is **7.4%**. Modern aircraft land within
1–2%; 1950s types read 12–24% high because excrescence drag is not modelled.
