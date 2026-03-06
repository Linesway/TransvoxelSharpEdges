# TransvoxelSharpEdges — Marching Cubes viewer

PlayCanvas viewer: FPS camera + marching-cubes SDF mesh. No WebGPU; runs in any modern browser.

![Extended marching cubes: sharp cube (blue) and classic MC cube (green)](screenshots/Screenshot%202026-03-05%20231635.png)

## Run

1. **Double‑click `run-server.bat`** (in this folder).
2. **Open in your browser:** [http://127.0.0.1:3344/](http://127.0.0.1:3344/) or [http://localhost:3344](http://localhost:3344)
3. Leave the server window open while you use the app.

*(Requires Python. If you don’t have it: [python.org](https://www.python.org/downloads/).)*

---

## Layout

```
TransvoxelSharpEdges/
├── index.html          # Entry page, loads src/main.js
├── README.md
├── src/
│   ├── main.js         # App entry, camera, lights, MC mesh
│   ├── noise/
│   │   └── sdf.js      # SDF primitives (box, cube, insidePositive)
│   ├── camera/
│   │   └── camera.js   # FPS fly camera
│   ├── mc/
│   │   ├── marching-cubes.js        # Classic MC (edge + tri table)
│   │   ├── marching-cubes-extended.js  # Extended MC (polygon table)
│   │   └── mc-mesh.js               # Build PlayCanvas mesh from MC result
│   └── tables/
│       ├── edge-table.js    # edgeTable[256]
│       ├── tri-table.js     # triTable[256] (classic triangles)
│       ├── polygon-tables.js # polyTable + polygonTable (re-exports)
│       └── mc-tables.js     # Full extended tables (edge + poly + polygon)
└── scripts/
    └── extract_tri_table.py # Generate tri-table.js from C++ reference
```

## Controls (FPS-style)

- **Mouse drag:** look around (yaw/pitch)
- **W / S:** move forward / backward
- **A / D:** strafe left / right
- **Q / E:** move down / up (world vertical)
