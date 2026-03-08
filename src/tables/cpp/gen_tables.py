#!/usr/bin/env python3
"""Generates transvoxel_extended_tables.cpp from ../transvoxel-extended-tables.js.
Run from tables/cpp: python gen_tables.py
"""
import re
from pathlib import Path

def extract_array_string(s):
    depth = 0
    for i, c in enumerate(s):
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                return s[: i + 1]
    raise ValueError("array end not found")

def parse_array_of_arrays(arr_str):
    """Parse a string like '[[0,-1,...], [1,3,...], ...]' into list of lists of ints."""
    arr_str = arr_str.strip()
    if not arr_str.startswith('[') or not arr_str.endswith(']'):
        raise ValueError("not an array")
    inner = arr_str[1:-1].strip()
    if not inner:
        return []
    rows = []
    depth = 0
    start = 0
    for i, c in enumerate(inner):
        if c == '[':
            if depth == 0:
                start = i
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                row_str = inner[start : i + 1]
                row = [int(x.strip()) for x in re.findall(r'-?\d+', row_str)]
                rows.append(row)
    return rows

def main():
    base = Path(__file__).resolve().parent
    js_path = base / ".." / "transvoxel-extended-tables.js"
    cpp_path = base / "transvoxel_extended_tables.cpp"

    content = js_path.read_text(encoding="utf-8")

    # regularCellPolyTable
    marker = "regularCellPolyTable = "
    pos = content.find(marker)
    if pos == -1:
        raise SystemExit("regularCellPolyTable not found")
    rest = content[pos + len(marker) :]
    rcp_str = extract_array_string(rest)
    rcp = parse_array_of_arrays(rcp_str)

    # polyTable (search after first array)
    marker2 = "polyTable = "
    pos2 = content.find(marker2, pos + 1)
    if pos2 == -1:
        raise SystemExit("polyTable not found")
    rest2 = content[pos2 + len(marker2) :]
    poly_str = extract_array_string(rest2)
    poly = parse_array_of_arrays(poly_str)

    RCP_ROW_SIZE = 32
    POLY_ROW_SIZE = 27

    out = []
    out.append("// Generated from transvoxel-extended-tables.js - do not edit by hand.")
    out.append("// Run: node gen_tables.js  (or: python gen_tables.py)")
    out.append('#include "transvoxel_extended_tables.h"')
    out.append("")
    out.append("namespace transvoxel {")
    out.append("")
    out.append("const int regularCellPolyTable[kRegularCellPolyTableSize][kRegularCellPolyRowSize] = {")
    for row in rcp:
        padded = (row + [-1] * RCP_ROW_SIZE)[:RCP_ROW_SIZE]
        out.append("  { " + ", ".join(str(x) for x in padded) + " },")
    out.append("};")
    out.append("")
    out.append("const int polyTable[kPolyTableSize][kPolyTableRowSize] = {")
    for i in range(8):
        row = poly[i] if i < len(poly) else []
        padded = (row + [-1] * POLY_ROW_SIZE)[:POLY_ROW_SIZE]
        out.append("  { " + ", ".join(str(x) for x in padded) + " },  // " + str(i))
    out.append("};")
    out.append("")
    out.append("}  // namespace transvoxel")
    out.append("")

    cpp_path.write_text("\n".join(out), encoding="utf-8")
    print("Wrote", cpp_path)

if __name__ == "__main__":
    main()
