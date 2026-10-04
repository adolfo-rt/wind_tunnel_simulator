/**
 * A dense linear solve, shared by the panel methods.
 *
 * Gaussian elimination with partial pivoting. The systems here are a few hundred
 * unknowns at most — a section has about 160 panels, a fuselage about 60 — so the cubic
 * cost is microseconds and there is no reason to reach for anything cleverer. Pivoting
 * is not optional: a panel influence matrix has small diagonal entries wherever two
 * panels are nearly parallel, which on an airfoil is most of the trailing edge.
 */
export function solveDense(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const m = Float64Array.from(a);
  const rhs = Float64Array.from(b);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row * n + col]) > Math.abs(m[pivot * n + col])) pivot = row;
    }
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = m[col * n + k];
        m[col * n + k] = m[pivot * n + k];
        m[pivot * n + k] = t;
      }
      const t = rhs[col];
      rhs[col] = rhs[pivot];
      rhs[pivot] = t;
    }

    const diagonal = m[col * n + col];
    if (Math.abs(diagonal) < 1e-14) continue;
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * n + col] / diagonal;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) m[row * n + k] -= factor * m[col * n + k];
      rhs[row] -= factor * rhs[col];
    }
  }

  const out = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row];
    for (let k = row + 1; k < n; k++) sum -= m[row * n + k] * out[k];
    const diagonal = m[row * n + row];
    out[row] = Math.abs(diagonal) < 1e-14 ? 0 : sum / diagonal;
  }
  return out;
}
