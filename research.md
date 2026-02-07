# Building a physics-based natural disaster simulator with Three.js

**A modular, multi-disaster simulator is best built as a hybrid client-server system: Three.js with WebGPU compute handles rendering and lightweight physics in the browser, while an NVIDIA H100 running Warp or Taichi handles heavy fluid dynamics, structural fracture, and seismic computation, streaming state via FlatBuffers over WebSocket at 20–30 Hz.** No single physics engine covers all disaster types — the optimal approach combines Jolt Physics (rigid bodies/debris), shallow water equations on GPU (tsunamis/floods), cellular automata (lava/wildfire), MLS-MPM (landslides), and analytical models (tornados/earthquakes). This architecture can simulate earthquakes, tsunamis, volcanic eruptions, landslides, tornadoes, and wildfires at interactive frame rates with physically meaningful accuracy, scaling from client-only mode on consumer hardware to full-fidelity server-accelerated simulation with the H100.

---

## Physics engine comparison reveals no single winner

The browser physics landscape in 2026 includes six viable engines, but none provides the full rigid body + soft body + fluid stack needed for disaster simulation. **Jolt Physics** and **Ammo.js** emerge as the strongest candidates, each with distinct advantages.

**Jolt Physics** (C++ compiled to multi-threaded WASM, MIT license, **9k GitHub stars**) delivers AAA-quality rigid body simulation — it powers Horizon Forbidden West and Death Stranding 2. Its multi-threaded WASM build is the fastest web physics engine available, and its **double-precision mode** is critical for km-scale disaster terrains where single-precision floating-point causes jitter. Jolt supports soft bodies, heightfield colliders, and has an official Three.js addon. It handles **1,000+ simultaneous rigid bodies** comfortably at 60 fps.

**Ammo.js** (Bullet Physics port, zlib license, ~4k stars) remains the most feature-complete option: it uniquely offers **mature soft body simulation** (cloth, deformable volumes, ropes) alongside robust rigid bodies. The Three.js ecosystem has the most Ammo.js examples, including cloth, fracture, and instancing demos. However, it lacks multi-threaded WASM and double-precision support.

**Rapier.js** (Rust/WASM, Apache 2.0, ~1M npm downloads/week) is popular and well-integrated with Three.js but lacks soft body and fluid support entirely. **PhysX.js** (PhysX 5.6.1 via WASM, actively maintained) has excellent feature parity with the native SDK except that all GPU-accelerated features (fluids, cloth, particles) require CUDA and are unavailable in the browser build. **Cannon-es** (pure JavaScript, MIT) is the easiest to use but too slow for large-scale simulation — its pure JS architecture limits it to hundreds of bodies. **Oimo.js** is unmaintained and unsuitable.

The recommended approach: **use Jolt Physics as the primary rigid body engine** for debris, building collapse, and structural fragments, supplemented by separate GPU-based systems for fluid and particle simulation. The **Phy bridge library** (github.com/lo-th/phy) allows hot-swapping between Jolt, Ammo, Rapier, and PhysX at runtime, which is valuable during development for benchmarking.

| Engine | WASM | Rigid Body | Soft Body | Fluid | Heightfield | Multi-threaded | Best For |
|--------|------|-----------|-----------|-------|------------|----------------|----------|
| **Jolt** | ✅ | ⭐⭐⭐⭐⭐ | ✅ | ❌ | ✅ | ✅ | Primary engine |
| **Ammo.js** | ✅ | ⭐⭐⭐⭐⭐ | ✅ Best | ❌ | ✅ | ❌ | Soft body fallback |
| **Rapier** | ✅ | ⭐⭐⭐⭐ | ❌ | ❌ | ✅ | ❌ | Lightweight scenes |
| **PhysX.js** | ✅ | ⭐⭐⭐⭐⭐ | Partial | ❌ web | ✅ | ❌ | Future-proof option |
| **Cannon-es** | ❌ | ⭐⭐⭐ | ❌ | ❌ | ✅ | ❌ | Prototyping only |

---

## Fluid simulation demands a multi-method strategy

No single fluid technique handles tsunamis, lava, and flooding equally well. The three-tier approach balances physical accuracy with browser performance.

**Shallow Water Equations (SWE)** are the clear choice for large-scale tsunamis and floods. SWE are depth-averaged Navier-Stokes equations solved on a 2D grid — massively GPU-parallel and well-validated for tsunami propagation. The **BROWNI** library (MIT license) already implements validated browser-based tsunami simulation using WebGL fragment shaders as GPGPU, matching GeoClaw and EasyWave accuracy against real events (Tohoku 2011, Chile 2010). A **512×512 to 2048×2048 grid** runs comfortably in real-time. Porting BROWNI's approach to WebGPU compute shaders would improve performance 5–10x over the fragment-shader hack. The **WebFlood** project demonstrates SWE in urban environments with building obstacles.

**MLS-MPM (Moving Least Squares Material Point Method)** excels for detailed local fluid effects and granular flows. The Hu et al. 2018 paper ("A Moving Least Squares Material Point Method with only 88 lines") has been implemented in WebGPU browsers, achieving **~100,000 particles on integrated GPUs** and ~300,000 on discrete GPUs. MPM naturally handles multi-material interaction (water hitting soil, lava cooling to rock) through its hybrid particle-grid formulation. WebGPU compute shaders make the P2G scatter stage feasible — this was extremely difficult with WebGL.

**Heightfield water** (the simplest approach) stores water as a 2D grid with wave-equation propagation. Three.js ships an official GPGPU water example. A **512×512 heightfield runs at 60 fps trivially** on any GPU. This approach lacks physical accuracy for wave dynamics but works well for decorative water effects and simple flood visualization.

For **lava flows**, a cellular automaton with Bingham fluid rheology (the SCIARA approach) is optimal. Each cell stores lava thickness and temperature; flow occurs when shear stress exceeds yield stress. Temperature-dependent viscosity makes lava slow and solidify naturally. SCIARA-fv3 already has a WebGL 3D visualization and achieves **31× speedup on GPU** versus CPU.

WebGPU browser support has reached **~70% global coverage** as of early 2026: Chrome 113+ (since April 2023), Safari 26+ (since mid-2025), and Firefox 141+ (Windows since July 2025, macOS ARM64 since Firefox 145). Three.js r171+ provides `WebGPURenderer` with automatic WebGL 2 fallback, and **TSL (Three Shading Language)** transpiles shaders to either WGSL or GLSL automatically.

---

## Terrain deformation and structural destruction

Real-time terrain deformation for earthquakes and landslides is most practical via **heightmap-based terrain with GPU displacement**. A `PlaneGeometry` with 512×512 segments (~262K vertices) updates comfortably at 60 fps when modifications are localized. For GPU-side deformation, update a `DataTexture` used as displacement map — all LOD levels automatically reflect changes. For physics-compatible deformation (where raycasting and collision must match the visual), modify vertex positions on CPU and set `needsUpdate = true`. Use **16-bit or Float32 heightmaps** to avoid visible banding.

For **3D volumetric destruction** (caves, tunnel collapse), voxel-based terrain using marching cubes is the alternative. The **softxels** library provides chunk-based marching cubes for Three.js. A 64³ grid (~262K voxels) rebuilds its mesh in ~5–15ms; with chunking (8³ chunks), partial rebuilds take under 1ms. Realistic maximum for real-time: ~256³ with aggressive chunking and LOD.

**Building fracture** uses Voronoi decomposition. The **three-pinata** library (`@dgreenheck/three-pinata`) provides production-ready fracture for Three.js: it generates 3D Voronoi fragments from any mesh, supports impact-based fracturing (denser fragments near impact point), and integrates with Rapier for physics simulation of resulting debris. The hybrid approach used in AAA games — pre-fracture large structures offline (in Blender/Houdini) and swap meshes at runtime — is recommended for complex buildings, with real-time Voronoi reserved for smaller props (100–200 fragments).

**Terrain LOD** is essential for km-scale disaster scenes. **Geometry clipmaps** (nested regular grids centered on camera) offer the best balance of simplicity and performance. The key architectural insight: store all deformation in a heightmap delta texture applied via vertex shader, so all LOD levels automatically reflect terrain changes without per-level mesh regeneration.

---

## GPU particle systems can reach millions at 60 fps

Three.js particle systems follow a clear performance hierarchy. **CPU-updated particles** (setting `needsUpdate = true` each frame) hit their ceiling at **~50,000 particles**. **InstancedMesh** pushes this to **100K–500K** by reducing draw calls. **WebGL GPGPU** (ping-pong render targets via `GPUComputationRenderer`) reaches **1–2 million** particles. **WebGPU compute shaders** (the modern approach) handle **1M+ particles** with full physics at 60 fps — demonstrated in galaxy simulations and fluid demos.

The recommended particle library for disaster VFX is **three.quarks** (v0.16.0, actively maintained). It provides a Unity Shuriken-compatible behavior system, batched rendering to minimize draw calls, four render modes (billboard, stretched billboard, mesh, trail), and a visual editor. Fire, smoke, ash, and debris effects are configured via behaviors like `ColorOverLife`, `SizeOverLife`, and force fields. For particle counts exceeding 100K, switch to custom WebGPU compute shaders using Three.js TSL `instancedArray` and `storage()` nodes.

Realistic particle budgets for a disaster scene at 60 fps: **5K–20K** billboard particles per fire/smoke emitter (2–5 emitters per scene), **50K–200K** point particles for ash fall, **100–500** physics-simulated rigid body fragments plus **10K–50K** decorative instanced debris particles, and **1K–5K** large billboard particles for dust clouds. Total scene budget: **100K–500K** particles on WebGL GPGPU, **1M+** on WebGPU compute.

---

## Each disaster type has an optimal simulation approach

### Earthquake

Ground motion is best modeled with **Ground Motion Prediction Equations (GMPEs)** rather than full wave-equation solvers. The Boore-Atkinson GMPE computes Peak Ground Acceleration at each point from magnitude, distance, depth, and site class — O(N_buildings) per timestep, trivially real-time. Seismic waves are visualized as concentric expanding displacement rings on the terrain mesh, with P-waves arriving before S-waves (delayed by Δt = d × (1/V_s − 1/V_p)). Building response uses **single-degree-of-freedom (SDOF) oscillator** models (Newmark-β integration), triggering collapse when inter-story drift exceeds **~0.04**. Collapse transitions from SDOF analysis to pre-fractured Voronoi geometry with Jolt rigid body physics for fragment motion.

### Tsunami and flood

**Shallow water equations on GPU** are the validated, industry-standard approach. BROWNI demonstrates browser-based tsunami simulation validated against DART buoy measurements. For near-shore detail, nonlinear SWE with wetting/drying capture bore formation and run-up. Buildings are treated as raised terrain cells or internal boundary conditions. A **hybrid approach** — SWE for km-scale wave propagation plus MLS-MPM particles for local splashing near coastlines — provides the best visual impact.

### Volcanic eruption

Lava flow uses **cellular automata with Bingham rheology** (SCIARA approach): grid cells store thickness and temperature, flow distributes by minimizing height differences, and temperature-dependent viscosity controls flow rate. Color derives from temperature via Planck's law (bright orange → dark red → black). Pyroclastic flows use **depth-averaged Saint-Venant equations** with plastic rheology (constant retarding stress ~5,000–15,000 Pa). Tephra/ash fall is a GPU particle system with wind-field advection and Stokes law settling velocity. Volcanic bombs follow standard ballistic trajectories with drag.

### Landslide

**MLS-MPM is the breakthrough technique** — it handles granular materials naturally through Drucker-Prager elastoplasticity, runs in WebGPU browsers at 100K particles, and captures the fluid-like behavior of debris flows. The depth-averaged Voellmy model (Coulomb friction + velocity-dependent turbulent friction) is an alternative for larger scales with lower computational cost.

### Tornado

The **Rankine combined vortex model** provides a closed-form analytical solution that requires zero CFD computation: V_t(r) = V_max × (r/R_max) inside the core, V_max × (R_max/r)^α outside. Add translation velocity for the moving tornado. Wind forces on structures use aerodynamic loading (F = 0.5 × ρ × C_d × A × V²), with damage thresholds from Enhanced Fujita scale. This is the **lightest computational load** of all disaster types — the entire wind field computes analytically in O(N_points).

### Wildfire

The **Rothermel fire spread model** embedded in a cellular automaton is the industry-standard approach (used by FARSITE, BehavePlus). Rate of spread R depends on fuel model (Anderson 13 or Scott & Burgan 40 fuel types), moisture content, wind speed, and slope. The CA grid maps perfectly to GPU compute: each cell evaluates independently, achieving **200× speedups** on GPU. A 1000×1000 grid runs at interactive rates. Ember/spotfire generation uses probabilistic rules: when fire intensity exceeds a threshold, launch particle embers with wind-driven transport and ignition probability at landing.

---

## Modular architecture with ECS and plugin-based disaster modules

The simulator architecture separates physics from rendering using an **Entity-Component-System (ECS) pattern**. **bitECS** is the recommended framework — it uses Structure-of-Arrays TypedArrays for maximum cache performance (~100K entities at 60 fps), and its SoA stores can be directly bound to Three.js Object3D properties via getter/setter proxies, eliminating costly sync loops.

Each disaster type registers as a plugin module:

```
DisasterModule {
  id: "earthquake" | "tsunami" | "volcano" | ...
  dependencies: ["terrain", "structures", ...]
  components: [SeismicWave, GroundDisplacement, ...]
  systems: [WavePropagationSystem, StructuralResponseSystem, ...]
  activate(params): void
  deactivate(): void
}
```

**Shared systems** (terrain, atmosphere, structures, particles, fluid, rendering) provide common infrastructure. **Disaster-specific systems** implement physics unique to each type. A **DisasterEventBus** enables cascading effects: an earthquake module emits `GROUND_DISPLACEMENT`, the tsunami module listens for displacement events near coastlines, and the fire module listens for `STRUCTURE_COLLAPSE` to trigger gas-line fires.

Physics runs on a **fixed timestep** (1/60s for rigid bodies, substeps at 1/120s for fluid) in a Web Worker using SharedArrayBuffer. The renderer interpolates between physics states: `lerp(prevState, currState, alpha)` where alpha = accumulator / fixedDelta. The Three.js `WebGPURenderer` (r171+) handles rendering with automatic WebGL 2 fallback, and TSL ensures all shaders compile to either WGSL or GLSL.

**Progressive enhancement tiers**: Tier 1 (WebGPU + Compute) delivers full GPU physics with 1M+ particles; Tier 2 (WebGPU render-only) provides better draw call performance with reduced physics; Tier 3 (WebGL 2 baseline) uses texture-based GPGPU with ~100K particles and simpler fluid models.

---

## The H100 transforms what's physically computable

The H100 SXM5 delivers **67 TFLOPS FP32**, **80 GB HBM3** at 3.35 TB/s bandwidth, and 16,896 CUDA cores. For physics simulation, this means **10–50M SPH particles at real-time rates** (versus ~100K–1M in the browser), full finite-element structural analysis with thousands of elements, and billion-particle MPM simulations for landslide/debris flow at offline-to-near-real-time speeds.

**NVIDIA Warp** (Python framework, JIT-compiled to CUDA) is the recommended server-side physics toolkit. It delivers CUDA-equivalent performance with Python productivity, includes built-in spatial data structures (hash grids, meshes, sparse volumes), and is differentiable for optimization. The **Newton physics engine** (Google DeepMind + Disney Research + NVIDIA), built on Warp, provides production-grade GPU physics. **Taichi Lang** is the strong alternative, particularly for MPM simulations — it has demonstrated **1 billion particles** on a single 80GB GPU and has a browser deployment path via Taichi.js (WebGPU AOT compilation).

The optimal server-client split: the **H100 handles fluid dynamics (>100K particles), structural fracture analysis, seismic wave propagation, and multi-physics coupling**. The **browser client handles rendering, local particle effects (dust, sparks), camera-relative atmosphere, UI, and interpolation**. Server sends state updates at 20–30 Hz via binary WebSocket.

**FlatBuffers is the critical serialization choice** — its zero-copy deserialization reads vec3 positions directly from the received ArrayBuffer without parsing, achieving **0.09µs deserialization** versus 69µs for Protocol Buffers. Bandwidth estimates for the hybrid architecture: 1,000 rigid bodies at 20 Hz (~800 KB/s) + 50,000 quantized fluid particles (~2 MB/s) + terrain heightmap deltas (~500 KB/s) = **~3.3 MB/s total**, well within typical network capacity. Delta encoding, 16-bit quantization, and viewport-based spatial filtering can reduce this further.

Client-side interpolation smooths the 20 Hz server updates to 60 fps display rate. WebRTC DataChannel in unreliable/unordered mode (UDP-like semantics) reduces latency to **20–50ms** versus 50–150ms for WebSocket, which matters for user-interactive scenarios.

---

## Recommended technology stack and project structure

**Client stack**: Three.js WebGPURenderer (r171+ with TSL) → bitECS for entity management → Jolt Physics (multi-threaded WASM) for rigid bodies → WebGPU compute for particles/fluid → three.quarks for VFX → FlatBuffers for deserialization

**Server stack**: NVIDIA Warp on H100 for physics kernels → Python orchestrator (FastAPI/asyncio) → FlatBuffers serialization → uWebSockets.js for binary WebSocket streaming → optional Omniverse Kit for PhysX Blast (destruction) and Flow (fluid/fire)

**Recommended project structure**:

```
disaster-sim/
├── client/
│   ├── core/
│   │   ├── Engine.ts              # Main loop, renderer init
│   │   ├── ECSWorld.ts            # bitECS world setup
│   │   ├── NetworkClient.ts       # WebSocket/WebRTC, FlatBuffers
│   │   └── InterpolationEngine.ts # State blending at render rate
│   ├── systems/
│   │   ├── RenderSystem.ts        # Three.js scene graph sync
│   │   ├── TerrainSystem.ts       # Heightmap LOD, deformation
│   │   ├── ParticleSystem.ts      # WebGPU compute particles
│   │   ├── FluidRenderSystem.ts   # Water/lava mesh from state
│   │   └── PhysicsSystem.ts       # Jolt wrapper, local physics
│   ├── disasters/                 # Plugin modules
│   │   ├── earthquake/
│   │   ├── tsunami/
│   │   ├── volcano/
│   │   ├── landslide/
│   │   ├── tornado/
│   │   └── wildfire/
│   └── shaders/                   # TSL compute + render shaders
│       ├── swe.compute.ts         # Shallow water equations
│       ├── fire-spread.compute.ts # CA wildfire
│       └── particle.compute.ts    # Generic GPU particles
├── server/
│   ├── physics/
│   │   ├── warp_fluid.py          # Warp SPH/MPM kernels
│   │   ├── warp_fracture.py       # Structural analysis
│   │   ├── warp_seismic.py        # Wave propagation
│   │   └── taichi_mpm.py          # Landslide/debris MPM
│   ├── streaming/
│   │   ├── state_serializer.py    # FlatBuffers encoding
│   │   └── ws_server.py           # WebSocket binary stream
│   └── schemas/
│       └── simulation.fbs         # FlatBuffers schema
└── shared/
    └── schemas/                   # Shared type definitions
```

**Key existing projects to build on**: BROWNI (validated browser tsunami SWE), three-pinata (Voronoi fracture), three.quarks (particle VFX), softxels (voxel marching cubes), Phy (multi-engine physics bridge), WebGPU-Ocean (MLS-MPM fluid), and WebFlood (urban SWE flooding).

---

## Conclusion

The fundamental insight is that natural disaster simulation spans too many physical domains for any single engine or technique. The winning architecture is a **composable, multi-solver system** where each disaster type brings its own optimal physics approach — analytical models for earthquakes and tornadoes, cellular automata for wildfires and lava, shallow water equations for tsunamis, MPM for landslides — all unified through an ECS that decouples physics from rendering. The H100 doesn't just accelerate existing browser-capable physics; it **unlocks entirely different scales** of simulation (10M+ fluid particles, real-time structural FEM) that stream their results to a lightweight Three.js client. WebGPU compute shaders — now available in all major browsers — close the gap between client and server for many scenarios, making a progressive enhancement strategy viable: client-only for simple demos, server-assisted for full fidelity. The technology stack is mature enough today to build this system, with BROWNI proving browser-based tsunami simulation, MLS-MPM running in WebGPU, and Warp/Taichi delivering H100-accelerated physics with Python-level productivity.