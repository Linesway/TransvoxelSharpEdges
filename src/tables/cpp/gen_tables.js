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
const RCP_ROW_SIZE = 32;
out.push('const int regularCellPolyTable[kRegularCellPolyTableSize][kRegularCellPolyRowSize] = {');
rcp.forEach((row) => {
  const padded = row.slice(0, RCP_ROW_SIZE);
  while (padded.length < RCP_ROW_SIZE) padded.push(-1);
  out.push('  { ' + padded.join(', ') + ' },');
});
out.push('};');
out.push('');
out.push('const int polyTable[kPolyTableSize][kPolyTableRowSize] = {');
const POLY_ROW_SIZE = 27;
for (let i = 0; i <= 8; i++) {
  const row = poly[i];
  const padded = (!row || row.length === 0) ? [] : row.slice(0, POLY_ROW_SIZE);
  while (padded.length < POLY_ROW_SIZE) padded.push(-1);
  out.push('  { ' + padded.join(', ') + ' },  // ' + i);
}
out.push('};');
out.push('');
out.push('}  // namespace transvoxel');
out.push('');

fs.writeFileSync(cppPath, out.join('\n'), 'utf8');
console.log('Wrote', cppPath);
