import type { AircraftSpec } from './AircraftSpec';

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
export const ROSTER: AircraftSpec[] = [
  {
    id: 'comet1',
    manufacturer: 'de Havilland',
    model: 'Comet 1',
    firstFlightYear: 1949,
    cruiseMach: 0.7,
    cruiseAltitudeM: 10700,
    innovation:
      'The first jet airliner. Engines buried in the wing roots keep the nacelles out of the airflow, but a thick unswept-ish wing limits it to Mach 0.70.',
    fuselage: {
      length: 28.35, diameter: 3.05, widthRatio: 1.0,
      noseFineness: 1.7, tailFineness: 3.0, tailUpsweepDeg: 4.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 35.05, rootChord: 8.22, tipChord: 2.46,
      sweepQuarterChordDeg: 20.0, dihedralDeg: 5.0, twistDeg: -2.0,
      thicknessRootRatio: 0.115, thicknessTipRatio: 0.095, camber: 0.02,
      family: 'naca4', rootStationFrac: 0.36, verticalOffsetFrac: -0.55,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.42, kinkChordRatio: 0.62, incidenceDeg: 2.0,
    },
    engines: {
      type: 'turbojet', mount: 'wing-root-buried', count: 4, bypassRatio: 0.0,
      nacelleLength: 4.6, nacelleDiameter: 1.15,
      spanStations: [0.18, 0.28],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 11.2, hStabRootChord: 3.2, hStabTipChord: 1.4,
      hStabSweepDeg: 15.0, hStabDihedralDeg: 6.0,
      vStabHeight: 4.6, vStabRootChord: 5.0, vStabTipChord: 2.2,
      vStabSweepDeg: 30.0,
    },
    reference: {
      wingAreaM2: 187.2, spanOverallM: 35.05,
      mtowKg: 47600, cruiseMassKg: 42000,
      seatsTypical: 44, rangeKm: 2400, cruiseLD: 13.5, tsfcCruise: 1.05,
    },
    livery: {
      fuselage: '#eef1f4', stripe: '#1b3f6e', tail: '#1b3f6e',
      wing: '#c9ced4', engine: '#b7bec6',
    },
  },
  {
    id: 'caravelle',
    manufacturer: 'Sud Aviation',
    model: 'Caravelle III',
    firstFlightYear: 1955,
    cruiseMach: 0.72,
    cruiseAltitudeM: 10700,
    innovation:
      'Moved the engines to the rear fuselage, leaving a completely clean wing. The idea was copied by almost every short-haul jet for the next twenty years.',
    fuselage: {
      length: 32.01, diameter: 3.2, widthRatio: 1.0,
      noseFineness: 1.7, tailFineness: 2.9, tailUpsweepDeg: 5.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 34.3, rootChord: 6.33, tipChord: 2.22,
      sweepQuarterChordDeg: 20.0, dihedralDeg: 3.0, twistDeg: -2.0,
      thicknessRootRatio: 0.12, thicknessTipRatio: 0.1, camber: 0.02,
      family: 'naca4', rootStationFrac: 0.3, verticalOffsetFrac: -0.55,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.4, kinkChordRatio: 0.6, incidenceDeg: 2.0,
    },
    engines: {
      type: 'turbojet', mount: 'rear-fuselage', count: 2, bypassRatio: 0.0,
      nacelleLength: 5.0, nacelleDiameter: 1.3,
      spanStations: [], fuselageStationFrac: 0.72,
    },
    tail: {
      config: 'conventional',
      hStabSpan: 11.4, hStabRootChord: 3.4, hStabTipChord: 1.4,
      hStabSweepDeg: 25.0, hStabDihedralDeg: 5.0,
      vStabHeight: 4.9, vStabRootChord: 5.4, vStabTipChord: 2.4,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 146.7, spanOverallM: 34.3,
      mtowKg: 46000, cruiseMassKg: 41000,
      seatsTypical: 80, rangeKm: 1845, cruiseLD: 13.0, tsfcCruise: 0.92,
    },
    livery: {
      fuselage: '#f2f4f6', stripe: '#0d3b66', tail: '#0d3b66',
      wing: '#ccd2d8', engine: '#aeb6bf',
    },
  },
  {
    id: 'boeing707',
    manufacturer: 'Boeing',
    model: '707-120',
    firstFlightYear: 1957,
    cruiseMach: 0.8,
    cruiseAltitudeM: 10700,
    innovation:
      '35 degrees of wing sweep, podded engines slung ahead of and below the wing. This layout became the template for essentially every jet airliner since.',
    fuselage: {
      length: 44.07, diameter: 3.76, widthRatio: 1.0,
      noseFineness: 1.7, tailFineness: 3.0, tailUpsweepDeg: 5.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 39.9, rootChord: 9.1, tipChord: 2.37,
      sweepQuarterChordDeg: 35.0, dihedralDeg: 7.0, twistDeg: -3.0,
      thicknessRootRatio: 0.12, thicknessTipRatio: 0.095, camber: 0.018,
      family: 'naca4', rootStationFrac: 0.34, verticalOffsetFrac: -0.55,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.38, kinkChordRatio: 0.6, incidenceDeg: 2.0,
    },
    engines: {
      type: 'turbojet', mount: 'wing-pylon', count: 4, bypassRatio: 0.0,
      nacelleLength: 5.5, nacelleDiameter: 1.35,
      spanStations: [0.28, 0.52],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 13.95, hStabRootChord: 4.5, hStabTipChord: 1.6,
      hStabSweepDeg: 35.0, hStabDihedralDeg: 7.0,
      vStabHeight: 6.5, vStabRootChord: 7.5, vStabTipChord: 3.0,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 226.3, spanOverallM: 39.9,
      mtowKg: 112037, cruiseMassKg: 98000,
      seatsTypical: 137, rangeKm: 5600, cruiseLD: 15.5, tsfcCruise: 0.86,
    },
    livery: {
      fuselage: '#f4f6f8', stripe: '#123a6d', tail: '#123a6d',
      wing: '#c6ccd3', engine: '#b2b9c1',
    },
  },
  {
    id: 'dc8',
    manufacturer: 'Douglas',
    model: 'DC-8-10',
    firstFlightYear: 1958,
    cruiseMach: 0.82,
    cruiseAltitudeM: 10700,
    innovation:
      'A slightly thinner wing at 30 degrees of sweep, trading a little cruise Mach for better low-speed behaviour and a shorter field length.',
    fuselage: {
      length: 45.87, diameter: 3.73, widthRatio: 1.0,
      noseFineness: 1.7, tailFineness: 3.0, tailUpsweepDeg: 5.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 43.41, rootChord: 9.27, tipChord: 2.6,
      sweepQuarterChordDeg: 30.6, dihedralDeg: 6.0, twistDeg: -3.0,
      thicknessRootRatio: 0.12, thicknessTipRatio: 0.095, camber: 0.018,
      family: 'naca4', rootStationFrac: 0.34, verticalOffsetFrac: -0.55,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.38, kinkChordRatio: 0.6, incidenceDeg: 2.0,
    },
    engines: {
      type: 'turbojet', mount: 'wing-pylon', count: 4, bypassRatio: 0.0,
      nacelleLength: 5.6, nacelleDiameter: 1.4,
      spanStations: [0.28, 0.52],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 14.3, hStabRootChord: 4.6, hStabTipChord: 1.7,
      hStabSweepDeg: 32.0, hStabDihedralDeg: 6.0,
      vStabHeight: 6.6, vStabRootChord: 7.6, vStabTipChord: 3.1,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 257.6, spanOverallM: 43.41,
      mtowKg: 123500, cruiseMassKg: 108000,
      seatsTypical: 177, rangeKm: 6000, cruiseLD: 15.8, tsfcCruise: 0.84,
    },
    livery: {
      fuselage: '#f5f6f8', stripe: '#8c1d2c', tail: '#8c1d2c',
      wing: '#c9ced4', engine: '#b4bac2',
    },
  },
  {
    id: 'boeing727',
    manufacturer: 'Boeing',
    model: '727-200',
    firstFlightYear: 1963,
    cruiseMach: 0.82,
    cruiseAltitudeM: 10000,
    innovation:
      'A T-tail trijet with the centre engine fed by an S-duct, and triple-slotted flaps so a fast, highly swept wing could still use short runways.',
    fuselage: {
      length: 46.69, diameter: 3.76, widthRatio: 1.0,
      noseFineness: 1.6, tailFineness: 2.9, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 32.92, rootChord: 7.49, tipChord: 2.1,
      sweepQuarterChordDeg: 32.0, dihedralDeg: 3.0, twistDeg: -3.0,
      thicknessRootRatio: 0.118, thicknessTipRatio: 0.095, camber: 0.018,
      family: 'peaky', rootStationFrac: 0.33, verticalOffsetFrac: -0.55,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.38, kinkChordRatio: 0.58, incidenceDeg: 2.0,
    },
    engines: {
      type: 'low-bypass', mount: 'rear-fuselage', count: 3, bypassRatio: 1.0,
      nacelleLength: 4.6, nacelleDiameter: 1.25,
      spanStations: [], fuselageStationFrac: 0.78,
    },
    tail: {
      config: 't-tail',
      hStabSpan: 10.9, hStabRootChord: 3.6, hStabTipChord: 1.4,
      hStabSweepDeg: 36.0, hStabDihedralDeg: 4.0,
      vStabHeight: 7.0, vStabRootChord: 8.0, vStabTipChord: 3.2,
      vStabSweepDeg: 45.0,
    },
    reference: {
      wingAreaM2: 157.9, spanOverallM: 32.92,
      mtowKg: 95028, cruiseMassKg: 84000,
      seatsTypical: 149, rangeKm: 4450, cruiseLD: 15.0, tsfcCruise: 0.8,
    },
    livery: {
      fuselage: '#f4f5f7', stripe: '#6b4c1e', tail: '#6b4c1e',
      wing: '#c8cdd3', engine: '#b3b9c1',
    },
  },
  {
    id: 'boeing737-200',
    manufacturer: 'Boeing',
    model: '737-200',
    firstFlightYear: 1967,
    cruiseMach: 0.73,
    cruiseAltitudeM: 9500,
    innovation:
      'Engines tucked tight under a short wing to keep the aircraft low to the ground. Cheap and simple, but the low-bypass JT8D burns a great deal of fuel.',
    fuselage: {
      length: 30.53, diameter: 3.76, widthRatio: 1.0,
      noseFineness: 1.6, tailFineness: 2.8, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 28.35, rootChord: 5.1, tipChord: 1.33,
      sweepQuarterChordDeg: 25.0, dihedralDeg: 6.0, twistDeg: -3.0,
      thicknessRootRatio: 0.128, thicknessTipRatio: 0.1, camber: 0.02,
      family: 'peaky', rootStationFrac: 0.36, verticalOffsetFrac: -0.6,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.36, kinkChordRatio: 0.6, incidenceDeg: 1.0,
    },
    engines: {
      type: 'low-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 1.0,
      nacelleLength: 4.9, nacelleDiameter: 1.35,
      spanStations: [0.34],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 10.8, hStabRootChord: 3.4, hStabTipChord: 1.2,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 7.0,
      vStabHeight: 5.2, vStabRootChord: 5.8, vStabTipChord: 2.4,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 91.05, spanOverallM: 28.35,
      mtowKg: 52390, cruiseMassKg: 46000,
      seatsTypical: 115, rangeKm: 4180, cruiseLD: 15.0, tsfcCruise: 0.8,
    },
    livery: {
      fuselage: '#f5f6f8', stripe: '#12457e', tail: '#12457e',
      wing: '#c9ced4', engine: '#b4bac2',
    },
  },
  {
    id: 'boeing747-100',
    manufacturer: 'Boeing',
    model: '747-100',
    firstFlightYear: 1969,
    cruiseMach: 0.84,
    cruiseAltitudeM: 10700,
    innovation:
      'The first widebody, and the first airliner with high-bypass turbofans. Spreading 366 seats across one airframe cut fuel per seat dramatically.',
    fuselage: {
      length: 70.66, diameter: 6.5, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.7, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.15, deck: 'partial-upper',
    },
    wing: {
      planform: 'trapezoid', span: 59.64, rootChord: 13.6, tipChord: 3.54,
      sweepQuarterChordDeg: 37.5, dihedralDeg: 7.0, twistDeg: -4.0,
      thicknessRootRatio: 0.135, thicknessTipRatio: 0.09, camber: 0.018,
      family: 'peaky', rootStationFrac: 0.3, verticalOffsetFrac: -0.55,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.36, kinkChordRatio: 0.58, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 4, bypassRatio: 5.0,
      nacelleLength: 7.0, nacelleDiameter: 2.7,
      spanStations: [0.27, 0.5],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 22.2, hStabRootChord: 7.0, hStabTipChord: 2.2,
      hStabSweepDeg: 36.0, hStabDihedralDeg: 7.0,
      vStabHeight: 9.8, vStabRootChord: 11.5, vStabTipChord: 4.4,
      vStabSweepDeg: 45.0,
    },
    reference: {
      wingAreaM2: 511.0, spanOverallM: 59.64,
      mtowKg: 333400, cruiseMassKg: 290000,
      seatsTypical: 366, rangeKm: 9800, cruiseLD: 17.0, tsfcCruise: 0.63,
    },
    livery: {
      fuselage: '#f6f7f9', stripe: '#0b2d5c', tail: '#0b2d5c',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'concorde',
    manufacturer: 'BAC / Sud Aviation',
    model: 'Concorde',
    firstFlightYear: 1969,
    cruiseMach: 2.02,
    cruiseAltitudeM: 18300,
    innovation:
      'An ogival delta tuned for Mach 2. It shows the other side of the trade: unbeatable speed, but a lift-to-drag ratio less than half a subsonic airliner’s.',
    fuselage: {
      length: 61.66, diameter: 2.88, widthRatio: 1.0,
      noseFineness: 5.2, tailFineness: 4.0, tailUpsweepDeg: 2.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'ogival-delta', span: 25.6, rootChord: 27.7, tipChord: 1.2,
      sweepQuarterChordDeg: 55.0, dihedralDeg: 0.0, twistDeg: -3.0,
      thicknessRootRatio: 0.03, thicknessTipRatio: 0.025, camber: 0.004,
      family: 'naca4', rootStationFrac: 0.28, verticalOffsetFrac: -0.75,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.5, kinkChordRatio: 0.55, incidenceDeg: 0.0,
    },
    engines: {
      type: 'turbojet', mount: 'underwing-delta', count: 4, bypassRatio: 0.0,
      nacelleLength: 7.1, nacelleDiameter: 1.4,
      spanStations: [0.2, 0.33],
    },
    tail: {
      config: 'delta',
      hStabSpan: 0.0, hStabRootChord: 0.0, hStabTipChord: 0.0,
      hStabSweepDeg: 0.0, hStabDihedralDeg: 0.0,
      vStabHeight: 6.4, vStabRootChord: 11.0, vStabTipChord: 3.4,
      vStabSweepDeg: 60.0,
    },
    reference: {
      wingAreaM2: 358.25, spanOverallM: 25.6,
      mtowKg: 185070, cruiseMassKg: 160000,
      seatsTypical: 100, rangeKm: 7250, cruiseLD: 7.5, tsfcCruise: 1.195,
    },
    livery: {
      fuselage: '#fbfbfc', stripe: '#1d4e89', tail: '#1d4e89',
      wing: '#eceff2', engine: '#c4cad1',
    },
  },
  {
    id: 'a300',
    manufacturer: 'Airbus',
    model: 'A300B4',
    firstFlightYear: 1972,
    cruiseMach: 0.78,
    cruiseAltitudeM: 10700,
    innovation:
      'The first twin-engined widebody. Two big high-bypass turbofans instead of four smaller ones cut both fuel burn and maintenance cost.',
    fuselage: {
      length: 53.62, diameter: 5.64, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.7, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.25, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 44.84, rootChord: 8.92, tipChord: 2.68,
      sweepQuarterChordDeg: 28.0, dihedralDeg: 5.0, twistDeg: -3.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.095, camber: 0.02,
      family: 'peaky', rootStationFrac: 0.32, verticalOffsetFrac: -0.6,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.36, kinkChordRatio: 0.6, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 4.4,
      nacelleLength: 6.7, nacelleDiameter: 2.9,
      spanStations: [0.33],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 16.3, hStabRootChord: 5.4, hStabTipChord: 1.9,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 6.0,
      vStabHeight: 8.2, vStabRootChord: 9.0, vStabTipChord: 3.6,
      vStabSweepDeg: 40.0,
    },
    reference: {
      wingAreaM2: 260.0, spanOverallM: 44.84,
      mtowKg: 165000, cruiseMassKg: 145000,
      seatsTypical: 266, rangeKm: 5375, cruiseLD: 16.5, tsfcCruise: 0.63,
    },
    livery: {
      fuselage: '#f6f7f9', stripe: '#16548f', tail: '#16548f',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'md80',
    manufacturer: 'McDonnell Douglas',
    model: 'MD-82',
    firstFlightYear: 1979,
    cruiseMach: 0.76,
    cruiseAltitudeM: 10700,
    innovation:
      'A long, slender fuselage on a small high-aspect-ratio wing, with refanned JT8D-200s. Efficient for its day, but still a low-bypass engine.',
    fuselage: {
      length: 45.06, diameter: 3.35, widthRatio: 1.0,
      noseFineness: 1.7, tailFineness: 3.1, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 32.87, rootChord: 5.69, tipChord: 1.14,
      sweepQuarterChordDeg: 24.5, dihedralDeg: 3.0, twistDeg: -3.0,
      thicknessRootRatio: 0.118, thicknessTipRatio: 0.095, camber: 0.02,
      family: 'peaky', rootStationFrac: 0.36, verticalOffsetFrac: -0.6,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.36, kinkChordRatio: 0.58, incidenceDeg: 1.5,
    },
    engines: {
      type: 'low-bypass', mount: 'rear-fuselage', count: 2, bypassRatio: 1.73,
      nacelleLength: 5.2, nacelleDiameter: 1.5,
      spanStations: [], fuselageStationFrac: 0.74,
    },
    tail: {
      config: 't-tail',
      hStabSpan: 12.2, hStabRootChord: 3.9, hStabTipChord: 1.3,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 4.0,
      vStabHeight: 6.6, vStabRootChord: 7.2, vStabTipChord: 3.0,
      vStabSweepDeg: 42.0,
    },
    reference: {
      wingAreaM2: 112.3, spanOverallM: 32.87,
      mtowKg: 67812, cruiseMassKg: 60000,
      seatsTypical: 155, rangeKm: 3800, cruiseLD: 16.0, tsfcCruise: 0.73,
    },
    livery: {
      fuselage: '#f5f6f8', stripe: '#b02a34', tail: '#b02a34',
      wing: '#c9ced4', engine: '#b4bac2',
    },
  },
  {
    id: 'boeing767',
    manufacturer: 'Boeing',
    model: '767-200',
    firstFlightYear: 1981,
    cruiseMach: 0.8,
    cruiseAltitudeM: 11300,
    innovation:
      'Boeing’s first supercritical wing. A flatter upper surface delays the shock at high subsonic Mach, so the wing can be thicker, lighter and more efficient.',
    fuselage: {
      length: 48.51, diameter: 5.03, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.8, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.25, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 47.57, rootChord: 9.84, tipChord: 2.07,
      sweepQuarterChordDeg: 31.5, dihedralDeg: 6.0, twistDeg: -4.0,
      thicknessRootRatio: 0.13, thicknessTipRatio: 0.09, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.31, verticalOffsetFrac: -0.6,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.35, kinkChordRatio: 0.58, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 5.0,
      nacelleLength: 6.4, nacelleDiameter: 2.8,
      spanStations: [0.33],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 18.6, hStabRootChord: 5.8, hStabTipChord: 1.9,
      hStabSweepDeg: 32.0, hStabDihedralDeg: 6.0,
      vStabHeight: 8.3, vStabRootChord: 9.2, vStabTipChord: 3.5,
      vStabSweepDeg: 40.0,
    },
    reference: {
      wingAreaM2: 283.3, spanOverallM: 47.57,
      mtowKg: 142880, cruiseMassKg: 125000,
      seatsTypical: 216, rangeKm: 7200, cruiseLD: 17.5, tsfcCruise: 0.6,
    },
    livery: {
      fuselage: '#f6f7f9', stripe: '#0f3f76', tail: '#0f3f76',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'boeing757',
    manufacturer: 'Boeing',
    model: '757-200',
    firstFlightYear: 1982,
    cruiseMach: 0.8,
    cruiseAltitudeM: 11300,
    innovation:
      'A narrowbody with an unusually high aspect ratio and a lot of thrust. High span means low induced drag, which is why it could cross the Atlantic.',
    fuselage: {
      length: 47.32, diameter: 3.76, widthRatio: 1.0,
      noseFineness: 1.7, tailFineness: 3.0, tailUpsweepDeg: 6.5,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 38.05, rootChord: 7.85, tipChord: 1.88,
      sweepQuarterChordDeg: 25.0, dihedralDeg: 5.0, twistDeg: -4.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.09, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.33, verticalOffsetFrac: -0.6,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.35, kinkChordRatio: 0.58, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 4.3,
      nacelleLength: 6.0, nacelleDiameter: 2.5,
      spanStations: [0.34],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 15.2, hStabRootChord: 4.8, hStabTipChord: 1.6,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 6.0,
      vStabHeight: 7.2, vStabRootChord: 7.8, vStabTipChord: 3.0,
      vStabSweepDeg: 38.0,
    },
    reference: {
      wingAreaM2: 185.25, spanOverallM: 38.05,
      mtowKg: 115680, cruiseMassKg: 101000,
      seatsTypical: 200, rangeKm: 7222, cruiseLD: 17.0, tsfcCruise: 0.58,
    },
    livery: {
      fuselage: '#f6f7f9', stripe: '#14477f', tail: '#14477f',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'a320',
    manufacturer: 'Airbus',
    model: 'A320-200',
    firstFlightYear: 1987,
    cruiseMach: 0.78,
    cruiseAltitudeM: 11300,
    innovation:
      'Fly-by-wire let the aircraft fly a smaller, more efficient tail safely. Wingtip fences cut the tip vortex and so trim a few percent off induced drag.',
    fuselage: {
      length: 37.57, diameter: 3.95, widthRatio: 1.0,
      noseFineness: 1.6, tailFineness: 2.9, tailUpsweepDeg: 6.5,
      crossSectionExponent: 2.05, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 33.91, rootChord: 5.83, tipChord: 1.4,
      sweepQuarterChordDeg: 25.0, dihedralDeg: 5.0, twistDeg: -4.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.095, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.34, verticalOffsetFrac: -0.6,
      wingletType: 'fence', wingletHeight: 0.9,
      kinkFrac: 0.36, kinkChordRatio: 0.58, incidenceDeg: 1.5,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 6.0,
      nacelleLength: 4.6, nacelleDiameter: 2.1,
      spanStations: [0.34],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 12.45, hStabRootChord: 3.9, hStabTipChord: 1.3,
      hStabSweepDeg: 29.0, hStabDihedralDeg: 6.0,
      vStabHeight: 5.9, vStabRootChord: 6.2, vStabTipChord: 2.6,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 122.6, spanOverallM: 34.1,
      mtowKg: 78000, cruiseMassKg: 68000,
      seatsTypical: 150, rangeKm: 6150, cruiseLD: 17.0, tsfcCruise: 0.6,
    },
    livery: {
      fuselage: '#f7f8fa', stripe: '#0a2f6b', tail: '#0a2f6b',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'a340',
    manufacturer: 'Airbus',
    model: 'A340-300',
    firstFlightYear: 1991,
    cruiseMach: 0.82,
    cruiseAltitudeM: 11300,
    innovation:
      'An aspect ratio of about 10, very high for its day. Long thin wings are the most direct way to cut induced drag on a long-range aircraft.',
    fuselage: {
      length: 63.69, diameter: 5.64, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.7, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.25, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 60.1, rootChord: 9.63, tipChord: 2.41,
      sweepQuarterChordDeg: 30.0, dihedralDeg: 5.5, twistDeg: -4.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.09, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.31, verticalOffsetFrac: -0.6,
      wingletType: 'fence', wingletHeight: 1.1,
      kinkFrac: 0.34, kinkChordRatio: 0.56, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 4, bypassRatio: 6.6,
      nacelleLength: 4.8, nacelleDiameter: 2.0,
      spanStations: [0.29, 0.53],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 21.5, hStabRootChord: 6.6, hStabTipChord: 2.1,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 6.0,
      vStabHeight: 9.3, vStabRootChord: 10.2, vStabTipChord: 4.0,
      vStabSweepDeg: 40.0,
    },
    reference: {
      wingAreaM2: 363.1, spanOverallM: 60.3,
      mtowKg: 276500, cruiseMassKg: 240000,
      seatsTypical: 295, rangeKm: 13700, cruiseLD: 18.0, tsfcCruise: 0.57,
    },
    livery: {
      fuselage: '#f7f8fa', stripe: '#0d3d80', tail: '#0d3d80',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'boeing777',
    manufacturer: 'Boeing',
    model: '777-200',
    firstFlightYear: 1994,
    cruiseMach: 0.84,
    cruiseAltitudeM: 11300,
    innovation:
      'Two enormous high-bypass engines replace four. A bypass ratio near nine moves far more air far more slowly, which is what makes a turbofan efficient.',
    fuselage: {
      length: 63.73, diameter: 6.2, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.7, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.3, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 60.93, rootChord: 12.21, tipChord: 1.83,
      sweepQuarterChordDeg: 31.6, dihedralDeg: 6.0, twistDeg: -4.5,
      thicknessRootRatio: 0.135, thicknessTipRatio: 0.09, camber: 0.024,
      family: 'supercritical', rootStationFrac: 0.3, verticalOffsetFrac: -0.6,
      wingletType: 'none', wingletHeight: 0.0,
      kinkFrac: 0.34, kinkChordRatio: 0.55, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 8.4,
      nacelleLength: 7.3, nacelleDiameter: 3.9,
      spanStations: [0.32],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 21.5, hStabRootChord: 6.8, hStabTipChord: 2.0,
      hStabSweepDeg: 34.0, hStabDihedralDeg: 6.0,
      vStabHeight: 9.9, vStabRootChord: 11.0, vStabTipChord: 4.2,
      vStabSweepDeg: 43.0,
    },
    reference: {
      wingAreaM2: 427.8, spanOverallM: 60.93,
      mtowKg: 247200, cruiseMassKg: 215000,
      seatsTypical: 305, rangeKm: 9700, cruiseLD: 19.0, tsfcCruise: 0.55,
    },
    livery: {
      fuselage: '#f7f8fa', stripe: '#11417a', tail: '#11417a',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'boeing737-800',
    manufacturer: 'Boeing',
    model: '737-800 (winglets)',
    firstFlightYear: 1997,
    cruiseMach: 0.785,
    cruiseAltitudeM: 11300,
    innovation:
      'Blended winglets, retrofitted from 2001. By turning the tip vortex’s swirl into a small forward force they cut block fuel by roughly 3-4 percent.',
    fuselage: {
      length: 39.47, diameter: 3.76, widthRatio: 1.0,
      noseFineness: 1.6, tailFineness: 2.9, tailUpsweepDeg: 6.5,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 34.32, rootChord: 5.86, tipChord: 1.41,
      sweepQuarterChordDeg: 25.0, dihedralDeg: 6.0, twistDeg: -4.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.092, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.35, verticalOffsetFrac: -0.6,
      wingletType: 'blended', wingletHeight: 2.4,
      kinkFrac: 0.36, kinkChordRatio: 0.58, incidenceDeg: 1.5,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 5.1,
      nacelleLength: 4.7, nacelleDiameter: 2.1,
      spanStations: [0.34],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 13.4, hStabRootChord: 4.2, hStabTipChord: 1.4,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 6.0,
      vStabHeight: 6.0, vStabRootChord: 6.6, vStabTipChord: 2.7,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 124.6, spanOverallM: 35.79,
      mtowKg: 79010, cruiseMassKg: 69000,
      seatsTypical: 162, rangeKm: 5436, cruiseLD: 18.0, tsfcCruise: 0.6,
    },
    livery: {
      fuselage: '#f7f8fa', stripe: '#12356b', tail: '#12356b',
      wing: '#c9ced4', engine: '#b0b7bf',
    },
  },
  {
    id: 'a380',
    manufacturer: 'Airbus',
    model: 'A380-800',
    firstFlightYear: 2005,
    cruiseMach: 0.85,
    cruiseAltitudeM: 11900,
    innovation:
      'A full double deck. Fuel per seat falls simply by carrying 555 people on one wing, though the span had to be capped at 80 m to fit existing airport gates.',
    fuselage: {
      length: 72.72, diameter: 7.7, widthRatio: 0.85,
      noseFineness: 1.4, tailFineness: 2.5, tailUpsweepDeg: 5.0,
      crossSectionExponent: 2.6, deck: 'full-double',
    },
    wing: {
      planform: 'trapezoid', span: 79.55, rootChord: 17.51, tipChord: 3.68,
      sweepQuarterChordDeg: 33.5, dihedralDeg: 5.6, twistDeg: -4.5,
      thicknessRootRatio: 0.135, thicknessTipRatio: 0.09, camber: 0.024,
      family: 'supercritical', rootStationFrac: 0.29, verticalOffsetFrac: -0.55,
      wingletType: 'fence', wingletHeight: 1.5,
      kinkFrac: 0.33, kinkChordRatio: 0.54, incidenceDeg: 2.0,
    },
    engines: {
      type: 'high-bypass', mount: 'wing-pylon', count: 4, bypassRatio: 8.7,
      nacelleLength: 7.2, nacelleDiameter: 3.1,
      spanStations: [0.25, 0.47],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 30.4, hStabRootChord: 9.2, hStabTipChord: 2.8,
      hStabSweepDeg: 34.0, hStabDihedralDeg: 6.0,
      vStabHeight: 13.0, vStabRootChord: 14.0, vStabTipChord: 5.6,
      vStabSweepDeg: 42.0,
    },
    reference: {
      wingAreaM2: 845.0, spanOverallM: 79.75,
      mtowKg: 575000, cruiseMassKg: 500000,
      seatsTypical: 555, rangeKm: 15200, cruiseLD: 19.0, tsfcCruise: 0.52,
    },
    livery: {
      fuselage: '#f8f9fb', stripe: '#0e3f84', tail: '#0e3f84',
      wing: '#ccd1d7', engine: '#b4bbc3',
    },
  },
  {
    id: 'boeing787',
    manufacturer: 'Boeing',
    model: '787-8',
    firstFlightYear: 2009,
    cruiseMach: 0.85,
    cruiseAltitudeM: 12200,
    innovation:
      'A carbon-fibre wing can be thinner and more slender than an aluminium one. Raked tips stretch the effective span without needing a taller winglet.',
    fuselage: {
      length: 56.72, diameter: 5.77, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.7, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.3, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 60.12, rootChord: 10.63, tipChord: 1.91,
      sweepQuarterChordDeg: 32.2, dihedralDeg: 6.5, twistDeg: -5.0,
      thicknessRootRatio: 0.13, thicknessTipRatio: 0.085, camber: 0.024,
      family: 'supercritical', rootStationFrac: 0.31, verticalOffsetFrac: -0.6,
      wingletType: 'raked', wingletHeight: 0.0,
      kinkFrac: 0.33, kinkChordRatio: 0.54, incidenceDeg: 2.0,
    },
    engines: {
      type: 'ultra-high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 9.6,
      nacelleLength: 6.6, nacelleDiameter: 3.1,
      spanStations: [0.32],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 20.1, hStabRootChord: 6.2, hStabTipChord: 1.8,
      hStabSweepDeg: 34.0, hStabDihedralDeg: 6.0,
      vStabHeight: 8.9, vStabRootChord: 9.6, vStabTipChord: 3.6,
      vStabSweepDeg: 40.0,
    },
    reference: {
      wingAreaM2: 377.0, spanOverallM: 60.12,
      mtowKg: 227930, cruiseMassKg: 198000,
      seatsTypical: 242, rangeKm: 13530, cruiseLD: 20.5, tsfcCruise: 0.505,
    },
    livery: {
      fuselage: '#f8f9fb', stripe: '#123f78', tail: '#123f78',
      wing: '#ccd1d7', engine: '#b4bbc3',
    },
  },
  {
    id: 'a350',
    manufacturer: 'Airbus',
    model: 'A350-900',
    firstFlightYear: 2013,
    cruiseMach: 0.85,
    cruiseAltitudeM: 12500,
    innovation:
      'A composite wing whose curved raked tip works like a winglet and a span extension at once, on the most fuel-efficient engine in airline service.',
    fuselage: {
      length: 66.8, diameter: 5.96, widthRatio: 1.0,
      noseFineness: 1.5, tailFineness: 2.7, tailUpsweepDeg: 6.0,
      crossSectionExponent: 2.3, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 64.75, rootChord: 11.57, tipChord: 2.08,
      sweepQuarterChordDeg: 31.9, dihedralDeg: 6.0, twistDeg: -5.0,
      thicknessRootRatio: 0.128, thicknessTipRatio: 0.085, camber: 0.024,
      family: 'supercritical', rootStationFrac: 0.3, verticalOffsetFrac: -0.6,
      wingletType: 'raked', wingletHeight: 0.0,
      kinkFrac: 0.33, kinkChordRatio: 0.54, incidenceDeg: 2.0,
    },
    engines: {
      type: 'ultra-high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 9.6,
      nacelleLength: 7.0, nacelleDiameter: 3.2,
      spanStations: [0.32],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 22.1, hStabRootChord: 6.8, hStabTipChord: 2.0,
      hStabSweepDeg: 33.0, hStabDihedralDeg: 6.0,
      vStabHeight: 9.8, vStabRootChord: 10.5, vStabTipChord: 4.0,
      vStabSweepDeg: 40.0,
    },
    reference: {
      wingAreaM2: 442.0, spanOverallM: 64.75,
      mtowKg: 280000, cruiseMassKg: 245000,
      seatsTypical: 315, rangeKm: 15000, cruiseLD: 21.0, tsfcCruise: 0.478,
    },
    livery: {
      fuselage: '#f8f9fb', stripe: '#20252b', tail: '#20252b',
      wing: '#ccd1d7', engine: '#aeb5bd',
    },
  },
  {
    id: 'a320neo',
    manufacturer: 'Airbus',
    model: 'A320neo',
    firstFlightYear: 2014,
    cruiseMach: 0.78,
    cruiseAltitudeM: 11300,
    innovation:
      'The same airframe as the 1987 A320, with sharklets and geared turbofans of bypass ratio 11. Most of the 15 percent fuel saving comes from the engines.',
    fuselage: {
      length: 37.57, diameter: 3.95, widthRatio: 1.0,
      noseFineness: 1.6, tailFineness: 2.9, tailUpsweepDeg: 6.5,
      crossSectionExponent: 2.05, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 33.91, rootChord: 5.83, tipChord: 1.4,
      sweepQuarterChordDeg: 25.0, dihedralDeg: 5.0, twistDeg: -4.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.095, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.34, verticalOffsetFrac: -0.6,
      wingletType: 'sharklet', wingletHeight: 2.4,
      kinkFrac: 0.36, kinkChordRatio: 0.58, incidenceDeg: 1.5,
    },
    engines: {
      type: 'ultra-high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 11.0,
      nacelleLength: 5.0, nacelleDiameter: 2.4,
      spanStations: [0.34],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 12.45, hStabRootChord: 3.9, hStabTipChord: 1.3,
      hStabSweepDeg: 29.0, hStabDihedralDeg: 6.0,
      vStabHeight: 5.9, vStabRootChord: 6.2, vStabTipChord: 2.6,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 122.6, spanOverallM: 35.8,
      mtowKg: 79000, cruiseMassKg: 69000,
      seatsTypical: 165, rangeKm: 6500, cruiseLD: 18.0, tsfcCruise: 0.51,
    },
    livery: {
      fuselage: '#f8f9fb', stripe: '#0b6470', tail: '#0b6470',
      wing: '#ccd1d7', engine: '#b4bbc3',
    },
  },
  {
    id: 'boeing737max',
    manufacturer: 'Boeing',
    model: '737 MAX 8',
    firstFlightYear: 2016,
    cruiseMach: 0.79,
    cruiseAltitudeM: 11300,
    innovation:
      'Split-tip scimitar winglets work above and below the wing at once, and a bypass ratio of nine forced the engine forward and up over the wing.',
    fuselage: {
      length: 39.52, diameter: 3.76, widthRatio: 1.0,
      noseFineness: 1.6, tailFineness: 2.9, tailUpsweepDeg: 6.5,
      crossSectionExponent: 2.0, deck: 'single',
    },
    wing: {
      planform: 'trapezoid', span: 34.4, rootChord: 5.7, tipChord: 1.37,
      sweepQuarterChordDeg: 25.0, dihedralDeg: 6.0, twistDeg: -4.0,
      thicknessRootRatio: 0.125, thicknessTipRatio: 0.092, camber: 0.022,
      family: 'supercritical', rootStationFrac: 0.35, verticalOffsetFrac: -0.6,
      wingletType: 'scimitar', wingletHeight: 2.6,
      kinkFrac: 0.36, kinkChordRatio: 0.58, incidenceDeg: 1.5,
    },
    engines: {
      type: 'ultra-high-bypass', mount: 'wing-pylon', count: 2, bypassRatio: 9.0,
      nacelleLength: 4.8, nacelleDiameter: 2.2,
      spanStations: [0.33],
    },
    tail: {
      config: 'conventional',
      hStabSpan: 14.0, hStabRootChord: 4.3, hStabTipChord: 1.4,
      hStabSweepDeg: 30.0, hStabDihedralDeg: 6.0,
      vStabHeight: 6.2, vStabRootChord: 6.8, vStabTipChord: 2.8,
      vStabSweepDeg: 35.0,
    },
    reference: {
      wingAreaM2: 127.0, spanOverallM: 35.92,
      mtowKg: 82190, cruiseMassKg: 72000,
      seatsTypical: 178, rangeKm: 6570, cruiseLD: 18.5, tsfcCruise: 0.51,
    },
    livery: {
      fuselage: '#f8f9fb', stripe: '#10294f', tail: '#10294f',
      wing: '#ccd1d7', engine: '#b4bbc3',
    },
  },
];

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
}
