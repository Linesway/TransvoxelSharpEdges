/**
 * Extended Marching Cubes — IsoEx/surfRecon style but building polygons by boundary tracing
 * (half-edge style) instead of using the precomputed polygon table.
 *
 * - Use only edgeTable + classic triTable (triangle list per case).
 * - Derive n-gon components by: triangles → boundary edges (edges with count 1) → trace loops.
 * - add_vertex, find_feature, flip_edges same as table-based version.
 */
import { edgeTable, triTable } from '../tables/mc-tables.js';
import { polyTable } from '../tables/mc-extended-tables-isoex.js';
import { svdSolve3 } from '../math/svd-solve3.js';

// Corner order: surfRecon mcTable 0..7
const CORNER_DELTA = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]
];

function orderedEdge(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/** Parse classic triTable row into list of triangles (each triangle = [e0, e1, e2] edge indices). */
function getTrianglesFromRow(triRow) {
  const triangles = [];
  for (let i = 0; i + 2 < triRow.length && triRow[i] >= 0; i += 3) {
    triangles.push([triRow[i], triRow[i + 1], triRow[i + 2]]);
  }
  return triangles;
}

/** Edges that appear in exactly one triangle (boundary of the triangulated patch). */
function getBoundaryEdges(triangles) {
  const count = new Map();
  for (const t of triangles) {
    const e0 = orderedEdge(t[0], t[1]);
    const e1 = orderedEdge(t[1], t[2]);
    const e2 = orderedEdge(t[2], t[0]);
    count.set(e0, (count.get(e0) || 0) + 1);
    count.set(e1, (count.get(e1) || 0) + 1);
    count.set(e2, (count.get(e2) || 0) + 1);
  }
  const boundary = [];
  for (const [edgeStr, c] of count) {
    if (c === 1) {
      const [a, b] = edgeStr.split(',').map(Number);
      boundary.push([a, b]);
    }
  }
  return boundary;
}

/** Adjacency: for each vertex, list of neighbors along boundary edges. */
function boundaryAdjacency(boundary) {
  const adj = new Map();
  for (const [a, b] of boundary) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(b).push(a);
  }
  return adj;
}

/** Trace one polygon loop starting at edge (v0, v1); remove used edges from unused set. */
function tracePolygon(unused, v0, v1, adj, polygon) {
  polygon.length = 0;
  polygon.push(v0, v1);
  unused.delete(orderedEdge(v0, v1));
  let prev = v0;
  let cur = v1;
  while (cur !== v0) {
    const neighbors = adj.get(cur) || [];
    let next = -1;
    for (const n of neighbors) {
      if (n !== prev && unused.has(orderedEdge(cur, n))) {
        next = n;
        break;
      }
    }
    if (next < 0) break;
    if (next === v0) {
      unused.delete(orderedEdge(cur, next));
      break;
    }
    polygon.push(next);
    unused.delete(orderedEdge(cur, next));
    prev = cur;
    cur = next;
  }
}

/** From triangle list, get connected boundary loops (each loop = list of edge indices = polygon). */
function getPolygonComponents(triangles) {
  const boundary = getBoundaryEdges(triangles);
  if (boundary.length === 0) return [];
  const unused = new Set(boundary.map(([a, b]) => orderedEdge(a, b)));
  const adj = boundaryAdjacency(boundary);
  const components = [];
  while (unused.size > 0) {
    const first = unused.keys().next().value;
    const [a, b] = first.split(',').map(Number);
    const polygon = [];
    tracePolygon(unused, a, b, adj, polygon);
    if (polygon.length >= 3) components.push(polygon);
  }
  return components;
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

/**
 * Run extended marching cubes (IsoEx style) with polygons built by boundary tracing
 * from the classic triangle table (no polygon lookup table).
 */
export function runExtendedMarchingCubesHalfedge(res, iso, fieldFn, doFlipEdges = true, opts = {}) {
  const featureAngleDeg = opts.featureAngleDeg ?? 30;
  const featureAngleRad = (featureAngleDeg * Math.PI) / 180;
  const noFeatures = opts.noFeatures === true;

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

  function findFeature(vhandles) {
    if (noFeatures) return null;
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
    if (!Number.isFinite(x[0]) || !Number.isFinite(x[1]) || !Number.isFinite(x[2])) return null;
    let minP = [p[0][0], p[0][1], p[0][2]], maxP = [p[0][0], p[0][1], p[0][2]];
    for (let i = 1; i < nV; i++) {
      for (let d = 0; d < 3; d++) {
        if (p[i][d] < minP[d]) minP[d] = p[i][d];
        if (p[i][d] > maxP[d]) maxP[d] = p[i][d];
      }
    }
    const margin = 0.1;
    for (let d = 0; d < 3; d++) {
      if (x[d] < minP[d] - margin || x[d] > maxP[d] + margin) return null;
    }
    const point = [x[0] + cog[0], x[1] + cog[1], x[2] + cog[2]];

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

  // process_cube: edge table → samples; tri table → triangles → boundary trace → polygon components
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

        const triRow = triTable[cubetype];
        const triangles = getTrianglesFromRow(triRow);
        if (triangles.length === 0) continue;

        const components = getPolygonComponents(triangles);

        for (const polygon of components) {
          const vhandles = polygon.map((edgeIndex) => samples[edgeIndex]);
          const vh = findFeature(vhandles);
          if (vh !== null) {
            for (let j = 0; j < polygon.length; j++)
              indices.push(vhandles[j], vhandles[(j + 1) % polygon.length], vh);
          } else {
            const n_vertices = polygon.length;
            const poly = polyTable[n_vertices];
            if (!poly) continue;
            for (let j = 0; poly[j] !== -1 && j + 2 < poly.length; j += 3)
              indices.push(
                vhandles[poly[j]],
                vhandles[poly[j + 1]],
                vhandles[poly[j + 2]]
              );
          }
        }
      }
    }
  }

  if (doFlipEdges === true) flipEdges(vertices, indices, featureVertices);

  console.log('Extended MC (half-edge):', counts.n_edges, 'edge features,', counts.n_corners, 'corner features');
  return { vertices, indices };
}

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
  if (flips > 0) console.log('Extended MC (half-edge): edge flips =', flips);
}
