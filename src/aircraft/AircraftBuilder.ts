import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AircraftSpec } from './AircraftSpec';
import { buildFuselage, type FuselageSections } from './build/fuselage';
import {
  buildLiftingSurface,
  chordAt,
  ogivalLeadingEdge,
  type LiftingSurfaceParams,
} from './build/wing';
import {
  buildExhaustPlug,
  buildFanBlades,
  buildNacelleCowl,
  buildSpinner,
  type NacelleParams,
} from './build/nacelle';
import { buildFuselageTexture } from './build/livery';

/**
 * Assemble a complete aircraft from its spec.
 *
 * Two things come out of this. The `group` is what gets rendered, with liveried
 * materials and visual-only detail like fan blades. The `solid` is a single merged
 * triangle mesh of everything that is aerodynamically real, in aircraft-local
 * coordinates, which is what later stages voxelise into the obstacle field the flow
 * solver uses. Keeping them separate means a nacelle's fan disc can look right without
 * the solver trying to resolve individual blades.
 *
 * No part is given its own transform: everything is generated directly in aircraft
 * coordinates so the merge is exact and the solid matches what you see.
 */

export type DetailLevel = 'low' | 'high';

export interface BuiltAircraft {
  spec: AircraftSpec;
  group: Group;
  /** Merged aerodynamic solid in aircraft-local coordinates. */
  solid: BufferGeometry;
  bounds: Box3;
  /** Leading edge position and chord at a spanwise station, for placing things on the wing. */
  wingStation: (z: number) => { x: number; y: number; chord: number };
  /** What was actually generated, so the geometry can be checked against the spec. */
  parts: { nacelles: number };
  dispose: () => void;
}

const DEG = Math.PI / 180;

interface Assembly {
  meshes: Mesh[];
  solids: BufferGeometry[];
}

function add(assembly: Assembly, geometry: BufferGeometry, material: MeshStandardMaterial, isSolid: boolean): void {
  assembly.meshes.push(new Mesh(geometry, material));
  if (isSolid) assembly.solids.push(geometry);
}

export function buildAircraft(spec: AircraftSpec, detail: DetailLevel = 'high'): BuiltAircraft {
  const high = detail === 'high';
  const L = spec.fuselage.length;
  const wing = spec.wing;
  const tail = spec.tail;

  const fuselage: FuselageSections = buildFuselage(spec, high ? 32 : 20, high ? 48 : 30);

  const liveryTexture = buildFuselageTexture(spec);
  const materials = {
    fuselage: new MeshStandardMaterial({
      color: 0xffffff,
      map: liveryTexture ?? undefined,
      roughness: 0.42,
      metalness: 0.12,
    }),
    wing: new MeshStandardMaterial({ color: spec.livery.wing, roughness: 0.5, metalness: 0.18 }),
    tail: new MeshStandardMaterial({ color: spec.livery.tail, roughness: 0.45, metalness: 0.15 }),
    engine: new MeshStandardMaterial({ color: spec.livery.engine, roughness: 0.32, metalness: 0.55 }),
    blade: new MeshStandardMaterial({
      color: 0x8c949e,
      roughness: 0.28,
      metalness: 0.9,
      side: DoubleSide,
    }),
    dark: new MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.4 }),
  };

  const assembly: Assembly = { meshes: [], solids: [] };
  add(assembly, fuselage.geometry, materials.fuselage, true);

  // ---- Wing -------------------------------------------------------------------
  const semiSpan = wing.span / 2;
  const rootLEx = wing.rootStationFrac * L;
  const rootY = fuselage.centreYAt(rootLEx) + wing.verticalOffsetFrac * fuselage.halfHeightAt(rootLEx);

  const wingParams: LiftingSurfaceParams = {
    rootLE: new Vector3(rootLEx, rootY, 0),
    semiSpan,
    rootChord: wing.rootChord,
    tipChord: wing.tipChord,
    kinkFrac: wing.kinkFrac,
    kinkChordRatio: wing.kinkChordRatio,
    sweepQuarterChordDeg: wing.sweepQuarterChordDeg,
    dihedralDeg: wing.dihedralDeg,
    twistDeg: wing.twistDeg,
    incidenceDeg: wing.incidenceDeg,
    thicknessRoot: wing.thicknessRootRatio,
    thicknessTip: wing.thicknessTipRatio,
    camber: wing.camber,
    family: wing.family,
    axis: 'z',
    winglet: { type: wing.wingletType, height: wing.wingletHeight },
    stations: high ? 16 : 10,
    airfoilResolution: high ? 30 : 20,
  };

  // Concorde's ogival delta is a different planform, not a swept trapezoid: the
  // leading edge curves continuously from a very highly swept root to a gentler tip.
  if (wing.planform === 'ogival-delta') {
    wingParams.kinkFrac = 0.55;
    wingParams.kinkChordRatio = 0.42;
    wingParams.stations = high ? 22 : 14;
    wingParams.leadingEdgeOffset = ogivalLeadingEdge(semiSpan);
  }

  add(assembly, buildLiftingSurface(wingParams), materials.wing, true);
  add(assembly, buildLiftingSurface({ ...wingParams, mirror: true }), materials.wing, true);

  const wingStation = (z: number) => {
    const u = Math.min(1, Math.abs(z) / semiSpan);
    const chord = chordAt(u, wingParams);
    const quarterChordX = rootLEx + 0.25 * wing.rootChord + Math.abs(z) * Math.tan(wing.sweepQuarterChordDeg * DEG);
    return {
      x: quarterChordX - 0.25 * chord,
      y: rootY + Math.abs(z) * Math.tan(wing.dihedralDeg * DEG),
      chord,
    };
  };

  // ---- Empennage --------------------------------------------------------------
  const finRootLEx = L - tail.vStabRootChord - 0.035 * L;
  const finRootY = fuselage.centreYAt(finRootLEx) + fuselage.halfHeightAt(finRootLEx) * 0.8;

  const finParams: LiftingSurfaceParams = {
    rootLE: new Vector3(finRootLEx, finRootY, 0),
    semiSpan: tail.vStabHeight,
    rootChord: tail.vStabRootChord,
    tipChord: tail.vStabTipChord,
    sweepQuarterChordDeg: tail.vStabSweepDeg,
    thicknessRoot: 0.12,
    thicknessTip: 0.09,
    camber: 0,
    family: 'naca4',
    axis: 'y',
    stations: high ? 10 : 6,
    airfoilResolution: high ? 24 : 16,
  };
  add(assembly, buildLiftingSurface(finParams), materials.tail, true);

  if (tail.config !== 'delta') {
    const isTTail = tail.config === 't-tail';
    let hRootLEx: number;
    let hRootY: number;
    if (isTTail) {
      // Perched on top of the fin, so the tailplane sits clear of the engine wake.
      const finTipQuarterChordX =
        finRootLEx + 0.25 * tail.vStabRootChord + tail.vStabHeight * Math.tan(tail.vStabSweepDeg * DEG);
      hRootLEx = finTipQuarterChordX - 0.25 * tail.vStabTipChord;
      hRootY = finRootY + tail.vStabHeight * 0.97;
    } else {
      hRootLEx = L - tail.hStabRootChord - 0.05 * L;
      hRootY = fuselage.centreYAt(hRootLEx) + fuselage.halfHeightAt(hRootLEx) * 0.1;
    }

    const hParams: LiftingSurfaceParams = {
      rootLE: new Vector3(hRootLEx, hRootY, 0),
      semiSpan: tail.hStabSpan / 2,
      rootChord: tail.hStabRootChord,
      tipChord: tail.hStabTipChord,
      sweepQuarterChordDeg: tail.hStabSweepDeg,
      dihedralDeg: tail.hStabDihedralDeg,
      thicknessRoot: 0.11,
      thicknessTip: 0.09,
      camber: 0,
      family: 'naca4',
      axis: 'z',
      stations: high ? 10 : 6,
      airfoilResolution: high ? 24 : 16,
    };
    add(assembly, buildLiftingSurface(hParams), materials.tail, true);
    add(assembly, buildLiftingSurface({ ...hParams, mirror: true }), materials.tail, true);
  }

  // ---- Engines ----------------------------------------------------------------
  const engines = spec.engines;
  let nacelleCount = 0;
  const addNacelle = (params: NacelleParams) => {
    nacelleCount++;
    add(assembly, buildNacelleCowl(params), materials.engine, true);
    add(assembly, buildExhaustPlug(params), materials.dark, true);
    if (high) {
      add(assembly, buildSpinner(params), materials.dark, false);
      add(assembly, buildFanBlades(params), materials.blade, false);
    }
  };

  if (engines.mount === 'wing-pylon' || engines.mount === 'wing-root-buried' || engines.mount === 'underwing-delta') {
    for (const station of engines.spanStations) {
      for (const side of [1, -1]) {
        const z = side * station * semiSpan;
        const at = wingStation(z);

        let inletX: number;
        let inletY: number;
        if (engines.mount === 'wing-root-buried') {
          // The Comet's engines live inside the wing root; only the intake shows.
          inletX = at.x - 0.05 * engines.nacelleLength;
          inletY = at.y;
        } else if (engines.mount === 'underwing-delta') {
          // Concorde's intakes are set well back under the delta.
          inletX = at.x + 0.42 * at.chord;
          inletY = at.y - 0.62 * engines.nacelleDiameter;
        } else {
          // A podded engine hangs forward of and below the leading edge, so the wing
          // and nacelle flows interfere as little as possible.
          inletX = at.x - 0.62 * engines.nacelleLength;
          inletY = at.y - 0.62 * engines.nacelleDiameter;
        }

        const params: NacelleParams = {
          inlet: new Vector3(inletX, inletY, z),
          length: engines.nacelleLength,
          diameter: engines.nacelleDiameter,
          bypassRatio: engines.bypassRatio,
          segments: high ? 26 : 16,
        };
        addNacelle(params);

        if (engines.mount === 'wing-pylon') {
          const pylonBaseY = inletY + 0.42 * engines.nacelleDiameter;
          add(
            assembly,
            buildLiftingSurface({
              rootLE: new Vector3(inletX + 0.3 * engines.nacelleLength, pylonBaseY, z),
              semiSpan: Math.max(0.15, at.y - pylonBaseY),
              rootChord: engines.nacelleLength * 0.8,
              tipChord: engines.nacelleLength * 0.62,
              sweepQuarterChordDeg: 8,
              thicknessRoot: 0.2,
              thicknessTip: 0.16,
              camber: 0,
              family: 'naca4',
              axis: 'y',
              stations: 4,
              airfoilResolution: 14,
            }),
            materials.engine,
            true,
          );
        }
      }
    }
  }

  if (engines.mount === 'rear-fuselage') {
    const stationX = (engines.fuselageStationFrac ?? 0.75) * L;
    const halfWidth = fuselage.halfWidthAt(stationX);
    const centreY = fuselage.centreYAt(stationX);
    for (const side of [1, -1]) {
      const z = side * (halfWidth + 0.62 * engines.nacelleDiameter);
      const inletX = stationX - 0.45 * engines.nacelleLength;
      const inletY = centreY + fuselage.halfHeightAt(stationX) * 0.22;
      addNacelle({
        inlet: new Vector3(inletX, inletY, z),
        length: engines.nacelleLength,
        diameter: engines.nacelleDiameter,
        bypassRatio: engines.bypassRatio,
        segments: high ? 26 : 16,
      });
      // Short horizontal pylon out to the fuselage side.
      add(
        assembly,
        buildLiftingSurface({
          rootLE: new Vector3(inletX + 0.42 * engines.nacelleLength, inletY, side * halfWidth * 0.75),
          semiSpan: Math.max(0.2, Math.abs(z) - halfWidth * 0.75),
          rootChord: engines.nacelleLength * 0.62,
          tipChord: engines.nacelleLength * 0.5,
          sweepQuarterChordDeg: 6,
          thicknessRoot: 0.22,
          thicknessTip: 0.18,
          camber: 0,
          family: 'naca4',
          axis: 'z',
          mirror: side < 0,
          stations: 4,
          airfoilResolution: 14,
        }),
        materials.engine,
        true,
      );
    }
  }

  // Any engines the pods above have not accounted for sit on the centreline, fed by a
  // duct through the base of the fin. That is how a trijet's third engine is arranged.
  //
  // This is derived from engines.count rather than from the tail configuration, because
  // the two are independent: the 727 is a T-tail AND a trijet, and gating the centre
  // engine on the tail shape left it with two engines while its specification said
  // three. Counting means the geometry cannot disagree with the number the interface
  // shows.
  for (let i = nacelleCount; i < engines.count; i++) {
    const intakeX = finRootLEx + tail.vStabRootChord * 0.1;
    const intakeY = finRootY + engines.nacelleDiameter * 0.35;
    addNacelle({
      inlet: new Vector3(intakeX, intakeY, 0),
      length: engines.nacelleLength * 0.62,
      diameter: engines.nacelleDiameter * 1.02,
      bypassRatio: engines.bypassRatio,
      segments: high ? 24 : 14,
    });
  }

  // ---- Finish -----------------------------------------------------------------
  const group = new Group();
  group.name = `aircraft:${spec.id}`;
  for (const mesh of assembly.meshes) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const merged = mergeGeometries(assembly.solids, false);
  if (!merged) throw new Error(`failed to merge solid geometry for ${spec.id}`);
  merged.computeBoundingBox();
  const bounds = merged.boundingBox ?? new Box3();

  return {
    spec,
    group,
    solid: merged,
    bounds,
    wingStation,
    parts: { nacelles: nacelleCount },
    dispose: () => {
      for (const mesh of assembly.meshes) mesh.geometry.dispose();
      merged.dispose();
      liveryTexture?.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
