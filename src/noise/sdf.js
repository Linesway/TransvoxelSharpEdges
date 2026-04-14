/**
 * SDF (signed distance field) primitives for marching cubes.
 * All functions take (x, y, z) in [0, 1]^3. Return negative inside, positive outside;
 * use -sdf when "inside" is defined as value > iso in MC.
 */

import { noise as perlinNoise } from '@chriscourses/perlin-noise';

/**
 * Box SDF: axis-aligned box centered at (cx, cy, cz) with half-extents (hx, hy, hz).
 * Returns negative inside, zero on surface, positive outside.
 * Uses standard formula: length(max(d,0)) + min(max(d.x,d.y,d.z), 0).
 */
function boxSDF(x, y, z, cx, cy, cz, hx, hy, hz) {
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  const dz = Math.abs(z - cz) - hz;
  const outside = Math.sqrt(
    Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2 + Math.max(dz, 0) ** 2
  );
  const inside = Math.min(Math.max(dx, dy, dz), 0);
  return outside + inside;
}

/**
 * Create cube SDF centered at (0.5, 0.5, 0.5) in [0,1]^3.
 * opts: { halfSize, offsetX, offsetY, offsetZ } where halfSize > 0.
 * Offsets are applied to cube center around the default (0.5, 0.5, 0.5).
 */
function createCubeSDF(opts = {}) {
  const halfSize = Math.max(0.001, Math.min(2.0, opts.halfSize ?? 0.4));
  const cx = 0.5 + (opts.offsetX ?? 0);
  const cy = 0.5 + (opts.offsetY ?? 0);
  const cz = 0.5 + (opts.offsetZ ?? 0);
  return function cube(x, y, z) {
    return boxSDF(x, y, z, cx, cy, cz, halfSize, halfSize, halfSize);
  };
}

/** Default cube SDF with half-size 0.4. */
function cubeSDF(x, y, z) {
  return createCubeSDF()(x, y, z);
}

/**
 * Sphere SDF centered at (0.5, 0.5, 0.5) with radius 0.35.
 */
function sphereSDF(x, y, z) {
  const cx = 0.5, cy = 0.5, cz = 0.5;
  const r = 0.35;
  return Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2) - r;
}

const DEFAULT_PERLIN = { base: 0.25, amplitude: 0.4, frequency: 3 };

/**
 * Create Perlin 2D height-map SDF with options.
 * frequency = number of hills across [0,1] (noise input scale). Lower = bigger hills.
 * opts: { base, amplitude, frequency }. Negative inside = below surface.
 */
function createPerlin2DSDF(opts = {}) {
  const base = opts.base ?? DEFAULT_PERLIN.base;
  const amplitude = opts.amplitude ?? DEFAULT_PERLIN.amplitude;
  const freq = opts.frequency ?? DEFAULT_PERLIN.frequency;
  return function perlin2DSDF(x, y, z) {
    const n = perlinNoise(x * freq, z * freq);
    const surfaceY = base + amplitude * n;
    return y - surfaceY;
  };
}

/**
 * Create union of cube and Perlin 2D terrain.
 * opts: { base, amplitude, frequency, halfSize, offsetX, offsetY, offsetZ }
 */
function createPerlin2DUnionCubeSDF(opts = {}) {
  const terrainSDF = createPerlin2DSDF(opts);
  const cube = createCubeSDF({
    halfSize: opts.halfSize,
    offsetX: opts.offsetX,
    offsetY: opts.offsetY,
    offsetZ: opts.offsetZ
  });
  return function perlin2DUnionCubeSDF(x, y, z) {
    const cubeValue = cube(x, y, z);
    const terrain = terrainSDF(x, y, z);
    return cubeValue < terrain ? cubeValue : terrain;
  };
}

/** Default Perlin SDFs (use createPerlin2DSDF(opts) when you need custom settings). */
function perlin2DSDF(x, y, z) {
  return createPerlin2DSDF()(x, y, z);
}

function perlin2DUnionCubeSDF(x, y, z) {
  return createPerlin2DUnionCubeSDF()(x, y, z);
}

const DEFAULT_PERLIN_3D = { frequency: 2 };

/**
 * Create 3D Perlin density field for MC: value in [0,1], use with iso ~0.5.
 * opts: { frequency }. Chunk at (cx,cy,cz) should use createPerlin3DField({ frequency }, cx, cy, cz)
 * so that (x,y,z) in [0,1] samples world position (cx+x, cy+y, cz+z).
 */
function createPerlin3DField(opts = {}, offsetX = 0, offsetY = 0, offsetZ = 0) {
  const freq = opts.frequency ?? DEFAULT_PERLIN_3D.frequency;
  return function perlin3DField(x, y, z) {
    return perlinNoise((offsetX + x) * freq, (offsetY + y) * freq, (offsetZ + z) * freq);
  };
}

/**
 * Grid of cubes SDF: union of nx×ny×nz axis-aligned cubes in [0,1]^3.
 * opts:
 * - nx, ny, nz: grid dimensions (default 3,3,3)
 * - cubeFill: relative cell fill amount per axis (>0), default 0.8
 * - offsetX/Y/Z: offset applied to each cube center in local [0,1] domain
 * Returns negative inside any cube.
 */
function createGridOfCubesSDF(opts = {}) {
  const nx = Math.max(1, opts.nx ?? 3);
  const ny = Math.max(1, opts.ny ?? 3);
  const nz = Math.max(1, opts.nz ?? 3);
  const cubeFill = Math.max(0.001, Math.min(3.0, opts.cubeFill ?? 0.8));
  const offsetX = opts.offsetX ?? 0;
  const offsetY = opts.offsetY ?? 0;
  const offsetZ = opts.offsetZ ?? 0;
  const hx = (0.5 * cubeFill) / nx;
  const hy = (0.5 * cubeFill) / ny;
  const hz = (0.5 * cubeFill) / nz;
  return function gridOfCubesSDF(x, y, z) {
    let d = Infinity;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const cx = (i + 0.5) / nx + offsetX;
          const cy = (j + 0.5) / ny + offsetY;
          const cz = (k + 0.5) / nz + offsetZ;
          const b = boxSDF(x, y, z, cx, cy, cz, hx, hy, hz);
          if (b < d) d = b;
        }
      }
    }
    return d;
  };
}

/**
 * Wraps an SDF so that "inside" (negative) becomes positive for marching cubes
 * that use "value > iso" for inside. Use with iso = 0.
 */
function insidePositive(sdfFn) {
  return (x, y, z) => -sdfFn(x, y, z);
}

/**
 * World-space 2D Perlin heightmap field factory for LOD/octree chunking.
 * opts: { baseY, amplitude, frequency } — all in world units (frequency = noise freq per world unit).
 * Returns makeChunkField(minX, minY, minZ, size) which yields a localFieldFn (lx,ly,lz in [0,1])
 * evaluating the heightmap in world space. Positive inside the terrain (below surface), for iso=0.
 */
function createWorldHeightmap2DFieldFactory(opts = {}) {
  const baseY = opts.baseY ?? 0;
  const amplitude = opts.amplitude ?? 6;
  const freq = opts.frequency ?? 0.05;
  return function makeChunkField(minX, minY, minZ, size) {
    return function chunkField(lx, ly, lz) {
      const wx = minX + lx * size;
      const wy = minY + ly * size;
      const wz = minZ + lz * size;
      const surfaceY = baseY + amplitude * perlinNoise(wx * freq, wz * freq);
      return surfaceY - wy;
    };
  };
}

export {
  boxSDF,
  createCubeSDF,
  cubeSDF,
  sphereSDF,
  perlin2DSDF,
  perlin2DUnionCubeSDF,
  createPerlin2DSDF,
  createPerlin2DUnionCubeSDF,
  createPerlin3DField,
  createGridOfCubesSDF,
  createWorldHeightmap2DFieldFactory,
  insidePositive
};
