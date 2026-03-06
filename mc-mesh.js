/**
 * Build a PlayCanvas mesh from extended marching cubes output.
 * MC result: { vertices: number[] (x,y,z,nx,ny,nz per vertex), indices: number[] }.
 */
import * as pc from 'playcanvas';

/**
 * @param {pc.GraphicsDevice} device
 * @param {{ vertices: number[]; indices: number[] }} mcResult
 * @param {{ center?: boolean }} options - center: map [0,1]^3 to [-0.5,0.5]^3 (default true)
 * @returns {pc.Mesh}
 */
export function createMeshFromMCResult(device, mcResult, options = {}) {
  const { center = true } = options;
  const { vertices: mcVertices, indices: mcIndices } = mcResult;

  const nV = mcVertices.length / 6;
  const positions = new Float32Array(nV * 3);
  const normals = new Float32Array(nV * 3);
  const off = center ? 0.5 : 0;

  for (let i = 0; i < nV; i++) {
    positions[i * 3] = mcVertices[i * 6] - off;
    positions[i * 3 + 1] = mcVertices[i * 6 + 1] - off;
    positions[i * 3 + 2] = mcVertices[i * 6 + 2] - off;
    normals[i * 3] = mcVertices[i * 6 + 3];
    normals[i * 3 + 1] = mcVertices[i * 6 + 4];
    normals[i * 3 + 2] = mcVertices[i * 6 + 5];
  }

  const indices = new Uint16Array(mcIndices.length);
  for (let i = 0; i < mcIndices.length; i++) indices[i] = mcIndices[i];

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setIndices(indices);
  mesh.update();

  return mesh;
}
