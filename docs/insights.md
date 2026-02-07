# OpenDisaster — Development Insights

## bitECS v0.4 API Breaking Changes

bitECS v0.4 has a completely different API from v0.3. The v0.3 examples found everywhere online (and in most AI training data) are wrong for v0.4:

- **No `defineComponent`** — components are plain objects with TypedArray properties
- **No `defineQuery`** — use `query(world, [Component1, Component2])` directly
- **No `Types`** — create raw `Float32Array`, `Uint32Array`, etc. yourself
- **`registerComponent(world, component)`** replaces the implicit registration from `addComponent`
- **`addComponent(world, entity, component)`** parameter order changed

Working v0.4 component definition:
```ts
const Position = {
  x: new Float64Array(MAX_ENTITIES),
  y: new Float64Array(MAX_ENTITIES),
  z: new Float64Array(MAX_ENTITIES),
};
```

## Three.js WebGPU Import Path

`three/addons/renderers/webgpu/WebGPURenderer.js` does not exist in three@0.182+. The correct approach is dynamic import at runtime:

```ts
const { WebGPURenderer } = await import("three/webgpu");
```

This also enables clean WebGL2 fallback in a try/catch. The WebGPURenderer needs an explicit `await renderer.init()` call.

## GLB Export in Bun (No Browser APIs)

Three.js `GLTFExporter` depends on browser APIs (`FileReader`, `readAsDataURL`, DOM event loop) that don't exist in Bun. Polyfilling these fails due to async callback mismatches.

**Solution:** Build GLB binary format manually. The spec is straightforward:
1. 12-byte header: magic `glTF`, version 2, total byte length
2. JSON chunk: 8-byte chunk header + padded JSON (space-padded to 4-byte alignment)
3. BIN chunk: 8-byte chunk header + padded binary data (zero-padded to 4-byte alignment)

Buffer views reference byte offsets into the BIN chunk. Accessors reference buffer views. This approach has zero dependencies and runs anywhere.

## Coordinate System Mismatch: ExtrudeGeometry vs Direct Translation

When using `THREE.ExtrudeGeometry` + `rotateX(-PI/2)` (the standard vertical extrusion pattern), the shape's Y coordinate maps to world **-Z** after rotation. But when placing objects via `geometry.translate(x, y, z)`, Z maps directly to world Z.

This means shapes built with ExtrudeGeometry (buildings, vegetation areas) and objects placed with translate (trees, fountains) end up Z-flipped relative to each other if both use the same coordinate input.

**Fix:** Negate Z for directly-translated objects:
```ts
const [x, z] = latLonToLocal(lat, lon);
// For ExtrudeGeometry: use z as shape Y (gets negated by rotateX)
// For translate: use -z to match
geometry.translate(x, height, -z);
```

## Z-Fighting with Coplanar Surfaces

Vegetation areas extruded from y=0 have bottom faces coinciding exactly with the ground plane at y=0. `polygonOffset` alone doesn't fix this because both faces are at identical depth.

**Fix:** Drop the ground plane below y=0 (`position.y = -0.3`) so no surface coincides with it.

## OSM Data Quality for Campus Scenes

OpenStreetMap building data varies widely:
- ~30% of buildings have real names (Butler Library, Pupin Hall, etc.)
- ~70% are just `building=yes` with no name tag
- Height data is sparse — `building:levels` is more common than `height`
- Default height estimation by building type (university=18m, library=15m, residential=20m) produces reasonable results

Tree node density is good in urban/campus areas (~432 trees in the Columbia bounding box). Vegetation areas (parks, gardens, grass) and water features (fountains) are well-tagged.

## Overpass API Reliability

The primary Overpass endpoint (`overpass-api.de`) returns 504 timeouts frequently, especially with expanded queries. **Always implement endpoint fallback:**
```ts
const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
```

Also validate the response body starts with `{` — some endpoints return HTML error pages with 200 status.

## Performance Observations

- 1202-mesh GLB (3.26 MB) loads and renders smoothly on WebGPU
- Low-poly trees (6-sided cylinder + 6x4 sphere) look acceptable from the default camera distance and keep the mesh count manageable
- Shadow mapping works across the full campus scene with shadow camera bounds set to 600 units
