/**
 * PlayCanvas viewer: FPS fly camera + marching-cubes SDF mesh.
 * Uses classic marching cubes (tri table) for the cube SDF.
 */
import * as pc from 'playcanvas';
import { insidePositive, cubeSDF } from './sdf.js';
import { runMarchingCubes } from './mc/marching-cubes.js';
import { createMeshFromMCResult } from './mc/mc-mesh.js';
import { createFpsCamera } from './camera.js';

const canvas = document.getElementById('application');
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas),
  touch: new pc.TouchDevice(canvas),
  keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: { alpha: false }
});

app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    app.resizeCanvas();
  }
}
resize();
window.addEventListener('resize', resize);

app.start();

const camera = createFpsCamera(app, canvas);

// Directional light
const light = new pc.Entity('Light');
light.addComponent('light', {
  type: 'directional',
  color: new pc.Color(1, 1, 1),
  intensity: 1,
  castShadows: false
});
light.setEulerAngles(45, 45, 0);
app.root.addChild(light);

// Default cube at origin (so we always see something)
const defaultBox = new pc.Entity('Default Box');
defaultBox.setPosition(0, 0, 0);
defaultBox.addComponent('render', { type: 'box' });
defaultBox.render.material.diffuse = new pc.Color(0.9, 0.25, 0.2);
defaultBox.render.material.update();
app.root.addChild(defaultBox);

// Classic marching cubes for cube SDF (inside = value > 0, iso = 0)
const mcRes = 24;
const iso = 0;
const fieldFn = insidePositive(cubeSDF);
const mcResult = runMarchingCubes(mcRes, iso, fieldFn);
const nVert = mcResult.vertices.length / 6;
const nTri = mcResult.indices.length / 3;
console.log('MC result:', nVert, 'vertices,', nTri, 'triangles');

const mesh = createMeshFromMCResult(app.graphicsDevice, mcResult, { center: true });
if (!mesh) {
  console.error('Marching cubes produced no mesh. Check SDF and resolution.');
}

// Material for MC mesh (green, double-sided)
let mcMaterial;
try {
  mcMaterial = new pc.StandardMaterial();
  mcMaterial.diffuse = new pc.Color(0.2, 0.85, 0.4);
} catch (_) {
  mcMaterial = defaultBox.render.material.clone();
  mcMaterial.diffuse = new pc.Color(0.2, 0.85, 0.4);
}
mcMaterial.cull = pc.CULLFACE_NONE;
mcMaterial.update();

if (mesh) {
  const meshInstance = new pc.MeshInstance(mesh, mcMaterial);
  const mcEntity = new pc.Entity('MC Cube');
  mcEntity.setPosition(1.5, 0, 0);
  mcEntity.addComponent('render');
  mcEntity.render.type = 'asset';
  mcEntity.render.meshInstances = [meshInstance];
  app.root.addChild(mcEntity);
}
