/**
 * Classic Marching Cubes — literal match to surfRecon marchingCubes.cpp + mcTable.cpp.
 * Grid: cells (cx, cy, cz), 0 <= cx,cy,cz < res. Corners at integer grid points 0..res.
 * Convention: value > iso = inside (same as surfRecon).
 */
import { edgeTable, triTable } from '../tables/mc-tables.js';

// Cube corner positions relative to cell (cx, cy, cz). Must match mcTable/surfRecon grid order.
// grid.cpp offsets: 0->(0,0,0), 1->(1,0,0), 2->(1,1,0), 3->(0,1,0), 4->(0,0,1), 5->(1,0,1), 6->(1,1,1), 7->(0,1,1)
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

// Edge k goes between corner pair (CORNER_EDGE[k][0], CORNER_EDGE[k][1]). Matches C++ add_vertex(corner[i], corner[j]).
const CORNER_EDGE = [
  [0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6], [7, 6], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

/**
 * Run marching cubes on a scalar field over [0,1]^3.
 * @param {number} res - grid resolution (res x res x res cells)
 * @param {number} iso - isosurface value (inside where field > iso)
 * @param {(x:number,y:number,z:number)=>number} field - scalar field (x,y,z in [0,1])
 * @returns {{ vertices: number[], indices: number[] }} vertices: x,y,z,nx,ny,nz per vertex; indices: triples
 */
export function runMarchingCubes(res, iso, field) {
  const vertices = [];
  const indices = [];
  const edgeToVertex = new Map();
  let vertexCount = 0;

  function sample(ix, iy, iz) {
    return field(ix / res, iy / res, iz / res);
  }

  function addVertex(cx, cy, cz, cornerA, cornerB) {
    const [ax, ay, az] = CORNER_DELTA[cornerA];
    const [bx, by, bz] = CORNER_DELTA[cornerB];
    const i0 = cx + ax, j0 = cy + ay, k0 = cz + az;
    const i1 = cx + bx, j1 = cy + by, k1 = cz + bz;
    const key = i0 < i1 || (i0 === i1 && (j0 < j1 || (j0 === j1 && k0 < k1)))
      ? `${i0},${j0},${k0}-${i1},${j1},${k1}` : `${i1},${j1},${k1}-${i0},${j0},${k0}`;
    if (edgeToVertex.has(key)) return edgeToVertex.get(key);

    const v0 = sample(i0, j0, k0);
    const v1 = sample(i1, j1, k1);
    const denom = v1 - v0;
    const t = Math.abs(denom) < 1e-9 ? 0.5 : (iso - v0) / denom;
    const x = (i0 + t * (i1 - i0)) / res;
    const y = (j0 + t * (j1 - j0)) / res;
    const z = (k0 + t * (k1 - k0)) / res;

    // Normal from gradient (central diff at midpoint)
    const mi = Math.max(1, Math.min(res - 1, (i0 + i1) >> 1));
    const mj = Math.max(1, Math.min(res - 1, (j0 + j1) >> 1));
    const mk = Math.max(1, Math.min(res - 1, (k0 + k1) >> 1));
    const h = 1 / res;
    const gx = (sample(mi + 1, mj, mk) - sample(mi - 1, mj, mk)) / (2 * h);
    const gy = (sample(mi, mj + 1, mk) - sample(mi, mj - 1, mk)) / (2 * h);
    const gz = (sample(mi, mj, mk + 1) - sample(mi, mj, mk - 1)) / (2 * h);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = -gx / len, ny = -gy / len, nz = -gz / len;

    const idx = vertexCount++;
    edgeToVertex.set(key, idx);
    vertices.push(x, y, z, nx, ny, nz);
    return idx;
  }

  for (let cx = 0; cx < res; cx++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cz = 0; cz < res; cz++) {
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNER_DELTA[c];
          if (sample(cx + dx, cy + dy, cz + dz) > iso) cubeIndex |= 1 << c;
        }
        if (cubeIndex === 0 || cubeIndex === 255) continue;

        const bits = edgeTable[cubeIndex];
        const samples = new Array(12);
        for (let e = 0; e < 12; e++) {
          if (bits & (1 << e)) {
            const [a, b] = CORNER_EDGE[e];
            samples[e] = addVertex(cx, cy, cz, a, b);
          }
        }

        const tri = triTable[cubeIndex];
        for (let i = 0; tri[i] !== -1; i += 3) {
          indices.push(samples[tri[i]], samples[tri[i + 1]], samples[tri[i + 2]]);
        }
      }
    }
  }

  return { vertices, indices };
}
