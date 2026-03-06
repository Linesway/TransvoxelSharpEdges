# Extract classic triTable (first row of each case) from surfRecon mcTable.cpp
import re
import os

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cpp_path = os.path.join(base, '..', 'References', 'surfRecon', 'src', 'mc', 'mcTable.cpp')
with open(cpp_path, 'r') as f:
    cpp = f.read()

# Match { { a, b, c, ... },  (first row only)
pat = re.compile(r'\{\s*\{\s*([-0-9,\s]+?)\s*\},')
rows = []
for m in pat.finditer(cpp):
    nums = [int(x.strip()) for x in m.group(1).split(',')]
    rows.append('  [' + ', '.join(map(str, nums)) + ']')

out = '''/**
 * Classic marching cubes triangle table (surfRecon mcTable.cpp triTable[case][0]).
 * triTable[case] = edge indices, 3 per triangle, -1 terminated.
 */
export const triTable = [
''' + ',\n'.join(rows) + '''
];
'''
out_path = os.path.join(base, 'src', 'tables', 'tri-table.js')
os.makedirs(os.path.dirname(out_path), exist_ok=True)
with open(out_path, 'w') as f:
    f.write(out)
print('Wrote', out_path)
