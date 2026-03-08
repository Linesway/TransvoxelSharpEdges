/**
 * Self-contained least-squares solve for the IsoEx feature-point case.
 * Solves min ||A x - b|| for x in R³. A is m×3 (rows = normals), b length m.
 * Uses normal equations (A'A x = A'b) and 3×3 symmetric eigendecomposition.
 * Set USE_ISOEX_SVD = true to use the known-working Golub-Reinsch SVD (svd-isoex) instead.
 */

import { svd_decomp, svd_backsub } from './svd-isoex.js';

const USE_ISOEX_SVD = true; // temporary: use svd-isoex (Golub-Reinsch) instead of 3×3 eigen

const EPS = 1e-10;

/** Solve using IsoEx Golub-Reinsch SVD (known working). A copied so svd_decomp can overwrite. */
function svdSolve3IsoEx(A, b, rank2) {
  const m = A.length;
  const Acopy = A.map(row => [row[0], row[1], row[2]]);
  const S = [0, 0, 0];
  const V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  svd_decomp(Acopy, S, V);
  if (rank2) {
    let minIdx = 0;
    for (let i = 1; i < 3; i++) if (S[i] < S[minIdx]) minIdx = i;
    S[minIdx] = 0;
  }
  const x = [0, 0, 0];
  svd_backsub(Acopy, S, V, b, x);
  return x;
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b, out) {
  out[0] = a[1] * b[2] - a[2] * b[1];
  out[1] = a[2] * b[0] - a[0] * b[2];
  out[2] = a[0] * b[1] - a[1] * b[0];
}

function norm3(v) {
  const n = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return n < EPS ? 0 : n;
}

function scale3(v, s, out) {
  out[0] = v[0] * s;
  out[1] = v[1] * s;
  out[2] = v[2] * s;
}

// Form ATA (3×3 symmetric) and ATb (3). A[row][col], b[row].
function formNormalEquations(A, b, ATA, ATb) {
  const m = A.length;
  ATA[0] = 0; ATA[1] = 0; ATA[2] = 0;
  ATA[3] = 0; ATA[4] = 0; ATA[5] = 0;
  ATA[6] = 0; ATA[7] = 0; ATA[8] = 0;
  ATb[0] = 0; ATb[1] = 0; ATb[2] = 0;
  for (let k = 0; k < m; k++) {
    const a0 = A[k][0], a1 = A[k][1], a2 = A[k][2];
    const bk = b[k];
    ATA[0] += a0 * a0; ATA[1] += a0 * a1; ATA[2] += a0 * a2;
    ATA[4] += a1 * a1; ATA[5] += a1 * a2;
    ATA[8] += a2 * a2;
    ATb[0] += a0 * bk; ATb[1] += a1 * bk; ATb[2] += a2 * bk;
  }
  ATA[3] = ATA[1]; ATA[6] = ATA[2]; ATA[7] = ATA[5];
}

// 3×3 symmetric eigendecomposition. M stored row-major [0..8]. Writes eig[0..2] and V as 3 columns (V[0], V[1], V[2] are vec3).
// Eigenvalues in descending order; eigenvectors normalized.
function eigen3x3Sym(M, eig, V) {
  const trace = M[0] + M[4] + M[8];
  const c2 = M[0] * M[4] - M[1] * M[3] + M[0] * M[8] - M[2] * M[6] + M[4] * M[8] - M[5] * M[7];
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  // t³ - trace·t² + c2·t - det = 0  =>  t³ + a t² + b t + c = 0 with a=-trace, b=c2, c=-det
  const a = -trace, b = c2, c = -det;
  const p = b - a * a / 3, q = c - a * b / 3 + 2 * a * a * a / 27;
  let y0, y1, y2;
  if (p > 0) {
    // Degenerate (one real root): use triple root at trace/3
    const t = trace / 3;
    eig[0] = t; eig[1] = t; eig[2] = t;
    V[0][0] = 1; V[0][1] = 0; V[0][2] = 0;
    V[1][0] = 0; V[1][1] = 1; V[1][2] = 0;
    V[2][0] = 0; V[2][1] = 0; V[2][2] = 1;
    return;
  }
  if (Math.abs(p) < EPS) {
    const r = Math.cbrt(-q);
    y0 = r; y1 = r; y2 = r;
  } else {
    const sq = Math.sqrt(-p / 3);
    const cap = sq < EPS ? 0 : Math.acos(Math.max(-1, Math.min(1, (3 * q / (2 * p)) / sq))) / 3;
    y0 = 2 * sq * Math.cos(cap);
    y1 = 2 * sq * Math.cos(cap - 2 * Math.PI / 3);
    y2 = 2 * sq * Math.cos(cap + 2 * Math.PI / 3);
  }
  const t0 = y0 - a / 3, t1 = y1 - a / 3, t2 = y2 - a / 3;
  // Sort descending
  if (t0 >= t1 && t0 >= t2) {
    eig[0] = t0;
    if (t1 >= t2) { eig[1] = t1; eig[2] = t2; } else { eig[1] = t2; eig[2] = t1; }
  } else if (t1 >= t0 && t1 >= t2) {
    eig[0] = t1;
    if (t0 >= t2) { eig[1] = t0; eig[2] = t2; } else { eig[1] = t2; eig[2] = t0; }
  } else {
    eig[0] = t2;
    if (t0 >= t1) { eig[1] = t0; eig[2] = t1; } else { eig[1] = t1; eig[2] = t0; }
  }
  // Eigenvectors: (M - λI) v = 0 => take two rows, cross product
  const row0 = [M[0], M[1], M[2]];
  const row1 = [M[3], M[4], M[5]];
  const row2 = [M[6], M[7], M[8]];
  for (let i = 0; i < 3; i++) {
    const lam = eig[i];
    row0[0] = M[0] - lam; row0[1] = M[1]; row0[2] = M[2];
    row1[0] = M[3]; row1[1] = M[4] - lam; row1[2] = M[5];
    row2[0] = M[6]; row2[1] = M[7]; row2[2] = M[8] - lam;
    cross3(row0, row1, V[i]);
    let n = norm3(V[i]);
    if (n < EPS) {
      cross3(row1, row2, V[i]);
      n = norm3(V[i]);
    }
    if (n < EPS) {
      cross3(row0, row2, V[i]);
      n = norm3(V[i]);
    }
    if (n >= EPS) scale3(V[i], 1 / n, V[i]);
    else { V[i][0] = i === 0 ? 1 : 0; V[i][1] = i === 1 ? 1 : 0; V[i][2] = i === 2 ? 1 : 0; }
  }
}

/**
 * Solve min ||A x - b|| for x in R³.
 * @param {number[][]} A - m×3 matrix (array of 3-element rows, e.g. normals)
 * @param {number[]} b - length m
 * @param {boolean} rank2 - if true, zero smallest singular value (edge feature)
 * @returns {number[]} x - length 3
 */
export function svdSolve3(A, b, rank2) {
  if (USE_ISOEX_SVD) {
    return svdSolve3IsoEx(A, b, rank2);
  }
  const m = A.length;
  const ATA = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const ATb = [0, 0, 0];
  formNormalEquations(A, b, ATA, ATb);

  const eig = [0, 0, 0];
  const V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  eigen3x3Sym(ATA, eig, V);

  // Pseudo-inverse: x = V * diag(1/λ) * V' * ATb. For rank2, zero smallest λ (eig[2] after sort).
  if (rank2) eig[2] = 0;

  const w0 = dot3(V[0], ATb);
  const w1 = dot3(V[1], ATb);
  const w2 = dot3(V[2], ATb);
  const inv0 = eig[0] > EPS ? 1 / eig[0] : 0;
  const inv1 = eig[1] > EPS ? 1 / eig[1] : 0;
  const inv2 = eig[2] > EPS ? 1 / eig[2] : 0;

  const x = [
    V[0][0] * (w0 * inv0) + V[1][0] * (w1 * inv1) + V[2][0] * (w2 * inv2),
    V[0][1] * (w0 * inv0) + V[1][1] * (w1 * inv1) + V[2][1] * (w2 * inv2),
    V[0][2] * (w0 * inv0) + V[1][2] * (w1 * inv1) + V[2][2] * (w2 * inv2)
  ];
  return x;
}
