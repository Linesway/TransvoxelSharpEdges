/**
 * Extended Marching Cubes — line-by-line match of IsoEx ExtendedMarchingCubesT:
 * - process_cube: triTable[case][1] (n_components, n_vertices per sheet, indices); samples[12]; find_feature(vhandles); fan or polyTable.
 * - add_vertex: point + normal (IsoEx: directed_distance; we: gradient at point + limit normals for crease detection).
 * - find_feature: p,n (nV); cog = sum(p)/nV; p -= cog; min_c criterion; rank 2/3; svdSolve3(A,b,rank===2) → point = x + cog.
 * - flip_edges: flip if v1,v3 feature and v0,v2 not.
 */
import { edgeTable, polygonTable, polyTable } from '../tables/mc-extended-tables.js';
import { svdSolve3 } from '../math/svd-solve3.js';

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

/**
 * IsoEx find_feature: use p_detect,n_detect for min_c and rank (can use limit normals);
 * use p_svd,n_svd for A,b (exactly nV rows = one per polygon vertex, matching IsoEx).
 * SVD: A(nV×3), b(nV); rank==2 → zero smallest S; backsub; point = x (caller adds cog).
 */
function findFeaturePoint(p_detect, n_detect, featureAngleRad, counts, p_svd, n_svd) {
  const nDetect = p_detect.length;
  let minC = 1;
  let axis = [0, 0, 0];
  for (let i = 0; i < nDetect; i++)
    for (let j = 0; j < nDetect; j++) {
      const c = n_detect[i][0] * n_detect[j][0] + n_detect[i][1] * n_detect[j][1] + n_detect[i][2] * n_detect[j][2];
      if (c < minC) {
        minC = c;
        axis = [
          n_detect[i][1] * n_detect[j][2] - n_detect[i][2] * n_detect[j][1],
          n_detect[i][2] * n_detect[j][0] - n_detect[i][0] * n_detect[j][2],
          n_detect[i][0] * n_detect[j][1] - n_detect[i][1] * n_detect[j][0]
        ];
      }
    }
  if (minC > Math.cos(featureAngleRad)) return null;

  let len = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
  axis[0] /= len; axis[1] /= len; axis[2] /= len;
  let minD = 1, maxD = -1;
  for (let i = 0; i < nDetect; i++) {
    const d = n_detect[i][0] * axis[0] + n_detect[i][1] * axis[1] + n_detect[i][2] * axis[2];
    if (d < minD) minD = d;
    if (d > maxD) maxD = d;
  }
  let c = Math.max(Math.abs(minD), Math.abs(maxD));
  c = Math.sqrt(1 - c * c);
  const rank = c > Math.cos(featureAngleRad) ? 2 : 3;
  if (counts) {
    if (rank === 2) counts.n_edges++;
    else counts.n_corners++;
  }

  // IsoEx: A(nV,3), b(nV) — exactly one row per polygon vertex (mesh_.point, mesh_.normal)
  const p = p_svd != null ? p_svd : p_detect;
  const n = n_svd != null ? n_svd : n_detect;
  const nV = p.length;
  const A = [];
  const b = [];
  for (let i = 0; i < nV; i++) {
    A.push([n[i][0], n[i][1], n[i][2]]);
    b.push(p[i][0] * n[i][0] + p[i][1] * n[i][1] + p[i][2] * n[i][2]);
  }
  const point = svdSolve3(A, b, rank === 2);
  return { point, rank };
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
  /** Per-vertex limit normals for feature detection: [vi] => [n0, n1] when edge crosses a crease, else undefined. */
  const vertexLimitNormals = [];
  let nextVertexIndex = 0;
  const counts = { n_edges: 0, n_corners: 0 };
  const featureVertices = new Set();

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

    // Normal at the actual intersection point (for rendering)
    const [gx, gy, gz] = gradientAt(p[0], p[1], p[2], fieldFn);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = -gx / len, ny = -gy / len, nz = -gz / len;

    // Limit normals at the two edge corners (for sharp-edge feature detection).
    // At a crease the SDF is non-differentiable; gradient at the vertex averages. Using corners gives the two face normals.
    const [g0x, g0y, g0z] = gradientAt(p0[0], p0[1], p0[2], fieldFn);
    const [g1x, g1y, g1z] = gradientAt(p1[0], p1[1], p1[2], fieldFn);
    const l0 = Math.sqrt(g0x * g0x + g0y * g0y + g0z * g0z) || 1;
    const l1 = Math.sqrt(g1x * g1x + g1y * g1y + g1z * g1z) || 1;
    const n0 = [-g0x / l0, -g0y / l0, -g0z / l0];
    const n1 = [-g1x / l1, -g1y / l1, -g1z / l1];
    const dotCorners = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dotCorners < Math.cos(featureAngleRad)) {
      vertexLimitNormals.push([n0, n1]);
    } else {
      vertexLimitNormals.push(undefined);
    }

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
    featureVertices.add(idx);
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

          // Barycenter of the n-gon — IsoEx: cog = sum(p)/nV
          const cog = [0, 0, 0];
          for (let i = 0; i < nv; i++) {
            const pos = getPosition(polyIndices[i]);
            cog[0] += pos[0]; cog[1] += pos[1]; cog[2] += pos[2];
          }
          cog[0] /= nv; cog[1] /= nv; cog[2] /= nv;

          // For detection: extended (p_detect, n_detect) with limit normals so we see creases
          const p_detect = [];
          const n_detect = [];
          for (let i = 0; i < nv; i++) {
            const vi = polyIndices[i];
            const pos = getPosition(vi);
            const limits = vertexLimitNormals[vi];
            if (limits) {
              for (const norm of limits) {
                p_detect.push([pos[0] - cog[0], pos[1] - cog[1], pos[2] - cog[2]]);
                n_detect.push(norm);
              }
            } else {
              p_detect.push([pos[0] - cog[0], pos[1] - cog[1], pos[2] - cog[2]]);
              n_detect.push(getNormal(vi));
            }
          }
          // For SVD: exactly nV rows (IsoEx: one point + one normal per polygon vertex)
          const p_svd = [];
          const n_svd = [];
          for (let i = 0; i < nv; i++) {
            const pos = getPosition(polyIndices[i]);
            p_svd.push([pos[0] - cog[0], pos[1] - cog[1], pos[2] - cog[2]]);
            n_svd.push(getNormal(polyIndices[i]));
          }

          const featureResult = findFeaturePoint(p_detect, n_detect, featureAngleRad, counts, p_svd, n_svd);
          if (featureResult) {
            const pt = featureResult.point;
            const world = [pt[0] + cog[0], pt[1] + cog[1], pt[2] + cog[2]];
            let nx = 0, ny = 0, nz = 0;
            for (let i = 0; i < n_svd.length; i++) {
              nx += n_svd[i][0]; ny += n_svd[i][1]; nz += n_svd[i][2];
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

  flipEdges(vertices, indices, featureVertices);

  console.log('Found', counts.n_edges, 'edge features,', counts.n_corners, 'corner features');
  return { vertices, indices };
}

/** Get position of vertex vi from flat vertices [x,y,z,nx,ny,nz,...]. */
function getPos(vertices, vi) {
  return [vertices[vi * 6], vertices[vi * 6 + 1], vertices[vi * 6 + 2]];
}

/** Triangle area (twice; positive if CCW). */
function triArea2(vertices, a, b, c) {
  const p0 = getPos(vertices, a), p1 = getPos(vertices, b), p2 = getPos(vertices, c);
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

/**
 * surfRecon/IsoEx-style edge flip: flip so the new edge connects the two feature
 * vertices. Only flip when is_flip_ok (opposite vertices not already connected)
 * and new triangles have positive area (avoids corner spikes).
 */
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
  const minArea2 = 1e-14;
  let flips = 0;
  for (const [edgeKeyStr, list] of edgeToTris) {
    if (list.length !== 2) continue;
    const [t0, t1] = list;
    const edgeA = t0.u, edgeB = t0.v, opp0 = t0.opp, opp1 = t1.opp;
    if (!featureVertices.has(opp0) || !featureVertices.has(opp1)) continue;
    if (featureVertices.has(edgeA) || featureVertices.has(edgeB)) continue;
    // is_flip_ok: opposite vertices must not already be connected (avoids corner spikes)
    const newEdgeKey = key(opp0, opp1);
    if (newEdgeKey !== edgeKeyStr && edgeToTris.has(newEdgeKey)) continue;
    // Geometric check: new triangles must have positive area
    const area1 = triArea2(vertices, edgeA, opp0, opp1);
    const area2 = triArea2(vertices, edgeB, opp1, opp0);
    if (area1 < minArea2 || area2 < minArea2) continue;
    const i0 = t0.tri, i1 = t1.tri;
    indices[i0] = edgeA; indices[i0 + 1] = opp0; indices[i0 + 2] = opp1;
    indices[i1] = edgeB; indices[i1 + 1] = opp1; indices[i1 + 2] = opp0;
    flips++;
  }
  if (flips > 0) console.log('Extended MC: edge flips =', flips);
}
