# Cube viewer (PlayCanvas)

Lit cube with orbit camera. No WebGPU; works in any modern browser.

## Run locally

Use a local HTTP server (ES modules don’t work from `file://`):

```bash
# From this directory
python -m http.server 3344
```

Then open **http://localhost:3344** in your browser. The cube viewer loads by default.

## Controls (FPS-style)

- **Mouse drag:** look around (yaw/pitch)
- **W / S:** move forward / backward
- **A / D:** strafe left / right
- **Q / E:** move down / up (world vertical)
