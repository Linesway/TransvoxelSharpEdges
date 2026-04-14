# Random missing edge flips + random black sharp normals (diagnosis + fixes)

This document focuses on your exact current pipeline:

1. `MarchingCS` writes `OutTris`, `edgeToTrianglesMap`, ranks.
2. `FlipEdgesCS` flips based on `edgeToTrianglesMap`.
3. `BuildFeatureMapCS` builds `featureVertex -> incident triangles`.
4. `CountDuplicateCS` and `ApplySharpNormalsCS` group + duplicate + rewrite corners.

You said behavior is random between regenerations. That strongly indicates nondeterministic write ordering + lossy map inserts.

---

## High-probability root causes

## 1) Publication race in hash entries (most important)

In `HashInsertEdgeTriangle`, slot claim uses atomic on `EdgeVertexIndexA`, but the rest of the entry is written non-atomically afterward.
Another thread can see:

- `EdgeVertexIndexA == myA`
- `EdgeVertexIndexB` not written yet (still old/EMPTY)

Then it probes to a different slot and may create fragmented entries for same edge. Result: some edges never reach a clean 2-triangle entry => random missed flips.

Same class of issue exists in `FeatureMap` insertion (key visible before payload fully initialized).

### Fix pattern: BUSY sentinel + publish last

Use explicit state for key field:

- `EMPTY = 0xffffffff`
- `BUSY  = 0xfffffffe`

Claim slot with `EMPTY -> BUSY`, initialize payload, then publish final key.

#### Feature map example

```hlsl
#define EMPTY 0xffffffff
#define BUSY  0xfffffffe

void HashInsertFeatureTriangle(uint featureVertex, uint tri, uint corner, uint bufferSize)
{
    uint slot = HashFeatureVertexIndex(featureVertex, bufferSize);
    [allow_uav_condition]
    while (true)
    {
        uint prev;
        InterlockedCompareExchange(FeatureMap[slot].FeatureVertexIndex, EMPTY, BUSY, prev);
        if (prev == EMPTY)
        {
            // initialize payload while BUSY
            FeatureMap[slot].FeatureTriangleCount = 1;
            FeatureMap[slot].FeatureTriangle[0].TriangleIndex = tri;
            FeatureMap[slot].FeatureTriangle[0].CornerIndex = corner;
            [unroll] for (uint i = 1; i < 7; ++i)
            {
                FeatureMap[slot].FeatureTriangle[i].TriangleIndex = EMPTY;
                FeatureMap[slot].FeatureTriangle[i].CornerIndex = EMPTY;
            }
            // publish key LAST
            InterlockedExchange(FeatureMap[slot].FeatureVertexIndex, featureVertex);
            return;
        }

        // if slot is BUSY, retry same slot until published
        if (prev == BUSY) { continue; }

        if (prev == featureVertex)
        {
            uint insertIndex = 0;
            InterlockedAdd(FeatureMap[slot].FeatureTriangleCount, 1, insertIndex);
            if (insertIndex < 7)
            {
                FeatureMap[slot].FeatureTriangle[insertIndex].TriangleIndex = tri;
                FeatureMap[slot].FeatureTriangle[insertIndex].CornerIndex = corner;
            }
            return;
        }

        slot = (slot + 1) & (bufferSize - 1);
    }
}
```

Apply same publish discipline to edge map entries.

---

## 2) Hard cap of 7 incident triangles in `FFeatureMapEntry` causes nondeterministic data loss

Your `FeatureTriangle[7]` and `FeatureTriangleCount` clamp means overflow triangles are dropped.
Which triangles get dropped depends on insertion order (thread scheduling), so results vary per run.

This directly causes:

- random wrong group assignment
- random black sharp normals
- random corner rewrite errors

### Fix options

1. Increase capacity significantly (temporary):
   - e.g. 16 or 24
2. Better: two-pass CSR layout (deterministic):
   - pass A: count incidents per feature vertex
   - prefix sum on CPU or GPU
   - pass B: fill compact incident list with atomic per-feature write index

If you keep fixed-size arrays, you must at least log overflow count.

```hlsl
globallycoherent RWStructuredBuffer<uint> FeatureOverflowCounter;
if (insertIndex >= MAX_FEATURE_TRIS) InterlockedAdd(FeatureOverflowCounter[0], 1);
```

---

## 3) `DuplicatedVertexCounter` used in both count and apply passes can desync offsets

You use atomic add in both `CountDuplicateCS` and `ApplySharpNormalsCS`.
If counter is not reset exactly before apply (or if sizes mismatch), duplicate starts become wrong/out-of-range.

### Deterministic fix

- In `CountDuplicateCS`: write per-feature duplicate count to a buffer `FeatureDupCount[featureSlot]`.
- Do prefix sum once to `FeatureDupOffset[featureSlot]`.
- In apply pass: `duplicateStart = FeatureDupOffset[featureSlot]` (no atomic).

This removes one major nondeterminism source.

---

## 4) Triangle rewritten by multiple edge flips in same pass

Even without >2-triangle edges, one triangle can belong to two candidate flipped edges.
Then two threads may write same triangle indices; last writer wins.

### Fix: triangle ownership claim

Add `RWStructuredBuffer<uint> TriangleFlipOwner` sized `IndexCount/3`, initialized to `EMPTY`.
Each edge flip must claim both triangles before writing.

```hlsl
bool TryClaimTri(uint triOffset, uint owner)
{
    uint tri = triOffset / 3;
    uint prev;
    InterlockedCompareExchange(TriangleFlipOwner[tri], EMPTY, owner, prev);
    return (prev == EMPTY || prev == owner);
}
```

If either claim fails, skip that flip.

---

## 5) Ensure map buffers are fully initialized every dispatch

Because hash maps use open addressing and sentinel values, stale entries from prior runs will create random behavior.

Required every frame/chunk dispatch:

- clear `edgeToTrianglesMap` to `EMPTY` state for all fields
- clear `FeatureMap` to `EMPTY` state
- reset counters (`FeatureTriangleCount`, `DuplicatedVertexCounter`, overflow counters)

Use clear pass/UAV clear, not partial writes.

---

## 6) Buffer size constraints: must be power-of-two for `& (size-1)` masking

You use:

```hlsl
slot = (slot + 1) & (bufferSize - 1);
hash & (bufferSize - 1)
```

This only works if `bufferSize` is power-of-two.
If not, probing is broken and appears random.

---

## Concrete stabilization plan (order)

1. Add overflow counters and verify if `FeatureTriangle[7]` overflows (very likely).
2. Add triangle ownership claim in `FlipEdgesCS`.
3. Change map publication to BUSY->READY pattern.
4. Replace dual-counter duplicate allocation with count+prefix+apply.
5. Upgrade feature incident storage from fixed 7 to CSR.

---

## Why this matches your symptoms

- “Most work, a few random fail” = collisions/overflows/order-dependent writes.
- “Different each regenerate” = thread scheduling changes insertion order.
- “Not >2 triangles” can still fail due to publication races, overflow, and duplicate allocation desync.

---

## Extra diagnostics to add now

- `EdgeMapDuplicateKeyCounter`: count how often same edge ends up in multiple slots.
- `FeatureOverflowCounter`: count dropped incident triangles.
- `FlipClaimRejectCounter`: count flips skipped due to triangle owner conflicts.
- `OutOfRangeDupWriteCounter`: count duplicate index >= output vertex buffer size.

These 4 counters will quickly tell which bug dominates.

