/**
 * Extended Marching Cubes — literal port of surfRecon marchingCubesExtended.cpp (IsoEx).
 * - process_cube: triTable[case][1] → n_components, n_vertices per sheet, indices; add_vertex; find_feature; fan or polyTable.
 * - add_vertex: point on edge + normal (gradient at intersection, outward = -gradient).
 * - find_feature: p,n; cog; min_c; rank 2/3; SVD → point; feature vertex gets normal = normalized sum of polygon normals.
 * - flip_edges: only when doFlipEdges === true; flip if v1,v3 feature and v0,v2 not (exactly as C++).
 */
import { edgeTable, polygonTable, polyTable } from '../tables/mc-extended-tables.js';
import { svdSolve3 } from '../math/svd-solve3.js';

// Corner order: surfRecon mcTable 0..7
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];
const EDGE_CORNERS = [
  [0, 1], [1, 2], [3, 2], [0, 3], [4, 5], [5, 6], [7, 6], [4, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

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

/**
 * Run extended marching cubes (IsoEx/surfRecon).
 * @param {number} res - grid resolution
 * @param {number} iso - isosurface (inside where field > iso)
 * @param {(x,y,z)=>number} fieldFn - scalar field
 * @param {boolean} doFlipEdges - if true run flip_edges (C++ always does; we allow toggle)
 * @param {{ featureAngleDeg?: number }} opts - feature angle degrees (default 30)
 */
export function runExtendedMarchingCubes(res, iso, fieldFn, doFlipEdges = true, opts = {}) {
  const featureAngleDeg = opts.featureAngleDeg ?? 30;
  const featureAngleRad = (featureAngleDeg * Math.PI) / 180;

  const vertices = [];
  const indices = [];
  const vertexMap = new Map();
  let nextVertexIndex = 0;
  const counts = { n_edges: 0, n_corners: 0 };
  const featureVertices = new Set();

  function edgeKey(p0, p1) {
    const k0 = p0[0] * (res + 1) * (res + 1) + p0[1] * (res + 1) + p0[2];
    const k1 = p1[0] * (res + 1) * (res + 1) + p1[1] * (res + 1) + p1[2];
    return k0 < k1 ? `${k0},${k1}` : `${k1},${k0}`;
  }

  // add_vertex(corner0, corner1) — IsoEx: directed_distance → point, normal; we: interpolate + gradient
  function addVertex(cx, cy, cz, corner0, corner1) {
    const [di0, dj0, dk0] = CORNER_DELTA[corner0];
    const [di1, dj1, dk1] = CORNER_DELTA[corner1];
    const p0 = [cx + di0, cy + dj0, cz + dk0];
    const p1 = [cx + di1, cy + dj1, cz + dk1];
    const key = edgeKey(p0, p1);
    let idx = vertexMap.get(key);
    if (idx !== undefined) return idx;

    const v0 = sampleField(p0[0], p0[1], p0[2], res, fieldFn);
    const v1 = sampleField(p1[0], p1[1], p1[2], res, fieldFn);
    const pos0 = [p0[0] / res, p0[1] / res, p0[2] / res];
    const pos1 = [p1[0] / res, p1[1] / res, p1[2] / res];
    const point = interpolate(pos0, pos1, v0, v1, iso);

    const [gx, gy, gz] = gradientAt(point[0], point[1], point[2], fieldFn);
    const len = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    const nx = -gx / len, ny = -gy / len, nz = -gz / len;

    idx = nextVertexIndex++;
    vertexMap.set(key, idx);
    vertices.push(point[0], point[1], point[2], nx, ny, nz);
    return idx;
  }

  function getPosition(vi) {
    return [vertices[vi * 6], vertices[vi * 6 + 1], vertices[vi * 6 + 2]];
  }
  function getNormal(vi) {
    return [vertices[vi * 6 + 3], vertices[vi * 6 + 4], vertices[vi * 6 + 5]];
  }

  // find_feature(vhandles) — IsoEx: p,n; cog; min_c; rank; SVD; add_vertex(point); set_feature; no normal in C++, we set average
  function findFeature(vhandles) {
    const nV = vhandles.length;
    const p = [];
    const n = [];
    for (let i = 0; i < nV; i++) {
      p.push(getPosition(vhandles[i]));
      n.push(getNormal(vhandles[i]));
    }
    const cog = [0, 0, 0];
    for (let i = 0; i < nV; i++) {
      cog[0] += p[i][0]; cog[1] += p[i][1]; cog[2] += p[i][2];
    }
    cog[0] /= nV; cog[1] /= nV; cog[2] /= nV;
    for (let i = 0; i < nV; i++) {
      p[i] = [p[i][0] - cog[0], p[i][1] - cog[1], p[i][2] - cog[2]];
    }

    let min_c = 1;
    let axis = [0, 0, 0];
    for (let i = 0; i < nV; i++)
      for (let j = 0; j < nV; j++) {
        const c = n[i][0] * n[j][0] + n[i][1] * n[j][1] + n[i][2] * n[j][2];
        if (c < min_c) {
          min_c = c;
          axis = [
            n[i][1] * n[j][2] - n[i][2] * n[j][1],
            n[i][2] * n[j][0] - n[i][0] * n[j][2],
            n[i][0] * n[j][1] - n[i][1] * n[j][0]
          ];
        }
      }
    if (min_c > Math.cos(featureAngleRad)) return null;

    let axisLen = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]) || 1;
    axis[0] /= axisLen; axis[1] /= axisLen; axis[2] /= axisLen;
    let minD = 1, maxD = -1;
    for (let i = 0; i < nV; i++) {
      const d = n[i][0] * axis[0] + n[i][1] * axis[1] + n[i][2] * axis[2];
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }
    let c = Math.max(Math.abs(minD), Math.abs(maxD));
    c = Math.sqrt(1 - c * c);
    const rank = c > Math.cos(featureAngleRad) ? 2 : 3;
    if (rank === 2) counts.n_edges++;
    else counts.n_corners++;

    const A = [];
    const b = [];
    for (let i = 0; i < nV; i++) {
      A.push([n[i][0], n[i][1], n[i][2]]);
      b.push(p[i][0] * n[i][0] + p[i][1] * n[i][1] + p[i][2] * n[i][2]);
    }
    const x = svdSolve3(A, b, rank === 2);
    const point = [x[0] + cog[0], x[1] + cog[1], x[2] + cog[2]];

    // Feature vertex normal: IsoEx doesn't set it; we use normalized sum of polygon normals for shading
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < nV; i++) {
      nx += n[i][0]; ny += n[i][1]; nz += n[i][2];
    }
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nlen; ny /= nlen; nz /= nlen;

    const fv = nextVertexIndex++;
    vertices.push(point[0], point[1], point[2], nx, ny, nz);
    featureVertices.add(fv);
    return fv;
  }

  // process_cube — literal from C++
  for (let cx = 0; cx < res; cx++) {
    for (let cy = 0; cy < res; cy++) {
      for (let cz = 0; cz < res; cz++) {
        const corner = [];
        for (let i = 0; i < 8; i++)
          corner[i] = [cx + CORNER_DELTA[i][0], cy + CORNER_DELTA[i][1], cz + CORNER_DELTA[i][2]];

        let cubetype = 0;
        for (let i = 0; i < 8; i++)
          if (sampleField(corner[i][0], corner[i][1], corner[i][2], res, fieldFn) > iso)
            cubetype |= (1 << i);

        if (cubetype === 0 || cubetype === 255) continue;

        const samples = [];
        if (edgeTable[cubetype] & 1)   samples[0] = addVertex(cx, cy, cz, 0, 1);
        if (edgeTable[cubetype] & 2)   samples[1] = addVertex(cx, cy, cz, 1, 2);
        if (edgeTable[cubetype] & 4)   samples[2] = addVertex(cx, cy, cz, 3, 2);
        if (edgeTable[cubetype] & 8)   samples[3] = addVertex(cx, cy, cz, 0, 3);
        if (edgeTable[cubetype] & 16)  samples[4] = addVertex(cx, cy, cz, 4, 5);
        if (edgeTable[cubetype] & 32)  samples[5] = addVertex(cx, cy, cz, 5, 6);
        if (edgeTable[cubetype] & 64)  samples[6] = addVertex(cx, cy, cz, 7, 6);
        if (edgeTable[cubetype] & 128) samples[7] = addVertex(cx, cy, cz, 4, 7);
        if (edgeTable[cubetype] & 256) samples[8] = addVertex(cx, cy, cz, 0, 4);
        if (edgeTable[cubetype] & 512) samples[9] = addVertex(cx, cy, cz, 1, 5);
        if (edgeTable[cubetype] & 1024) samples[10] = addVertex(cx, cy, cz, 2, 6);
        if (edgeTable[cubetype] & 2048) samples[11] = addVertex(cx, cy, cz, 3, 7);

        const row = polygonTable[cubetype];
        const n_components = row[0];
        let tableOffset = 1;
        for (let i = 1; i <= n_components; i++) {
          const n_vertices = row[tableOffset++];
          const vhandles = [];
          for (let j = 0; j < n_vertices; j++)
            vhandles.push(samples[row[tableOffset + j]]);
          tableOffset += n_vertices;

          const vh = findFeature(vhandles);
          if (vh !== null) {
            // IsoEx: vhandles.push_back(vhandles[0]); for (j=0;j<n_vertices;++j) add_face(vhandles[j], vhandles[j+1], vh);
            const v0 = vhandles[0];
            for (let j = 0; j < n_vertices; j++)
              indices.push(vhandles[j], vhandles[(j + 1) % n_vertices], vh);
          } else {
            for (let j = 0; polyTable[n_vertices][j] !== -1; j += 3)
              indices.push(
                vhandles[polyTable[n_vertices][j]],
                vhandles[polyTable[n_vertices][j + 1]],
                vhandles[polyTable[n_vertices][j + 2]]
              );
          }
        }
      }
    }
  }

  if (doFlipEdges === true) flipEdges(vertices, indices, featureVertices);

  console.log('Found', counts.n_edges, 'edge features,', counts.n_corners, 'corner features');
  return { vertices, indices };
}

// flip_edges — exactly as C++: flip if v1,v3 feature and v0,v2 not
function getPos(vertices, vi) {
  return [vertices[vi * 6], vertices[vi * 6 + 1], vertices[vi * 6 + 2]];
}

function triArea(vertices, a, b, c) {
  const p0 = getPos(vertices, a), p1 = getPos(vertices, b), p2 = getPos(vertices, c);
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
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
  const minArea = 1e-14;
  let flips = 0;
  for (const [edgeStr, list] of edgeToTris) {
    if (list.length !== 2) continue;
    const [t0, t1] = list;
    const v0 = t0.u, v2 = t0.v, v1 = t0.opp, v3 = t1.opp;
    // C++: if (status(v1).feature() && status(v3).feature() && !status(v0).feature() && !status(v2).feature()) flip
    if (!featureVertices.has(v1) || !featureVertices.has(v3)) continue;
    if (featureVertices.has(v0) || featureVertices.has(v2)) continue;
    const newKey = key(v1, v3);
    if (newKey !== edgeStr && edgeToTris.has(newKey)) continue;
    if (triArea(vertices, v0, v1, v3) < minArea || triArea(vertices, v2, v3, v1) < minArea) continue;
    const i0 = t0.tri, i1 = t1.tri;
    indices[i0] = v0; indices[i0 + 1] = v1; indices[i0 + 2] = v3;
    indices[i1] = v2; indices[i1 + 1] = v3; indices[i1 + 2] = v1;
    flips++;
  }
  if (flips > 0) console.log('Extended MC: edge flips =', flips);
}
