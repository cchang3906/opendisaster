# OpenDisaster — Project Status

## Completed Milestones

### M1: Rendering Foundation
- Three.js renderer with WebGPU backend (WebGL2 fallback)
- `Engine.ts`: scene, PerspectiveCamera, OrbitControls, hemisphere + directional lighting, shadow maps
- Bun.serve() dev server with HMR at localhost:3000
- HTML entry point imports `src/main.ts` directly

### M2: ECS World + Event Bus + Materials
- **bitECS v0.4** world with fixed-timestep accumulator (1/60s ticks, max 10 per frame, spiral-of-death cap)
- 9 SoA components using raw TypedArrays (bitECS v0.4 API — no `defineComponent`/`Types`):
  - Position (Float64), Rotation (Float32 quat), Scale, Velocity, MeshRef, PhysicsBody, Health, Classification, TerrainCell
- Typed EventBus: 6 disaster event types (GROUND_SHAKE, GROUND_DISPLACEMENT, STRUCTURE_COLLAPSE, FLOOD_LEVEL, FIRE_SPREAD, WIND_FIELD_UPDATE), wildcard listener, `once()`
- MaterialRegistry: 8 built-in materials (concrete, wood, glass, steel, soil, water, asphalt, vegetation) with physics properties

### M3: Mesh Import + Auto-Classification
- GLTFImporter wrapping Three.js GLTFLoader + DRACOLoader
- MeshClassifier: name-based pattern matching + geometry heuristics (aspect ratio, normal direction, closedness, color)
- MeshDecomposer: classified meshes to ECS entities
- Currently bypassed in main.ts — direct GLTFLoader used for the hardcoded campus scene

### M4: Terrain System (partial)
- TerrainData class: Float32Array heightmap, bilinear interpolation, cosine-bell deformation, central-difference normals, slope calculation
- Pure logic layer only — not yet wired to GPU displacement or visual terrain mesh

### M5: Physics + Destruction (skeleton)
- PhysicsSystem: Jolt WASM wrapper structure, body creation, impulse, ECS sync
- DestructionSystem: listens for STRUCTURE_COLLAPSE, simple box-based fracture placeholder
- RenderSystem: ECS-to-Three.js transform sync with interpolation
- Not yet wired into the live scene

### Campus Scene Generation
- `scripts/generate-campus.ts`: fetches real building footprints, trees, vegetation areas, water features, and fountains from OpenStreetMap Overpass API
- Custom GLB binary encoder (no browser dependency — runs in Bun)
- Current GLB: 1202 meshes, 3.26 MB
  - 275 buildings (extruded from OSM footprints with height estimation)
  - 432 trees (cylinder trunk + sphere canopy)
  - 57 vegetation areas (parks, lawns, gardens)
  - 1 water area, 2 fountains
  - 1 ground terrain plane
  - 12 material colors

## Test Coverage

104 tests passing across 6 test files:
- `src/core/__tests__/EventBus.test.ts`
- `src/core/__tests__/MaterialRegistry.test.ts`
- `src/core/__tests__/Components.test.ts`
- `src/core/__tests__/World.test.ts`
- `src/mesh/__tests__/MeshClassifier.test.ts`
- `src/systems/__tests__/TerrainSystem.test.ts`

## Current State

The app renders the Columbia University campus at localhost:3000 with:
- WebGPU backend (automatic WebGL2 fallback)
- 275 buildings with height/color variation
- 432 trees with trunk + canopy geometry
- 57 vegetation patches (Morningside Park, Furnald Lawn, etc.)
- Water features and fountains
- Orbit camera controls
- Shadow mapping

## Not Yet Started

- M6: GPU Particle System (WebGPU compute)
- M7: Fluid System (shallow water equations)
- M8: Cellular Automata compute framework
- M9: Disaster Module infrastructure + UI
- M10–M15: Individual disaster modules
- M16: Cascading events + polish
