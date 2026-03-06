/**
 * SDF (signed distance field) primitives for marching cubes.
 * All functions take (x, y, z) in [0, 1]^3. Return negative inside, positive outside;
 * use -sdf when "inside" is defined as value > iso in MC.
 */

/**
 * Box SDF: axis-aligned box centered at (cx, cy, cz) with half-extents (hx, hy, hz).
 * Returns negative inside, zero on surface, positive outside.
 * Uses standard formula: length(max(d,0)) + min(max(d.x,d.y,d.z), 0).
 */
export function boxSDF(x, y, z, cx, cy, cz, hx, hy, hz) {
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
export function cubeSDF(x, y, z) {
  return boxSDF(x, y, z, 0.5, 0.5, 0.5, 0.4, 0.4, 0.4);
}

/**
 * Wraps an SDF so that "inside" (negative) becomes positive for marching cubes
 * that use "value > iso" for inside. Use with iso = 0.
 */
export function insidePositive(sdfFn) {
  return (x, y, z) => -sdfFn(x, y, z);
}
