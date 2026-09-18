import { ATLAS_GLSL } from './atlas';

/**
 * The solver's passes.
 *
 * This is incompressible flow solved the way most interactive fluid work is: move the
 * velocity field along itself, then correct it so nothing is created or destroyed. The
 * correction is the expensive half - finding the pressure whose gradient cancels the
 * divergence is a Poisson solve, done here by repeated Jacobi sweeps.
 *
 * Everything is non-dimensional. The free stream is exactly 1, lengths are cells, and
 * the step is a fraction of a cell. The speed slider does not enter the solver at all;
 * it scales what is displayed and how fast particles are carried. That is ordinary
 * practice in computational aerodynamics, and it has a practical benefit here: the CFL
 * number is fixed, so dragging the slider cannot destabilise the solve.
 */

export const VERTEX_SHADER = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Obstacle lookup shared by every pass that needs to know where the aircraft is. */
const OBSTACLE_GLSL = /* glsl */ `
  uniform sampler2D uSdf;
  uniform vec3 uSdfGrid;
  uniform vec2 uSdfTiles;
  uniform vec2 uSdfTexSize;
  uniform vec3 uSdfOrigin;
  uniform float uSdfCell;
  uniform float uSdfBand;
  uniform float uHasObstacle;
  uniform mat4 uInvModel;
  uniform vec3 uDomainMin;
  uniform vec3 uDomainSize;
  /// World size of one flow cell.
  uniform float uCellWorld;

  vec3 cellToWorld(vec3 cell) {
    return uDomainMin + ((cell + 0.5) / uGrid) * uDomainSize;
  }

  /// Distance to the aircraft surface, negative inside.
  ///
  /// The field is built once in the aircraft's own frame and the query point is
  /// transformed into it, so pitching or yawing the model costs a matrix multiply rather
  /// than a rebuild.
  float solidDistance(vec3 cell) {
    if (uHasObstacle < 0.5) return uSdfBand;
    vec3 world = cellToWorld(cell);
    vec3 object = (uInvModel * vec4(world, 1.0)).xyz;
    vec3 p = (object - uSdfOrigin) / uSdfCell + 0.5;
    if (any(lessThan(p, vec3(0.0))) || any(greaterThan(p, uSdfGrid))) return uSdfBand;
    return sampleAtlasOf(uSdf, p, uSdfGrid, uSdfTiles, uSdfTexSize).r;
  }

  /// How much of a cell the aircraft occupies, 0 clear and 1 solid.
  ///
  /// The half-cell ramp is what keeps the surface smooth. A hard test would make every
  /// boundary a staircase at this resolution, and the flow would separate off the steps
  /// rather than off the shape.
  float solidity(vec3 cell) {
    return clamp(0.5 - solidDistance(cell) / uCellWorld, 0.0, 1.0);
  }

  bool isSolid(vec3 cell) {
    return solidity(cell) > 0.5;
  }
`;

const HEADER = `precision highp float;\nprecision highp sampler2D;\nout vec4 fragColor;\n`;

/** Move the velocity field along itself, tracing backwards to find where each cell's air came from. */
export const ADVECT_SHADER = HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform float uDt;
  uniform float uDissipation;

  void main() {
    vec3 cell = fragmentCell();
    if (isPaddingCell(cell)) { fragColor = vec4(0.0); return; }

    vec3 p = cell + 0.5;
    vec3 v = sampleAtlas(uVelocity, p).xyz;
    // Semi-Lagrangian: unconditionally stable, which matters more here than the
    // numerical diffusion it costs. The lost small-scale detail is put back in a later
    // stage as vorticity confinement.
    vec3 source = p - v * uDt;
    vec3 advected = sampleAtlas(uVelocity, source).xyz * uDissipation;

    fragColor = vec4(advected, 0.0);
  }
`;

/**
 * Boundary conditions and the obstacle.
 *
 * Inlet holds the free stream, outlet lets the flow leave without reflecting, the
 * lateral faces slip rather than stick, and the aircraft brings the air to rest.
 */
export const CONSTRAIN_SHADER = HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  uniform sampler2D uVelocity;

  void main() {
    vec3 cell = fragmentCell();
    if (isPaddingCell(cell)) { fragColor = vec4(0.0); return; }

    vec3 v = readCell(uVelocity, cell).xyz;

    // The aircraft. A partly solid cell is slowed in proportion, which is what makes a
    // coarse grid produce a smooth surface rather than a staircase.
    float solid = solidity(cell);
    v = mix(v, vec3(0.0), solid);

    // Lateral walls slip. A no-slip tunnel wall would grow a boundary layer far thicker
    // than the real one at this resolution, and it is not what the simulation is about.
    if (cell.y < 0.5 || cell.y > uGrid.y - 1.5) v.y = 0.0;
    if (cell.z < 0.5 || cell.z > uGrid.z - 1.5) v.z = 0.0;

    // Inlet: the free stream, by definition 1.
    if (cell.x < 1.5) v = vec3(1.0, 0.0, 0.0);
    // Outlet: copy from upstream so the wake leaves instead of bouncing back in.
    if (cell.x > uGrid.x - 2.5) v = readCell(uVelocity, vec3(uGrid.x - 3.0, cell.y, cell.z)).xyz;

    fragColor = vec4(v, 0.0);
  }
`;

/** How much the velocity field is creating or destroying air in each cell. */
export const DIVERGENCE_SHADER = HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  uniform sampler2D uVelocity;

  /**
   * A neighbour's velocity, with the domain edge treated as zero-gradient.
   *
   * Returning zero outside the grid instead would make every face of the domain look
   * like a wall the free stream slams into: at the inlet the difference across the face
   * is then the whole free stream rather than nothing, and the pressure solve spends
   * itself fighting a source that does not exist. The symptom is the flow losing a
   * quarter of its speed before it has reached the aircraft.
   */
  vec3 neighbourVelocity(vec3 cell, vec3 offset, vec3 centre) {
    vec3 n = cell + offset;
    if (any(lessThan(n, vec3(0.0))) || any(greaterThan(n, uGrid - 1.0))) return centre;
    // Solid neighbours are at rest, so the surface is felt as a lack of through-flow.
    return readCell(uVelocity, n).xyz * (1.0 - solidity(n));
  }

  void main() {
    vec3 cell = fragmentCell();
    if (isPaddingCell(cell)) { fragColor = vec4(0.0); return; }

    vec3 centre = readCell(uVelocity, cell).xyz;
    float dx = neighbourVelocity(cell, vec3(1.0, 0.0, 0.0), centre).x
             - neighbourVelocity(cell, vec3(-1.0, 0.0, 0.0), centre).x;
    float dy = neighbourVelocity(cell, vec3(0.0, 1.0, 0.0), centre).y
             - neighbourVelocity(cell, vec3(0.0, -1.0, 0.0), centre).y;
    float dz = neighbourVelocity(cell, vec3(0.0, 0.0, 1.0), centre).z
             - neighbourVelocity(cell, vec3(0.0, 0.0, -1.0), centre).z;

    fragColor = vec4(0.5 * (dx + dy + dz), 0.0, 0.0, 0.0);
  }
`;

/**
 * One Jacobi sweep of the pressure Poisson equation.
 *
 * Solid and outside neighbours reuse the centre value, which is a zero-gradient
 * condition: pressure is free to build against a surface, and the projection that
 * follows turns that build-up into flow along the surface rather than through it.
 */
export const JACOBI_SHADER = HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  uniform sampler2D uPressure;
  uniform sampler2D uDivergence;

  float neighbourPressure(vec3 cell, vec3 offset, float centre) {
    vec3 n = cell + offset;
    if (any(lessThan(n, vec3(0.0))) || any(greaterThan(n, uGrid - 1.0))) return centre;
    if (isSolid(n)) return centre;
    return readCell(uPressure, n).x;
  }

  void main() {
    vec3 cell = fragmentCell();
    if (isPaddingCell(cell)) { fragColor = vec4(0.0); return; }

    float centre = readCell(uPressure, cell).x;
    float sum =
      neighbourPressure(cell, vec3( 1.0, 0.0, 0.0), centre) +
      neighbourPressure(cell, vec3(-1.0, 0.0, 0.0), centre) +
      neighbourPressure(cell, vec3(0.0,  1.0, 0.0), centre) +
      neighbourPressure(cell, vec3(0.0, -1.0, 0.0), centre) +
      neighbourPressure(cell, vec3(0.0, 0.0,  1.0), centre) +
      neighbourPressure(cell, vec3(0.0, 0.0, -1.0), centre);

    float divergence = readCell(uDivergence, cell).x;
    fragColor = vec4((sum - divergence) / 6.0, 0.0, 0.0, 0.0);
  }
`;

/** Subtract the pressure gradient, which is what makes the field divergence-free. */
export const PROJECT_SHADER = HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  uniform sampler2D uVelocity;
  uniform sampler2D uPressure;

  float neighbourPressure(vec3 cell, vec3 offset, float centre) {
    vec3 n = cell + offset;
    if (any(lessThan(n, vec3(0.0))) || any(greaterThan(n, uGrid - 1.0))) return centre;
    if (isSolid(n)) return centre;
    return readCell(uPressure, n).x;
  }

  void main() {
    vec3 cell = fragmentCell();
    if (isPaddingCell(cell)) { fragColor = vec4(0.0); return; }

    float centre = readCell(uPressure, cell).x;
    vec3 gradient = 0.5 * vec3(
      neighbourPressure(cell, vec3(1.0, 0.0, 0.0), centre) - neighbourPressure(cell, vec3(-1.0, 0.0, 0.0), centre),
      neighbourPressure(cell, vec3(0.0, 1.0, 0.0), centre) - neighbourPressure(cell, vec3(0.0, -1.0, 0.0), centre),
      neighbourPressure(cell, vec3(0.0, 0.0, 1.0), centre) - neighbourPressure(cell, vec3(0.0, 0.0, -1.0), centre)
    );

    vec3 v = readCell(uVelocity, cell).xyz - gradient;
    fragColor = vec4(v, 0.0);
  }
`;

/** Start from a uniform free stream with the aircraft already carved out of it. */
export const SEED_SHADER = HEADER + ATLAS_GLSL + OBSTACLE_GLSL + /* glsl */ `
  void main() {
    vec3 cell = fragmentCell();
    if (isPaddingCell(cell)) { fragColor = vec4(0.0); return; }
    fragColor = vec4(vec3(1.0, 0.0, 0.0) * (1.0 - solidity(cell)), 0.0);
  }
`;

export const CLEAR_SHADER = HEADER + /* glsl */ `
  void main() { fragColor = vec4(0.0); }
`;
