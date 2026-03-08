/**
 * Transvoxel interior with C4-style edge-only vertex sharing.
 * Vertices on edges use deck + edgeDeltaCode; vertices on corners are created per cell (no corner path).
 * Returns { vertices, indices } with 6 floats per vertex (x,y,z,nx,ny,nz) in [0,1]^3.
 */
import { regularCellClass, regularCellData, regularVertexData } from '../tables/transvoxel-tables.js';

const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]
];

const EMPTY = -1;

function sampleField(ix, iy, iz, res, fieldFn) {
  return fieldFn(ix / res, iy / res, iz / res);
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
    p0[2] + t * (p1[2] - p0[2]),
    t
  ];
}

function makeDeck(res) {
  return Array.from({ length: res }, () =>
    Array.from({ length: res }, () => ({ edge: new Array(12).fill(EMPTY) }))
  );
}

/**
 * Run Transvoxel interior with C4-style edge-only vertex sharing.
 */
export function runTransvoxelInteriorVertexSharing(res, iso, fieldFn) {
  const vertices = [];
  const indices = [];
  const deck0 = makeDeck(res);
  const deck1 = makeDeck(res);
  const decks = [deck0, deck1];
  let nextIndex = 0;
  const onCornerEps = 1e-7;

  for (let cz = 0; cz < res; cz++) {
    const currentDeck = decks[cz & 1];
    for (let cy = 0; cy < res; cy++) {
      for (let cx = 0; cx < res; cx++) {
        const cell = currentDeck[cy][cx];
        cell.edge.fill(EMPTY);
      }
    }

    let cornerDeltaMask = 4;
    for (let cy = 0; cy < res; cy++) {
      cornerDeltaMask = (cornerDeltaMask | 2) & 6;
      for (let cx = 0; cx < res; cx++) {
        cornerDeltaMask |= 1;
        const ox = cx / res, oy = cy / res, oz = cz / res;
        const cornerVal = [];
        for (let c = 0; c < 8; c++) {
          const d = CORNER_DELTA[c];
          cornerVal.push(sampleField(cx + d[0], cy + d[1], cz + d[2], res, fieldFn));
        }
        let caseIndex = 0;
        for (let c = 0; c < 8; c++) if (cornerVal[c] > iso) caseIndex |= (1 << c);
        if (caseIndex === 0 || caseIndex === 255) continue;

        const equivClass = regularCellClass[caseIndex];
        const cellData = regularCellData[equivClass];
        const geometryCounts = cellData.geometryCounts;
        const numVertices = geometryCounts >> 4;
        const numTriangles = geometryCounts & 0x0F;
        const vertexIndex = cellData.vertexIndex;
        const vertexArray = regularVertexData[caseIndex];
        const currentCell = currentDeck[cy][cx];
        const edgeDeltaMask = ((cornerDeltaMask << 1) & 0x0C) | (cornerDeltaMask & 0x03);

        const cellVertexIndex = [];
        for (let a = 0; a < numVertices; a++) {
          const vertexData = vertexArray[a];
          const c0 = vertexData & 0x07;
          const c1 = (vertexData >> 3) & 0x07;
          const p0 = [ox + CORNER_DELTA[c0][0] / res, oy + CORNER_DELTA[c0][1] / res, oz + CORNER_DELTA[c0][2] / res];
          const p1 = [ox + CORNER_DELTA[c1][0] / res, oy + CORNER_DELTA[c1][1] / res, oz + CORNER_DELTA[c1][2] / res];
          const v0 = cornerVal[c0], v1 = cornerVal[c1];
          const interp = interpolate(p0, p1, v0, v1, iso);
          const pos = [interp[0], interp[1], interp[2]];
          const t = interp[3];

          const onCorner = t <= onCornerEps || t >= 1 - onCornerEps;
          let idx = EMPTY;

          if (onCorner) {
            idx = nextIndex++;
            const norm = gradientAt(pos[0], pos[1], pos[2], fieldFn);
            vertices.push(pos[0], pos[1], pos[2], -norm[0], -norm[1], -norm[2]);
          } else {
            let edgeIdx = (vertexData >> 8) & 0x0F;
            const edgeDeltaCode = (vertexData >> 12) & edgeDeltaMask;
            if (edgeDeltaCode !== 0) {
              edgeIdx += ((edgeDeltaCode & 1) + ((edgeDeltaCode >> 1) & 1) + ((edgeDeltaCode >> 2) & 3)) * 3;
              const deck = decks[(cz & 1) ^ (edgeDeltaCode >> 3)];
              const ny = cy - ((edgeDeltaCode >> 1) & 1);
              const nx = cx - (edgeDeltaCode & 1);
              if (nx >= 0 && nx < res && ny >= 0 && ny < res && edgeIdx >= 3) {
                idx = deck[ny][nx].edge[edgeIdx - 3];
              }
            }
            if (idx === EMPTY) {
              idx = nextIndex++;
              const norm = gradientAt(pos[0], pos[1], pos[2], fieldFn);
              vertices.push(pos[0], pos[1], pos[2], -norm[0], -norm[1], -norm[2]);
              if (edgeIdx >= 3) {
                currentCell.edge[edgeIdx - 3] = idx;
              }
            }
          }
          cellVertexIndex[a] = idx;
        }

        for (let t = 0; t < numTriangles; t++) {
          const i0 = vertexIndex[t * 3];
          const i1 = vertexIndex[t * 3 + 1];
          const i2 = vertexIndex[t * 3 + 2];
          indices.push(cellVertexIndex[i0], cellVertexIndex[i2], cellVertexIndex[i1]);
        }
      }
    }
  }

  return { vertices, indices };
}
