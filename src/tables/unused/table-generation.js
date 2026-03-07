/**
 * Shared table generation (used by unused/mc-polygon and unused/transvoxel-regular-poly).
 * - buildRegularCellPolyTable: Transvoxel extended (regular-cell polygon table from triangle topology).
 * - buildMcPolygonTable: MC extended (polygon table from classic tri table: n_components, then per component nv + edge indices).
 */

const ROW_SIZE = 32;

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function edgeFromKey(key) {
  const [a, b] = key.split(',').map(Number);
  return [a, b];
}

function getTriangles(cell) {
  const nTri = cell.geometryCounts & 0x0f;
  const tris = [];
  for (let i = 0; i < nTri; i++) {
    tris.push([
      cell.vertexIndex[i * 3 + 0],
      cell.vertexIndex[i * 3 + 1],
      cell.vertexIndex[i * 3 + 2]
    ]);
  }
  return tris;
}

function getBoundaryEdges(triangles) {
  const counts = new Map();
  for (const t of triangles) {
    const e0 = edgeKey(t[0], t[1]);
    const e1 = edgeKey(t[1], t[2]);
    const e2 = edgeKey(t[2], t[0]);
    counts.set(e0, (counts.get(e0) || 0) + 1);
    counts.set(e1, (counts.get(e1) || 0) + 1);
    counts.set(e2, (counts.get(e2) || 0) + 1);
  }
  const out = [];
  for (const [k, c] of counts) {
    if (c === 1) out.push(k);
  }
  return out;
}

function getPolygonComponents(triangles) {
  const boundary = getBoundaryEdges(triangles);
  if (boundary.length === 0) return [];

  const adj = new Map();
  for (const ek of boundary) {
    const [a, b] = edgeFromKey(ek);
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  const unused = new Set(boundary);
  const components = [];

  while (unused.size > 0) {
    const start = unused.values().next().value;
    const [v0, v1] = edgeFromKey(start);
    const poly = [v0, v1];
    let prev = v0;
    let cur = v1;
    unused.delete(edgeKey(v0, v1));

    while (cur !== v0) {
      const neighbors = adj.get(cur) || [];
      let next = -1;
      for (const n of neighbors) {
        if (n !== prev && unused.has(edgeKey(cur, n))) {
          next = n;
          break;
        }
      }
      if (next < 0) break;
      poly.push(next);
      unused.delete(edgeKey(cur, next));
      prev = cur;
      cur = next;
    }

    if (poly.length >= 3) components.push(poly);
  }

  return components;
}

function buildRow(components) {
  const row = new Array(ROW_SIZE).fill(-1);
  let k = 0;
  row[k++] = components.length;
  for (const poly of components) {
    if (k >= ROW_SIZE) break;
    row[k++] = poly.length;
    for (const v of poly) {
      if (k >= ROW_SIZE) break;
      row[k++] = v;
    }
  }
  return row;
}

/**
 * Build Transvoxel regular-cell polygon table in extended format.
 * @param {Array} regularCellClass - [256] cell class index per case
 * @param {Array} regularCellData - [16] { geometryCounts, vertexIndex }
 * @returns {Array} table[256] rows: [n_components, nv_0, idx..., nv_1, ...]
 */
export function buildRegularCellPolyTable(regularCellClass, regularCellData) {
  const table = new Array(256);
  for (let caseIdx = 0; caseIdx < 256; caseIdx++) {
    const classIdx = regularCellClass[caseIdx];
    const cell = regularCellData[classIdx];
    const tris = getTriangles(cell);
    const comps = getPolygonComponents(tris);
    table[caseIdx] = buildRow(comps);
  }
  return table;
}

const MC_POLY_ROW_SIZE = 17;

/**
 * Build MC extended polygon table from classic tri table.
 * triTable[case] = edge indices, 3 per triangle, -1 terminated.
 * Output: table[case] = [n_components, nv_0, idx..., nv_1, idx..., ...] with -1 padding to row size.
 */
export function buildMcPolygonTable(triTable) {
  const table = new Array(256);
  for (let caseIdx = 0; caseIdx < 256; caseIdx++) {
    const row = triTable[caseIdx];
    const out = new Array(MC_POLY_ROW_SIZE).fill(-1);
    let i = 0;
    let nComp = 0;
    let k = 1;
    while (i + 2 < row.length && row[i] !== -1 && k < MC_POLY_ROW_SIZE - 2) {
      const a = row[i++];
      const b = row[i++];
      const c = row[i++];
      if (a === -1 || b === -1 || c === -1) break;
      nComp++;
      out[k++] = 3;
      out[k++] = a;
      out[k++] = b;
      out[k++] = c;
    }
    out[0] = nComp;
    table[caseIdx] = out;
  }
  return table;
}
