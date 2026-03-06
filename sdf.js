/**
 * SDF (signed distance field) primitives for marching cubes.
 * All functions take (x, y, z) in [0, 1]^3. Return negative inside, positive outside;
 * use -sdf when "inside" is defined as value > iso in MC.
 */

/**
 * Box SDF: axis-aligned box centered at (cx, cy, cz) with half-extents (hx, hy, hz).
 * Returns negative inside, zero on surface, positive outside.
 */
export function boxSDF(x, y, z, cx, cy, cz, hx, hy, hz) {
  const dx = Math.abs(x - cx) - hx;
  const dy = Math.abs(y - cy) - hy;
  const dz = Math.abs(z - cz) - hz;
  const outside = Math.max(dx, dy, dz);
  const inside = Math.min(Math.max(dx, 0) + Math.max(dy, 0) + Math.max(dz, 0), 0);
  return outside > 0 ? outside : inside;
}

/**
 * Unit cube centered at (0.5, 0.5, 0.5) in [0,1]^3 (half-size 0.5).
 * For MC with "inside" = value > iso, use field = (x,y,z) => -cubeSDF(x,y,z) and iso = 0.
 */
export function cubeSDF(x, y, z) {
  return boxSDF(x, y, z, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5);
}

/**
 * Wraps an SDF so that "inside" (negative) becomes positive for marching cubes
 * that use "value > iso" for inside. Use with iso = 0.
 */
export function insidePositive(sdfFn) {
  return (x, y, z) => -sdfFn(x, y, z);
}
