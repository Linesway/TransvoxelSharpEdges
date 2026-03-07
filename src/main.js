/**
 * PlayCanvas viewer: FPS fly camera + marching-cubes SDF mesh.
 * Uses classic marching cubes (tri table) for the cube SDF.
 */
import * as pc from 'playcanvas';
import { insidePositive, cubeSDF } from './noise/sdf.js';
import { runMarchingCubes } from './mc/marching-cubes.js';
import { runExtendedMarchingCubes } from './mc/marching-cubes-extended.js';
import { runTransvoxelInterior } from './mc/transvoxel.js';
import { runTransvoxelExtended } from './mc/transvoxel-extended.js';
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

// Chunk / resolution sliders — rebuild meshes on Apply
const chunkState = {
  resolution: 24,
  iso: 0,
  mcEntity: null,
  tvEntity: null,
  tvxEntity: null,
  extendedEntity: null,
  materials: null
};

(function () {
  const panel = document.createElement('div');
  panel.id = 'chunk-control';
  panel.style.cssText = 'position:fixed;top:12px;left:12px;padding:10px 14px;background:rgba(0,0,0,0.7);border-radius:8px;font-size:12px;color:#e0e0e0;z-index:9999;font-family:system-ui,sans-serif;min-width:180px;';

  const resLabel = document.createElement('label');
  resLabel.style.display = 'block';
  const resValueSpan = document.createElement('span');
  resValueSpan.textContent = chunkState.resolution;
  resLabel.appendChild(document.createTextNode('Resolution '));
  resLabel.appendChild(resValueSpan);
  const resInput = document.createElement('input');
  resInput.type = 'range';
  resInput.min = '6';
  resInput.max = '48';
  resInput.value = String(chunkState.resolution);
  resInput.style.width = '140px';
  resInput.style.display = 'block';

  const isoLabel = document.createElement('label');
  isoLabel.style.display = 'block';
  isoLabel.style.marginTop = '8px';
  const isoValueSpan = document.createElement('span');
  isoValueSpan.textContent = chunkState.iso.toFixed(2);
  isoLabel.appendChild(document.createTextNode('Iso '));
  isoLabel.appendChild(isoValueSpan);
  const isoInput = document.createElement('input');
  isoInput.type = 'range';
  isoInput.min = '-0.2';
  isoInput.max = '0.2';
  isoInput.step = '0.01';
  isoInput.value = String(chunkState.iso);
  isoInput.style.width = '140px';
  isoInput.style.display = 'block';

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply';
  applyBtn.style.cssText = 'margin-top:10px;padding:6px 12px;cursor:pointer;background:#444;color:#eee;border:1px solid #666;border-radius:4px;font-size:12px;';

  resInput.addEventListener('input', () => {
    resValueSpan.textContent = resInput.value;
  });
  isoInput.addEventListener('input', () => {
    isoValueSpan.textContent = Number(isoInput.value).toFixed(2);
  });

  panel.appendChild(resLabel);
  panel.appendChild(resInput);
  panel.appendChild(isoLabel);
  panel.appendChild(isoInput);
  panel.appendChild(applyBtn);
  document.body.appendChild(panel);

  window.rebuildChunkMeshes = function rebuildChunkMeshes() {
    chunkState.resolution = Math.max(6, parseInt(resInput.value, 10) || 24);
    chunkState.iso = Number(isoInput.value) || 0;
    resInput.value = String(chunkState.resolution);
    isoInput.value = String(chunkState.iso);
    resValueSpan.textContent = chunkState.resolution;
    isoValueSpan.textContent = chunkState.iso.toFixed(2);

    const mcRes = chunkState.resolution;
    const iso = chunkState.iso;
    const fieldFn = insidePositive(cubeSDF);

    const mcResult = runMarchingCubes(mcRes, iso, fieldFn);
    const mcMesh = createMeshFromMCResult(app.graphicsDevice, mcResult, { center: true });
    if (mcMesh && chunkState.mcEntity && chunkState.materials.mc) {
      chunkState.mcEntity.render.meshInstances = [new pc.MeshInstance(mcMesh, chunkState.materials.mc)];
    }

    const transvoxelResult = runTransvoxelInterior(mcRes, iso, fieldFn);
    const tvMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelResult, { center: true });
    if (tvMesh && chunkState.tvEntity && chunkState.materials.tv) {
      chunkState.tvEntity.render.meshInstances = [new pc.MeshInstance(tvMesh, chunkState.materials.tv)];
    }

    const transvoxelExtResult = runTransvoxelExtended(mcRes, iso, fieldFn);
    const tvxMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelExtResult, { center: true });
    if (tvxMesh && chunkState.tvxEntity && chunkState.materials.tvx) {
      chunkState.tvxEntity.render.meshInstances = [new pc.MeshInstance(tvxMesh, chunkState.materials.tvx)];
    }

    const extendedResult = runExtendedMarchingCubes(mcRes, iso, fieldFn);
    const extendedMesh = createMeshFromMCResult(app.graphicsDevice, extendedResult, { center: true });
    if (extendedMesh && chunkState.extendedEntity && chunkState.materials.extended) {
      chunkState.extendedEntity.render.meshInstances = [new pc.MeshInstance(extendedMesh, chunkState.materials.extended)];
    }

    console.log('Chunk rebuilt: resolution=', mcRes, 'iso=', iso);
  };

  applyBtn.addEventListener('click', window.rebuildChunkMeshes);
})();

// Default cube at origin (so we always see something)
const defaultBox = new pc.Entity('Default Box');
defaultBox.setPosition(0, 0, 0);
defaultBox.addComponent('render', { type: 'box' });
defaultBox.render.material.diffuse = new pc.Color(0.9, 0.25, 0.2);
defaultBox.render.material.update();
app.root.addChild(defaultBox);

// Create materials once (shared across rebuilds)
function createChunkMaterials() {
  let mc, tv, tvx, extended;
  try {
    mc = new pc.StandardMaterial();
    mc.diffuse = new pc.Color(0.2, 0.85, 0.4);
  } catch (_) {
    mc = defaultBox.render.material.clone();
    mc.diffuse = new pc.Color(0.2, 0.85, 0.4);
  }
  mc.cull = pc.CULLFACE_NONE;
  mc.update();

  try {
    tv = new pc.StandardMaterial();
    tv.diffuse = new pc.Color(0.95, 0.5, 0.15);
  } catch (_) {
    tv = defaultBox.render.material.clone();
    tv.diffuse = new pc.Color(0.95, 0.5, 0.15);
  }
  tv.cull = pc.CULLFACE_NONE;
  tv.update();

  try {
    tvx = new pc.StandardMaterial();
    tvx.diffuse = new pc.Color(0.72, 0.35, 0.95);
  } catch (_) {
    tvx = defaultBox.render.material.clone();
    tvx.diffuse = new pc.Color(0.72, 0.35, 0.95);
  }
  tvx.cull = pc.CULLFACE_NONE;
  tvx.update();

  try {
    extended = new pc.StandardMaterial();
    extended.diffuse = new pc.Color(0.2, 0.5, 0.95);
  } catch (_) {
    extended = defaultBox.render.material.clone();
    extended.diffuse = new pc.Color(0.2, 0.5, 0.95);
  }
  extended.cull = pc.CULLFACE_NONE;
  extended.update();

  return { mc, tv, tvx, extended };
}

chunkState.materials = createChunkMaterials();

const mcRes = chunkState.resolution;
const iso = chunkState.iso;
const fieldFn = insidePositive(cubeSDF);

const mcResult = runMarchingCubes(mcRes, iso, fieldFn);
console.log('MC result:', mcResult.vertices.length / 6, 'vertices,', mcResult.indices.length / 3, 'triangles');

const mesh = createMeshFromMCResult(app.graphicsDevice, mcResult, { center: true });
if (mesh) {
  const mcEntity = new pc.Entity('MC Cube');
  mcEntity.setPosition(1.5, 0, 0);
  mcEntity.addComponent('render');
  mcEntity.render.type = 'asset';
  mcEntity.render.meshInstances = [new pc.MeshInstance(mesh, chunkState.materials.mc)];
  app.root.addChild(mcEntity);
  chunkState.mcEntity = mcEntity;
}

const transvoxelResult = runTransvoxelInterior(mcRes, iso, fieldFn);
console.log('Transvoxel result:', transvoxelResult.vertices.length / 6, 'vertices,', transvoxelResult.indices.length / 3, 'triangles');

const transvoxelMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelResult, { center: true });
if (transvoxelMesh) {
  const tvEntity = new pc.Entity('Transvoxel Cube');
  tvEntity.setPosition(-4.5, 0, 0);
  tvEntity.addComponent('render');
  tvEntity.render.type = 'asset';
  tvEntity.render.meshInstances = [new pc.MeshInstance(transvoxelMesh, chunkState.materials.tv)];
  app.root.addChild(tvEntity);
  chunkState.tvEntity = tvEntity;
}

const transvoxelExtResult = runTransvoxelExtended(mcRes, iso, fieldFn);
console.log('Transvoxel Extended result:', transvoxelExtResult.vertices.length / 6, 'vertices,', transvoxelExtResult.indices.length / 3, 'triangles');

const transvoxelExtMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelExtResult, { center: true });
if (transvoxelExtMesh) {
  const tvxEntity = new pc.Entity('Transvoxel Extended Cube');
  tvxEntity.setPosition(-7.5, 0, 0);
  tvxEntity.addComponent('render');
  tvxEntity.render.type = 'asset';
  tvxEntity.render.meshInstances = [new pc.MeshInstance(transvoxelExtMesh, chunkState.materials.tvx)];
  app.root.addChild(tvxEntity);
  chunkState.tvxEntity = tvxEntity;
}

const extendedResult = runExtendedMarchingCubes(mcRes, iso, fieldFn);
console.log('Extended MC result:', extendedResult.vertices.length / 6, 'vertices,', extendedResult.indices.length / 3, 'triangles');

const extendedMesh = createMeshFromMCResult(app.graphicsDevice, extendedResult, { center: true });
if (extendedMesh) {
  const extendedEntity = new pc.Entity('MC Extended Cube');
  extendedEntity.setPosition(-1.5, 0, 0);
  extendedEntity.addComponent('render');
  extendedEntity.render.type = 'asset';
  extendedEntity.render.meshInstances = [new pc.MeshInstance(extendedMesh, chunkState.materials.extended)];
  app.root.addChild(extendedEntity);
  chunkState.extendedEntity = extendedEntity;
}
