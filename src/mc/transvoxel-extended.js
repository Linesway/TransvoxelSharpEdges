/**
 * Transvoxel regular-cell extractor with sharp-feature handling:
 * - uses regularCellPolyTable components (n-gons)
 * - detects edge/corner features from normals
 * - places feature vertices via IsoEx-style SVD solve
 * - triangulates via fan around feature point or fallback poly triangulation
 */
import { regularVertexData } from '../tables/transvoxel-regular-tables.js';
import { regularCellPolyTable } from '../tables/transvoxel-regular-poly-table.js';
import { polyTable } from '../tables/polygon-tables.js';
import { svd_decomp, svd_backsub } from '../math/svd-isoex.js';

// C4 / Transvoxel corner convention.
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]
];

function edgeKey(i, j) {
  return i < j ? `${i},${j}` : `${j},${i}`;
}

function sampleField(ix, iy, iz, res, fieldFn) {
  return fieldFn(ix / res, iy / res, iz / res);
}

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

function findFeaturePoint(pDetect, nDetect, featureAngleRad, counts, pSvd, nSvd) {
  const nDetectCount = pDetect.length;
  let minC = 1;
  let axis = [0, 0, 0];
  for (let i = 0; i < nDetectCount; i++) {
    for (let j = 0; j < nDetectCount; j++) {
      const c = nDetect[i][0] * nDetect[j][0] + nDetect[i][1] * nDetect[j][1] + nDetect[i][2] * nDetect[j][2];
      if (c < minC) {
        minC = c;
        axis = [
          nDetect[i][1] * nDetect[j][2] - nDetect[i][2] * nDetect[j][1],
          nDetect[i][2] * nDetect[j][0] - nDetect[i][0] * nDetect[j][2],
          nDetect[i][0] * nDetect[j][1] - nDetect[i][1] * nDetect[j][0]
        ];
      }
    }
  }
  if (minC > Math.cos(featureAngleRad)) return null;

  let len = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
  axis[0] /= len; axis[1] /= len; axis[2] /= len;
  let minD = 1;
  let maxD = -1;
  for (let i = 0; i < nDetectCount; i++) {
    const d = nDetect[i][0] * axis[0] + nDetect[i][1] * axis[1] + nDetect[i][2] * axis[2];
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  let c = Math.max(Math.abs(minD), Math.abs(maxD));
  c = Math.sqrt(1 - c * c);
  const rank = c > Math.cos(featureAngleRad) ? 2 : 3;
  if (rank === 2) counts.n_edges++;
  else counts.n_corners++;

  const nV = pSvd.length;
  const A = [];
  const b = [];
  for (let i = 0; i < nV; i++) {
    A.push([nSvd[i][0], nSvd[i][1], nSvd[i][2]]);
    b.push(pSvd[i][0] * nSvd[i][0] + pSvd[i][1] * nSvd[i][1] + pSvd[i][2] * nSvd[i][2]);
  }

  const ACopy = A.map((row) => row.slice());
  const S = [0, 0, 0];
  const V = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  svd_decomp(ACopy, S, V);

  if (rank === 2) {
    const srank = Math.min(nV, 3);
    let smin = Number.POSITIVE_INFINITY;
    let sminid = 0;
    for (let i = 0; i < srank; i++) {
      if (S[i] < smin) {
        smin = S[i];
        sminid = i;
      }
    }
    S[sminid] = 0;
  }

  const x = [0, 0, 0];
  svd_backsub(ACopy, S, V, b, x);
  return { point: x, rank };
}

function getPos(vertices, vi) {
  return [vertices[vi * 6], vertices[vi * 6 + 1], vertices[vi * 6 + 2]];
}

function triArea(vertices, a, b, c) {
  const p0 = getPos(vertices, a);
  const p1 = getPos(vertices, b);
  const p2 = getPos(vertices, c);
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function flipEdges(vertices, indices, featureVertices) {
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
  const edgeToTris = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    for (const [u, v, w] of [[a, b, c], [b, c, a], [c, a, b]]) {
      const e = key(u, v);
      if (!edgeToTris.has(e)) edgeToTris.set(e, []);
      edgeToTris.get(e).push({ tri: i, u, v, opp: w });
    }
  }

  let flips = 0;
  const minArea = 1e-14;
  for (const [edgeKeyStr, list] of edgeToTris) {
    if (list.length !== 2) continue;
    const [t0, t1] = list;
    const edgeA = t0.u, edgeB = t0.v;
    const opp0 = t0.opp, opp1 = t1.opp;
    if (!featureVertices.has(opp0) || !featureVertices.has(opp1)) continue;
    if (featureVertices.has(edgeA) || featureVertices.has(edgeB)) continue;
    const newEdge = key(opp0, opp1);
    if (newEdge !== edgeKeyStr && edgeToTris.has(newEdge)) continue;
    if (triArea(vertices, edgeA, opp0, opp1) < minArea) continue;
    if (triArea(vertices, edgeB, opp1, opp0) < minArea) continue;
    const i0 = t0.tri, i1 = t1.tri;
    indices[i0] = edgeA; indices[i0 + 1] = opp0; indices[i0 + 2] = opp1;
    indices[i1] = edgeB; indices[i1 + 1] = opp1; indices[i1 + 2] = opp0;
    flips++;
  }
  if (flips > 0) console.log('Transvoxel Extended: edge flips =', flips);
}

/**
 * Run Transvoxel regular-cell extended extractor.
 * @param {number} res
 * @param {number} iso
 * @param {(x:number,y:number,z:number)=>number} fieldFn
 * @param {{ featureAngleDeg?: number }} options
 * @returns {{ vertices:number[], indices:number[] }}
 */
export function runTransvoxelExtended(res, iso, fieldFn, options = {}) {
  const featureAngleDeg = options.featureAngleDeg ?? 30;
  const featureAngleRad = (featureAngleDeg * Math.PI) / 180;

  const vertices = [];
  const indices = [];
  const vertexMap = new Map();
  const vertexLimitNormals = [];
  const featureVertices = new Set();
  const counts = { n_edges: 0, n_corners: 0 };
  let nextVertexIndex = 0;

  function getVertex(cx, cy, cz, vertexCode, cornerVal) {
    const c0 = vertexCode & 0x07;
    const c1 = (vertexCode >> 3) & 0x07;
    const [di0, dj0, dk0] = CORNER_DELTA[c0];
    const [di1, dj1, dk1] = CORNER_DELTA[c1];
    const i0 = cx + di0, j0 = cy + dj0, k0 = cz + dk0;
    const i1 = cx + di1, j1 = cy + dj1, k1 = cz + dk1;
    const key = edgeKey(
      i0 * (res + 1) * (res + 1) + j0 * (res + 1) + k0,
      i1 * (res + 1) * (res + 1) + j1 * (res + 1) + k1
    );
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;

    const p0 = [i0 / res, j0 / res, k0 / res];
    const p1 = [i1 / res, j1 / res, k1 / res];
    const v0 = cornerVal[c0], v1 = cornerVal[c1];
    const pos = interpolate(p0, p1, v0, v1, iso);

    // Surface normal (same outward convention as transvoxel.js: negate gradient of field=-SDF)
    const [gx, gy, gz] = gradientAt(pos[0], pos[1], pos[2], fieldFn);
    let len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = -gx / len, ny = -gy / len, nz = -gz / len;

    // Limit normals at edge corners for feature detection.
    const [g0x, g0y, g0z] = gradientAt(p0[0], p0[1], p0[2], fieldFn);
    const [g1x, g1y, g1z] = gradientAt(p1[0], p1[1], p1[2], fieldFn);
    const l0 = Math.sqrt(g0x * g0x + g0y * g0y + g0z * g0z) || 1;
    const l1 = Math.sqrt(g1x * g1x + g1y * g1y + g1z * g1z) || 1;
    const n0 = [-g0x / l0, -g0y / l0, -g0z / l0];
    const n1 = [-g1x / l1, -g1y / l1, -g1z / l1];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];

    const idx = nextVertexIndex++;
    vertexMap.set(key, idx);
    vertices.push(pos[0], pos[1], pos[2], nx, ny, nz);
    if (dot < Math.cos(featureAngleRad)) vertexLimitNormals[idx] = [n0, n1];
    else vertexLimitNormals[idx] = undefined;
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
    featureVertices.add(idx);
    return idx;
  }

  for (let cz = 0; cz < res; cz++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cx = 0; cx < res; cx++) {
        const cornerVal = new Array(8);
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = CORNER_DELTA[c];
          cornerVal[c] = sampleField(cx + di, cy + dj, cz + dk, res, fieldFn);
        }
        let caseIndex = 0;
        for (let c = 0; c < 8; c++) if (cornerVal[c] > iso) caseIndex |= (1 << c);
        if (caseIndex === 0 || caseIndex === 255) continue;

        const vertexArray = regularVertexData[caseIndex];
        const row = regularCellPolyTable[caseIndex];
        const nComponents = row[0];

        // Build per-case sample vertex indices on demand.
        const samples = new Array(12);
        let maxIndex = 0;
        let tmpOffset = 1;
        for (let comp = 0; comp < nComponents; comp++) {
          const nvRaw = row[tmpOffset++];
          for (let i = 0; i < nvRaw; i++) {
            const idx = row[tmpOffset + i];
            if (idx > maxIndex) maxIndex = idx;
          }
          tmpOffset += nvRaw;
        }
        for (let i = 0; i <= maxIndex; i++) {
          const code = vertexArray[i];
          samples[i] = getVertex(cx, cy, cz, code, cornerVal);
        }

        let offset = 1;
        for (let comp = 0; comp < nComponents; comp++) {
          const nvRaw = row[offset++];
          const raw = [];
          for (let i = 0; i < nvRaw; i++) raw.push(samples[row[offset + i]]);
          offset += nvRaw;

          // regularCellPolyTable stores closed loops (last index repeats first).
          let polyIndices = raw;
          if (raw.length >= 4 && raw[0] === raw[raw.length - 1]) {
            polyIndices = raw.slice(0, raw.length - 1);
          }
          const nv = polyIndices.length;
          if (nv < 3 || nv > 7) continue;

          const cog = [0, 0, 0];
          for (let i = 0; i < nv; i++) {
            const p = getPosition(polyIndices[i]);
            cog[0] += p[0]; cog[1] += p[1]; cog[2] += p[2];
          }
          cog[0] /= nv; cog[1] /= nv; cog[2] /= nv;

          const pDetect = [];
          const nDetect = [];
          for (let i = 0; i < nv; i++) {
            const vi = polyIndices[i];
            const p = getPosition(vi);
            const limits = vertexLimitNormals[vi];
            if (limits) {
              for (const norm of limits) {
                pDetect.push([p[0] - cog[0], p[1] - cog[1], p[2] - cog[2]]);
                nDetect.push(norm);
              }
            } else {
              pDetect.push([p[0] - cog[0], p[1] - cog[1], p[2] - cog[2]]);
              nDetect.push(getNormal(vi));
            }
          }

          const pSvd = [];
          const nSvd = [];
          for (let i = 0; i < nv; i++) {
            const p = getPosition(polyIndices[i]);
            pSvd.push([p[0] - cog[0], p[1] - cog[1], p[2] - cog[2]]);
            nSvd.push(getNormal(polyIndices[i]));
          }

          const feature = findFeaturePoint(pDetect, nDetect, featureAngleRad, counts, pSvd, nSvd);
          if (feature) {
            const world = [
              feature.point[0] + cog[0],
              feature.point[1] + cog[1],
              feature.point[2] + cog[2]
            ];
            let nx = 0, ny = 0, nz = 0;
            for (let i = 0; i < nSvd.length; i++) {
              nx += nSvd[i][0]; ny += nSvd[i][1]; nz += nSvd[i][2];
            }
            const ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
            nx /= ln; ny /= ln; nz /= ln;
            const fv = addFeatureVertex(world, [nx, ny, nz]);
            for (let j = 0; j < nv; j++) {
              indices.push(polyIndices[j], polyIndices[(j + 1) % nv], fv);
            }
          } else {
            const tri = polyTable[nv];
            for (let j = 0; tri[j] !== -1; j += 3) {
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
  }

  flipEdges(vertices, indices, featureVertices);
  console.log('Transvoxel Extended: found', counts.n_edges, 'edge features,', counts.n_corners, 'corner features');
  return { vertices, indices };
}
