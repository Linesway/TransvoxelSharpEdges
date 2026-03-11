/**
 * Transvoxel extended tables (C++).
 * Mirrors transvoxel-extended-tables.js:
 * - regularCellPolyTable[256][32]: n_components, then per component (nv, v0..v(nv-1)), -1 padded to 32.
 * - polyTable[8][27]: fan triangulation, 3 per triangle, -1 terminated.
 */
#ifndef TRANSVOXEL_EXTENDED_TABLES_H
#define TRANSVOXEL_EXTENDED_TABLES_H

namespace transvoxel {

/** Number of regular cell cases. */
constexpr int kRegularCellPolyTableSize = 256;
/** Entries per case (padded with -1). */
constexpr int kRegularCellPolyRowSize = 32;

/** 8 entries: indices 0,1,2 unused; 3-7 = triangle..heptagon fan. */
constexpr int kPolyTableSize = 8;
/** Max vertex indices per poly (3 per triangle, -1 terminator). */
constexpr int kPolyTableRowSize = 27;

/** regularCellPolyTable[caseIndex][0..31]. Per component: nv, verts (vertex slots). Same for feature and no-feature. */
extern const int regularCellPolyTable[kRegularCellPolyTableSize][kRegularCellPolyRowSize];

/** polyTable[nv][0..26]. For nv in 3..7: fan triangulation (3 indices per triangle), -1 terminated. */
extern const int polyTable[kPolyTableSize][kPolyTableRowSize];

}  // namespace transvoxel

#endif
