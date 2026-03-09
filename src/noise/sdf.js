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
 * Unit cube centered at (0.5, 0.5, 0.5) in [0,1]^3.
 * Half-size 0.4 so the surface lies inside the grid (cube [0.1, 0.9]^3) and MC gets boundary cells.
 * For MC with "inside" = value > iso, use field = (x,y,z) => -cubeSDF(x,y,z) and iso = 0.
 */
function cubeSDF(x, y, z) {
  return boxSDF(x, y, z, 0.5, 0.5, 0.5, 0.4, 0.4, 0.4);
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
 * Create union of cube and Perlin 2D terrain with the same opts.
 */
function createPerlin2DUnionCubeSDF(opts = {}) {
  const terrainSDF = createPerlin2DSDF(opts);
  return function perlin2DUnionCubeSDF(x, y, z) {
    const cube = cubeSDF(x, y, z);
    const terrain = terrainSDF(x, y, z);
    return cube < terrain ? cube : terrain;
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
 * Wraps an SDF so that "inside" (negative) becomes positive for marching cubes
 * that use "value > iso" for inside. Use with iso = 0.
 */
function insidePositive(sdfFn) {
  return (x, y, z) => -sdfFn(x, y, z);
}

export {
  boxSDF,
  cubeSDF,
  sphereSDF,
  perlin2DSDF,
  perlin2DUnionCubeSDF,
  createPerlin2DSDF,
  createPerlin2DUnionCubeSDF,
  createPerlin3DField,
  insidePositive
};
