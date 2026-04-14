/**
 * Transvoxel Extended with sharp normals via vertex duplication (Transvoxel paper §6.2).
 * Runs the same extraction as transvoxel-extended, then duplicates vertices at sharp
 * edges so each adjacent face gets its own vertex copy with that face's normal.
 * Smooth-angle threshold: faces within this angle share one vertex (smooth);
 * beyond it we duplicate (sharp). Default smoothAngleDeg = 60.
 */
import { runTransvoxelExtended } from './transvoxel-extended.js';

function getPos(vertices, vi) {
  return [vertices[vi * 6], vertices[vi * 6 + 1], vertices[vi * 6 + 2]];
}

function getNorm(vertices, vi) {
  return [vertices[vi * 6 + 3], vertices[vi * 6 + 4], vertices[vi * 6 + 5]];
}

function setPosNorm(vertices, vi, x, y, z, nx, ny, nz) {
  vertices[vi * 6] = x;
  vertices[vi * 6 + 1] = y;
  vertices[vi * 6 + 2] = z;
  vertices[vi * 6 + 3] = nx;
  vertices[vi * 6 + 4] = ny;
  vertices[vi * 6 + 5] = nz;
}

/** Union-Find for partitioning triangle indices by face-normal similarity. */
function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    if (parent[i] !== i) parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i, j) => {
    const a = find(i), b = find(j);
    if (a !== b) parent[a] = b;
  };
  return { find, union };
}

/**
 * Post-pass: duplicate only feature vertices at sharp edges (by face-normal angle).
 * Non-feature vertices are left as-is (one vertex, one normal). Only vertices in
 * featureVertexSet get added to vertex->triangles and may be split into multiple copies.
 * @param {number[]} vertices - flat [x,y,z,nx,ny,nz] per vertex
 * @param {number[]} indices - triangle indices
 * @param {number} smoothAngleDeg - angle in degrees; faces within this share a vertex (smooth), else duplicate (sharp)
 * @param {Set<number>} featureVertexSet - vertex indices that are feature vertices (from extractor); only these are duplicated
 * @param {Map<number, number[]>} featureLocalFanTriangles - per feature vertex, triangle indices to consider for grouping
 * @returns {{ vertices: number[], indices: number[] }}
 */
function applySharpNormals(vertices, indices, smoothAngleDeg, featureVertexSet, featureLocalFanTriangles) {
  const smoothAngleRad = (smoothAngleDeg * Math.PI) / 180;
  const cosSmooth = Math.cos(smoothAngleRad);
  const numTris = indices.length / 3;

  // Face normal per triangle (cross product, normalized). Orient outward using original vertex normal.
  const faceNormals = [];
  for (let t = 0; t < numTris; t++) {
    const a = indices[3 * t], b = indices[3 * t + 1], c = indices[3 * t + 2];
    const pa = getPos(vertices, a), pb = getPos(vertices, b), pc = getPos(vertices, c);
    const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2];
    const vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const orig = getNorm(vertices, a);
    if (nx * orig[0] + ny * orig[1] + nz * orig[2] < 0) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    faceNormals.push([nx, ny, nz]);
  }

  // vertex -> list of { triIndex, corner } only for feature vertices, from local/final fan map
  const vertexToTriangles = new Map();
  for (const [v, triList] of featureLocalFanTriangles) {
    if (!featureVertexSet.has(v) || !Array.isArray(triList) || triList.length === 0) continue;
    const list = [];
    for (let i = 0; i < triList.length; i++) {
      const t = triList[i];
      if (t < 0 || t >= numTris) continue;
      const a = indices[3 * t], b = indices[3 * t + 1], c = indices[3 * t + 2];
      if (a !== v && b !== v && c !== v) continue;
      const corner = (a === v) ? 0 : ((b === v) ? 1 : 2);
      list.push({ triIndex: t, corner });
    }
    if (list.length > 0) vertexToTriangles.set(v, list);
  }

  // For each feature vertex: partition its triangles by face normal angle
  const vertexGroupId = new Map(); // "v,triIndex" -> groupId (only for feature v)
  const vertexNumGroups = new Map();
  const vertexGroupNormals = new Map();

  for (const [v, list] of vertexToTriangles) {
    const n = list.length;
    const uf = unionFind(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ni = faceNormals[list[i].triIndex];
        const nj = faceNormals[list[j].triIndex];
        const dot = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2];
        if (dot >= cosSmooth) uf.union(i, j);
      }
    }
    const rootToGroup = new Map();
    let groupCount = 0;
    const groupNormals = [];
    const groupNormalSums = [];
    for (let i = 0; i < n; i++) {
      const r = uf.find(i);
      if (!rootToGroup.has(r)) {
        rootToGroup.set(r, groupCount);
        groupNormals.push([0, 0, 0]);
        groupNormalSums.push(0);
        groupCount++;
      }
      const g = rootToGroup.get(r);
      vertexGroupId.set(`${v},${list[i].triIndex}`, g);
      const fn = faceNormals[list[i].triIndex];
      groupNormals[g][0] += fn[0];
      groupNormals[g][1] += fn[1];
      groupNormals[g][2] += fn[2];
      groupNormalSums[g]++;
    }
    for (let g = 0; g < groupCount; g++) {
      const nn = groupNormals[g];
      const count = groupNormalSums[g];
      const len = Math.sqrt(nn[0] * nn[0] + nn[1] * nn[1] + nn[2] * nn[2]) || 1;
      groupNormals[g] = [nn[0] / len, nn[1] / len, nn[2] / len];
    }
    vertexNumGroups.set(v, groupCount);
    vertexGroupNormals.set(v, groupNormals);
  }

  // Log (numGroups, numIncidentFaces) per feature vertex for comparison
  const groupsVsFaces = [];
  for (const [v, list] of vertexToTriangles) {
    groupsVsFaces.push([vertexNumGroups.get(v), list.length]);
  }
  console.log('Sharp normals: feature vertices (groups, incident faces)', groupsVsFaces);

  // Prefix sum: new vertex count per old vertex (feature: num groups, non-feature: 1)
  const numOldVertices = vertices.length / 6;
  let totalNew = 0;
  const newVertexOffset = new Array(numOldVertices);
  for (let v = 0; v < numOldVertices; v++) {
    newVertexOffset[v] = totalNew;
    totalNew += vertexNumGroups.get(v) ?? 1;
  }

  // Build new vertex array (non-feature: 1 copy with original normal; feature: group normals)
  const newVertices = new Array(totalNew * 6);
  for (let v = 0; v < numOldVertices; v++) {
    const pos = getPos(vertices, v);
    const numGroups = vertexNumGroups.get(v) ?? 1;
    const groupNormals = vertexGroupNormals.get(v) ?? [getNorm(vertices, v)];
    for (let g = 0; g < numGroups; g++) {
      const nn = groupNormals[g];
      setPosNorm(newVertices, newVertexOffset[v] + g, pos[0], pos[1], pos[2], nn[0], nn[1], nn[2]);
    }
  }

  // Remap indices: feature vertices use groupId, non-feature use 0
  const newIndices = new Array(indices.length);
  for (let t = 0; t < numTris; t++) {
    for (let c = 0; c < 3; c++) {
      const v = indices[3 * t + c];
      const g = featureVertexSet.has(v) ? (vertexGroupId.get(`${v},${t}`) ?? 0) : 0;
      newIndices[3 * t + c] = newVertexOffset[v] + g;
    }
  }

  return { vertices: newVertices, indices: newIndices };
}

/**
 * Run Transvoxel Extended then apply vertex duplication for sharp normals.
 * @param {number} resolution
 * @param {number} isovalue
 * @param {(x:number,y:number,z:number)=>number} fieldFn
 * @param {{ flipEdges?: boolean, featureAngleDeg?: number, noFeatures?: boolean }} options - same featureAngleDeg used for smooth vs sharp threshold in vertex duplication
 * @returns {{ vertices: number[], indices: number[] }}
 */
export function runTransvoxelExtendedSharpNormals(resolution, isovalue, fieldFn, options = {}) {
  const noFeatures = options.noFeatures === true;
  const { vertices, indices, featureVertices, featureLocalFanTriangles } = runTransvoxelExtended(resolution, isovalue, fieldFn, {
    flipEdges: options.flipEdges,
    featureAngleDeg: options.featureAngleDeg,
    noFeatures
  });
  if (noFeatures) return { vertices, indices };
  const featureVertexSet = featureVertices ?? new Set();
  const localFanTriangles = featureLocalFanTriangles ?? new Map();
  const smoothAngleDeg = options.featureAngleDeg ?? 30;
  return applySharpNormals(vertices, indices, smoothAngleDeg, featureVertexSet, localFanTriangles);
}
