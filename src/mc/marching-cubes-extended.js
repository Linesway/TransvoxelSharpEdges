/**
 * Extended Marching Cubes (surfRecon-style): polygon table + feature detection +
 * QEF (plane intersection) for sharp edges/corners + triangle fanning.
 * Same corner/edge order as classic MC so tables match.
 */
import { edgeTable } from '../tables/edge-table.js';
import { polygonTable, polyTable } from '../tables/polygon-tables.js';

// Must match mcTable/surfRecon: 0=(0,0,0), 1=(1,0,0), 2=(1,1,0), 3=(0,1,0), 4=(0,0,1), 5=(1,0,1), 6=(1,1,1), 7=(0,1,1)
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];
const EDGE_CORNERS = [
  [0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6], [7, 6], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

function sampleField(ix, iy, iz, res, fieldFn) {
  const x = ix / res, y = iy / res, z = iz / res;
  return fieldFn(x, y, z);
}

/** Gradient of field at (x,y,z) by central differences. Same coord system as fieldFn (e.g. [0,1]^3). */
function gradientAt(x, y, z, fieldFn, eps = 1e-6) {
  const gx = (fieldFn(x + eps, y, z) - fieldFn(x - eps, y, z)) / (2 * eps);
  const gy = (fieldFn(x, y + eps, z) - fieldFn(x, y - eps, z)) / (2 * eps);
  const gz = (fieldFn(x, y, z + eps) - fieldFn(x, y, z - eps)) / (2 * eps);
  return [gx, gy, gz];
}

function interpolate(p0, p1, v0, v1, iso) {
  const denom = v1 - v0;
  const t = Math.abs(denom) < 1e-9 ? 0.5 : (iso - v0) / denom;
  return [
    p0[0] + t * (p1[0] - p0[0]),
    p0[1] + t * (p1[1] - p0[1]),
    p0[2] + t * (p1[2] - p0[2])
  ];
}

/** Solve 3x3 linear system M x = b in place; returns true if successful. */
function solve3(M, b) {
  const m = (i, j) => M[i * 3 + j];
  const set = (i, j, v) => { M[i * 3 + j] = v; };
  const x = b;
  for (let k = 0; k < 3; k++) {
    let pivot = k;
    let max = Math.abs(m(k, k));
    for (let i = k + 1; i < 3; i++) {
      const a = Math.abs(m(i, k));
      if (a > max) { max = a; pivot = i; }
    }
    if (max < 1e-12) return false;
    if (pivot !== k) {
      for (let j = 0; j < 3; j++) { const t = m(k, j); set(k, j, m(pivot, j)); set(pivot, j, t); }
      const t = x[k]; x[k] = x[pivot]; x[pivot] = t;
    }
    const inv = 1 / m(k, k);
    for (let i = k + 1; i < 3; i++) {
      const f = m(i, k) * inv;
      for (let j = k; j < 3; j++) set(i, j, m(i, j) - f * m(k, j));
      x[i] -= f * x[k];
    }
  }
  for (let k = 2; k >= 0; k--) {
    let s = x[k];
    for (let j = k + 1; j < 3; j++) s -= m(k, j) * x[j];
    x[k] = s / m(k, k);
  }
  return true;
}

/**
 * Find feature point for an n-gon (surfRecon find_feature).
 * p[], n[] = positions and normals (centered). If normals span a sharp angle, solve
 * least-squares plane intersection (QEF) and return [x,y,z]; else return null.
 */
function findFeaturePoint(p, n, featureAngleRad) {
  const nV = p.length;
  let minC = 1;
  for (let i = 0; i < nV; i++)
    for (let j = 0; j < nV; j++) {
      const c = n[i][0] * n[j][0] + n[i][1] * n[j][1] + n[i][2] * n[j][2];
      if (c < minC) minC = c;
    }
  if (minC > Math.cos(featureAngleRad)) return null;

  // A x = b: each row i is n_i · x = n_i · p_i  =>  A = n (nV x 3), b[i] = dot(n[i], p[i])
  // Least squares: A^T A x = A^T b
  const AtA = new Float64Array(9);
  const Atb = new Float64Array(3);
  for (let i = 0; i < nV; i++) {
    const ni = n[i], pi = p[i];
    const bi = ni[0] * pi[0] + ni[1] * pi[1] + ni[2] * pi[2];
    Atb[0] += ni[0] * bi; Atb[1] += ni[1] * bi; Atb[2] += ni[2] * bi;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++)
        AtA[r * 3 + c] += ni[r] * ni[c];
  }
  if (!solve3(AtA, Atb)) return null;
  return [Atb[0], Atb[1], Atb[2]];
}

/**
 * Run extended marching cubes with feature detection and triangle fanning.
 * @param {number} res - grid resolution
 * @param {number} iso - isosurface value (inside where field > iso)
 * @param {(x,y,z)=>number} fieldFn - scalar field
 * @param {{ featureAngleDeg?: number }} options - feature angle in degrees (default 30)
 */
export function runExtendedMarchingCubes(res, iso, fieldFn, options = {}) {
  const featureAngleDeg = options.featureAngleDeg ?? 30;
  const featureAngleRad = (featureAngleDeg * Math.PI) / 180;

  const vertices = [];
  const indices = [];
  const vertexMap = new Map();
  let nextVertexIndex = 0;
  let featureCount = 0;

  function getVertex(cx, cy, cz, edgeId) {
    const [c0, c1] = EDGE_CORNERS[edgeId];
    const [di0, dj0, dk0] = CORNER_DELTA[c0];
    const [di1, dj1, dk1] = CORNER_DELTA[c1];
    const i0 = cx + di0, j0 = cy + dj0, k0 = cz + dk0;
    const i1 = cx + di1, j1 = cy + dj1, k1 = cz + dk1;
    const key = edgeKey(
      i0 * (res + 1) * (res + 1) + j0 * (res + 1) + k0,
      i1 * (res + 1) * (res + 1) + j1 * (res + 1) + k1
    );
    let idx = vertexMap.get(key);
    if (idx !== undefined) return idx;

    const v0 = sampleField(i0, j0, k0, res, fieldFn);
    const v1 = sampleField(i1, j1, k1, res, fieldFn);
    const p0 = [i0 / res, j0 / res, k0 / res];
    const p1 = [i1 / res, j1 / res, k1 / res];
    const p = interpolate(p0, p1, v0, v1, iso);

    // Normal at the actual intersection point (surfRecon uses directed_distance normal at _point)
    const [gx, gy, gz] = gradientAt(p[0], p[1], p[2], fieldFn);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = -gx / len, ny = -gy / len, nz = -gz / len;

    idx = nextVertexIndex++;
    vertexMap.set(key, idx);
    vertices.push(p[0], p[1], p[2], nx, ny, nz);
    return idx;
  }

  function getPosition(vi) {
    return [vertices[vi * 6], vertices[vi * 6 + 1], vertices[vi * 6 + 2]];
  }
  function getNormal(vi) {
    return [vertices[vi * 6 + 3], vertices[vi * 6 + 4], vertices[vi * 6 + 5]];
  }

  function addFeatureVertex(pos, norm) {
    const idx = nextVertexIndex++;
    vertices.push(pos[0], pos[1], pos[2], norm[0], norm[1], norm[2]);
    return idx;
  }

  for (let cx = 0; cx < res; cx++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cz = 0; cz < res; cz++) {
        const values = [];
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = CORNER_DELTA[c];
          values[c] = sampleField(cx + di, cy + dj, cz + dk, res, fieldFn);
        }
        let cubetype = 0;
        for (let c = 0; c < 8; c++)
          if (values[c] > iso) cubetype |= 1 << c;
        if (cubetype === 0 || cubetype === 255) continue;

        const edgeMask = edgeTable[cubetype];
        const samples = [];
        for (let e = 0; e < 12; e++) {
          if (edgeMask & (1 << e))
            samples[e] = getVertex(cx, cy, cz, e);
        }

        const row = polygonTable[cubetype];
        const n_components = row[0];
        let offset = 1;
        for (let comp = 0; comp < n_components; comp++) {
          const nv = row[offset++];
          if (nv < 3 || nv > 7) { offset += nv; continue; }
          const polyIndices = [];
          for (let i = 0; i < nv; i++)
            polyIndices.push(samples[row[offset + i]]);
          offset += nv;

          const p = [];
          const n = [];
          for (let i = 0; i < nv; i++) {
            p.push(getPosition(polyIndices[i]));
            n.push(getNormal(polyIndices[i]));
          }
          const cog = [0, 0, 0];
          for (let i = 0; i < nv; i++) {
            cog[0] += p[i][0]; cog[1] += p[i][1]; cog[2] += p[i][2];
          }
          cog[0] /= nv; cog[1] /= nv; cog[2] /= nv;
          for (let i = 0; i < nv; i++) {
            p[i] = [p[i][0] - cog[0], p[i][1] - cog[1], p[i][2] - cog[2]];
          }

          const featurePoint = findFeaturePoint(p, n, featureAngleRad);
          if (featurePoint) {
            featureCount++;
            const world = [featurePoint[0] + cog[0], featurePoint[1] + cog[1], featurePoint[2] + cog[2]];
            let nx = 0, ny = 0, nz = 0;
            for (let i = 0; i < nv; i++) {
              nx += n[i][0]; ny += n[i][1]; nz += n[i][2];
            }
            const ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= ln; ny /= ln; nz /= ln;
            const fv = addFeatureVertex(world, [nx, ny, nz]);
            for (let j = 0; j < nv; j++)
              indices.push(polyIndices[j], polyIndices[(j + 1) % nv], fv);
          } else {
            const tri = polyTable[nv];
            for (let j = 0; tri[j] !== -1; j += 3)
              indices.push(
                polyIndices[tri[j]],
                polyIndices[tri[j + 1]],
                polyIndices[tri[j + 2]]
              );
          }
        }
      }
    }
  }

  console.log('Extended MC: features found =', featureCount);
  return { vertices, indices };
}
