/**
 * GPU-friendly SVD-based least-squares solver for A x ≈ b.
 * Port of Nick Gildea's glsl_svd.cpp (QEF / feature points), which works in GLSL compute shaders.
 * A is n×3 (n = 3..7), b is n×1. Returns x minimizing |A x - b|.
 * rank2: if true, zero smallest singular value (edge features).
 * Fixed-size arrays only for HLSL/GPU portability.
 *
 * Reference: https://github.com/nickgildea/qef (glsl_svd.cpp), public domain.
 */

const MAX_ROWS = 7;
const COLS = 3;
const N = 3;
const SVD_NUM_SWEEPS = 5;
const TINY = 1e-20;

// Fixed-size scratch
const A_flat = new Float64Array(MAX_ROWS * COLS);
const b_flat = new Float64Array(MAX_ROWS);
const ATA = new Float64Array(N * N);   // 3×3 symmetric (A^T A), row-major
const ATb = new Float64Array(N);       // 3
const V = new Float64Array(N * N);    // 3×3 eigenvectors (columns), row-major
const sigma = new Float64Array(N);    // 3 eigenvalues (singular values squared for A^T A)

function at(M, i, j) { return M[i * N + j]; }
function set(M, i, j, v) { M[i * N + j] = v; }

/** Givens coefficients to zero a_pq in symmetric 2×2 block. Same as glsl_svd givens_coeffs_sym. */
function givensCoeffsSym(a_pp, a_pq, a_qq, out) {
  if (a_pq === 0) {
    out.c = 1; out.s = 0;
    return;
  }
  const tau = (a_qq - a_pp) / (2 * a_pq);
  const stt = Math.sqrt(1 + tau * tau);
  const tan = 1 / (tau >= 0 ? tau + stt : tau - stt);
  out.c = 1 / Math.sqrt(1 + tan * tan);
  out.s = tan * out.c;
}

/** Rotate (x,y) by (c,-s;s,c). Same as glsl_svd svd_rotate_xy. */
function rotateXY(x, y, c, s) {
  return { x: c * x - s * y, y: s * x + c * y };
}

/** Update 2×2 block diagonal and zero off-diag. Same as glsl_svd svd_rotateq_xy. */
function rotateQXY(x, y, a, c, s) {
  const cc = c * c, ss = s * s, mx = 2 * c * s * a;
  return {
    x: cc * x - mx + ss * y,
    y: ss * x + mx + cc * y
  };
}

/** One Jacobi sweep pair (a,b). Zeros ATA[a][b], updates ATA and V. */
function svdRotate(a, b) {
  const apq = at(ATA, a, b);
  if (apq === 0) return;
  const app = at(ATA, a, a);
  const aqq = at(ATA, b, b);
  const g = {};
  givensCoeffsSym(app, apq, aqq, g);
  const c = g.c, s = g.s;
  const d = rotateQXY(app, aqq, apq, c, s);
  set(ATA, a, a, d.x);
  set(ATA, b, b, d.y);
  set(ATA, a, b, 0);
  set(ATA, b, a, 0);
  const k = 3 - a - b;
  const r0 = rotateXY(at(ATA, a, k), at(ATA, b, k), c, s);
  set(ATA, a, k, r0.x);
  set(ATA, b, k, r0.y);
  set(ATA, k, a, r0.x);
  set(ATA, k, b, r0.y);
  for (let j = 0; j < N; j++) {
    const rv = rotateXY(at(V, j, a), at(V, j, b), c, s);
    set(V, j, a, rv.x);
    set(V, j, b, rv.y);
  }
}

/** Diagonalize symmetric ATA; on exit ATA is diagonal (eigenvalues), V holds eigenvectors. */
function svdSolveSym() {
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) set(V, i, j, i === j ? 1 : 0);
  }
  for (let i = 0; i < SVD_NUM_SWEEPS; i++) {
    svdRotate(0, 1);
    svdRotate(0, 2);
    svdRotate(1, 2);
  }
  sigma[0] = at(ATA, 0, 0);
  sigma[1] = at(ATA, 1, 1);
  sigma[2] = at(ATA, 2, 2);
}

/** Pseudoinverse weight: 1/x if |x| and |1/x| above tol, else 0. Same as glsl_svd svd_invdet. */
function invDet(x, tol) {
  const ax = Math.abs(x);
  return (ax < tol || Math.abs(1 / x) < tol) ? 0 : (1 / x);
}

/** x = (V * diag(d) * V^T) * ATb with d = pseudoinverse of sigma; rank2 zeros smallest. */
function solveFromSVD(rank2, out) {
  let d0 = invDet(sigma[0], TINY);
  let d1 = invDet(sigma[1], TINY);
  let d2 = invDet(sigma[2], TINY);
  if (rank2) {
    const s0 = sigma[0], s1 = sigma[1], s2 = sigma[2];
    if (s0 <= s1 && s0 <= s2) d0 = 0;
    else if (s1 <= s0 && s1 <= s2) d1 = 0;
    else d2 = 0;
  }
  const v00 = at(V, 0, 0), v01 = at(V, 0, 1), v02 = at(V, 0, 2);
  const v10 = at(V, 1, 0), v11 = at(V, 1, 1), v12 = at(V, 1, 2);
  const v20 = at(V, 2, 0), v21 = at(V, 2, 1), v22 = at(V, 2, 2);
  const q0 = ATb[0], q1 = ATb[1], q2 = ATb[2];
  out[0] = (v00 * d0 * v00 + v01 * d1 * v01 + v02 * d2 * v02) * q0
         + (v00 * d0 * v10 + v01 * d1 * v11 + v02 * d2 * v12) * q1
         + (v00 * d0 * v20 + v01 * d1 * v21 + v02 * d2 * v22) * q2;
  out[1] = (v10 * d0 * v00 + v11 * d1 * v01 + v12 * d2 * v02) * q0
         + (v10 * d0 * v10 + v11 * d1 * v11 + v12 * d2 * v12) * q1
         + (v10 * d0 * v20 + v11 * d1 * v21 + v12 * d2 * v22) * q2;
  out[2] = (v20 * d0 * v00 + v21 * d1 * v01 + v22 * d2 * v02) * q0
         + (v20 * d0 * v10 + v21 * d1 * v11 + v22 * d2 * v12) * q1
         + (v20 * d0 * v20 + v21 * d1 * v21 + v22 * d2 * v22) * q2;
}

/** Form ATA = A^T A and ATb = A^T b from first n rows. A_flat is n×3 (rows), so A^T is 3×n. */
function formATAATb(n) {
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) sum += A_flat[k * COLS + i] * A_flat[k * COLS + j];
      set(ATA, i, j, sum);
      set(ATA, j, i, sum);
    }
    let sum = 0;
    for (let k = 0; k < n; k++) sum += A_flat[k * COLS + i] * b_flat[k];
    ATb[i] = sum;
  }
}

/**
 * Solve min |A x - b| for x in R^3.
 * @param {Array<[number,number,number]>} matrixA - n rows of 3 (normals), n in 3..7
 * @param {number[]} vectorB - length n (position·normal per vertex)
 * @param {boolean} rank2 - if true, use rank-2 (zero smallest singular value)
 * @returns {[number,number,number]} x
 */
export function svdSolve3(matrixA, vectorB, rank2) {
  const n = matrixA.length;
  if (n < 3 || n > MAX_ROWS || vectorB.length < n) return [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = matrixA[i];
    A_flat[i * COLS + 0] = row[0];
    A_flat[i * COLS + 1] = row[1];
    A_flat[i * COLS + 2] = row[2];
    b_flat[i] = vectorB[i];
  }
  formATAATb(n);
  svdSolveSym();
  const out = [0, 0, 0];
  solveFromSVD(rank2, out);
  return out;
}
