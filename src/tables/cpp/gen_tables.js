#!/usr/bin/env node
/**
 * Generates transvoxel_extended_tables.cpp from ../transvoxel-extended-tables.js
 * Run from tables/cpp: node gen_tables.js
 */
const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, '..', 'transvoxel-extended-tables.js');
const cppPath = path.join(__dirname, 'transvoxel_extended_tables.cpp');

const content = fs.readFileSync(jsPath, 'utf8');

// Extract regularCellPolyTable: from "= " to "];" (first array)
const rcpStart = content.indexOf('regularCellPolyTable = ');
if (rcpStart === -1) throw new Error('regularCellPolyTable not found');
let rest = content.slice(rcpStart + 'regularCellPolyTable = '.length);
const rcpEnd = rest.indexOf('];');
const rcpStr = rest.slice(0, rcpEnd + 2);
const rcp = eval(rcpStr);

// Extract polyTable
const polyStart = content.indexOf('polyTable = ');
if (polyStart === -1) throw new Error('polyTable not found');
rest = content.slice(polyStart + 'polyTable = '.length);
const polyEnd = rest.indexOf('];');
const polyStr = rest.slice(0, polyEnd + 2);
const poly = eval(polyStr);

const out = [];
out.push('// Generated from transvoxel-extended-tables.js - do not edit by hand.');
out.push('// Run: node gen_tables.js');
out.push('#include "transvoxel_extended_tables.h"');
out.push('');
out.push('namespace transvoxel {');
out.push('');
out.push('const int regularCellPolyTable[kRegularCellPolyTableSize][kRegularCellPolyRowSize] = {');
rcp.forEach((row) => {
  out.push('  { ' + row.join(', ') + ' },');
});
out.push('};');
out.push('');
out.push('const int polyTable[kPolyTableSize][kPolyTableRowSize] = {');
for (let i = 0; i <= 8; i++) {
  const row = poly[i];
  if (!row || row.length === 0) {
    out.push('  { -1 },  // ' + i);
  } else {
    const padded = row.slice(0, 27);
    while (padded.length < 27) padded.push(-1);
    out.push('  { ' + padded.join(', ') + ' },  // ' + i);
  }
}
out.push('};');
out.push('');
out.push('}  // namespace transvoxel');
out.push('');

fs.writeFileSync(cppPath, out.join('\n'), 'utf8');
console.log('Wrote', cppPath);
