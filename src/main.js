/**
 * PlayCanvas viewer: FPS fly camera + marching-cubes SDF mesh.
 * Uses classic marching cubes (tri table) for the cube SDF.
 */
import * as pc from 'playcanvas';
import * as sdf from './noise/sdf.js';
const { insidePositive, cubeSDF, sphereSDF, createPerlin2DSDF, createPerlin2DUnionCubeSDF, createPerlin3DField } = sdf;
import { runMarchingCubes } from './mc/marching-cubes.js';
import { runExtendedMarchingCubes } from './mc/marching-cubes-extended.js';
import { runTransvoxelInterior } from './mc/transvoxel.js';
import { runTransvoxelInteriorVertexSharing } from './mc/transvoxel-vertex-sharing.js';
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

// Ambient (skylight) — fills in shadows so they're not pitch black
app.scene.ambientLight = new pc.Color(0.35, 0.4, 0.5);

// Main directional (sun)
const light = new pc.Entity('Light');
light.addComponent('light', {
  type: 'directional',
  color: new pc.Color(1, 0.98, 0.95),
  intensity: 1.1,
  castShadows: false
});
light.setEulerAngles(45, 45, 0);
app.root.addChild(light);

// Soft fill light — opposite side, lowers contrast and harsh terminator
const fillLight = new pc.Entity('Fill Light');
fillLight.addComponent('light', {
  type: 'directional',
  color: new pc.Color(0.7, 0.8, 1),
  intensity: 0.4,
  castShadows: false
});
fillLight.setEulerAngles(30, 225, 0); // from other side, slightly up
app.root.addChild(fillLight);

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

// World 1: Compare (5 algorithms, single chunk). World 2: TVx only, grid of chunks, 3D Perlin.
const currentWorld = { value: 1 }; // 1 = Compare, 2 = TVx Terrain
const world1State = {
  resolution: 24,
  iso: 0,
  sdfChoice: 1,  // 1: Cube, 2: Sphere, 3: Perlin 2D, 4: Perlin 2D union cube
  chunkScale: 1,
  perlinBase: 0.25,
  perlinAmplitude: 0.4,
  perlinFrequency: 3,
  flipEdges: true,
  featureAngleDeg: 30,
  noFeatures: false
};
const world2State = {
  resolution: 20,
  iso: 0.5,
  chunkScale: 1,
  gridX: 2,
  gridY: 2,
  gridZ: 2,
  perlin3DFrequency: 2,
  flipEdges: true,
  featureAngleDeg: 30,
  noFeatures: false,
  algorithm: 'transvoxelExtended' // mc | extended | transvoxel | transvoxelVS | transvoxelExtended
};
const chunkState = {
  mcEntity: null,
  tvEntity: null,
  tvSharedEntity: null,
  tvxEntity: null,
  extendedEntity: null,
  tvxChunkEntities: [], // World 2: one entity per chunk
  materials: null
};

function getFieldFn() {
  const choice = world1State.sdfChoice;
  if (choice === 1) return insidePositive(cubeSDF);
  if (choice === 2) return insidePositive(sphereSDF);
  if (choice === 3) return insidePositive(createPerlin2DSDF({
    base: world1State.perlinBase,
    amplitude: world1State.perlinAmplitude,
    frequency: world1State.perlinFrequency
  }));
  if (choice === 4) return insidePositive(createPerlin2DUnionCubeSDF({
    base: world1State.perlinBase,
    amplitude: world1State.perlinAmplitude,
    frequency: world1State.perlinFrequency
  }));
  return insidePositive(cubeSDF);
}

/** Even x positions for the 5 mesh entities (MC, Extended, TV, TV Shared, TVx). Perlin (3 or 4) uses wider spacing. */
function getMeshPositions() {
  const isPerlin = world1State.sdfChoice === 3 || world1State.sdfChoice === 4;
  const spacing = isPerlin ? 5 : 3;
  const half = 2 * spacing;
  return [half, spacing, 0, -spacing, -half]; // MC, Extended, TV, TV Shared, TVx
}

function setWorldVisibility() {
  const w = currentWorld.value;
  const compareRoot = chunkState.compareRoot;
  const terrainRoot = chunkState.terrainRoot;
  if (compareRoot) compareRoot.enabled = (w === 1);
  if (terrainRoot) terrainRoot.enabled = (w === 2);
}

(function () {
  const panel = document.createElement('div');
  panel.id = 'chunk-control';
  panel.style.cssText = 'position:fixed;top:12px;left:12px;padding:10px 14px;background:rgba(0,0,0,0.7);border-radius:8px;font-size:12px;color:#e0e0e0;z-index:9999;font-family:system-ui,sans-serif;min-width:180px;';

  // World selector — always visible so you can switch worlds
  const worldRow = document.createElement('div');
  worldRow.style.cssText = 'margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #555;';
  worldRow.appendChild(document.createTextNode('World: '));
  const worldSelect = document.createElement('select');
  worldSelect.style.cssText = 'font-size:12px;background:#333;color:#eee;border:1px solid #666;border-radius:4px;padding:4px 8px;margin-left:6px;cursor:pointer;';
  worldSelect.innerHTML = '<option value="1">1: Compare (5 algorithms)</option><option value="2">2: TVx Terrain (chunk grid)</option>';
  worldSelect.title = 'Switch between Compare view and TVx Terrain view';
  worldRow.appendChild(worldSelect);
  const worldBtns = document.createElement('span');
  worldBtns.style.marginLeft = '8px';
  const btnCompare = document.createElement('button');
  btnCompare.textContent = 'Compare';
  btnCompare.style.cssText = 'font-size:11px;padding:2px 6px;cursor:pointer;background:#444;color:#eee;border:1px solid #666;border-radius:4px;margin-left:2px;';
  const btnTerrain = document.createElement('button');
  btnTerrain.textContent = 'TVx Terrain';
  btnTerrain.style.cssText = 'font-size:11px;padding:2px 6px;cursor:pointer;background:#444;color:#eee;border:1px solid #666;border-radius:4px;margin-left:2px;';
  worldBtns.appendChild(btnCompare);
  worldBtns.appendChild(btnTerrain);
  worldRow.appendChild(worldBtns);
  panel.appendChild(worldRow);
  btnCompare.addEventListener('click', () => { worldSelect.value = '1'; showSectionForWorld(); });
  btnTerrain.addEventListener('click', () => { worldSelect.value = '2'; showSectionForWorld(); });

  // ---- World 1 section ----
  const world1Section = document.createElement('div');
  world1Section.id = 'world1-section';

  const resLabel = document.createElement('label');
  resLabel.style.display = 'block';
  resLabel.style.marginTop = '8px';
  const resValueSpan = document.createElement('span');
  resValueSpan.textContent = world1State.resolution;
  resLabel.appendChild(document.createTextNode('Resolution '));
  resLabel.appendChild(resValueSpan);
  const resInput = document.createElement('input');
  resInput.type = 'range';
  resInput.min = '6';
  resInput.max = '48';
  resInput.value = String(world1State.resolution);
  resInput.style.width = '140px';
  resInput.style.display = 'block';

  const isoLabel = document.createElement('label');
  isoLabel.style.display = 'block';
  isoLabel.style.marginTop = '8px';
  const isoValueSpan = document.createElement('span');
  isoValueSpan.textContent = world1State.iso.toFixed(2);
  isoLabel.appendChild(document.createTextNode('Iso '));
  isoLabel.appendChild(isoValueSpan);
  const isoInput = document.createElement('input');
  isoInput.type = 'range';
  isoInput.min = '-0.2';
  isoInput.max = '0.2';
  isoInput.step = '0.01';
  isoInput.value = String(world1State.iso);
  isoInput.style.width = '140px';
  isoInput.style.display = 'block';

  const sdfLabel = document.createElement('label');
  sdfLabel.style.display = 'block';
  sdfLabel.style.marginTop = '8px';
  sdfLabel.appendChild(document.createTextNode('SDF '));
  const sdfSelect = document.createElement('select');
  sdfSelect.style.cssText = 'margin-left:4px;font-size:12px;background:#333;color:#eee;border:1px solid #666;border-radius:4px;padding:2px 6px;';
  sdfSelect.innerHTML = '<option value="1">1: Cube</option><option value="2">2: Sphere</option><option value="3">3: Perlin 2D noise</option><option value="4">4: Perlin 2D union cube</option>';
  sdfSelect.value = String(world1State.sdfChoice);
  sdfLabel.appendChild(sdfSelect);

  const scaleLabel = document.createElement('label');
  scaleLabel.style.display = 'block';
  scaleLabel.style.marginTop = '8px';
  const scaleValueSpan = document.createElement('span');
  scaleValueSpan.textContent = world1State.chunkScale.toFixed(1);
  scaleLabel.appendChild(document.createTextNode('Chunk scale '));
  scaleLabel.appendChild(scaleValueSpan);
  const scaleInput = document.createElement('input');
  scaleInput.type = 'range';
  scaleInput.min = '0.25';
  scaleInput.max = '3';
  scaleInput.step = '0.25';
  scaleInput.value = String(world1State.chunkScale);
  scaleInput.style.width = '140px';
  scaleInput.style.display = 'block';

  const perlinSection = document.createElement('div');
  perlinSection.style.marginTop = '8px';
  perlinSection.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">Perlin terrain</div>';
  // Hide Perlin settings when SDF is Cube (1) or Sphere (2); show only for Perlin 2D (3) or Perlin union (4)
  perlinSection.style.display = (world1State.sdfChoice === 3 || world1State.sdfChoice === 4) ? 'block' : 'none';
  const perlinBaseLabel = document.createElement('label');
  perlinBaseLabel.style.display = 'block';
  const perlinBaseSpan = document.createElement('span');
  perlinBaseSpan.textContent = world1State.perlinBase.toFixed(2);
  perlinBaseLabel.appendChild(document.createTextNode('Base '));
  perlinBaseLabel.appendChild(perlinBaseSpan);
  const perlinBaseInput = document.createElement('input');
  perlinBaseInput.type = 'range';
  perlinBaseInput.min = '0';
  perlinBaseInput.max = '0.5';
  perlinBaseInput.step = '0.01';
  perlinBaseInput.value = String(world1State.perlinBase);
  perlinBaseInput.style.width = '140px';
  perlinBaseInput.style.display = 'block';
  const perlinAmpLabel = document.createElement('label');
  perlinAmpLabel.style.display = 'block';
  perlinAmpLabel.style.marginTop = '4px';
  const perlinAmpSpan = document.createElement('span');
  perlinAmpSpan.textContent = world1State.perlinAmplitude.toFixed(2);
  perlinAmpLabel.appendChild(document.createTextNode('Amplitude '));
  perlinAmpLabel.appendChild(perlinAmpSpan);
  const perlinAmpInput = document.createElement('input');
  perlinAmpInput.type = 'range';
  perlinAmpInput.min = '0.1';
  perlinAmpInput.max = '0.8';
  perlinAmpInput.step = '0.05';
  perlinAmpInput.value = String(world1State.perlinAmplitude);
  perlinAmpInput.style.width = '140px';
  perlinAmpInput.style.display = 'block';
  const perlinFreqLabel = document.createElement('label');
  perlinFreqLabel.style.display = 'block';
  perlinFreqLabel.style.marginTop = '4px';
  const perlinFreqSpan = document.createElement('span');
  perlinFreqSpan.textContent = world1State.perlinFrequency.toFixed(1);
  perlinFreqLabel.appendChild(document.createTextNode('Hills (count) '));
  perlinFreqLabel.appendChild(perlinFreqSpan);
  const perlinFreqInput = document.createElement('input');
  perlinFreqInput.type = 'range';
  perlinFreqInput.min = '0.5';
  perlinFreqInput.max = '10';
  perlinFreqInput.step = '0.5';
  perlinFreqInput.value = String(world1State.perlinFrequency);
  perlinFreqInput.style.width = '140px';
  perlinFreqInput.style.display = 'block';
  perlinSection.appendChild(perlinBaseLabel);
  perlinSection.appendChild(perlinBaseInput);
  perlinSection.appendChild(perlinAmpLabel);
  perlinSection.appendChild(perlinAmpInput);
  perlinSection.appendChild(perlinFreqLabel);
  perlinSection.appendChild(perlinFreqInput);

  const featureAngleLabelW1 = document.createElement('label');
  featureAngleLabelW1.style.display = 'block';
  featureAngleLabelW1.style.marginTop = '8px';
  const featureAngleSpanW1 = document.createElement('span');
  featureAngleSpanW1.textContent = world1State.featureAngleDeg + '°';
  featureAngleLabelW1.appendChild(document.createTextNode('Feature angle '));
  featureAngleLabelW1.appendChild(featureAngleSpanW1);
  const featureAngleInputW1 = document.createElement('input');
  featureAngleInputW1.type = 'range';
  featureAngleInputW1.min = '0';
  featureAngleInputW1.max = '90';
  featureAngleInputW1.step = '5';
  featureAngleInputW1.value = String(world1State.featureAngleDeg);
  featureAngleInputW1.style.width = '140px';
  featureAngleInputW1.style.display = 'block';
  featureAngleInputW1.title = 'Sharp-feature detection angle (MC Extended / Transvoxel Extended)';

  const flipEdgesLabelW1 = document.createElement('label');
  flipEdgesLabelW1.style.display = 'block';
  flipEdgesLabelW1.style.marginTop = '10px';
  flipEdgesLabelW1.style.cursor = 'pointer';
  const flipEdgesCheckW1 = document.createElement('input');
  flipEdgesCheckW1.type = 'checkbox';
  flipEdgesCheckW1.checked = world1State.flipEdges;
  flipEdgesCheckW1.style.marginRight = '6px';
  flipEdgesLabelW1.appendChild(flipEdgesCheckW1);
  flipEdgesLabelW1.appendChild(document.createTextNode('Triangle flip (Transvoxel/Extended MC)'));

  const noFeaturesLabelW1 = document.createElement('label');
  noFeaturesLabelW1.style.display = 'block';
  noFeaturesLabelW1.style.marginTop = '8px';
  noFeaturesLabelW1.style.cursor = 'pointer';
  const noFeaturesCheckW1 = document.createElement('input');
  noFeaturesCheckW1.type = 'checkbox';
  noFeaturesCheckW1.checked = world1State.noFeatures;
  noFeaturesCheckW1.style.marginRight = '6px';
  noFeaturesLabelW1.appendChild(noFeaturesCheckW1);
  noFeaturesLabelW1.appendChild(document.createTextNode('No features (override)'));

  world1Section.appendChild(resLabel);
  world1Section.appendChild(resInput);
  world1Section.appendChild(isoLabel);
  world1Section.appendChild(isoInput);
  world1Section.appendChild(sdfLabel);
  world1Section.appendChild(sdfSelect);
  world1Section.appendChild(scaleLabel);
  world1Section.appendChild(scaleInput);
  world1Section.appendChild(perlinSection);
  world1Section.appendChild(featureAngleLabelW1);
  world1Section.appendChild(featureAngleInputW1);
  world1Section.appendChild(flipEdgesLabelW1);
  world1Section.appendChild(noFeaturesLabelW1);

  function updatePerlinSectionVisibility() {
    const choice = parseInt(sdfSelect.value, 10);
    perlinSection.style.display = (choice === 3 || choice === 4) ? 'block' : 'none';
  }
  sdfSelect.addEventListener('change', updatePerlinSectionVisibility);
  updatePerlinSectionVisibility(); // Cube/Sphere = hide Perlin; Perlin 2D / union = show

  // ---- World 2 section ----
  const world2Section = document.createElement('div');
  world2Section.id = 'world2-section';
  world2Section.style.display = 'none';

  const w2ResLabel = document.createElement('label');
  w2ResLabel.style.display = 'block';
  w2ResLabel.style.marginTop = '8px';
  const w2ResSpan = document.createElement('span');
  w2ResSpan.textContent = world2State.resolution;
  w2ResLabel.appendChild(document.createTextNode('Resolution '));
  w2ResLabel.appendChild(w2ResSpan);
  const w2ResInput = document.createElement('input');
  w2ResInput.type = 'range';
  w2ResInput.min = '6';
  w2ResInput.max = '40';
  w2ResInput.value = String(world2State.resolution);
  w2ResInput.style.width = '140px';
  w2ResInput.style.display = 'block';

  const w2IsoLabel = document.createElement('label');
  w2IsoLabel.style.display = 'block';
  w2IsoLabel.style.marginTop = '8px';
  const w2IsoSpan = document.createElement('span');
  w2IsoSpan.textContent = world2State.iso.toFixed(2);
  w2IsoLabel.appendChild(document.createTextNode('Iso (density) '));
  w2IsoLabel.appendChild(w2IsoSpan);
  const w2IsoInput = document.createElement('input');
  w2IsoInput.type = 'range';
  w2IsoInput.min = '0.2';
  w2IsoInput.max = '0.8';
  w2IsoInput.step = '0.05';
  w2IsoInput.value = String(world2State.iso);
  w2IsoInput.style.width = '140px';
  w2IsoInput.style.display = 'block';

  const w2ScaleLabel = document.createElement('label');
  w2ScaleLabel.style.display = 'block';
  w2ScaleLabel.style.marginTop = '8px';
  const w2ScaleSpan = document.createElement('span');
  w2ScaleSpan.textContent = world2State.chunkScale.toFixed(1);
  w2ScaleLabel.appendChild(document.createTextNode('Chunk scale '));
  w2ScaleLabel.appendChild(w2ScaleSpan);
  const w2ScaleInput = document.createElement('input');
  w2ScaleInput.type = 'range';
  w2ScaleInput.min = '0.25';
  w2ScaleInput.max = '3';
  w2ScaleInput.step = '0.25';
  w2ScaleInput.value = String(world2State.chunkScale);
  w2ScaleInput.style.width = '140px';
  w2ScaleInput.style.display = 'block';

  const w2AlgoLabel = document.createElement('label');
  w2AlgoLabel.style.display = 'block';
  w2AlgoLabel.style.marginTop = '8px';
  w2AlgoLabel.appendChild(document.createTextNode('Algorithm '));
  const w2AlgoSelect = document.createElement('select');
  w2AlgoSelect.style.cssText = 'margin-left:4px;font-size:12px;background:#333;color:#eee;border:1px solid #666;border-radius:4px;padding:2px 6px;';
  w2AlgoSelect.innerHTML = '<option value="mc">MC</option><option value="extended">MC Extended</option><option value="transvoxel">Transvoxel</option><option value="transvoxelVS">Transvoxel (VS)</option><option value="transvoxelExtended">Transvoxel Extended</option>';
  w2AlgoSelect.value = world2State.algorithm;
  w2AlgoLabel.appendChild(w2AlgoSelect);

  const gridLabel = document.createElement('div');
  gridLabel.style.marginTop = '8px';
  gridLabel.style.fontWeight = '600';
  gridLabel.textContent = 'Chunk grid';
  const w2GridXLabel = document.createElement('label');
  w2GridXLabel.style.display = 'block';
  const w2GridXSpan = document.createElement('span');
  w2GridXSpan.textContent = world2State.gridX;
  w2GridXLabel.appendChild(document.createTextNode('X '));
  w2GridXLabel.appendChild(w2GridXSpan);
  const w2GridXInput = document.createElement('input');
  w2GridXInput.type = 'range';
  w2GridXInput.min = '1';
  w2GridXInput.max = '6';
  w2GridXInput.value = String(world2State.gridX);
  w2GridXInput.style.width = '140px';
  w2GridXInput.style.display = 'block';
  const w2GridYLabel = document.createElement('label');
  w2GridYLabel.style.display = 'block';
  const w2GridYSpan = document.createElement('span');
  w2GridYSpan.textContent = world2State.gridY;
  w2GridYLabel.appendChild(document.createTextNode('Y '));
  w2GridYLabel.appendChild(w2GridYSpan);
  const w2GridYInput = document.createElement('input');
  w2GridYInput.type = 'range';
  w2GridYInput.min = '1';
  w2GridYInput.max = '6';
  w2GridYInput.value = String(world2State.gridY);
  w2GridYInput.style.width = '140px';
  w2GridYInput.style.display = 'block';
  const w2GridZLabel = document.createElement('label');
  w2GridZLabel.style.display = 'block';
  const w2GridZSpan = document.createElement('span');
  w2GridZSpan.textContent = world2State.gridZ;
  w2GridZLabel.appendChild(document.createTextNode('Z '));
  w2GridZLabel.appendChild(w2GridZSpan);
  const w2GridZInput = document.createElement('input');
  w2GridZInput.type = 'range';
  w2GridZInput.min = '1';
  w2GridZInput.max = '6';
  w2GridZInput.value = String(world2State.gridZ);
  w2GridZInput.style.width = '140px';
  w2GridZInput.style.display = 'block';

  const w2PerlinLabel = document.createElement('label');
  w2PerlinLabel.style.display = 'block';
  w2PerlinLabel.style.marginTop = '8px';
  const w2PerlinSpan = document.createElement('span');
  w2PerlinSpan.textContent = world2State.perlin3DFrequency.toFixed(1);
  w2PerlinLabel.appendChild(document.createTextNode('3D Perlin frequency '));
  w2PerlinLabel.appendChild(w2PerlinSpan);
  const w2PerlinInput = document.createElement('input');
  w2PerlinInput.type = 'range';
  w2PerlinInput.min = '0.5';
  w2PerlinInput.max = '5';
  w2PerlinInput.step = '0.25';
  w2PerlinInput.value = String(world2State.perlin3DFrequency);
  w2PerlinInput.style.width = '140px';
  w2PerlinInput.style.display = 'block';

  const w2FeatureAngleLabel = document.createElement('label');
  w2FeatureAngleLabel.style.display = 'block';
  w2FeatureAngleLabel.style.marginTop = '8px';
  const w2FeatureAngleSpan = document.createElement('span');
  w2FeatureAngleSpan.textContent = world2State.featureAngleDeg + '°';
  w2FeatureAngleLabel.appendChild(document.createTextNode('Feature angle '));
  w2FeatureAngleLabel.appendChild(w2FeatureAngleSpan);
  const w2FeatureAngleInput = document.createElement('input');
  w2FeatureAngleInput.type = 'range';
  w2FeatureAngleInput.min = '0';
  w2FeatureAngleInput.max = '90';
  w2FeatureAngleInput.step = '5';
  w2FeatureAngleInput.value = String(world2State.featureAngleDeg);
  w2FeatureAngleInput.style.width = '140px';
  w2FeatureAngleInput.style.display = 'block';
  w2FeatureAngleInput.title = 'Sharp-feature detection angle (MC Extended / Transvoxel Extended)';

  const flipEdgesLabelW2 = document.createElement('label');
  flipEdgesLabelW2.style.display = 'block';
  flipEdgesLabelW2.style.marginTop = '10px';
  flipEdgesLabelW2.style.cursor = 'pointer';
  const flipEdgesCheckW2 = document.createElement('input');
  flipEdgesCheckW2.type = 'checkbox';
  flipEdgesCheckW2.checked = world2State.flipEdges;
  flipEdgesCheckW2.style.marginRight = '6px';
  flipEdgesLabelW2.appendChild(flipEdgesCheckW2);
  flipEdgesLabelW2.appendChild(document.createTextNode('Triangle flip'));

  const noFeaturesLabelW2 = document.createElement('label');
  noFeaturesLabelW2.style.display = 'block';
  noFeaturesLabelW2.style.marginTop = '8px';
  noFeaturesLabelW2.style.cursor = 'pointer';
  const noFeaturesCheckW2 = document.createElement('input');
  noFeaturesCheckW2.type = 'checkbox';
  noFeaturesCheckW2.checked = world2State.noFeatures;
  noFeaturesCheckW2.style.marginRight = '6px';
  noFeaturesLabelW2.appendChild(noFeaturesCheckW2);
  noFeaturesLabelW2.appendChild(document.createTextNode('No features (override)'));

  world2Section.appendChild(w2ResLabel);
  world2Section.appendChild(w2ResInput);
  world2Section.appendChild(w2IsoLabel);
  world2Section.appendChild(w2IsoInput);
  world2Section.appendChild(w2ScaleLabel);
  world2Section.appendChild(w2ScaleInput);
  world2Section.appendChild(w2AlgoLabel);
  world2Section.appendChild(w2AlgoSelect);
  world2Section.appendChild(gridLabel);
  world2Section.appendChild(w2GridXLabel);
  world2Section.appendChild(w2GridXInput);
  world2Section.appendChild(w2GridYLabel);
  world2Section.appendChild(w2GridYInput);
  world2Section.appendChild(w2GridZLabel);
  world2Section.appendChild(w2GridZInput);
  world2Section.appendChild(w2PerlinLabel);
  world2Section.appendChild(w2PerlinInput);
  world2Section.appendChild(w2FeatureAngleLabel);
  world2Section.appendChild(w2FeatureAngleInput);
  world2Section.appendChild(flipEdgesLabelW2);
  world2Section.appendChild(noFeaturesLabelW2);

  const applyBtn = document.createElement('button');
  applyBtn.textContent = 'Apply';
  applyBtn.style.cssText = 'margin-top:10px;padding:6px 12px;cursor:pointer;background:#444;color:#eee;border:1px solid #666;border-radius:4px;font-size:12px;';

  featureAngleInputW1.addEventListener('input', () => { featureAngleSpanW1.textContent = featureAngleInputW1.value + '°'; });
  resInput.addEventListener('input', () => { resValueSpan.textContent = resInput.value; });
  isoInput.addEventListener('input', () => { isoValueSpan.textContent = Number(isoInput.value).toFixed(2); });
  scaleInput.addEventListener('input', () => { scaleValueSpan.textContent = Number(scaleInput.value).toFixed(1); });
  perlinBaseInput.addEventListener('input', () => { perlinBaseSpan.textContent = Number(perlinBaseInput.value).toFixed(2); });
  perlinAmpInput.addEventListener('input', () => { perlinAmpSpan.textContent = Number(perlinAmpInput.value).toFixed(2); });
  perlinFreqInput.addEventListener('input', () => { perlinFreqSpan.textContent = Number(perlinFreqInput.value).toFixed(1); });
  w2ResInput.addEventListener('input', () => { w2ResSpan.textContent = w2ResInput.value; });
  w2IsoInput.addEventListener('input', () => { w2IsoSpan.textContent = Number(w2IsoInput.value).toFixed(2); });
  w2ScaleInput.addEventListener('input', () => { w2ScaleSpan.textContent = Number(w2ScaleInput.value).toFixed(1); });
  w2GridXInput.addEventListener('input', () => { w2GridXSpan.textContent = w2GridXInput.value; });
  w2GridYInput.addEventListener('input', () => { w2GridYSpan.textContent = w2GridYInput.value; });
  w2GridZInput.addEventListener('input', () => { w2GridZSpan.textContent = w2GridZInput.value; });
  w2PerlinInput.addEventListener('input', () => { w2PerlinSpan.textContent = Number(w2PerlinInput.value).toFixed(1); });
  w2FeatureAngleInput.addEventListener('input', () => { w2FeatureAngleSpan.textContent = w2FeatureAngleInput.value + '°'; });

  function showSectionForWorld() {
    const w = parseInt(worldSelect.value, 10);
    currentWorld.value = w;
    world1Section.style.display = (w === 1) ? 'block' : 'none';
    world2Section.style.display = (w === 2) ? 'block' : 'none';
    setWorldVisibility();
  }
  worldSelect.addEventListener('change', showSectionForWorld);

  panel.appendChild(world1Section);
  panel.appendChild(world2Section);
  panel.appendChild(applyBtn);
  document.body.appendChild(panel);

  window.rebuildChunkMeshes = function rebuildChunkMeshes() {
    const w = currentWorld.value;
    if (w === 1) {
      world1State.resolution = Math.max(6, parseInt(resInput.value, 10) || 24);
      world1State.iso = Number(isoInput.value) || 0;
      world1State.sdfChoice = Math.max(1, Math.min(4, parseInt(sdfSelect.value, 10) || 1));
      world1State.chunkScale = Math.max(0.25, Math.min(3, Number(scaleInput.value) || 1));
      world1State.perlinBase = Math.max(0, Math.min(0.5, Number(perlinBaseInput.value) || 0.25));
      world1State.perlinAmplitude = Math.max(0.1, Math.min(0.8, Number(perlinAmpInput.value) || 0.4));
      world1State.perlinFrequency = Math.max(0.5, Math.min(10, Number(perlinFreqInput.value) || 3));
      world1State.flipEdges = flipEdgesCheckW1.checked;
      world1State.noFeatures = noFeaturesCheckW1.checked;
      world1State.featureAngleDeg = (() => { const v = parseInt(featureAngleInputW1.value, 10); return Math.max(0, Math.min(90, isNaN(v) ? 30 : v)); })();
      resInput.value = String(world1State.resolution);
      isoInput.value = String(world1State.iso);
      sdfSelect.value = String(world1State.sdfChoice);
      scaleInput.value = String(world1State.chunkScale);
      perlinBaseInput.value = String(world1State.perlinBase);
      perlinAmpInput.value = String(world1State.perlinAmplitude);
      perlinFreqInput.value = String(world1State.perlinFrequency);
      resValueSpan.textContent = world1State.resolution;
      isoValueSpan.textContent = world1State.iso.toFixed(2);
      scaleValueSpan.textContent = world1State.chunkScale.toFixed(1);
      perlinBaseSpan.textContent = world1State.perlinBase.toFixed(2);
      perlinAmpSpan.textContent = world1State.perlinAmplitude.toFixed(2);
      perlinFreqSpan.textContent = world1State.perlinFrequency.toFixed(1);
      featureAngleInputW1.value = String(world1State.featureAngleDeg);
      featureAngleSpanW1.textContent = world1State.featureAngleDeg + '°';
      noFeaturesCheckW1.checked = world1State.noFeatures;

      const mcRes = world1State.resolution;
      const scale = world1State.chunkScale;
      const iso = world1State.iso;
      const fieldFn = getFieldFn();

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
      const transvoxelVSResult = runTransvoxelInteriorVertexSharing(mcRes, iso, fieldFn);
      const tvSharedMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelVSResult, { center: true });
      if (tvSharedMesh && chunkState.tvSharedEntity && chunkState.materials.tvShared) {
        chunkState.tvSharedEntity.render.meshInstances = [new pc.MeshInstance(tvSharedMesh, chunkState.materials.tvShared)];
      }
      const transvoxelExtResult = runTransvoxelExtended(mcRes, iso, fieldFn, { flipEdges: world1State.flipEdges, featureAngleDeg: world1State.featureAngleDeg, noFeatures: world1State.noFeatures });
      const tvxMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelExtResult, { center: true });
      if (tvxMesh && chunkState.tvxEntity && chunkState.materials.tvx) {
        chunkState.tvxEntity.render.meshInstances = [new pc.MeshInstance(tvxMesh, chunkState.materials.tvx)];
      }
      const extendedResult = runExtendedMarchingCubes(mcRes, iso, fieldFn, world1State.flipEdges, { featureAngleDeg: world1State.featureAngleDeg, noFeatures: world1State.noFeatures });
      const extendedMesh = createMeshFromMCResult(app.graphicsDevice, extendedResult, { center: true });
      if (extendedMesh && chunkState.extendedEntity && chunkState.materials.extended) {
        chunkState.extendedEntity.render.meshInstances = [new pc.MeshInstance(extendedMesh, chunkState.materials.extended)];
      }
      const pos = getMeshPositions();
      if (chunkState.mcEntity) { chunkState.mcEntity.setPosition(pos[0], 0, 0); chunkState.mcEntity.setLocalScale(scale, scale, scale); }
      if (chunkState.extendedEntity) { chunkState.extendedEntity.setPosition(pos[1], 0, 0); chunkState.extendedEntity.setLocalScale(scale, scale, scale); }
      if (chunkState.tvEntity) { chunkState.tvEntity.setPosition(pos[2], 0, 0); chunkState.tvEntity.setLocalScale(scale, scale, scale); }
      if (chunkState.tvSharedEntity) { chunkState.tvSharedEntity.setPosition(pos[3], 0, 0); chunkState.tvSharedEntity.setLocalScale(scale, scale, scale); }
      if (chunkState.tvxEntity) { chunkState.tvxEntity.setPosition(pos[4], 0, 0); chunkState.tvxEntity.setLocalScale(scale, scale, scale); }
      console.log('World 1 rebuilt: resolution=', mcRes, 'iso=', iso, 'sdf=', world1State.sdfChoice, 'scale=', scale);
    } else {
      world2State.resolution = Math.max(6, Math.min(40, parseInt(w2ResInput.value, 10) || 20));
      world2State.iso = Math.max(0.2, Math.min(0.8, Number(w2IsoInput.value) || 0.5));
      world2State.chunkScale = Math.max(0.25, Math.min(3, Number(w2ScaleInput.value) || 1));
      world2State.gridX = Math.max(1, Math.min(6, parseInt(w2GridXInput.value, 10) || 2));
      world2State.gridY = Math.max(1, Math.min(6, parseInt(w2GridYInput.value, 10) || 2));
      world2State.gridZ = Math.max(1, Math.min(6, parseInt(w2GridZInput.value, 10) || 2));
      world2State.perlin3DFrequency = Math.max(0.5, Math.min(5, Number(w2PerlinInput.value) || 2));
      world2State.flipEdges = flipEdgesCheckW2.checked;
      world2State.noFeatures = noFeaturesCheckW2.checked;
      world2State.featureAngleDeg = (() => { const v = parseInt(w2FeatureAngleInput.value, 10); return Math.max(0, Math.min(90, isNaN(v) ? 30 : v)); })();
      world2State.algorithm = w2AlgoSelect.value || 'transvoxelExtended';
      w2ResInput.value = String(world2State.resolution);
      w2IsoInput.value = String(world2State.iso);
      w2ScaleInput.value = String(world2State.chunkScale);
      w2GridXInput.value = String(world2State.gridX);
      w2GridYInput.value = String(world2State.gridY);
      w2GridZInput.value = String(world2State.gridZ);
      w2PerlinInput.value = String(world2State.perlin3DFrequency);
      w2FeatureAngleInput.value = String(world2State.featureAngleDeg);
      w2FeatureAngleSpan.textContent = world2State.featureAngleDeg + '°';
      noFeaturesCheckW2.checked = world2State.noFeatures;
      w2ResSpan.textContent = world2State.resolution;
      w2IsoSpan.textContent = world2State.iso.toFixed(2);
      w2ScaleSpan.textContent = world2State.chunkScale.toFixed(1);
      w2GridXSpan.textContent = world2State.gridX;
      w2GridYSpan.textContent = world2State.gridY;
      w2GridZSpan.textContent = world2State.gridZ;
      w2PerlinSpan.textContent = world2State.perlin3DFrequency.toFixed(1);
      w2AlgoSelect.value = world2State.algorithm;

      const mcRes = world2State.resolution;
      const scale = world2State.chunkScale;
      const iso = world2State.iso;
      const gx = world2State.gridX;
      const gy = world2State.gridY;
      const gz = world2State.gridZ;
      const freq = world2State.perlin3DFrequency;
      const opts = { frequency: freq };

      const terrainRoot = chunkState.terrainRoot;
      if (!terrainRoot) return;
      while (chunkState.tvxChunkEntities.length) {
        const e = chunkState.tvxChunkEntities.pop();
        if (e && e.parent) e.parent.removeChild(e);
      }
      const halfX = (gx - 1) * 0.5;
      const halfY = (gy - 1) * 0.5;
      const halfZ = (gz - 1) * 0.5;
      const algo = world2State.algorithm;
      const flip = world2State.flipEdges;
      const runAlgo = (fieldFn) => {
        if (algo === 'mc') return runMarchingCubes(mcRes, iso, fieldFn);
        if (algo === 'extended') return runExtendedMarchingCubes(mcRes, iso, fieldFn, flip, { featureAngleDeg: world2State.featureAngleDeg, noFeatures: world2State.noFeatures });
        if (algo === 'transvoxel') return runTransvoxelInterior(mcRes, iso, fieldFn);
        if (algo === 'transvoxelVS') return runTransvoxelInteriorVertexSharing(mcRes, iso, fieldFn);
        return runTransvoxelExtended(mcRes, iso, fieldFn, { flipEdges: flip, featureAngleDeg: world2State.featureAngleDeg, noFeatures: world2State.noFeatures });
      };
      const algoMaterialKey = { mc: 'mc', extended: 'extended', transvoxel: 'tv', transvoxelVS: 'tvShared', transvoxelExtended: 'tvx' }[algo] || 'tvx';
      const terrainMat = chunkState.materials[algoMaterialKey];

      for (let cz = 0; cz < gz; cz++) {
        for (let cy = 0; cy < gy; cy++) {
          for (let cx = 0; cx < gx; cx++) {
            const fieldFn = createPerlin3DField(opts, cx, cy, cz);
            const result = runAlgo(fieldFn);
            const mesh = createMeshFromMCResult(app.graphicsDevice, result, { center: true });
            if (!mesh) continue;
            const entity = new pc.Entity('Chunk ' + cx + ',' + cy + ',' + cz);
            entity.setPosition((cx - halfX) * scale, (cy - halfY) * scale, (cz - halfZ) * scale);
            entity.setLocalScale(scale, scale, scale);
            entity.addComponent('render');
            entity.render.type = 'asset';
            entity.render.meshInstances = [new pc.MeshInstance(mesh, terrainMat)];
            terrainRoot.addChild(entity);
            chunkState.tvxChunkEntities.push(entity);
          }
        }
      }
      console.log('World 2 rebuilt: grid=', gx, 'x', gy, 'x', gz, 'resolution=', mcRes, 'iso=', iso, 'scale=', scale);
    }
    setWorldVisibility();
  };

  applyBtn.addEventListener('click', window.rebuildChunkMeshes);
})();

const compareRoot = new pc.Entity('Compare Root');
app.root.addChild(compareRoot);
chunkState.compareRoot = compareRoot;

const terrainRoot = new pc.Entity('TVx Terrain Root');
terrainRoot.enabled = false;
app.root.addChild(terrainRoot);
chunkState.terrainRoot = terrainRoot;

// Default cube (only visible in World 1)
const defaultBox = new pc.Entity('Default Box');
defaultBox.setPosition(0, 4, 0);
defaultBox.addComponent('render', { type: 'box' });
defaultBox.render.material.diffuse = new pc.Color(0.9, 0.25, 0.2);
defaultBox.render.material.update();
compareRoot.addChild(defaultBox);

// Create materials once (shared across rebuilds)
function createChunkMaterials() {
  let mc, tv, tvShared, tvx, extended;
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
    tvShared = new pc.StandardMaterial();
    tvShared.diffuse = new pc.Color(0.15, 0.75, 0.75);
  } catch (_) {
    tvShared = defaultBox.render.material.clone();
    tvShared.diffuse = new pc.Color(0.15, 0.75, 0.75);
  }
  tvShared.cull = pc.CULLFACE_NONE;
  tvShared.update();

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

  return { mc, tv, tvShared, tvx, extended };
}

chunkState.materials = createChunkMaterials();

const mcRes = world1State.resolution;
const iso = world1State.iso;
const fieldFn = getFieldFn();

const mcResult = runMarchingCubes(mcRes, iso, fieldFn);
console.log('MC result:', mcResult.vertices.length / 6, 'vertices,', mcResult.indices.length / 3, 'triangles');

const meshPos = getMeshPositions();

const initialScale = world1State.chunkScale;
const mesh = createMeshFromMCResult(app.graphicsDevice, mcResult, { center: true });
if (mesh) {
  const mcEntity = new pc.Entity('MC Cube');
  mcEntity.setPosition(meshPos[0], 0, 0);
  mcEntity.setLocalScale(initialScale, initialScale, initialScale);
  mcEntity.addComponent('render');
  mcEntity.render.type = 'asset';
  mcEntity.render.meshInstances = [new pc.MeshInstance(mesh, chunkState.materials.mc)];
  compareRoot.addChild(mcEntity);
  chunkState.mcEntity = mcEntity;
}

const transvoxelResult = runTransvoxelInterior(mcRes, iso, fieldFn);
console.log('Transvoxel result:', transvoxelResult.vertices.length / 6, 'vertices,', transvoxelResult.indices.length / 3, 'triangles');

const transvoxelMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelResult, { center: true });
if (transvoxelMesh) {
  const tvEntity = new pc.Entity('Transvoxel Cube');
  tvEntity.setPosition(meshPos[2], 0, 0);
  tvEntity.setLocalScale(initialScale, initialScale, initialScale);
  tvEntity.addComponent('render');
  tvEntity.render.type = 'asset';
  tvEntity.render.meshInstances = [new pc.MeshInstance(transvoxelMesh, chunkState.materials.tv)];
  compareRoot.addChild(tvEntity);
  chunkState.tvEntity = tvEntity;
}

const transvoxelVSResult = runTransvoxelInteriorVertexSharing(mcRes, iso, fieldFn);
console.log('Transvoxel (vertex-sharing) result:', transvoxelVSResult.vertices.length / 6, 'vertices,', transvoxelVSResult.indices.length / 3, 'triangles');

const transvoxelVSMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelVSResult, { center: true });
if (transvoxelVSMesh) {
  const tvSharedEntity = new pc.Entity('Transvoxel VS Cube');
  tvSharedEntity.setPosition(meshPos[3], 0, 0);
  tvSharedEntity.setLocalScale(initialScale, initialScale, initialScale);
  tvSharedEntity.addComponent('render');
  tvSharedEntity.render.type = 'asset';
  tvSharedEntity.render.meshInstances = [new pc.MeshInstance(transvoxelVSMesh, chunkState.materials.tvShared)];
  compareRoot.addChild(tvSharedEntity);
  chunkState.tvSharedEntity = tvSharedEntity;
}

const transvoxelExtResult = runTransvoxelExtended(mcRes, iso, fieldFn, { flipEdges: true });
console.log('Transvoxel Extended result:', transvoxelExtResult.vertices.length / 6, 'vertices,', transvoxelExtResult.indices.length / 3, 'triangles');

const transvoxelExtMesh = createMeshFromMCResult(app.graphicsDevice, transvoxelExtResult, { center: true });
if (transvoxelExtMesh) {
  const tvxEntity = new pc.Entity('Transvoxel Extended Cube');
  tvxEntity.setPosition(meshPos[4], 0, 0);
  tvxEntity.setLocalScale(initialScale, initialScale, initialScale);
  tvxEntity.addComponent('render');
  tvxEntity.render.type = 'asset';
  tvxEntity.render.meshInstances = [new pc.MeshInstance(transvoxelExtMesh, chunkState.materials.tvx)];
  compareRoot.addChild(tvxEntity);
  chunkState.tvxEntity = tvxEntity;
}

const extendedResult = runExtendedMarchingCubes(mcRes, iso, fieldFn, true);
console.log('Extended MC result:', extendedResult.vertices.length / 6, 'vertices,', extendedResult.indices.length / 3, 'triangles');

const extendedMesh = createMeshFromMCResult(app.graphicsDevice, extendedResult, { center: true });
if (extendedMesh) {
  const extendedEntity = new pc.Entity('MC Extended Cube');
  extendedEntity.setPosition(meshPos[1], 0, 0);
  extendedEntity.setLocalScale(initialScale, initialScale, initialScale);
  extendedEntity.addComponent('render');
  extendedEntity.render.type = 'asset';
  extendedEntity.render.meshInstances = [new pc.MeshInstance(extendedMesh, chunkState.materials.extended)];
  compareRoot.addChild(extendedEntity);
  chunkState.extendedEntity = extendedEntity;
}

// 3D text labels: canvas texture on a quad, billboarded toward camera
const labelHeight = 0.9;
const labelScale = 0.35; // world-space width of label quad

function createTextTexture(device, text) {
  const padding = 8;
  const fontSize = 52;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const metrics = ctx.measureText(text);
  const w = Math.max(64, Math.ceil(metrics.width) + padding * 2);
  const h = fontSize + padding * 2;
  canvas.width = w;
  canvas.height = h;
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, w, h);
  // outline
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, w / 2, h / 2);
  const texture = new pc.Texture(device, {
    width: w,
    height: h,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: false,
    minFilter: pc.FILTER_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP,
    addressV: pc.ADDRESS_CLAMP,
    flipY: false // canvas (0,0) = top-left; keep as-is so UVs match
  });
  texture.setSource(canvas);
  texture.upload(); // force upload now to avoid lazy init / white quad on first frame
  return texture;
}

function createLabelQuad(app, text, parentEntity) {
  const device = app.graphicsDevice;
  const texture = createTextTexture(device, text);
  const mesh = new pc.Mesh(device);
  const h = labelScale * 0.5;
  const aspect = texture.width / texture.height;
  const w = h * aspect;
  const positions = new Float32Array([
    -w, -h, 0,
    w, -h, 0,
    w, h, 0,
    -w, h, 0
  ]);
  const uvs = new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]); // quad facing +Z
  mesh.setPositions(positions);
  mesh.setNormals(pc.calculateNormals(positions, indices));
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update();

  const mat = new pc.StandardMaterial();
  mat.diffuseMap = texture;
  mat.diffuse = new pc.Color(1, 1, 1);
  mat.emissiveMap = texture; // unlit: show texture as emissive so it's visible without lights
  mat.emissive = new pc.Color(1, 1, 1);
  mat.opacity = 1;
  mat.blendType = pc.BLEND_NORMAL;
  mat.cull = pc.CULLFACE_NONE;
  mat.useLighting = false;
  mat.update();

  const entity = new pc.Entity('Label');
  entity.addComponent('render');
  entity.render.type = 'asset';
  entity.render.meshInstances = [new pc.MeshInstance(mesh, mat)];
  entity.setLocalPosition(0, labelHeight, 0);
  parentEntity.addChild(entity);
  return entity;
}

const labelConfig = [
  { entity: () => chunkState.mcEntity, text: 'MC' },
  { entity: () => chunkState.extendedEntity, text: 'MC Extended' },
  { entity: () => chunkState.tvEntity, text: 'Transvoxel' },
  { entity: () => chunkState.tvSharedEntity, text: 'Transvoxel (VS)' },
  { entity: () => chunkState.tvxEntity, text: 'Transvoxel Extended' }
];

const labelEntities = [];
labelConfig.forEach(({ entity, text }) => {
  const parent = entity();
  if (parent) {
    labelEntities.push(createLabelQuad(app, text, parent));
  }
});

app.on('update', () => {
  const camEntity = camera;
  if (!camEntity || !camEntity.getPosition) return;
  const camPos = camEntity.getPosition();
  labelEntities.forEach((label) => {
    label.lookAt(camPos);
    label.rotateLocal(0, 180, 0); // quad faces +Z; lookAt uses -Z, so flip to face camera
  });
});
