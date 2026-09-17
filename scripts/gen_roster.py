#!/usr/bin/env python3
"""Emit src/aircraft/roster.ts from a table of published airliner dimensions.

Kept as a generator so every aircraft is described the same way and the numbers
can be audited in one place. Run from the project root:

    python3 scripts/gen_roster.py
"""

A = []
def ac(**k): A.append(k)

# id, mfr, model, year, mach, alt(m), innovation
# fus: L, D, wr, nf, tf, ups, exp, deck
# wing: planform, span, cr, ct, sweep, dih, twist, tr, tt, camber, family, rootFrac, vOff, winglet, wh, kink, kinkC, inc
# eng: type, mount, count, bpr, nl, nd, stations, fusFrac
# tail: cfg, hs, hr, ht, hsw, hdih, vh, vr, vt, vsw
# ref: area, mtow, cruiseMass, seats, range, LD, tsfc  (spanOverallM added below)
# livery: fus, stripe, tail, wing, engine

ac(id='comet1', mfr='de Havilland', model='Comet 1', year=1949, mach=0.70, alt=10700,
   innovation='The first jet airliner. Engines buried in the wing roots keep the nacelles out of the airflow, but a thick unswept-ish wing limits it to Mach 0.70.',
   fus=(28.35, 3.05, 1.0, 1.7, 3.0, 4.0, 2.0, 'single'),
   wing=('trapezoid', 35.05, 8.22, 2.46, 20.0, 5.0, -2.0, 0.115, 0.095, 0.020, 'naca4', 0.36, -0.55, 'none', 0.0, 0.42, 0.62, 2.0),
   eng=('turbojet', 'wing-root-buried', 4, 0.0, 4.6, 1.15, [0.18, 0.28], None),
   tail=('conventional', 11.2, 3.2, 1.4, 15.0, 6.0, 4.6, 5.0, 2.2, 30.0),
   ref=(187.2, 47600, 42000, 44, 2400, 13.5, 1.05),
   liv=('#eef1f4', '#1b3f6e', '#1b3f6e', '#c9ced4', '#b7bec6'))

ac(id='caravelle', mfr='Sud Aviation', model='Caravelle III', year=1955, mach=0.72, alt=10700,
   innovation='Moved the engines to the rear fuselage, leaving a completely clean wing. The idea was copied by almost every short-haul jet for the next twenty years.',
   fus=(32.01, 3.20, 1.0, 1.7, 2.9, 5.0, 2.0, 'single'),
   wing=('trapezoid', 34.30, 6.33, 2.22, 20.0, 3.0, -2.0, 0.120, 0.100, 0.020, 'naca4', 0.30, -0.55, 'none', 0.0, 0.40, 0.60, 2.0),
   eng=('turbojet', 'rear-fuselage', 2, 0.0, 5.0, 1.30, [], 0.72),
   tail=('conventional', 11.4, 3.4, 1.4, 25.0, 5.0, 4.9, 5.4, 2.4, 35.0),
   ref=(146.7, 46000, 41000, 80, 1845, 13.0, 0.92),
   liv=('#f2f4f6', '#0d3b66', '#0d3b66', '#ccd2d8', '#aeb6bf'))

ac(id='boeing707', mfr='Boeing', model='707-120', year=1957, mach=0.80, alt=10700,
   innovation='35 degrees of wing sweep, podded engines slung ahead of and below the wing. This layout became the template for essentially every jet airliner since.',
   fus=(44.07, 3.76, 1.0, 1.7, 3.0, 5.0, 2.0, 'single'),
   wing=('trapezoid', 39.90, 9.10, 2.37, 35.0, 7.0, -3.0, 0.120, 0.095, 0.018, 'naca4', 0.34, -0.55, 'none', 0.0, 0.38, 0.60, 2.0),
   eng=('turbojet', 'wing-pylon', 4, 0.0, 5.5, 1.35, [0.28, 0.52], None),
   tail=('conventional', 13.95, 4.5, 1.6, 35.0, 7.0, 6.5, 7.5, 3.0, 35.0),
   ref=(226.3, 112037, 98000, 137, 5600, 15.5, 0.86),
   liv=('#f4f6f8', '#123a6d', '#123a6d', '#c6ccd3', '#b2b9c1'))

ac(id='dc8', mfr='Douglas', model='DC-8-10', year=1958, mach=0.82, alt=10700,
   innovation='A slightly thinner wing at 30 degrees of sweep, trading a little cruise Mach for better low-speed behaviour and a shorter field length.',
   fus=(45.87, 3.73, 1.0, 1.7, 3.0, 5.0, 2.0, 'single'),
   wing=('trapezoid', 43.41, 9.27, 2.60, 30.6, 6.0, -3.0, 0.120, 0.095, 0.018, 'naca4', 0.34, -0.55, 'none', 0.0, 0.38, 0.60, 2.0),
   eng=('turbojet', 'wing-pylon', 4, 0.0, 5.6, 1.40, [0.28, 0.52], None),
   tail=('conventional', 14.3, 4.6, 1.7, 32.0, 6.0, 6.6, 7.6, 3.1, 35.0),
   ref=(257.6, 123500, 108000, 177, 6000, 15.8, 0.84),
   liv=('#f5f6f8', '#8c1d2c', '#8c1d2c', '#c9ced4', '#b4bac2'))

ac(id='boeing727', mfr='Boeing', model='727-200', year=1963, mach=0.82, alt=10000,
   innovation='A T-tail trijet with the centre engine fed by an S-duct, and triple-slotted flaps so a fast, highly swept wing could still use short runways.',
   fus=(46.69, 3.76, 1.0, 1.6, 2.9, 6.0, 2.0, 'single'),
   wing=('trapezoid', 32.92, 7.49, 2.10, 32.0, 3.0, -3.0, 0.118, 0.095, 0.018, 'peaky', 0.33, -0.55, 'none', 0.0, 0.38, 0.58, 2.0),
   eng=('low-bypass', 'rear-fuselage', 3, 1.0, 4.6, 1.25, [], 0.78),
   tail=('t-tail', 10.9, 3.6, 1.4, 36.0, 4.0, 7.0, 8.0, 3.2, 45.0),
   ref=(157.9, 95028, 84000, 149, 4450, 15.0, 0.80),
   liv=('#f4f5f7', '#6b4c1e', '#6b4c1e', '#c8cdd3', '#b3b9c1'))

ac(id='boeing737_200', mfr='Boeing', model='737-200', year=1967, mach=0.73, alt=9500,
   innovation='Engines tucked tight under a short wing to keep the aircraft low to the ground. Cheap and simple, but the low-bypass JT8D burns a great deal of fuel.',
   fus=(30.53, 3.76, 1.0, 1.6, 2.8, 6.0, 2.0, 'single'),
   wing=('trapezoid', 28.35, 5.10, 1.33, 25.0, 6.0, -3.0, 0.128, 0.100, 0.020, 'peaky', 0.36, -0.60, 'none', 0.0, 0.36, 0.60, 1.0),
   eng=('low-bypass', 'wing-pylon', 2, 1.0, 4.9, 1.35, [0.34], None),
   tail=('conventional', 10.8, 3.4, 1.2, 30.0, 7.0, 5.2, 5.8, 2.4, 35.0),
   ref=(91.05, 52390, 46000, 115, 4180, 15.0, 0.80),
   liv=('#f5f6f8', '#12457e', '#12457e', '#c9ced4', '#b4bac2'))

ac(id='boeing747_100', mfr='Boeing', model='747-100', year=1969, mach=0.84, alt=10700,
   innovation='The first widebody, and the first airliner with high-bypass turbofans. Spreading 366 seats across one airframe cut fuel per seat dramatically.',
   fus=(70.66, 6.50, 1.0, 1.5, 2.7, 6.0, 2.15, 'partial-upper'),
   wing=('trapezoid', 59.64, 13.60, 3.54, 37.5, 7.0, -4.0, 0.135, 0.090, 0.018, 'peaky', 0.30, -0.55, 'none', 0.0, 0.36, 0.58, 2.0),
   eng=('high-bypass', 'wing-pylon', 4, 5.0, 7.0, 2.70, [0.27, 0.50], None),
   tail=('conventional', 22.2, 7.0, 2.2, 36.0, 7.0, 9.8, 11.5, 4.4, 45.0),
   ref=(511.0, 333400, 290000, 366, 9800, 17.0, 0.63),
   liv=('#f6f7f9', '#0b2d5c', '#0b2d5c', '#c9ced4', '#b0b7bf'))

ac(id='concorde', mfr='BAC / Sud Aviation', model='Concorde', year=1969, mach=2.02, alt=18300,
   innovation='An ogival delta tuned for Mach 2. It shows the other side of the trade: unbeatable speed, but a lift-to-drag ratio less than half a subsonic airliner’s.',
   fus=(61.66, 2.88, 1.0, 5.2, 4.0, 2.0, 2.0, 'single'),
   wing=('ogival-delta', 25.60, 27.70, 1.20, 55.0, 0.0, -3.0, 0.030, 0.025, 0.004, 'naca4', 0.28, -0.75, 'none', 0.0, 0.50, 0.55, 0.0),
   eng=('turbojet', 'underwing-delta', 4, 0.0, 7.1, 1.40, [0.20, 0.33], None),
   tail=('delta', 0.0, 0.0, 0.0, 0.0, 0.0, 6.4, 11.0, 3.4, 60.0),
   ref=(358.25, 185070, 160000, 100, 7250, 7.5, 1.195),
   liv=('#fbfbfc', '#1d4e89', '#1d4e89', '#eceff2', '#c4cad1'))

ac(id='a300', mfr='Airbus', model='A300B4', year=1972, mach=0.78, alt=10700,
   innovation='The first twin-engined widebody. Two big high-bypass turbofans instead of four smaller ones cut both fuel burn and maintenance cost.',
   fus=(53.62, 5.64, 1.0, 1.5, 2.7, 6.0, 2.25, 'single'),
   wing=('trapezoid', 44.84, 8.92, 2.68, 28.0, 5.0, -3.0, 0.125, 0.095, 0.020, 'peaky', 0.32, -0.60, 'none', 0.0, 0.36, 0.60, 2.0),
   eng=('high-bypass', 'wing-pylon', 2, 4.4, 6.7, 2.90, [0.33], None),
   tail=('conventional', 16.3, 5.4, 1.9, 30.0, 6.0, 8.2, 9.0, 3.6, 40.0),
   ref=(260.0, 165000, 145000, 266, 5375, 16.5, 0.63),
   liv=('#f6f7f9', '#16548f', '#16548f', '#c9ced4', '#b0b7bf'))

ac(id='md80', mfr='McDonnell Douglas', model='MD-82', year=1979, mach=0.76, alt=10700,
   innovation='A long, slender fuselage on a small high-aspect-ratio wing, with refanned JT8D-200s. Efficient for its day, but still a low-bypass engine.',
   fus=(45.06, 3.35, 1.0, 1.7, 3.1, 6.0, 2.0, 'single'),
   wing=('trapezoid', 32.87, 5.69, 1.14, 24.5, 3.0, -3.0, 0.118, 0.095, 0.020, 'peaky', 0.36, -0.60, 'none', 0.0, 0.36, 0.58, 1.5),
   eng=('low-bypass', 'rear-fuselage', 2, 1.73, 5.2, 1.50, [], 0.74),
   tail=('t-tail', 12.2, 3.9, 1.3, 30.0, 4.0, 6.6, 7.2, 3.0, 42.0),
   ref=(112.3, 67812, 60000, 155, 3800, 16.0, 0.73),
   liv=('#f5f6f8', '#b02a34', '#b02a34', '#c9ced4', '#b4bac2'))

ac(id='boeing767', mfr='Boeing', model='767-200', year=1981, mach=0.80, alt=11300,
   innovation='Boeing’s first supercritical wing. A flatter upper surface delays the shock at high subsonic Mach, so the wing can be thicker, lighter and more efficient.',
   fus=(48.51, 5.03, 1.0, 1.5, 2.8, 6.0, 2.25, 'single'),
   wing=('trapezoid', 47.57, 9.84, 2.07, 31.5, 6.0, -4.0, 0.130, 0.090, 0.022, 'supercritical', 0.31, -0.60, 'none', 0.0, 0.35, 0.58, 2.0),
   eng=('high-bypass', 'wing-pylon', 2, 5.0, 6.4, 2.80, [0.33], None),
   tail=('conventional', 18.6, 5.8, 1.9, 32.0, 6.0, 8.3, 9.2, 3.5, 40.0),
   ref=(283.3, 142880, 125000, 216, 7200, 17.5, 0.60),
   liv=('#f6f7f9', '#0f3f76', '#0f3f76', '#c9ced4', '#b0b7bf'))

ac(id='boeing757', mfr='Boeing', model='757-200', year=1982, mach=0.80, alt=11300,
   innovation='A narrowbody with an unusually high aspect ratio and a lot of thrust. High span means low induced drag, which is why it could cross the Atlantic.',
   fus=(47.32, 3.76, 1.0, 1.7, 3.0, 6.5, 2.0, 'single'),
   wing=('trapezoid', 38.05, 7.85, 1.88, 25.0, 5.0, -4.0, 0.125, 0.090, 0.022, 'supercritical', 0.33, -0.60, 'none', 0.0, 0.35, 0.58, 2.0),
   eng=('high-bypass', 'wing-pylon', 2, 4.3, 6.0, 2.50, [0.34], None),
   tail=('conventional', 15.2, 4.8, 1.6, 30.0, 6.0, 7.2, 7.8, 3.0, 38.0),
   ref=(185.25, 115680, 101000, 200, 7222, 17.0, 0.58),
   liv=('#f6f7f9', '#14477f', '#14477f', '#c9ced4', '#b0b7bf'))

ac(id='a320', mfr='Airbus', model='A320-200', year=1987, mach=0.78, alt=11300,
   innovation='Fly-by-wire let the aircraft fly a smaller, more efficient tail safely. Wingtip fences cut the tip vortex and so trim a few percent off induced drag.',
   fus=(37.57, 3.95, 1.0, 1.6, 2.9, 6.5, 2.05, 'single'),
   wing=('trapezoid', 33.91, 5.83, 1.40, 25.0, 5.0, -4.0, 0.125, 0.095, 0.022, 'supercritical', 0.34, -0.60, 'fence', 0.9, 0.36, 0.58, 1.5),
   eng=('high-bypass', 'wing-pylon', 2, 6.0, 4.6, 2.10, [0.34], None),
   tail=('conventional', 12.45, 3.9, 1.3, 29.0, 6.0, 5.9, 6.2, 2.6, 35.0),
   ref=(122.6, 78000, 68000, 150, 6150, 17.0, 0.60),
   liv=('#f7f8fa', '#0a2f6b', '#0a2f6b', '#c9ced4', '#b0b7bf'))

ac(id='a340', mfr='Airbus', model='A340-300', year=1991, mach=0.82, alt=11300,
   innovation='An aspect ratio of about 10, very high for its day. Long thin wings are the most direct way to cut induced drag on a long-range aircraft.',
   fus=(63.69, 5.64, 1.0, 1.5, 2.7, 6.0, 2.25, 'single'),
   wing=('trapezoid', 60.1, 9.63, 2.41, 30.0, 5.5, -4.0, 0.125, 0.090, 0.022, 'supercritical', 0.31, -0.60, 'fence', 1.1, 0.34, 0.56, 2.0),
   eng=('high-bypass', 'wing-pylon', 4, 6.6, 4.8, 2.00, [0.29, 0.53], None),
   tail=('conventional', 21.5, 6.6, 2.1, 30.0, 6.0, 9.3, 10.2, 4.0, 40.0),
   ref=(363.1, 276500, 240000, 295, 13700, 18.0, 0.57),
   liv=('#f7f8fa', '#0d3d80', '#0d3d80', '#c9ced4', '#b0b7bf'))

ac(id='boeing777', mfr='Boeing', model='777-200', year=1994, mach=0.84, alt=11300,
   innovation='Two enormous high-bypass engines replace four. A bypass ratio near nine moves far more air far more slowly, which is what makes a turbofan efficient.',
   fus=(63.73, 6.20, 1.0, 1.5, 2.7, 6.0, 2.30, 'single'),
   wing=('trapezoid', 60.93, 12.21, 1.83, 31.6, 6.0, -4.5, 0.135, 0.090, 0.024, 'supercritical', 0.30, -0.60, 'none', 0.0, 0.34, 0.55, 2.0),
   eng=('high-bypass', 'wing-pylon', 2, 8.4, 7.3, 3.90, [0.32], None),
   tail=('conventional', 21.5, 6.8, 2.0, 34.0, 6.0, 9.9, 11.0, 4.2, 43.0),
   ref=(427.8, 247200, 215000, 305, 9700, 19.0, 0.55),
   liv=('#f7f8fa', '#11417a', '#11417a', '#c9ced4', '#b0b7bf'))

ac(id='boeing737_800', mfr='Boeing', model='737-800 (winglets)', year=1997, mach=0.785, alt=11300,
   innovation='Blended winglets, retrofitted from 2001. By turning the tip vortex’s swirl into a small forward force they cut block fuel by roughly 3-4 percent.',
   fus=(39.47, 3.76, 1.0, 1.6, 2.9, 6.5, 2.0, 'single'),
   wing=('trapezoid', 34.32, 5.86, 1.41, 25.0, 6.0, -4.0, 0.125, 0.092, 0.022, 'supercritical', 0.35, -0.60, 'blended', 2.4, 0.36, 0.58, 1.5),
   eng=('high-bypass', 'wing-pylon', 2, 5.1, 4.7, 2.10, [0.34], None),
   tail=('conventional', 13.4, 4.2, 1.4, 30.0, 6.0, 6.0, 6.6, 2.7, 35.0),
   ref=(124.6, 79010, 69000, 162, 5436, 18.0, 0.60),
   liv=('#f7f8fa', '#12356b', '#12356b', '#c9ced4', '#b0b7bf'))

ac(id='a380', mfr='Airbus', model='A380-800', year=2005, mach=0.85, alt=11900,
   innovation='A full double deck. Fuel per seat falls simply by carrying 555 people on one wing, though the span had to be capped at 80 m to fit existing airport gates.',
   fus=(72.72, 7.70, 0.85, 1.4, 2.5, 5.0, 2.60, 'full-double'),
   wing=('trapezoid', 79.55, 17.51, 3.68, 33.5, 5.6, -4.5, 0.135, 0.090, 0.024, 'supercritical', 0.29, -0.55, 'fence', 1.5, 0.33, 0.54, 2.0),
   eng=('high-bypass', 'wing-pylon', 4, 8.7, 7.2, 3.10, [0.25, 0.47], None),
   tail=('conventional', 30.4, 9.2, 2.8, 34.0, 6.0, 13.0, 14.0, 5.6, 42.0),
   ref=(845.0, 575000, 500000, 555, 15200, 19.0, 0.52),
   liv=('#f8f9fb', '#0e3f84', '#0e3f84', '#ccd1d7', '#b4bbc3'))

ac(id='boeing787', mfr='Boeing', model='787-8', year=2009, mach=0.85, alt=12200,
   innovation='A carbon-fibre wing can be thinner and more slender than an aluminium one. Raked tips stretch the effective span without needing a taller winglet.',
   fus=(56.72, 5.77, 1.0, 1.5, 2.7, 6.0, 2.30, 'single'),
   wing=('trapezoid', 60.12, 10.63, 1.91, 32.2, 6.5, -5.0, 0.130, 0.085, 0.024, 'supercritical', 0.31, -0.60, 'raked', 0.0, 0.33, 0.54, 2.0),
   eng=('ultra-high-bypass', 'wing-pylon', 2, 9.6, 6.6, 3.10, [0.32], None),
   tail=('conventional', 20.1, 6.2, 1.8, 34.0, 6.0, 8.9, 9.6, 3.6, 40.0),
   ref=(377.0, 227930, 198000, 242, 13530, 20.5, 0.505),
   liv=('#f8f9fb', '#123f78', '#123f78', '#ccd1d7', '#b4bbc3'))

ac(id='a350', mfr='Airbus', model='A350-900', year=2013, mach=0.85, alt=12500,
   innovation='A composite wing whose curved raked tip works like a winglet and a span extension at once, on the most fuel-efficient engine in airline service.',
   fus=(66.80, 5.96, 1.0, 1.5, 2.7, 6.0, 2.30, 'single'),
   wing=('trapezoid', 64.75, 11.57, 2.08, 31.9, 6.0, -5.0, 0.128, 0.085, 0.024, 'supercritical', 0.30, -0.60, 'raked', 0.0, 0.33, 0.54, 2.0),
   eng=('ultra-high-bypass', 'wing-pylon', 2, 9.6, 7.0, 3.20, [0.32], None),
   tail=('conventional', 22.1, 6.8, 2.0, 33.0, 6.0, 9.8, 10.5, 4.0, 40.0),
   ref=(442.0, 280000, 245000, 315, 15000, 21.0, 0.478),
   liv=('#f8f9fb', '#20252b', '#20252b', '#ccd1d7', '#aeb5bd'))

ac(id='a320neo', mfr='Airbus', model='A320neo', year=2014, mach=0.78, alt=11300,
   innovation='The same airframe as the 1987 A320, with sharklets and geared turbofans of bypass ratio 11. Most of the 15 percent fuel saving comes from the engines.',
   fus=(37.57, 3.95, 1.0, 1.6, 2.9, 6.5, 2.05, 'single'),
   wing=('trapezoid', 33.91, 5.83, 1.40, 25.0, 5.0, -4.0, 0.125, 0.095, 0.022, 'supercritical', 0.34, -0.60, 'sharklet', 2.4, 0.36, 0.58, 1.5),
   eng=('ultra-high-bypass', 'wing-pylon', 2, 11.0, 5.0, 2.40, [0.34], None),
   tail=('conventional', 12.45, 3.9, 1.3, 29.0, 6.0, 5.9, 6.2, 2.6, 35.0),
   ref=(122.6, 79000, 69000, 165, 6500, 18.0, 0.51),
   liv=('#f8f9fb', '#0b6470', '#0b6470', '#ccd1d7', '#b4bbc3'))

ac(id='boeing737max', mfr='Boeing', model='737 MAX 8', year=2016, mach=0.79, alt=11300,
   innovation='Split-tip scimitar winglets work above and below the wing at once, and a bypass ratio of nine forced the engine forward and up over the wing.',
   fus=(39.52, 3.76, 1.0, 1.6, 2.9, 6.5, 2.0, 'single'),
   wing=('trapezoid', 34.4, 5.70, 1.37, 25.0, 6.0, -4.0, 0.125, 0.092, 0.022, 'supercritical', 0.35, -0.60, 'scimitar', 2.6, 0.36, 0.58, 1.5),
   eng=('ultra-high-bypass', 'wing-pylon', 2, 9.0, 4.8, 2.20, [0.33], None),
   tail=('conventional', 14.0, 4.3, 1.4, 30.0, 6.0, 6.2, 6.8, 2.8, 35.0),
   ref=(127.0, 82190, 72000, 178, 6570, 18.5, 0.51),
   liv=('#f8f9fb', '#10294f', '#10294f', '#ccd1d7', '#b4bbc3'))

OVERALL_SPAN = {'comet1': 35.05, 'caravelle': 34.3, 'boeing707': 39.9, 'dc8': 43.41, 'boeing727': 32.92, 'boeing737_200': 28.35, 'boeing747_100': 59.64, 'concorde': 25.6, 'a300': 44.84, 'md80': 32.87, 'boeing767': 47.57, 'boeing757': 38.05, 'a320': 34.1, 'a340': 60.3, 'boeing777': 60.93, 'boeing737_800': 35.79, 'a380': 79.75, 'boeing787': 60.12, 'a350': 64.75, 'a320neo': 35.8, 'boeing737max': 35.92}

def num(v):
    return repr(round(v, 4)) if isinstance(v, float) else repr(v)

out = []
out.append("""import type { AircraftSpec } from './AircraftSpec';

/**
 * The airliner roster, ordered by the year the type first flew.
 *
 * Dimensions are approximate published figures from manufacturer data and standard
 * references. They are accurate enough to make the aerodynamic comparison between
 * eras meaningful, but this is a teaching simulator, not a certification document.
 *
 * Reference performance figures (cruiseLD, tsfcCruise) are quoted book values. They
 * are never presented as simulation output; the UI labels them as published so it is
 * always clear which numbers the simulation computed and which were looked up.
 *
 * Generated from a single table so the numbers stay consistent. See
 * scripts/gen_roster.py in the project history for the source table.
 */
export const ROSTER: AircraftSpec[] = [""")

for a in A:
    fL, fD, fWR, fNF, fTF, fUp, fExp, fDeck = a['fus']
    (wPl, wSpan, wCr, wCt, wSw, wDih, wTw, wTr, wTt, wCam, wFam,
     wRoot, wVoff, wWl, wWh, wKink, wKinkC, wInc) = a['wing']
    eType, eMount, eCount, eBpr, eNl, eNd, eStations, eFus = a['eng']
    tCfg, tHs, tHr, tHt, tHsw, tHdih, tVh, tVr, tVt, tVsw = a['tail']
    rArea, rMtow, rCruise, rSeats, rRange, rLD, rTsfc = a['ref']
    rSpanOverall = OVERALL_SPAN[a['id']]
    lFus, lStripe, lTail, lWing, lEng = a['liv']
    out.append(f"""  {{
    id: {a['id'].replace('_','-')!r},
    manufacturer: {a['mfr']!r},
    model: {a['model']!r},
    firstFlightYear: {a['year']},
    cruiseMach: {num(a['mach'])},
    cruiseAltitudeM: {a['alt']},
    innovation:
      {a['innovation']!r},
    fuselage: {{
      length: {num(fL)}, diameter: {num(fD)}, widthRatio: {num(fWR)},
      noseFineness: {num(fNF)}, tailFineness: {num(fTF)}, tailUpsweepDeg: {num(fUp)},
      crossSectionExponent: {num(fExp)}, deck: {fDeck!r},
    }},
    wing: {{
      planform: {wPl!r}, span: {num(wSpan)}, rootChord: {num(wCr)}, tipChord: {num(wCt)},
      sweepQuarterChordDeg: {num(wSw)}, dihedralDeg: {num(wDih)}, twistDeg: {num(wTw)},
      thicknessRootRatio: {num(wTr)}, thicknessTipRatio: {num(wTt)}, camber: {num(wCam)},
      family: {wFam!r}, rootStationFrac: {num(wRoot)}, verticalOffsetFrac: {num(wVoff)},
      wingletType: {wWl!r}, wingletHeight: {num(wWh)},
      kinkFrac: {num(wKink)}, kinkChordRatio: {num(wKinkC)}, incidenceDeg: {num(wInc)},
    }},
    engines: {{
      type: {eType!r}, mount: {eMount!r}, count: {eCount}, bypassRatio: {num(eBpr)},
      nacelleLength: {num(eNl)}, nacelleDiameter: {num(eNd)},
      spanStations: {eStations!r},{'' if eFus is None else f' fuselageStationFrac: {num(eFus)},'}
    }},
    tail: {{
      config: {tCfg!r},
      hStabSpan: {num(tHs)}, hStabRootChord: {num(tHr)}, hStabTipChord: {num(tHt)},
      hStabSweepDeg: {num(tHsw)}, hStabDihedralDeg: {num(tHdih)},
      vStabHeight: {num(tVh)}, vStabRootChord: {num(tVr)}, vStabTipChord: {num(tVt)},
      vStabSweepDeg: {num(tVsw)},
    }},
    reference: {{
      wingAreaM2: {num(rArea)}, spanOverallM: {num(rSpanOverall)},
      mtowKg: {rMtow}, cruiseMassKg: {rCruise},
      seatsTypical: {rSeats}, rangeKm: {rRange}, cruiseLD: {num(rLD)}, tsfcCruise: {num(rTsfc)},
    }},
    livery: {{
      fuselage: {lFus!r}, stripe: {lStripe!r}, tail: {lTail!r},
      wing: {lWing!r}, engine: {lEng!r},
    }},
  }},""")

out.append("""];

/** Look up a spec by id. */
export function specById(id: string): AircraftSpec | undefined {
  return ROSTER.find((s) => s.id === id);
}

/** The roster grouped into decades, in chronological order, for the selector menu. */
export function rosterByDecade(): Array<{ decade: string; aircraft: AircraftSpec[] }> {
  const groups = new Map<number, AircraftSpec[]>();
  for (const spec of ROSTER) {
    const decade = Math.floor(spec.firstFlightYear / 10) * 10;
    const list = groups.get(decade);
    if (list) list.push(spec);
    else groups.set(decade, [spec]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([decade, aircraft]) => ({
      decade: `${decade}s`,
      aircraft: aircraft.sort((a, b) => a.firstFlightYear - b.firstFlightYear),
    }));
}""")

open('src/aircraft/roster.ts', 'w').write('\n'.join(out) + '\n')
print(f"wrote {len(A)} aircraft")
