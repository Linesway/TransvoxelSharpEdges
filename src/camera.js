/**
 * FPS-style fly camera: WASD move, mouse drag look.
 */
import * as pc from 'playcanvas';

/**
 * @param {pc.Application} app
 * @param {HTMLCanvasElement} canvas
 * @returns {{ camera: pc.Entity; update: (dt: number) => void } | pc.Entity}
 */
export function createFpsCamera(app, canvas) {
  const camera = new pc.Entity('Camera');
  camera.addComponent('camera', {
    clearColor: new pc.Color(0.2, 0.2, 0.28),
    fov: 45,
    nearClip: 0.1,
    farClip: 100
  });
  app.root.addChild(camera);

  let camX = 0, camY = 0, camZ = 3;
  let yaw = 0;
  let pitch = 0;
  const moveSpeed = 6;
  const mouseSensitivity = 0.002;
  let drag = false;
  let lastMouseX = 0, lastMouseY = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      drag = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }
  });
  window.addEventListener('mouseup', () => { drag = false; });
  window.addEventListener('mouseleave', () => { drag = false; });
  canvas.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    yaw -= dx * mouseSensitivity;
    pitch -= dy * mouseSensitivity;
    pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  });

  app.on('update', (dt) => {
    const cy = Math.cos(pitch);
    const forward = new pc.Vec3(-Math.sin(yaw) * cy, Math.sin(pitch), -Math.cos(yaw) * cy);
    const right = new pc.Vec3(Math.cos(yaw), 0, -Math.sin(yaw));

    let dx = 0, dy = 0, dz = 0;
    if (app.keyboard.isPressed(pc.KEY_W)) { dx += forward.x; dy += forward.y; dz += forward.z; }
    if (app.keyboard.isPressed(pc.KEY_S)) { dx -= forward.x; dy -= forward.y; dz -= forward.z; }
    if (app.keyboard.isPressed(pc.KEY_A)) { dx -= right.x; dz -= right.z; }
    if (app.keyboard.isPressed(pc.KEY_D)) { dx += right.x; dz += right.z; }
    if (app.keyboard.isPressed(pc.KEY_E)) { dy += 1; }
    if (app.keyboard.isPressed(pc.KEY_Q)) { dy -= 1; }

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len > 0) {
      const scale = (moveSpeed * dt) / len;
      camX += dx * scale;
      camY += dy * scale;
      camZ += dz * scale;
    }

    camera.setPosition(camX, camY, camZ);
    const target = new pc.Vec3(camX + forward.x, camY + forward.y, camZ + forward.z);
    camera.lookAt(target, new pc.Vec3(0, 1, 0));
  });

  return camera;
}
