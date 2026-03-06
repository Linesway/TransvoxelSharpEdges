/**
 * Extended Marching Cubes: polygon table + polyTable n-gon triangulation.
 * Samples a scalar field on a regular grid, outputs triangles (positions + normals).
 */

import { edgeTable, polygonTable, polyTable } from './mc-tables.js';

// Cube corners: 0..7. Edge 0 = 0-1, 1 = 1-2, 2 = 3-2, 3 = 0-3, 4 = 4-5, 5 = 5-6, 6 = 7-6, 7 = 4-7, 8 = 0-4, 9 = 1-5, 10 = 2-6, 11 = 3-7.
const EDGE_CORNERS = [
  [0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6], [7, 6], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

// Corner positions in unit cube (for gradient / vertex position)
const CORNER_POS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

/**
 * Sample scalar field at grid point (ix, iy, iz). Grid is [0, res]^3, map to [0,1]^3.
 */
function sampleField(ix, iy, iz, res, fieldFn) {
  const x = ix / res, y = iy / res, z = iz / res;
  return fieldFn(x, y, z);
}

/** Linear interpolation along edge: vertex where value = iso. */
function interpolate(p0, p1, v0, v1, iso) {
  const t = (iso - v0) / (v1 - v0);
  return [
    p0[0] + t * (p1[0] - p0[0]),
    p0[1] + t * (p1[1] - p0[1]),
    p0[2] + t * (p1[2] - p0[2])
  ];
}

export function runExtendedMarchingCubes(res, iso, fieldFn) {
  const vertices = [];  // [x,y,z, nx,ny,nz] per vertex
  const indices = [];    // triangle indices into vertices (each 3 = one triangle)
  const vertexMap = new Map(); // edgeKey -> vertex index
  let nextVertexIndex = 0;

  function getVertex(cx, cy, cz, edgeId) {
    const [c0, c1] = EDGE_CORNERS[edgeId];
    const i0 = cx + (c0 & 1), j0 = cy + ((c0 >> 1) & 1), k0 = cz + ((c0 >> 2) & 1);
    const i1 = cx + (c1 & 1), j1 = cy + ((c1 >> 1) & 1), k1 = cz + ((c1 >> 2) & 1);
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

    // Normal from gradient at edge midpoint (clamp to grid)
    const mi = Math.max(1, Math.min(res - 1, Math.floor((i0 + i1) / 2)));
    const mj = Math.max(1, Math.min(res - 1, Math.floor((j0 + j1) / 2)));
    const mk = Math.max(1, Math.min(res - 1, Math.floor((k0 + k1) / 2)));
    const h = 1 / res;
    const gx = (sampleField(mi + 1, mj, mk, res, fieldFn) - sampleField(mi - 1, mj, mk, res, fieldFn)) / (2 * h);
    const gy = (sampleField(mi, mj + 1, mk, res, fieldFn) - sampleField(mi, mj - 1, mk, res, fieldFn)) / (2 * h);
    const gz = (sampleField(mi, mj, mk + 1, res, fieldFn) - sampleField(mi, mj, mk - 1, res, fieldFn)) / (2 * h);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = -gx / len, ny = -gy / len, nz = -gz / len;

    idx = nextVertexIndex++;
    vertexMap.set(key, idx);
    vertices.push(p[0], p[1], p[2], nx, ny, nz);
    return idx;
  }

  for (let cx = 0; cx < res; cx++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cz = 0; cz < res; cz++) {
        const values = [];
        for (let c = 0; c < 8; c++) {
          const i = cx + (c & 1), j = cy + ((c >> 1) & 1), k = cz + ((c >> 2) & 1);
          values[c] = sampleField(i, j, k, res, fieldFn);
        }
        let cubetype = 0;
        for (let c = 0; c < 8; c++)
          if (values[c] > iso) cubetype |= 1 << c;
        if (cubetype === 0 || cubetype === 255) continue;

        const edgeMask = edgeTable[cubetype];
        const samples = []; // samples[edgeId] = vertex index
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

  return { vertices, indices };
}
