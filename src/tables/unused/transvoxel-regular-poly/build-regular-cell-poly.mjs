/**
 * One-off script: run from src/tables/unused/transvoxel-regular-poly with
 *   node build-regular-cell-poly.mjs
 * Uses C4 official regularCellClass + regularCellData; builds polygon table following
 * C4 triangle winding. Patches regularCellPolyTable into ../../transvoxel-extended-tables.js.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildRegularCellPolyTable } from '../table-generation.js';
import { regularCellClass, regularCellData } from '../../transvoxel-tables.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const table = buildRegularCellPolyTable(regularCellClass, regularCellData);

const extendedPath = path.join(__dirname, '..', '..', 'transvoxel-extended-tables.js');
let content = fs.readFileSync(extendedPath, 'utf8');
const startMarker = 'export const regularCellPolyTable = ';
const endMarker = '\nexport const polyTable = ';
const start = content.indexOf(startMarker);
const end = content.indexOf(endMarker);
if (start === -1 || end === -1) throw new Error('Could not find regularCellPolyTable or polyTable in ' + extendedPath);
const newTableStr = JSON.stringify(table);
content = content.slice(0, start) + startMarker + newTableStr + content.slice(end);
fs.writeFileSync(extendedPath, content);
console.log('Patched regularCellPolyTable in', extendedPath);
