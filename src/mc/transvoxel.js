/**
 * Transvoxel interior (regular cell) algorithm only.
 * Corner order must match C4/Transvoxel tables: corner k = (k&1, (k>>1)&1, (k>>2)&1).
 * So 0=(0,0,0), 1=(1,0,0), 2=(0,1,0), 3=(1,1,0), 4=(0,0,1), 5=(1,0,1), 6=(0,1,1), 7=(1,1,1).
 * Returns { vertices, indices } with 6 floats per vertex (x,y,z,nx,ny,nz) in [0,1]^3.
 */
import { regularCellClass, regularCellData, regularVertexData } from '../tables/transvoxel-regular-tables.js';

// C4 / Transvoxel table convention: position from corner index = (corner&1, (corner>>1)&1, (corner>>2)&1)
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]
];

function sampleField(ix, iy, iz, res, fieldFn) {
  const x = ix / res, y = iy / res, z = iz / res;
  return fieldFn(x, y, z);
}

function gradientAt(x, y, z, fieldFn, eps = 1e-6) {
  const gx = (fieldFn(x + eps, y, z) - fieldFn(x - eps, y, z)) / (2 * eps);
  const gy = (fieldFn(x, y + eps, z) - fieldFn(x, y - eps, z)) / (2 * eps);
  const gz = (fieldFn(x, y, z + eps) - fieldFn(x, y, z - eps)) / (2 * eps);
  const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / len, gy / len, gz / len];
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

/**
 * Run Transvoxel interior (regular cells) only.
 * @param {number} res - resolution per axis (cells: 0..res-1)
 * @param {number} iso - isosurface value (inside = field > iso)
 * @param {(x:number,y:number,z:number)=>number} fieldFn - scalar field on [0,1]^3
 * @returns {{ vertices: number[], indices: number[] }}
 */
export function runTransvoxelInterior(res, iso, fieldFn) {
  const vertices = [];
  const indices = [];

  for (let cz = 0; cz < res; cz++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cx = 0; cx < res; cx++) {
        const ox = cx / res, oy = cy / res, oz = cz / res;
        const cornerVal = [];
        for (let i = 0; i < 8; i++) {
          const d = CORNER_DELTA[i];
          cornerVal.push(sampleField(cx + d[0], cy + d[1], cz + d[2], res, fieldFn));
        }
        let caseIndex = 0;
        for (let i = 0; i < 8; i++) if (cornerVal[i] > iso) caseIndex |= (1 << i);
        if (caseIndex === 0 || caseIndex === 255) continue;

        const equivClass = regularCellClass[caseIndex];
        const cellData = regularCellData[equivClass];
        const geometryCounts = cellData.geometryCounts;
        const numVertices = geometryCounts >> 4;
        const numTriangles = geometryCounts & 0x0F;
        const vertexIndex = cellData.vertexIndex;
        const vertexArray = regularVertexData[caseIndex];

        const baseIndex = vertices.length / 6;
        for (let a = 0; a < numVertices; a++) {
          const vertexData = vertexArray[a];
          const c0 = vertexData & 0x07;
          const c1 = (vertexData >> 3) & 0x07;
          const p0 = [ox + CORNER_DELTA[c0][0] / res, oy + CORNER_DELTA[c0][1] / res, oz + CORNER_DELTA[c0][2] / res];
          const p1 = [ox + CORNER_DELTA[c1][0] / res, oy + CORNER_DELTA[c1][1] / res, oz + CORNER_DELTA[c1][2] / res];
          const v0 = cornerVal[c0], v1 = cornerVal[c1];
          const pos = interpolate(p0, p1, v0, v1, iso);
          const norm = gradientAt(pos[0], pos[1], pos[2], fieldFn);
          // C4: inside = negative distance, gradient points outward. We use field = -SDF (positive inside), so gradient points inward; negate for outward normal.
          vertices.push(pos[0], pos[1], pos[2], -norm[0], -norm[1], -norm[2]);
        }
        // C4 outputs index[0], index[1], index[2]; flip winding so front face is outward (we use gradient = low→high, surface is at iso)
        for (let t = 0; t < numTriangles; t++) {
          const i0 = vertexIndex[t * 3], i1 = vertexIndex[t * 3 + 1], i2 = vertexIndex[t * 3 + 2];
          indices.push(baseIndex + i0, baseIndex + i2, baseIndex + i1);
        }
      }
    }
  }

  return { vertices, indices };
}
