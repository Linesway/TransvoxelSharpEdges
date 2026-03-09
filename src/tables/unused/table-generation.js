/**
 * Shared table generation (used by unused/mc-polygon and unused/transvoxel-regular-poly).
 * - buildRegularCellPolyTable: Transvoxel extended. Uses C4 official regularCellClass + regularCellData
 *   (triangle list). Boundary of each connected component is extracted and traversed following
 *   C4 triangle winding so polygon order matches the original triangulation.
 * - buildMcPolygonTable: MC extended (polygon table from classic tri table).
 */

const ROW_SIZE = 32;

function edgeKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function edgeFromKey(key) {
  const [a, b] = key.split(',').map(Number);
  return [a, b];
}

/** C4: geometryCounts low nibble = num triangles, high nibble = num vertices. */
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

function shareEdge(tri0, tri1) {
  const e0 = new Set([edgeKey(tri0[0], tri0[1]), edgeKey(tri0[1], tri0[2]), edgeKey(tri0[2], tri0[0])]);
  for (let i = 0; i < 3; i++) {
    if (e0.has(edgeKey(tri1[i], tri1[(i + 1) % 3]))) return true;
  }
  return false;
}

/** Partition triangles by connectivity (share an edge). Each component = list of { index, tri }. */
function partitionIntoComponents(triangles) {
  const n = triangles.length;
  const used = new Array(n).fill(false);
  const components = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const comp = [];
    const stack = [i];
    used[i] = true;
    while (stack.length > 0) {
      const idx = stack.pop();
      comp.push({ index: idx, tri: triangles[idx] });
      for (let j = 0; j < n; j++) {
        if (used[j]) continue;
        if (shareEdge(triangles[idx], triangles[j])) {
          used[j] = true;
          stack.push(j);
        }
      }
    }
    components.push(comp);
  }
  return components;
}

/** Boundary edges (appear in exactly one triangle). Returns Set of edge keys. */
function getBoundaryEdgeSet(triangles) {
  const counts = new Map();
  for (const t of triangles) {
    const e0 = edgeKey(t[0], t[1]);
    const e1 = edgeKey(t[1], t[2]);
    const e2 = edgeKey(t[2], t[0]);
    counts.set(e0, (counts.get(e0) || 0) + 1);
    counts.set(e1, (counts.get(e1) || 0) + 1);
    counts.set(e2, (counts.get(e2) || 0) + 1);
  }
  const out = new Set();
  for (const [k, c] of counts) {
    if (c === 1) out.add(k);
  }
  return out;
}

/**
 * For each directed boundary edge (a,b), the triangle (a,b,c) gives interior vertex c.
 * Map key: directed key "a,b" (a < b we still need to know direction - use "a,b" as from->to).
 * So we store for edge (a,b) the interior when traversing a->b. So directedKey(a,b) = "a,b".
 */
function buildEdgeToInterior(triangles, boundarySet) {
  const directedToInterior = new Map();
  for (const t of triangles) {
    const [a, b, c] = t;
    if (boundarySet.has(edgeKey(a, b))) { directedToInterior.set(`${a},${b}`, c); directedToInterior.set(`${b},${a}`, c); }
    if (boundarySet.has(edgeKey(b, c))) { directedToInterior.set(`${b},${c}`, a); directedToInterior.set(`${c},${b}`, a); }
    if (boundarySet.has(edgeKey(c, a))) { directedToInterior.set(`${c},${a}`, b); directedToInterior.set(`${a},${c}`, b); }
  }
  return directedToInterior;
}

/**
 * Extract polygon components from C4 triangle list. Partition by connectivity;
 * for each component, start boundary walk from first triangle's edge (v0,v1) so
 * polygon order matches C4 fan (first vertex = fan center).
 */
function getPolygonComponents(triangles) {
  if (triangles.length === 0) return [];

  const part = partitionIntoComponents(triangles);
  const components = [];

  for (const comp of part) {
    const compTris = comp.map((c) => c.tri);
    comp.sort((a, b) => a.index - b.index);
    const firstTri = comp[0].tri;
    let v0 = firstTri[0];
    let v1 = firstTri[1];

    const boundarySet = getBoundaryEdgeSet(compTris);
    if (boundarySet.size === 0) continue;

    const directedToInterior = buildEdgeToInterior(compTris, boundarySet);
    const boundaryAdj = new Map();
    for (const ek of boundarySet) {
      const [a, b] = edgeFromKey(ek);
      if (!boundaryAdj.has(a)) boundaryAdj.set(a, []);
      if (!boundaryAdj.has(b)) boundaryAdj.set(b, []);
      boundaryAdj.get(a).push(b);
      boundaryAdj.get(b).push(a);
    }

    const unused = new Set(boundarySet);
    if (!unused.has(edgeKey(v0, v1))) {
      for (const ek of boundarySet) {
        const [a, b] = edgeFromKey(ek);
        if (a === v0 || b === v0) {
          v1 = a === v0 ? b : a;
          break;
        }
      }
    }

    const poly = [v0, v1];
    let prev = v0;
    let cur = v1;
    unused.delete(edgeKey(v0, v1));

    while (cur !== v0) {
      const interior = directedToInterior.get(`${prev},${cur}`);
      const candidates = (boundaryAdj.get(cur) || []).filter((n) => n !== prev && unused.has(edgeKey(cur, n)));
      let next = -1;
      if (candidates.length === 1) next = candidates[0];
      else if (candidates.length === 2 && interior !== undefined) next = candidates[0] === interior ? candidates[1] : candidates[0];
      else if (candidates.length > 0) next = candidates[0];
      if (next < 0) break;
      if (next === v0) break;
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
