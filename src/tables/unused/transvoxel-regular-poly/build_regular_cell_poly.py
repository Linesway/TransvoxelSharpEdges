"""
Generate regularCellPolyTable from C4 transvoxel regularCellClass + regularCellData.
Follows C4 triangle winding for boundary walk. Run from this directory:
  python build_regular_cell_poly.py
Patches ../../transvoxel-extended-tables.js.
"""
import json
import os

ROW_SIZE = 32

# From transvoxel-tables.js: regularCellClass[256]
REGULAR_CELL_CLASS = [
    0x00, 0x01, 0x01, 0x03, 0x01, 0x03, 0x02, 0x04, 0x01, 0x02, 0x03, 0x04, 0x03, 0x04, 0x04, 0x03,
    0x01, 0x03, 0x02, 0x04, 0x02, 0x04, 0x06, 0x0C, 0x02, 0x05, 0x05, 0x0B, 0x05, 0x0A, 0x07, 0x04,
    0x01, 0x02, 0x03, 0x04, 0x02, 0x05, 0x05, 0x0A, 0x02, 0x06, 0x04, 0x0C, 0x05, 0x07, 0x0B, 0x04,
    0x03, 0x04, 0x04, 0x03, 0x05, 0x0B, 0x07, 0x04, 0x05, 0x07, 0x0A, 0x04, 0x08, 0x0E, 0x0E, 0x03,
    0x01, 0x02, 0x02, 0x05, 0x03, 0x04, 0x05, 0x0B, 0x02, 0x06, 0x05, 0x07, 0x04, 0x0C, 0x0A, 0x04,
    0x03, 0x04, 0x05, 0x0A, 0x04, 0x03, 0x07, 0x04, 0x05, 0x07, 0x08, 0x0E, 0x0B, 0x04, 0x0E, 0x03,
    0x02, 0x06, 0x05, 0x07, 0x05, 0x07, 0x08, 0x0E, 0x06, 0x09, 0x07, 0x0F, 0x07, 0x0F, 0x0E, 0x0D,
    0x04, 0x0C, 0x0B, 0x04, 0x0A, 0x04, 0x0E, 0x03, 0x07, 0x0F, 0x0E, 0x0D, 0x0E, 0x0D, 0x02, 0x01,
    0x01, 0x02, 0x02, 0x05, 0x02, 0x05, 0x06, 0x07, 0x03, 0x05, 0x04, 0x0A, 0x04, 0x0B, 0x0C, 0x04,
    0x02, 0x05, 0x06, 0x07, 0x06, 0x07, 0x09, 0x0F, 0x05, 0x08, 0x07, 0x0E, 0x07, 0x0E, 0x0F, 0x0D,
    0x03, 0x05, 0x04, 0x0B, 0x05, 0x08, 0x07, 0x0E, 0x04, 0x07, 0x03, 0x04, 0x0A, 0x0E, 0x04, 0x03,
    0x04, 0x0A, 0x0C, 0x04, 0x07, 0x0E, 0x0F, 0x0D, 0x0B, 0x0E, 0x04, 0x03, 0x0E, 0x02, 0x0D, 0x01,
    0x03, 0x05, 0x05, 0x08, 0x04, 0x0A, 0x07, 0x0E, 0x04, 0x07, 0x0B, 0x0E, 0x03, 0x04, 0x04, 0x03,
    0x04, 0x0B, 0x07, 0x0E, 0x0C, 0x04, 0x0F, 0x0D, 0x0A, 0x0E, 0x0E, 0x02, 0x04, 0x03, 0x0D, 0x01,
    0x04, 0x07, 0x0A, 0x0E, 0x0B, 0x0E, 0x0E, 0x02, 0x0C, 0x0F, 0x04, 0x0D, 0x04, 0x0D, 0x03, 0x01,
    0x03, 0x04, 0x04, 0x03, 0x04, 0x03, 0x0D, 0x01, 0x04, 0x0D, 0x03, 0x01, 0x03, 0x01, 0x01, 0x00,
]

# From transvoxel-tables.js: regularCellData[16]
REGULAR_CELL_DATA = [
    {"geometryCounts": 0x00, "vertexIndex": [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},
    {"geometryCounts": 0x31, "vertexIndex": [0,1,2,0,0,0,0,0,0,0,0,0,0,0,0]},
    {"geometryCounts": 0x62, "vertexIndex": [0,1,2,3,4,5,0,0,0,0,0,0,0,0,0]},
    {"geometryCounts": 0x42, "vertexIndex": [0,1,2,0,2,3,0,0,0,0,0,0,0,0,0]},
    {"geometryCounts": 0x53, "vertexIndex": [0,1,4,1,3,4,1,2,3,0,0,0,0,0,0]},
    {"geometryCounts": 0x73, "vertexIndex": [0,1,2,0,2,3,4,5,6,0,0,0,0,0,0]},
    {"geometryCounts": 0x93, "vertexIndex": [0,1,2,3,4,5,6,7,8,0,0,0,0,0,0]},
    {"geometryCounts": 0x84, "vertexIndex": [0,1,4,1,3,4,1,2,3,5,6,7,0,0,0]},
    {"geometryCounts": 0x84, "vertexIndex": [0,1,2,0,2,3,4,5,6,4,6,7,0,0,0]},
    {"geometryCounts": 0xC4, "vertexIndex": [0,1,2,3,4,5,6,7,8,9,10,11,0,0,0]},
    {"geometryCounts": 0x64, "vertexIndex": [0,4,5,0,1,4,1,3,4,1,2,3,0,0,0]},
    {"geometryCounts": 0x64, "vertexIndex": [0,5,4,0,4,1,1,4,3,1,3,2,0,0,0]},
    {"geometryCounts": 0x64, "vertexIndex": [0,4,5,0,3,4,0,1,3,1,2,3,0,0,0]},
    {"geometryCounts": 0x64, "vertexIndex": [0,1,2,0,2,3,0,3,4,0,4,5,0,0,0]},
    {"geometryCounts": 0x75, "vertexIndex": [0,1,2,0,2,3,0,3,4,0,4,5,0,5,6]},
    {"geometryCounts": 0x95, "vertexIndex": [0,4,5,0,3,4,0,1,3,1,2,3,6,7,8]},
]


def edge_key(a, b):
    return (min(a, b), max(a, b))


def get_triangles(cell):
    n_tri = cell["geometryCounts"] & 0x0F
    vi = cell["vertexIndex"]
    return [tuple(vi[i * 3 + j] for j in range(3)) for i in range(n_tri)]


def share_edge(tri0, tri1):
    e0 = {edge_key(tri0[i], tri0[(i + 1) % 3]) for i in range(3)}
    for i in range(3):
        if edge_key(tri1[i], tri1[(i + 1) % 3]) in e0:
            return True
    return False


def partition_into_components(triangles):
    """Partition triangles by connectivity (share an edge). Each component is list of (original_index, tri)."""
    n = len(triangles)
    used = [False] * n
    components = []
    for i in range(n):
        if used[i]:
            continue
        comp = []
        stack = [i]
        used[i] = True
        while stack:
            idx = stack.pop()
            comp.append((idx, triangles[idx]))
            for j in range(n):
                if used[j]:
                    continue
                if share_edge(triangles[idx], triangles[j]):
                    used[j] = True
                    stack.append(j)
        components.append(comp)
    return components


def get_boundary_edge_set(triangles):
    counts = {}
    for t in triangles:
        for i in range(3):
            e = edge_key(t[i], t[(i + 1) % 3])
            counts[e] = counts.get(e, 0) + 1
    return {e for e, c in counts.items() if c == 1}


def build_edge_to_interior(triangles, boundary_set):
    out = {}
    for a, b, c in triangles:
        e = edge_key(a, b)
        if e in boundary_set:
            out[(a, b)] = c
            out[(b, a)] = c
        e = edge_key(b, c)
        if e in boundary_set:
            out[(b, c)] = a
            out[(c, b)] = a
        e = edge_key(c, a)
        if e in boundary_set:
            out[(c, a)] = b
            out[(a, c)] = b
    return out


def get_polygon_components(triangles):
    if not triangles:
        return []
    components = partition_into_components(triangles)
    out_components = []
    for comp in components:
        comp_tris = [t for _, t in comp]
        comp_sorted = sorted(comp, key=lambda p: p[0])
        first_tri = comp_sorted[0][1]
        v0, v1 = first_tri[0], first_tri[1]

        boundary_set = get_boundary_edge_set(comp_tris)
        if not boundary_set:
            continue
        directed = build_edge_to_interior(comp_tris, boundary_set)
        boundary_adj = {}
        for (a, b) in boundary_set:
            boundary_adj.setdefault(a, []).append(b)
            boundary_adj.setdefault(b, []).append(a)
        unused = set(boundary_set)
        start_e = edge_key(v0, v1)
        if start_e not in unused:
            # First triangle's edge is internal; pick a boundary edge that has v0 (fan center)
            for e in boundary_set:
                if v0 in e:
                    v1 = e[1] if e[0] == v0 else e[0]
                    break
        poly = [v0, v1]
        prev, cur = v0, v1
        unused.discard(edge_key(v0, v1))
        while cur != v0:
            interior = directed.get((prev, cur))
            candidates = [n for n in boundary_adj.get(cur, []) if n != prev and edge_key(cur, n) in unused]
            if len(candidates) == 1:
                next_v = candidates[0]
            elif len(candidates) == 2 and interior is not None:
                next_v = candidates[1] if candidates[0] == interior else candidates[0]
            elif candidates:
                next_v = candidates[0]
            else:
                next_v = None
            if next_v is None:
                break
            if next_v == v0:
                break
            poly.append(next_v)
            unused.discard(edge_key(cur, next_v))
            prev, cur = cur, next_v
        if len(poly) >= 3:
            out_components.append(poly)
    return out_components


def build_row(components):
    row = [-1] * ROW_SIZE
    k = 0
    row[k] = len(components)
    k += 1
    for poly in components:
        if k >= ROW_SIZE:
            break
        row[k] = len(poly)
        k += 1
        for v in poly:
            if k >= ROW_SIZE:
                break
            row[k] = v
            k += 1
    return row


def build_regular_cell_poly_table():
    table = []
    for case_idx in range(256):
        class_idx = REGULAR_CELL_CLASS[case_idx]
        cell = REGULAR_CELL_DATA[class_idx]
        tris = get_triangles(cell)
        comps = get_polygon_components(tris)
        table.append(build_row(comps))
    return table


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    extended_path = os.path.join(script_dir, "..", "..", "transvoxel-extended-tables.js")
    extended_path = os.path.normpath(extended_path)

    table = build_regular_cell_poly_table()
    table_str = json.dumps(table, separators=(",", ""))

    with open(extended_path, "r", encoding="utf-8") as f:
        content = f.read()

    start_marker = "export const regularCellPolyTable = "
    end_marker = "\nexport const polyTable = "
    start = content.find(start_marker)
    end = content.find(end_marker)
    if start == -1 or end == -1:
        raise SystemExit("Could not find regularCellPolyTable or polyTable in " + extended_path)

    new_content = content[:start] + start_marker + table_str + content[end:]
    with open(extended_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print("Patched regularCellPolyTable in", extended_path)


if __name__ == "__main__":
    main()
