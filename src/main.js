/**
 * PlayCanvas viewer: FPS fly camera + marching-cubes SDF mesh.
 * Uses classic marching cubes (tri table) for the cube SDF.
 */
import * as pc from 'playcanvas';
import { insidePositive, cubeSDF } from './noise/sdf.js';
import { runMarchingCubes } from './mc/marching-cubes.js';
import { runExtendedMarchingCubes } from './mc/marching-cubes-extended.js';
import { runTransvoxelInterior } from './mc/transvoxel.js';
import { createMeshFromMCResult } from './mc/mc-mesh.js';
import { createFpsCamera } from './camera/camera.js';

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

// Sun direction sliders — create in JS and append to body so they always work
(function () {
  const panel = document.createElement('div');
  panel.id = 'sun-control';
  panel.style.cssText = 'position:fixed;top:12px;right:12px;padding:10px 14px;background:rgba(0,0,0,0.7);border-radius:8px;font-size:12px;color:#e0e0e0;z-index:9999;font-family:system-ui,sans-serif;';
  const azLabel = document.createElement('label');
  azLabel.style.display = 'block';
  const azValueSpan = document.createElement('span');
  azValueSpan.textContent = '45';
  azLabel.appendChild(document.createTextNode('Sun azimuth '));
  azLabel.appendChild(azValueSpan);
  azLabel.appendChild(document.createTextNode('°'));
  const azInput = document.createElement('input');
  azInput.type = 'range';
  azInput.min = '0';
  azInput.max = '360';
  azInput.value = '45';
  azInput.style.width = '120px';
  azInput.style.display = 'block';
  const elLabel = document.createElement('label');
  elLabel.style.display = 'block';
  elLabel.style.marginTop = '8px';
  const elValueSpan = document.createElement('span');
  elValueSpan.textContent = '45';
  elLabel.appendChild(document.createTextNode('Sun elevation '));
  elLabel.appendChild(elValueSpan);
  elLabel.appendChild(document.createTextNode('°'));
  const elInput = document.createElement('input');
  elInput.type = 'range';
  elInput.min = '0';
  elInput.max = '90';
  elInput.value = '45';
  elInput.style.width = '120px';
  elInput.style.display = 'block';

  function updateSun() {
    const az = parseInt(azInput.value, 10);
    const el = parseInt(elInput.value, 10);
    azValueSpan.textContent = az;
    elValueSpan.textContent = el;
    light.setEulerAngles(el, az, 0);
  }
  azInput.addEventListener('input', updateSun);
  elInput.addEventListener('input', updateSun);

  panel.appendChild(azLabel);
  panel.appendChild(azInput);
  panel.appendChild(elLabel);
  panel.appendChild(elInput);
  document.body.appendChild(panel);
})();

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

// Transvoxel interior (regular cells) — same SDF, orange cube on the left
const transvoxelResult = runTransvoxelInterior(mcRes, iso, fieldFn);
const tvVert = transvoxelResult.vertices.length / 6;
const tvTri = transvoxelResult.indices.length / 3;
console.log('Transvoxel result:', tvVert, 'vertices,', tvTri, 'triangles');

const transvoxelMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelResult, { center: true });
if (transvoxelMesh) {
  let tvMaterial;
  try {
    tvMaterial = new pc.StandardMaterial();
    tvMaterial.diffuse = new pc.Color(0.95, 0.5, 0.15);
  } catch (_) {
    tvMaterial = defaultBox.render.material.clone();
    tvMaterial.diffuse = new pc.Color(0.95, 0.5, 0.15);
  }
  tvMaterial.cull = pc.CULLFACE_NONE;
  tvMaterial.update();

  const tvInstance = new pc.MeshInstance(transvoxelMesh, tvMaterial);
  const tvEntity = new pc.Entity('Transvoxel Cube');
  tvEntity.setPosition(-4.5, 0, 0);
  tvEntity.addComponent('render');
  tvEntity.render.type = 'asset';
  tvEntity.render.meshInstances = [tvInstance];
  app.root.addChild(tvEntity);
}

// Extended marching cubes (polygon table) — same SDF, blue cube
const extendedResult = runExtendedMarchingCubes(mcRes, iso, fieldFn);
const extendedVert = extendedResult.vertices.length / 6;
const extendedTri = extendedResult.indices.length / 3;
console.log('Extended MC result:', extendedVert, 'vertices,', extendedTri, 'triangles');

const extendedMesh = createMeshFromMCResult(app.graphicsDevice, extendedResult, { center: true });
if (extendedMesh) {
  let extendedMaterial;
  try {
    extendedMaterial = new pc.StandardMaterial();
    extendedMaterial.diffuse = new pc.Color(0.2, 0.5, 0.95);
  } catch (_) {
    extendedMaterial = defaultBox.render.material.clone();
    extendedMaterial.diffuse = new pc.Color(0.2, 0.5, 0.95);
  }
  extendedMaterial.cull = pc.CULLFACE_NONE;
  extendedMaterial.update();

  const extendedInstance = new pc.MeshInstance(extendedMesh, extendedMaterial);
  const extendedEntity = new pc.Entity('MC Extended Cube');
  extendedEntity.setPosition(-1.5, 0, 0);
  extendedEntity.addComponent('render');
  extendedEntity.render.type = 'asset';
  extendedEntity.render.meshInstances = [extendedInstance];
  app.root.addChild(extendedEntity);
}
