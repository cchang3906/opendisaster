import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Engine } from "./core/Engine.ts";
import { SimWorld } from "./core/World.ts";
import { EventBus } from "./core/EventBus.ts";
import { MaterialRegistry } from "./core/MaterialRegistry.ts";
import { StylizedMaterialLibrary } from "./materials/StylizedMaterials.ts";
import { SatelliteProvider } from "./imagery/SatelliteProvider.ts";
import { RoofProjector } from "./imagery/RoofProjector.ts";
import { AlignmentOptimizer } from "./imagery/AlignmentOptimizer.ts";

const ORIGIN = { lat: 40.80786337462047, lng: -73.96212879442707 }; // Alma Mater
const LOW_COORD = { lat: 40.80833, lng: -73.96194 };
const BUTLER_COORD = { lat: 40.80639, lng: -73.96333 };

async function main() {
  const engine = new Engine();
  const world = new SimWorld();
  const eventBus = new EventBus();
  const materials = new MaterialRegistry();
  const stylized = new StylizedMaterialLibrary();

  // Start renderer first
  await engine.start();
  console.log("[OpenDisaster] Engine started");

  // Load Columbia campus directly
  const loader = new GLTFLoader();
  loader.load(
    "/models/columbia-campus.glb",
    async (gltf) => {
      console.log("[Import] GLB loaded, adding to scene");
      const model = gltf.scene;

      // Configure meshes + stylized facade materials
      let meshCount = 0;
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
          child.castShadow = true;
          child.receiveShadow = true;
          child.material = stylized.getMaterial(classifyMeshByName(child.name));

          // Fix z-fighting: drop ground below overlapping surfaces
          if (child.name === "ground_terrain") {
            child.position.y = -0.3;
          }
        }
      });
      console.log(`[Import] ${meshCount} meshes in model`);

      engine.scene.add(model);

      // Remove default ground
      const defaultGround = engine.scene.getObjectByName("ground");
      if (defaultGround) engine.scene.remove(defaultGround);

      updateInfo(`Columbia University Campus — ${meshCount} meshes`);

      // Apply roof imagery + auto-optimise alignment
      try {
        updateInfo("Fetching roof imagery…");
        const provider = new SatelliteProvider();
        const extent = computeExtentFromAnchors(model);
        // Auto-compute zoom and grid so tiles actually cover the extent.
        // At zoom z, each pixel = 156543·cos(lat) / 2^z metres.
        // A 640px tile covers tileSize × mpp metres of ground.
        const tileParams = computeTileParams(extent);
        console.log(
          `[Satellite] zoom ${tileParams.zoom}, grid ${tileParams.cols}×${tileParams.rows} ` +
            `(${tileParams.cols * tileParams.rows} tiles)`
        );
        const roofTexture = await provider.fetchTexture({
          extent,
          zoom: tileParams.zoom,
          gridSize: [tileParams.cols, tileParams.rows],
          tileSize: 640,
        });

        // 1. Compute alignment from the two verified anchor buildings.
        //    Only Low Library and Butler Library have confirmed coordinates.
        //    The solver logs all building_* mesh names — use the console
        //    output to identify more anchors if needed.
        const optimal = AlignmentOptimizer.solve(model, extent, [
          { name: "building_Low_Memorial_Library", lat: LOW_COORD.lat, lng: LOW_COORD.lng },
          { name: "building_Butler_Library", lat: BUTLER_COORD.lat, lng: BUTLER_COORD.lng },
        ]);

        // 2. Project roof imagery with the computed affine alignment
        const projector = new RoofProjector();
        projector.apply(roofTexture, model, optimal);

        // Decompose affine for display
        const rot = Math.atan2(optimal.c, optimal.a);
        const sU = Math.sqrt(optimal.a ** 2 + optimal.c ** 2);
        const sV = Math.sqrt(optimal.b ** 2 + optimal.d ** 2);
        updateInfo(
          `Columbia University Campus — ${meshCount} meshes — ` +
            `roofs aligned (rot ${((rot * 180) / Math.PI).toFixed(2)}°, ` +
            `scale ${sU.toFixed(3)}×${sV.toFixed(3)})`
        );

        // Expose for console inspection
        (window as any).__alignment = optimal;
      } catch (err) {
        console.warn("[Roof] Imagery failed:", err);
        updateInfo("Roof imagery failed — see console");
      }
    },
    (progress) => {
      if (progress.total > 0) {
        const pct = Math.round((progress.loaded / progress.total) * 100);
        updateInfo(`Loading campus model... ${pct}%`);
      }
    },
    (error) => {
      console.error("[Import] Failed to load model:", error);
      updateInfo("Failed to load model — see console");
    }
  );

  // Wire update loop
  engine.onUpdate((dt) => {
    world.update(dt);
  });
}

/* ------------------------------------------------------------------ */
/*  UI helper                                                          */
/* ------------------------------------------------------------------ */

function updateInfo(text: string) {
  const el = document.getElementById("info");
  if (el) el.textContent = `OpenDisaster — ${text}`;
}

function classifyMeshByName(
  name: string
): "building" | "ground" | "road" | "vegetation" | "water" {
  const n = name.toLowerCase();
  if (/(road|street|path|walk|sidewalk|asphalt|pavement)/.test(n)) return "road";
  if (/(water|river|lake|pond|sea|ocean|pool)/.test(n)) return "water";
  if (/(tree|bush|grass|plant|vegetation|forest|hedge|shrub)/.test(n))
    return "vegetation";
  if (/(ground|terrain|floor|land|earth|surface|plane|lawn)/.test(n))
    return "ground";
  return "building";
}

function computeExtentFromAnchors(model: THREE.Object3D): {
  north: number;
  south: number;
  east: number;
  west: number;
} {
  const lowMesh = findMeshByName(model, "building_Low_Memorial_Library");
  const butlerMesh = findMeshByName(model, "building_Butler_Library");
  const bbox = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  if (!lowMesh || !butlerMesh || size.x < 0.001 || size.z < 0.001) {
    return {
      north: ORIGIN.lat + 0.004,
      south: ORIGIN.lat - 0.004,
      east: ORIGIN.lng + 0.005,
      west: ORIGIN.lng - 0.005,
    };
  }

  const lowPos = getMeshCenter(lowMesh);
  const butlerPos = getMeshCenter(butlerMesh);

  const enuLow = enuFromLatLng(ORIGIN, LOW_COORD);
  const enuButler = enuFromLatLng(ORIGIN, BUTLER_COORD);

  const glbVec = new THREE.Vector2(
    butlerPos.x - lowPos.x,
    butlerPos.z - lowPos.z
  );
  const enuVec = new THREE.Vector2(enuButler.east - enuLow.east, enuButler.north - enuLow.north);

  const enuLen = enuVec.length();
  const glbLen = glbVec.length();
  const scale = enuLen > 1e-6 ? glbLen / enuLen : 1;
  const rotation = Math.atan2(glbVec.y, glbVec.x) - Math.atan2(enuVec.y, enuVec.x);

  // GLB = R * (ENU * scale) + offset
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const offsetX = lowPos.x - (enuLow.east * scale * cosR - enuLow.north * scale * sinR);
  const offsetZ = lowPos.z - (enuLow.east * scale * sinR + enuLow.north * scale * cosR);

  // Convert GLB bbox corners to ENU, then to lat/lng
  const corners = [
    new THREE.Vector2(bbox.min.x, bbox.min.z),
    new THREE.Vector2(bbox.min.x, bbox.max.z),
    new THREE.Vector2(bbox.max.x, bbox.min.z),
    new THREE.Vector2(bbox.max.x, bbox.max.z),
  ];

  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;

  for (const c of corners) {
    // Inverse transform: ENU = R^-1 * (GLB - offset) / scale
    const gx = c.x - offsetX;
    const gz = c.y - offsetZ;
    const enuE = (gx * cosR + gz * sinR) / scale;
    const enuN = (-gx * sinR + gz * cosR) / scale;
    const ll = latLngFromENU(ORIGIN, { east: enuE, north: enuN });
    north = Math.max(north, ll.lat);
    south = Math.min(south, ll.lat);
    east = Math.max(east, ll.lng);
    west = Math.min(west, ll.lng);
  }

  console.log(
    `[RoofAlign] rot ${(rotation * 180) / Math.PI}°, scale ${scale.toFixed(3)}, extent N:${north.toFixed(5)} S:${south.toFixed(5)} E:${east.toFixed(5)} W:${west.toFixed(5)}`
  );

  return { north, south, east, west };
}

function findMeshByName(
  root: THREE.Object3D,
  name: string
): THREE.Mesh | null {
  let result: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (result) return;
    if (child instanceof THREE.Mesh && child.name === name) {
      result = child;
    }
  });
  return result;
}

function getMeshCenter(mesh: THREE.Mesh): THREE.Vector3 {
  const bbox = new THREE.Box3().setFromObject(mesh);
  const center = new THREE.Vector3();
  bbox.getCenter(center);
  return center;
}

function enuFromLatLng(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number }
): { east: number; north: number } {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(target.lat - origin.lat);
  const dLng = toRad(target.lng - origin.lng);
  const east = dLng * Math.cos(toRad(origin.lat)) * R;
  const north = dLat * R;
  return { east, north };
}

function latLngFromENU(
  origin: { lat: number; lng: number },
  enu: { east: number; north: number }
): { lat: number; lng: number } {
  const R = 6371000;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLat = enu.north / R;
  const dLng = enu.east / (R * Math.cos((origin.lat * Math.PI) / 180));
  return {
    lat: origin.lat + toDeg(dLat),
    lng: origin.lng + toDeg(dLng),
  };
}

/**
 * Auto-compute the Google Maps zoom level and tile grid size so the
 * fetched tiles actually **cover** the geographic extent.
 *
 * At zoom z each pixel represents  156 543 · cos(lat) / 2^z  metres.
 * A 640 px tile therefore covers  640 × mpp  metres on the ground.
 * We pick the highest zoom where the required grid stays ≤ 25 tiles
 * (to keep API usage reasonable).
 */
function computeTileParams(
  extent: { north: number; south: number; east: number; west: number },
  tileSize = 640,
  maxTiles = 25
): { zoom: number; cols: number; rows: number } {
  const latMid = (extent.north + extent.south) / 2;
  const cosLat = Math.cos((latMid * Math.PI) / 180);
  const extentW =
    Math.abs(extent.east - extent.west) * 111_319 * cosLat; // metres
  const extentH = Math.abs(extent.north - extent.south) * 111_319;

  // Try zoom levels from high (detailed) to low (wide) and pick the
  // highest zoom whose grid fits within maxTiles.
  for (let z = 20; z >= 1; z--) {
    const mpp = (156_543.03392 * cosLat) / 2 ** z;
    const tileCov = tileSize * mpp; // metres per tile edge
    const cols = Math.max(1, Math.ceil(extentW / tileCov));
    const rows = Math.max(1, Math.ceil(extentH / tileCov));
    if (cols * rows <= maxTiles) {
      return { zoom: z, cols, rows };
    }
  }
  return { zoom: 1, cols: 1, rows: 1 };
}

main().catch(console.error);
