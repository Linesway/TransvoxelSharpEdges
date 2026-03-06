/**
 * IsoEx Math SVD — Golub-Reinsch (Numerical Recipes) port.
 * A = U * diag(S) * V^T. On exit A is overwritten: first n columns hold U (m×n).
 * S is length n, V is n×n.
 * Backsub: x = V * inv(S) * U^T * b.
 */

function dmax(a, b) {
  return a > b ? a : b;
}

function imin(a, b) {
  return a < b ? a : b;
}

function sign(a, b) {
  return b >= 0 ? Math.abs(a) : -Math.abs(a);
}

function dpythag(a, b) {
  const absa = Math.abs(a);
  const absb = Math.abs(b);
  if (absa > absb) return absa * Math.sqrt(1 + (absb / absa) ** 2);
  return absb === 0 ? 0 : absb * Math.sqrt(1 + (absa / absb) ** 2);
}

/**
 * SVD of A (m×n). A modified in place (first n cols become U). S length n, V n×n.
 * A[k][i] = row k, col i. V[j][jj] = row j, col jj.
 */
export function svd_decomp(A, S, V) {
  const m = A.length;
  const n = A[0].length;
  const rv1 = new Array(n);
  let l = 0;
  let anorm = 0;
  let scale = 0;
  let g = 0;
  let s = 0;

  for (let i = 0; i < n; i++) {
    l = i + 1;
    rv1[i] = scale * g;
    g = 0;
    scale = 0;
    let s = 0;
    if (i < m) {
      for (let k = i; k < m; k++) scale += Math.abs(A[k][i]);
      if (scale !== 0) {
        for (let k = i; k < m; k++) {
          A[k][i] /= scale;
          s += A[k][i] * A[k][i];
        }
        let f = A[i][i];
        g = -sign(Math.sqrt(s), f);
        const h = f * g - s;
        A[i][i] = f - g;
        for (let j = l; j < n; j++) {
          s = 0;
          for (let k = i; k < m; k++) s += A[k][i] * A[k][j];
          f = s / h;
          for (let k = i; k < m; k++) A[k][j] += f * A[k][i];
        }
        for (let k = i; k < m; k++) A[k][i] *= scale;
      }
    }
    S[i] = scale * g;
    g = 0;
    scale = 0;
    s = 0;
    if (i < m && i !== n - 1) {
      for (let k = l; k < n; k++) scale += Math.abs(A[i][k]);
      if (scale !== 0) {
        for (let k = l; k < n; k++) {
          A[i][k] /= scale;
          s += A[i][k] * A[i][k];
        }
        const f = A[i][l];
        g = -sign(Math.sqrt(s), f);
        const h = f * g - s;
        A[i][l] = f - g;
        for (let k = l; k < n; k++) rv1[k] = A[i][k] / h;
        for (let j = l; j < m; j++) {
          s = 0;
          for (let k = l; k < n; k++) s += A[j][k] * A[i][k];
          for (let k = l; k < n; k++) A[j][k] += s * rv1[k];
        }
        for (let k = l; k < n; k++) A[i][k] *= scale;
      }
    }
    anorm = dmax(anorm, Math.abs(S[i]) + Math.abs(rv1[i]));
  }

  for (let i = n - 1; i >= 0; i--) {
    if (i < n - 1) {
      if (g !== 0) {
        for (let j = l; j < n; j++) V[j][i] = (A[i][j] / A[i][l]) / g;
        for (let j = l; j < n; j++) {
          s = 0;
          for (let k = l; k < n; k++) s += A[i][k] * V[k][j];
          for (let k = l; k < n; k++) V[k][j] += s * V[k][i];
        }
      }
      for (let j = l; j < n; j++) V[i][j] = V[j][i] = 0;
    }
    V[i][i] = 1;
    g = rv1[i];
    l = i;
  }

  for (let i = imin(m, n) - 1; i >= 0; i--) {
    l = i + 1;
    g = S[i];
    for (let j = l; j < n; j++) A[i][j] = 0;
    if (g !== 0) {
      g = 1 / g;
      for (let j = l; j < n; j++) {
        s = 0;
        for (let k = l; k < m; k++) s += A[k][i] * A[k][j];
        const f = (s / A[i][i]) * g;
        for (let k = i; k < m; k++) A[k][j] += f * A[k][i];
      }
      for (let j = i; j < m; j++) A[j][i] *= g;
    } else {
      for (let j = i; j < m; j++) A[j][i] = 0;
    }
    A[i][i] += 1;
  }

  for (let k = n - 1; k >= 0; k--) {
    let its = 0;
    for (; its < 100; its++) {
      let flag = 1;
      let nm = 0;
      for (l = k; l >= 0; l--) {
        nm = l - 1;
        if (Math.abs(rv1[l]) + anorm === anorm) {
          flag = 0;
          break;
        }
        if (nm >= 0 && Math.abs(S[nm]) + anorm === anorm) break;
      }
      if (flag) {
        let c = 0, s = 1;
        for (let i = l; i <= k; i++) {
          const f = s * rv1[i];
          rv1[i] = c * rv1[i];
          if (Math.abs(f) + anorm === anorm) break;
          g = S[i];
          const h = dpythag(f, g);
          S[i] = h;
          const invH = 1 / h;
          c = g * invH;
          s = -f * invH;
          for (let j = 0; j < m; j++) {
            const y = A[j][nm];
            const z = A[j][i];
            A[j][nm] = y * c + z * s;
            A[j][i] = z * c - y * s;
          }
        }
      }
      let z = S[k];
      if (l === k) {
        if (z < 0) {
          S[k] = -z;
          for (let j = 0; j < n; j++) V[j][k] = -V[j][k];
        }
        break;
      }
      if (its === 29) {
        console.warn('SVD: no convergence after 30 iterations');
      }
      let x = S[l];
      nm = k - 1;
      let y = S[nm];
      g = rv1[nm];
      let h = rv1[k];
      let f = ((y - z) * (y + z) + (g - h) * (g + h)) / (2 * h * y);
      g = dpythag(f, 1);
      f = ((x - z) * (x + z) + h * ((y / (f + sign(g, f))) - h)) / x;
      let c = 1, s = 1;
      for (let j = l; j <= nm; j++) {
        const ii = j + 1;
        g = rv1[ii];
        y = S[ii];
        h = s * g;
        g = c * g;
        z = dpythag(f, h);
        rv1[j] = z;
        c = f / z;
        s = h / z;
        f = x * c + g * s;
        g = g * c - x * s;
        h = y * s;
        y *= c;
        for (let jj = 0; jj < n; jj++) {
          x = V[jj][j];
          z = V[jj][ii];
          V[jj][j] = x * c + z * s;
          V[jj][ii] = z * c - x * s;
        }
        z = dpythag(f, h);
        S[j] = z;
        if (z !== 0) {
          z = 1 / z;
          c = f * z;
          s = h * z;
        }
        f = c * g + s * y;
        x = c * y - s * g;
        for (let jj = 0; jj < m; jj++) {
          y = A[jj][j];
          z = A[jj][ii];
          A[jj][j] = y * c + z * s;
          A[jj][ii] = z * c - y * s;
        }
      }
      rv1[l] = 0;
      rv1[k] = f;
      S[k] = x;
    }
  }
  return true;
}

/**
 * SVD backsub: x = V * inv(S) * U^T * b. A holds U (m×n), S length n, V n×n, b length m, x length n.
 */
export function svd_backsub(A, S, V, b, x) {
  const m = A.length;
  const n = V.length;
  const tmp = new Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    if (S[j] !== 0) {
      for (let i = 0; i < m; i++) s += A[i][j] * b[i];
      s /= S[j];
    }
    tmp[j] = s;
  }
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let jj = 0; jj < n; jj++) s += V[j][jj] * tmp[jj];
    x[j] = s;
  }
}
