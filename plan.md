# OpenDisaster Implementation Plan

## Architecture Overview

Client-only multi-disaster physics simulator. Bun.serve() dev server, Three.js WebGPURenderer, Jolt Physics WASM, bitECS, WebGPU compute shaders. Six disaster modules as plugins sharing common terrain/particle/fluid infrastructure.

```
opendisaster/
├── index.ts                    # Bun.serve() entry
├── index.html                  # HTML entry, imports main.ts
├── src/
│   ├── main.ts                 # Frontend boot: engine init, UI bind
│   ├── core/
│   │   ├── Engine.ts           # WebGPURenderer, scene, camera, render loop
│   │   ├── World.ts            # bitECS world, fixed-timestep loop
│   │   ├── Components.ts       # All ECS component definitions
│   │   ├── EventBus.ts         # Typed pub/sub for disaster cascading
│   │   └── MaterialRegistry.ts # Physics material properties (concrete, wood, etc.)
│   ├── mesh/
│   │   ├── GLTFImporter.ts     # Load GLB/GLTF, return classified entities
│   │   ├── MeshClassifier.ts   # Heuristic auto-classify: building/ground/vegetation
│   │   └── MeshDecomposer.ts   # Split classified groups into ECS entities
│   ├── systems/
│   │   ├── RenderSystem.ts     # Sync ECS transform → Three.js Object3D
│   │   ├── TerrainSystem.ts    # Heightmap terrain, GPU displacement, deformation
│   │   ├── PhysicsSystem.ts    # Jolt Physics wrapper, rigid body management
│   │   ├── ParticleSystem.ts   # WebGPU compute particle sim + rendering
│   │   ├── FluidSystem.ts      # SWE compute shader + mesh generation
│   │   └── DestructionSystem.ts# Voronoi fracture, collapse triggers
│   ├── disasters/
│   │   ├── DisasterModule.ts   # Base interface + registry
│   │   ├── earthquake/
│   │   │   ├── EarthquakeModule.ts
│   │   │   ├── GMPEModel.ts        # Ground Motion Prediction Equations
│   │   │   └── SDOFOscillator.ts   # Single-DOF structural response
│   │   ├── tsunami/
│   │   │   ├── TsunamiModule.ts
│   │   │   └── SWECompute.ts       # Shallow water equations GPU kernel
│   │   ├── volcano/
│   │   │   ├── VolcanoModule.ts
│   │   │   ├── LavaCA.ts           # Cellular automata Bingham lava
│   │   │   └── PyroclasticSystem.ts
│   │   ├── landslide/
│   │   │   ├── LandslideModule.ts
│   │   │   └── GranularFlow.ts     # Voellmy depth-averaged model
│   │   ├── tornado/
│   │   │   ├── TornadoModule.ts
│   │   │   └── RankineVortex.ts    # Analytical wind field
│   │   └── wildfire/
│   │       ├── WildfireModule.ts
│   │       └── RothermelCA.ts      # Rothermel spread + cellular automata
│   ├── ui/
│   │   ├── DisasterPanel.ts    # Disaster picker + param controls
│   │   └── SimulationHUD.ts    # Play/pause/speed, stats overlay
│   └── shaders/                # TSL compute shaders (compiled to WGSL/GLSL)
│       ├── swe.compute.ts      # Shallow water equations kernel
│       ├── particle.compute.ts # Generic GPU particle update
│       └── ca.compute.ts       # Cellular automata kernel (fire/lava)
├── public/
│   └── models/                 # Sample GLB files for testing
├── package.json
├── tsconfig.json
└── CLAUDE.md
```

---

## Milestone 1: Rendering Foundation

**Goal:** Three.js WebGPU scene visible in browser, served by Bun.

**Install:**
```
bun install three @types/three
```

**Files:**
- `index.ts` — Bun.serve() with route "/" serving index.html
- `index.html` — HTML shell, `<script type="module" src="./src/main.ts">`
- `src/main.ts` — Create Engine, start render loop
- `src/core/Engine.ts` — WebGPURenderer init (WebGL2 fallback), Scene, PerspectiveCamera, OrbitControls, ambient+directional light, sky hemisphere, ground plane, animation loop with `renderer.setAnimationLoop()`

**Testable outcome:** Browser shows a lit ground plane with orbit camera controls. Console logs WebGPU or WebGL2 backend.

**Key details:**
- `import * as THREE from 'three/webgpu'` for WebGPU path
- `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'`
- Renderer: `antialias: true, forceWebGL: false` — auto WebGPU with WebGL2 fallback
- Ground: `MeshStandardMaterial` on a 100×100 PlaneGeometry
- Resize handler on window resize

---

## Milestone 2: ECS World + Event Bus + Materials

**Goal:** bitECS world running fixed-timestep loop, material registry, typed event bus.

**Install:**
```
bun install bitecs
```

**Files:**
- `src/core/World.ts` — bitECS `createWorld()`, fixed timestep loop (dt=1/60, accumulator pattern), `addSystem()`/`removeSystem()` registration
- `src/core/Components.ts` — SoA component definitions:
  - `Position { x, y, z }` — Float64Array (double precision for km-scale)
  - `Rotation { x, y, z, w }` — Float32Array quaternion
  - `Scale { x, y, z }` — Float32Array
  - `Velocity { x, y, z }` — Float32Array
  - `MeshRef { objectId }` — Uint32Array (index into Three.js object pool)
  - `PhysicsBody { bodyId, mass, materialId }` — rigid body reference
  - `Health { current, max, damageThreshold }` — structural integrity
  - `Classification { type }` — 0=ground, 1=building, 2=vegetation, 3=water, 4=debris
  - `TerrainCell { height, moisture, fuelLoad, temperature }` — per-cell terrain data
- `src/core/EventBus.ts` — Typed publish/subscribe:
  - Events: `GROUND_SHAKE`, `GROUND_DISPLACEMENT`, `STRUCTURE_COLLAPSE`, `FLOOD_LEVEL`, `FIRE_SPREAD`, `WIND_FIELD_UPDATE`
  - Each event has typed payload (e.g., `GROUND_SHAKE: { epicenter: Vec3, magnitude: number, pga: Float32Array }`)
- `src/core/MaterialRegistry.ts` — Material catalog with physics properties:
  - Concrete: density=2400, Young's modulus=30GPa, compressive strength=30MPa, friction=0.6
  - Wood: density=500, modulus=12GPa, strength=40MPa, friction=0.4, flammable=true, ignitionTemp=300°C
  - Glass: density=2500, modulus=70GPa, strength=45MPa, friction=0.2, brittle=true
  - Steel: density=7800, modulus=200GPa, strength=250MPa, friction=0.5
  - Soil: density=1500, friction=0.7, cohesion=10kPa, frictionAngle=30°
  - Water: density=1000, viscosity=0.001
  - Asphalt: density=2300, friction=0.65, flammable=false

**Testable outcome:** World ticks at fixed 60Hz independent of render rate. Console logs tick count. Event bus unit test: emit GROUND_SHAKE, listener receives typed payload.

---

## Milestone 3: Mesh Import + Auto-Classification

**Goal:** Load any GLB/GLTF, auto-classify meshes as building/ground/vegetation, decompose into ECS entities.

**Files:**
- `src/mesh/GLTFImporter.ts` — Wraps Three.js GLTFLoader. Returns structured scene graph with metadata. Handles Draco/KTX2 compressed meshes.
- `src/mesh/MeshClassifier.ts` — Heuristic classification pipeline:
  1. **Name-based** (highest priority): mesh name contains "building", "house", "wall" → building; "ground", "terrain", "floor" → ground; "tree", "bush", "grass" → vegetation
  2. **Geometry heuristics** (fallback):
     - Compute bounding box aspect ratio: height/footprint > 0.5 → likely building
     - Surface normal analysis: >80% normals pointing up → ground
     - Vertex count + closed mesh test: small closed mesh above ground plane → building
     - Position: meshes at y≈0 with large horizontal extent → ground
  3. **Material hints**: green/brown diffuse → vegetation; gray/flat → building/ground
  4. Returns `ClassifiedMesh { mesh, type: 'building'|'ground'|'vegetation'|'water'|'unknown', confidence: number }`
- `src/mesh/MeshDecomposer.ts` — Takes classified meshes, creates ECS entities:
  - Each building mesh → entity with Position, Rotation, Scale, MeshRef, PhysicsBody, Health, Classification
  - Ground meshes → merged into terrain heightmap or kept as static collision
  - Vegetation → instanced rendering entities (InstancedMesh batching)
  - Assigns MaterialRegistry materials based on classification

**Testable outcome:** Drag-drop a GLB file onto the scene. Console logs classification results. Buildings highlighted in one color, ground in another, vegetation in third. Scene renders the imported model correctly positioned.

**Key details:**
- Use `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`
- DRACOLoader for compressed meshes: `three/addons/loaders/DRACOLoader.js`
- File input via `<input type="file" accept=".glb,.gltf">` or drag-drop
- Classification runs once on import, results cached on entity

---

## Milestone 4: Terrain System

**Goal:** Heightmap-based terrain with GPU displacement, supporting deformation from disasters.

**Files:**
- `src/systems/TerrainSystem.ts`:
  - Creates `PlaneGeometry(1000, 1000, 512, 512)` — 1km × 1km, 512×512 resolution
  - Stores height data in `Float32Array` (262,144 values)
  - GPU path: `DataTexture` as displacement map in vertex shader (via TSL `texture()` node)
  - CPU path: direct vertex position updates for physics-accurate collision
  - Methods: `deform(x, z, radius, delta)` — crater/displacement, `getHeightAt(x, z)` — bilinear interpolated height query
  - Generates from imported ground mesh OR flat plane
  - Normal recalculation after deformation (`computeVertexNormals()`)
  - Terrain material: multi-layer (grass/dirt/rock) based on slope angle via TSL shader

**Testable outcome:** 1km terrain renders with GPU displacement. Click to create deformation craters. Heights query correctly from any world position.

---

## Milestone 5: Physics Engine Integration

**Goal:** Jolt Physics running in Web Worker, rigid bodies for buildings, collision with terrain.

**Install:**
```
bun install jolt-physics
```

**Files:**
- `src/systems/PhysicsSystem.ts`:
  - Initialize Jolt WASM (`import Jolt from 'jolt-physics/wasm-multithread'` or fallback to single-thread)
  - `JoltInterface`, `PhysicsSystem`, `BodyInterface` setup
  - Create static heightfield body from TerrainSystem data
  - `addRigidBody(entity)` — creates Jolt body from entity's mesh bounding box (box/convex hull shape), assigns mass from MaterialRegistry density × volume
  - `step(dt)` — Jolt `PhysicsSystem.Update(dt, collisionSteps)` with substeps
  - `syncToECS()` — copy Jolt body transforms back to ECS Position/Rotation components
  - Collision callbacks: on impact force > threshold → emit `STRUCTURE_COLLAPSE` event
  - Debris management: when building collapses, remove single body, add N fragment bodies

- `src/systems/DestructionSystem.ts`:
  - Listens for `STRUCTURE_COLLAPSE` events
  - Uses Voronoi decomposition to fracture building mesh into fragments
  - Simple built-in Voronoi (no three-pinata dependency initially): slice mesh with random planes through impact point
  - Each fragment → new ECS entity with PhysicsBody, small mass, high initial velocity
  - Fragment cleanup: remove fragments that have been at rest for >5s and are small

- `src/systems/RenderSystem.ts`:
  - Queries all entities with Position + MeshRef
  - Syncs ECS Position/Rotation/Scale → Three.js Object3D.position/quaternion/scale
  - Interpolation: `lerp(prevPosition, currPosition, alpha)` for smooth rendering between physics ticks
  - Object pool: reuse Three.js objects, add/remove from scene as entities are created/destroyed

**Testable outcome:** Buildings stand on terrain. Apply downward force → they tip and fall with realistic physics. Shoot a projectile at a building → it fractures into debris pieces that scatter and settle.

---

## Milestone 6: GPU Particle System

**Goal:** WebGPU compute shader particle system for smoke, fire, ash, debris particles.

**Files:**
- `src/shaders/particle.compute.ts` — TSL compute shader:
  ```
  // Pseudocode for TSL particle update
  storage positions: instancedArray(Float32, maxParticles * 3)
  storage velocities: instancedArray(Float32, maxParticles * 3)
  storage lifetimes: instancedArray(Float32, maxParticles)

  computeFn: for each particle index:
    if lifetime <= 0: skip (dead)
    velocity += gravity * dt
    velocity += windForce * dt
    position += velocity * dt
    lifetime -= dt
  ```
- `src/systems/ParticleSystem.ts`:
  - Manages multiple emitters (fire, smoke, ash, debris, water spray)
  - Each emitter: position, rate, lifetime range, initial velocity range, color gradient, size curve
  - GPU compute updates all particles each frame
  - Renders via `Points` or `InstancedMesh` (billboards for smoke/fire, mesh for debris)
  - Emitter types: `FIRE` (orange→red, rise, short life), `SMOKE` (gray→transparent, rise+spread), `ASH` (dark, slow fall, wind-driven), `DEBRIS` (physics fragments, short life), `WATER_SPRAY` (blue→white, arc trajectory), `EMBER` (bright orange, wind-carried, can ignite)
  - Budget: 100K particles total, split across active emitters

**Testable outcome:** Click anywhere to spawn fire+smoke emitter. Particles rise, change color, fade out. Consistent 60fps with 50K+ particles.

---

## Milestone 7: Fluid System (SWE)

**Goal:** Shallow water equations on GPU compute for water simulation.

**Files:**
- `src/shaders/swe.compute.ts` — TSL compute shader implementing SWE:
  - 2D grid (512×512), each cell stores: water height `h`, velocity `(u, v)`, bed elevation `b`
  - Lax-Friedrichs or HLL Riemann solver for flux computation
  - Per timestep: compute fluxes between neighbors → update h, hu, hv
  - Wetting/drying: cells with h < epsilon treated as dry
  - Boundary conditions: reflective walls at domain edges
  - CFL condition for stability: dt ≤ dx / (|u| + √(gh))
  - Multiple substeps per frame for stability (5-10 substeps at dt=0.001s)

- `src/systems/FluidSystem.ts`:
  - Manages SWE grid as two ping-pong `StorageTexture` buffers
  - Dispatches compute shader each physics tick
  - Generates water mesh from height field: `PlaneGeometry` with vertex displacement from water height texture
  - Water material: translucent blue, Fresnel reflections, depth-based opacity
  - Methods: `addWaterSource(x, z, height, radius)`, `setInitialCondition(heightmap)`
  - Coupling: reads terrain heightmap as bed elevation, respects building cells as obstacles (raised bed)

**Testable outcome:** Drop a column of water on terrain. It spreads realistically, flows around buildings, settles into low areas. 60fps on 512×512 grid.

---

## Milestone 8: Cellular Automata Compute

**Goal:** Generic GPU cellular automata framework for fire and lava.

**Files:**
- `src/shaders/ca.compute.ts` — TSL compute kernel:
  - 2D grid, each cell has state vector (temperature, fuel, material, etc.)
  - Configurable neighborhood (Moore 8-cell or von Neumann 4-cell)
  - Per-cell update rule provided as callback/configuration
  - Ping-pong storage buffers

- This is used by both wildfire (Rothermel spread rules) and volcano (Bingham lava rules). The compute shader is parameterized; the disaster modules provide the rule configuration.

**Testable outcome:** Set a cell on fire → fire spreads across grid following wind direction and fuel availability. Visual feedback via color-mapped grid overlay on terrain.

---

## Milestone 9: Disaster Module Infrastructure

**Goal:** Plugin registration system, disaster parameter UI, cascading event wiring.

**Files:**
- `src/disasters/DisasterModule.ts` — Base interface:
  ```ts
  interface DisasterModule {
    id: string
    name: string
    description: string
    parameters: ParameterDef[]  // { name, type, min, max, default, unit }
    dependencies: string[]       // required systems
    activate(params: Record<string, number>): void
    deactivate(): void
    update(dt: number): void
  }
  ```
  - `DisasterRegistry`: register modules, activate/deactivate, manage lifecycle
  - Multiple disasters can be active simultaneously (earthquake triggers tsunami)

- `src/ui/DisasterPanel.ts` — HTML/CSS overlay (no React, vanilla DOM):
  - Grid of disaster cards with icons
  - Click to select → shows parameter sliders
  - "Activate" button → calls module.activate()
  - Active disasters shown with deactivate option

- `src/ui/SimulationHUD.ts`:
  - Play/pause/step controls
  - Speed slider (0.1x to 10x)
  - FPS counter, entity count, particle count
  - Camera preset buttons (overview, close-up, follow)

**Testable outcome:** UI panel shows all 6 disasters. Can select one, adjust parameters, activate/deactivate. HUD shows simulation stats.

---

## Milestone 10: Earthquake Module

**Files:**
- `src/disasters/earthquake/EarthquakeModule.ts`:
  - Parameters: magnitude (4.0–9.0), depth (5–50km), epicenter (click to place)
  - On activate: computes PGA at each building using GMPE, starts SDOF oscillation, spawns terrain wave visualization

- `src/disasters/earthquake/GMPEModel.ts`:
  - Boore-Atkinson 2008 GMPE: `ln(PGA) = f(M, R, V_s30, fault_type)`
  - For each building entity: compute distance to epicenter → PGA → spectral acceleration
  - Site amplification based on MaterialRegistry soil properties

- `src/disasters/earthquake/SDOFOscillator.ts`:
  - Newmark-β time integration for each building
  - Natural period from building height: `T = 0.1 × N_stories`
  - Damping ratio: 5% for concrete, 2% for steel
  - Track inter-story drift: if drift > 0.04 → emit `STRUCTURE_COLLAPSE`
  - Visual: buildings sway according to oscillator displacement

- Terrain effect: concentric displacement rings expanding from epicenter at P-wave and S-wave velocities. Applied as temporary terrain deformation.

**Testable outcome:** Set epicenter, trigger M7.0 earthquake. See wave rings propagate across terrain. Buildings sway, weakest ones collapse into debris.

---

## Milestone 11: Tsunami Module

**Files:**
- `src/disasters/tsunami/TsunamiModule.ts`:
  - Parameters: wave height (1–30m), direction, wavelength, or triggered by earthquake displacement
  - Listens for `GROUND_DISPLACEMENT` events near water → auto-triggers
  - Activates FluidSystem with initial water condition: raised water column at displacement zone
  - On wave contact with buildings: applies hydrostatic + hydrodynamic force to PhysicsSystem bodies
  - Wetting/drying for run-up onto coast

- `src/disasters/tsunami/SWECompute.ts`:
  - Extends base SWE with: Manning friction for coastal roughness, building obstacles as raised bed cells
  - Initial condition: seafloor displacement → water surface displacement (standard tsunami generation)

**Testable outcome:** Earthquake offshore → ocean floor displaces → wave propagates → hits coast → floods buildings → structures knocked over by water force.

---

## Milestone 12: Volcano Module

**Files:**
- `src/disasters/volcano/VolcanoModule.ts`:
  - Parameters: eruption intensity (VEI 1–5), lava viscosity, vent position
  - Spawns lava source at vent → drives CA lava flow
  - Spawns pyroclastic particle emitters
  - Launches ballistic volcanic bombs (parabolic trajectories with drag)

- `src/disasters/volcano/LavaCA.ts`:
  - Uses CA compute shader with Bingham fluid rules:
    - Flow from cell to neighbor when shear stress > yield stress
    - Temperature cools over time (radiation + conduction)
    - Viscosity increases exponentially as temperature drops
    - Color from temperature: >1000°C bright yellow, 800°C orange, 600°C dark red, <500°C black/solidified
  - Lava sets flammable buildings on fire (emits `FIRE_SPREAD`)

- `src/disasters/volcano/PyroclasticSystem.ts`:
  - GPU particle emitter: dense hot gas+ash cloud
  - Gravity current behavior: initially rises, then collapses and flows downhill
  - Uses ParticleSystem with custom force: buoyancy (hot=rise) diminishing over time → gravity takes over

**Testable outcome:** Volcano erupts at mountain peak. Lava flows downhill following terrain, cooling and solidifying. Pyroclastic cloud rolls down slopes. Ballistic bombs arc through air.

---

## Milestone 13: Landslide Module

**Files:**
- `src/disasters/landslide/LandslideModule.ts`:
  - Parameters: failure zone (click to define area), soil saturation, slope angle
  - Triggers when slope stability exceeded (simplified Bishop method)
  - Can be triggered by `GROUND_SHAKE` event (earthquake-induced landslide)

- `src/disasters/landslide/GranularFlow.ts`:
  - Voellmy depth-averaged model: friction + turbulence resistance
  - Implemented as modified SWE: h=debris thickness, uses Coulomb friction (µ·g·cos(θ)) + velocity-dependent drag (g·v²/ξ)
  - Terrain deformation: source zone lowers, deposit zone raises
  - Debris flow entrains objects: buildings in path get `STRUCTURE_COLLAPSE`

**Testable outcome:** Define failure zone on slope. Trigger → mass slides downhill, flows around obstacles, deposits at base. Terrain permanently deformed. Buildings in path destroyed.

---

## Milestone 14: Tornado Module

**Files:**
- `src/disasters/tornado/TornadoModule.ts`:
  - Parameters: EF scale (0–5), path direction, translation speed, core radius
  - Lightest computational load — fully analytical
  - Moving tornado follows user-defined path or click-to-steer

- `src/disasters/tornado/RankineVortex.ts`:
  - Wind field: `V_t(r) = V_max × (r/R_max)` inside core, `V_max × (R_max/r)^0.6` outside
  - Add translation velocity vector
  - For each building: compute wind force `F = 0.5 × ρ_air × C_d × A × V²`
  - Damage thresholds from EF scale: EF0=29-38 m/s (minor damage), EF5=89+ m/s (total destruction)
  - Debris pickup: objects with force > weight get launched (add to PhysicsSystem with initial velocity = wind velocity)
  - Visual: funnel cloud particle emitter (rotating conical particle system), debris ring

**Testable outcome:** Tornado funnel visible, moves across terrain. Buildings in path progressively damaged based on EF scale. Debris picked up and thrown. Particle funnel rotates convincingly.

---

## Milestone 15: Wildfire Module

**Files:**
- `src/disasters/wildfire/WildfireModule.ts`:
  - Parameters: ignition point, wind speed/direction, fuel moisture, ambient temperature
  - Can be triggered by `STRUCTURE_COLLAPSE` (gas line fire) or `FIRE_SPREAD` from volcano

- `src/disasters/wildfire/RothermelCA.ts`:
  - Uses CA compute shader with Rothermel spread rate:
    - `R = R_0 × (1 + φ_w + φ_s)` where R_0=no-wind/no-slope rate, φ_w=wind factor, φ_s=slope factor
  - Fuel model per cell from classification: vegetation=high fuel, buildings=medium, ground=none
  - Fire states: unburned → igniting → burning → burnout → extinguished
  - Spotfire: when fire intensity > threshold, emit ember particles (wind-carried, probabilistic ignition on landing)
  - Buildings catch fire when adjacent cells burning + flammable material

**Testable outcome:** Start fire in vegetation. Spreads with wind, climbs slopes faster, burns through fuel. Embers jump ahead and start spot fires. Wooden buildings ignite; concrete survives longer.

---

## Milestone 16: Cascading Events + Polish

**Goal:** Wire all disaster modules together via EventBus for multi-hazard cascading.

**Cascade chains to implement:**
- Earthquake → Tsunami (seafloor displacement triggers wave)
- Earthquake → Landslide (shaking destabilizes slopes)
- Earthquake → Fire (collapsed buildings emit gas-line fires)
- Volcano → Fire (lava ignites vegetation/buildings)
- Volcano → Landslide (eruption destabilizes flanks)
- Landslide → Tsunami (mass entering water displaces it)
- Tornado → Fire (can spread embers, or extinguish by removing oxygen — configurable)

**Additional polish:**
- Post-processing: bloom for fire/lava, depth of field, tone mapping
- Audio: spatial audio cues per disaster (rumble, roar, crackle) via Web Audio API
- Screenshot/recording capability
- Sample scenes: coastal city (earthquake→tsunami), volcanic island, wildfire-prone hillside

**Testable outcome:** Trigger earthquake near coast → buildings collapse → gas fires start → tsunami wave arrives → floods burning buildings. All systems interact correctly.

---

## Dependency Install Summary

```bash
# Milestone 1
bun install three @types/three

# Milestone 2
bun install bitecs

# Milestone 5
bun install jolt-physics
```

No other external dependencies required. All disaster physics are custom implementations. Particle systems, fluid sim, and cellular automata use Three.js TSL compute shaders directly.

---

## Implementation Order & Estimates

| # | Milestone | Depends On | Scope |
|---|-----------|-----------|-------|
| 1 | Rendering Foundation | — | 4 files |
| 2 | ECS + Events + Materials | 1 | 5 files |
| 3 | Mesh Import + Classify | 1, 2 | 3 files |
| 4 | Terrain System | 1, 2 | 1 file |
| 5 | Physics Engine | 2, 4 | 3 files |
| 6 | GPU Particles | 1, 2 | 2 files |
| 7 | Fluid System (SWE) | 1, 4 | 2 files |
| 8 | Cellular Automata | 1, 4 | 1 file |
| 9 | Disaster Infrastructure + UI | 2 | 3 files |
| 10 | Earthquake | 4, 5, 9 | 3 files |
| 11 | Tsunami | 7, 9, 10 | 2 files |
| 12 | Volcano | 6, 8, 9 | 3 files |
| 13 | Landslide | 4, 7, 9 | 2 files |
| 14 | Tornado | 5, 6, 9 | 2 files |
| 15 | Wildfire | 6, 8, 9 | 2 files |
| 16 | Cascading + Polish | 10–15 | wiring + FX |

Total: ~36 files, building incrementally with testable output at every milestone.
