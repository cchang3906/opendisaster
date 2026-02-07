/**
 * Fetches Columbia University campus buildings, vegetation, and water features
 * from OpenStreetMap Overpass API, generates extruded 3D geometry, and exports
 * as GLB using a custom encoder.
 */
import * as THREE from "three";

// Columbia University campus bounding box
const BOUNDS = {
  south: 40.805,
  north: 40.812,
  west: -73.965,
  east: -73.957,
};

const CENTER_LAT = (BOUNDS.south + BOUNDS.north) / 2;
const CENTER_LON = (BOUNDS.west + BOUNDS.east) / 2;
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((CENTER_LAT * Math.PI) / 180);

interface OSMNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

interface OSMWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}

function latLonToLocal(lat: number, lon: number): [number, number] {
  const x = (lon - CENTER_LON) * M_PER_DEG_LON;
  const z = -(lat - CENTER_LAT) * M_PER_DEG_LAT;
  return [x, z];
}

function estimateHeight(tags: Record<string, string> | undefined): number {
  if (!tags) return 12;
  if (tags["height"]) {
    const h = parseFloat(tags["height"]);
    if (!isNaN(h)) return h;
  }
  if (tags["building:levels"]) {
    const levels = parseInt(tags["building:levels"]);
    if (!isNaN(levels)) return levels * 3.5;
  }
  const type = tags["building"];
  if (type === "university" || type === "college") return 18;
  if (type === "cathedral" || type === "church") return 25;
  if (type === "library") return 15;
  if (type === "dormitory" || type === "residential") return 20;
  return 14;
}

function getBuildingName(tags: Record<string, string> | undefined): string {
  if (!tags) return "building";
  return tags["name"] || tags["building"] || "building";
}

// ─── Mesh data extraction ───

interface RawMesh {
  name: string;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number];
}

function extractMeshData(mesh: THREE.Mesh, name: string, color: [number, number, number]): RawMesh {
  const geom = mesh.geometry;
  geom.computeVertexNormals();

  const pos = geom.getAttribute("position");
  const norm = geom.getAttribute("normal");
  const idx = geom.getIndex();

  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }

  const normals = new Float32Array(norm.count * 3);
  for (let i = 0; i < norm.count; i++) {
    normals[i * 3] = norm.getX(i);
    normals[i * 3 + 1] = norm.getY(i);
    normals[i * 3 + 2] = norm.getZ(i);
  }

  let indices: Uint32Array;
  if (idx) {
    indices = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i++) {
      indices[i] = idx.getX(i);
    }
  } else {
    indices = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) indices[i] = i;
  }

  return { name, positions, normals, indices, color };
}

function buildBuildingMesh(
  coords: [number, number][],
  height: number,
  name: string
): RawMesh | null {
  if (coords.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(coords[0]![0], coords[0]![1]);
  for (let i = 1; i < coords.length; i++) {
    shape.lineTo(coords[i]![0], coords[i]![1]);
  }
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);

  let color: [number, number, number] = [0.72, 0.72, 0.69];
  const n = name.toLowerCase();
  if (n.includes("library")) color = [0.77, 0.66, 0.51];
  else if (n.includes("hall")) color = [0.66, 0.63, 0.60];
  else if (n.includes("center")) color = [0.60, 0.60, 0.63];
  else if (n.includes("church") || n.includes("cathedral")) color = [0.83, 0.78, 0.69];

  const mesh = new THREE.Mesh(geometry);
  const safeName = `building_${name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`;
  return extractMeshData(mesh, safeName, color);
}

function buildTreeMesh(x: number, z: number, id: number): RawMesh[] {
  // Negate z to match building convention (ExtrudeGeometry + rotateX(-PI/2) negates Y→Z)
  const wz = -z;
  const trunkRadius = 0.3;
  const trunkHeight = 3 + Math.random() * 2;
  const canopyRadius = 2.5 + Math.random() * 1.5;
  const canopyHeight = 4 + Math.random() * 3;

  // Trunk: low-poly cylinder
  const trunkGeom = new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, trunkHeight, 6);
  trunkGeom.translate(x, trunkHeight / 2, wz);
  const trunkMesh = new THREE.Mesh(trunkGeom);

  // Canopy: low-poly sphere
  const canopyGeom = new THREE.SphereGeometry(canopyRadius, 6, 4);
  canopyGeom.scale(1, canopyHeight / canopyRadius / 2, 1);
  canopyGeom.translate(x, trunkHeight + canopyHeight * 0.3, wz);
  const canopyMesh = new THREE.Mesh(canopyGeom);

  return [
    extractMeshData(trunkMesh, `tree_trunk_${id}`, [0.40, 0.28, 0.16]),
    extractMeshData(canopyMesh, `tree_canopy_${id}`, [0.22, 0.45, 0.18]),
  ];
}

function buildVegetationAreaMesh(
  coords: [number, number][],
  name: string
): RawMesh | null {
  if (coords.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(coords[0]![0], coords[0]![1]);
  for (let i = 1; i < coords.length; i++) {
    shape.lineTo(coords[i]![0], coords[i]![1]);
  }
  shape.closePath();

  // Thin extrusion to give it slight height above ground
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.15,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry);
  const safeName = `vegetation_${name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`;
  return extractMeshData(mesh, safeName, [0.25, 0.52, 0.22]);
}

function buildWaterMesh(
  coords: [number, number][],
  name: string
): RawMesh | null {
  if (coords.length < 3) return null;

  const shape = new THREE.Shape();
  shape.moveTo(coords[0]![0], coords[0]![1]);
  for (let i = 1; i < coords.length; i++) {
    shape.lineTo(coords[i]![0], coords[i]![1]);
  }
  shape.closePath();

  // Flat plane at y=0.05 (just above ground)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0.05, 0);

  const mesh = new THREE.Mesh(geometry);
  const safeName = `water_${name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60)}`;
  return extractMeshData(mesh, safeName, [0.25, 0.45, 0.65]);
}

function buildFountainMesh(x: number, z: number, id: number): RawMesh[] {
  // Negate z to match building convention (ExtrudeGeometry + rotateX(-PI/2) negates Y→Z)
  const wz = -z;
  // Basin: flat cylinder
  const basinRadius = 3;
  const basinGeom = new THREE.CylinderGeometry(basinRadius, basinRadius, 0.5, 12);
  basinGeom.translate(x, 0.25, wz);
  const basinMesh = new THREE.Mesh(basinGeom);

  // Water surface inside
  const waterGeom = new THREE.CylinderGeometry(basinRadius * 0.9, basinRadius * 0.9, 0.1, 12);
  waterGeom.translate(x, 0.45, wz);
  const waterMesh = new THREE.Mesh(waterGeom);

  return [
    extractMeshData(basinMesh, `fountain_basin_${id}`, [0.6, 0.58, 0.55]),
    extractMeshData(waterMesh, `fountain_water_${id}`, [0.3, 0.5, 0.7]),
  ];
}

// ─── GLB Encoder ───

function encodeGLB(meshes: RawMesh[]): ArrayBuffer {
  // Collect unique materials (by color)
  const materialMap = new Map<string, number>();
  const materials: { color: [number, number, number] }[] = [];

  for (const m of meshes) {
    const key = m.color.join(",");
    if (!materialMap.has(key)) {
      materialMap.set(key, materials.length);
      materials.push({ color: m.color });
    }
  }

  // Build binary buffer: positions | normals | indices for each mesh
  // Calculate total sizes first
  let totalBytes = 0;
  const meshOffsets: {
    posOffset: number; posBytes: number; posCount: number;
    normOffset: number; normBytes: number;
    idxOffset: number; idxBytes: number; idxCount: number;
    min: [number, number, number]; max: [number, number, number];
  }[] = [];

  for (const m of meshes) {
    const posBytes = m.positions.byteLength;
    const normBytes = m.normals.byteLength;
    const idxBytes = m.indices.byteLength;

    // Compute AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i]!);
      minY = Math.min(minY, m.positions[i + 1]!);
      minZ = Math.min(minZ, m.positions[i + 2]!);
      maxX = Math.max(maxX, m.positions[i]!);
      maxY = Math.max(maxY, m.positions[i + 1]!);
      maxZ = Math.max(maxZ, m.positions[i + 2]!);
    }

    const posOffset = totalBytes;
    totalBytes += posBytes;
    // Align to 4 bytes
    totalBytes = (totalBytes + 3) & ~3;

    const normOffset = totalBytes;
    totalBytes += normBytes;
    totalBytes = (totalBytes + 3) & ~3;

    const idxOffset = totalBytes;
    totalBytes += idxBytes;
    totalBytes = (totalBytes + 3) & ~3;

    meshOffsets.push({
      posOffset, posBytes, posCount: m.positions.length / 3,
      normOffset, normBytes,
      idxOffset, idxBytes, idxCount: m.indices.length,
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
    });
  }

  // Fill binary buffer
  const binBuffer = new ArrayBuffer(totalBytes);
  const binView = new Uint8Array(binBuffer);

  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i]!;
    const o = meshOffsets[i]!;
    binView.set(new Uint8Array(m.positions.buffer), o.posOffset);
    binView.set(new Uint8Array(m.normals.buffer), o.normOffset);
    binView.set(new Uint8Array(m.indices.buffer), o.idxOffset);
  }

  // Build GLTF JSON
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const gltfMeshes: any[] = [];
  const nodes: any[] = [];

  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i]!;
    const o = meshOffsets[i]!;
    const matKey = m.color.join(",");
    const matIdx = materialMap.get(matKey)!;

    const bvPosIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: o.posOffset,
      byteLength: o.posBytes,
      target: 34962, // ARRAY_BUFFER
    });

    const bvNormIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: o.normOffset,
      byteLength: o.normBytes,
      target: 34962,
    });

    const bvIdxIdx = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: o.idxOffset,
      byteLength: o.idxBytes,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });

    const accPosIdx = accessors.length;
    accessors.push({
      bufferView: bvPosIdx,
      componentType: 5126, // FLOAT
      count: o.posCount,
      type: "VEC3",
      min: o.min,
      max: o.max,
    });

    const accNormIdx = accessors.length;
    accessors.push({
      bufferView: bvNormIdx,
      componentType: 5126,
      count: o.posCount,
      type: "VEC3",
    });

    const accIdxIdx = accessors.length;
    accessors.push({
      bufferView: bvIdxIdx,
      componentType: 5125, // UNSIGNED_INT
      count: o.idxCount,
      type: "SCALAR",
    });

    gltfMeshes.push({
      name: m.name,
      primitives: [{
        attributes: { POSITION: accPosIdx, NORMAL: accNormIdx },
        indices: accIdxIdx,
        material: matIdx,
      }],
    });

    nodes.push({ name: m.name, mesh: i });
  }

  const gltfMaterials = materials.map((mat, i) => ({
    name: `material_${i}`,
    pbrMetallicRoughness: {
      baseColorFactor: [mat.color[0], mat.color[1], mat.color[2], 1.0],
      metallicFactor: 0.05,
      roughnessFactor: 0.85,
    },
  }));

  const gltf = {
    asset: { version: "2.0", generator: "opendisaster-gen" },
    scene: 0,
    scenes: [{ name: "columbia-campus", nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalBytes }],
    materials: gltfMaterials,
  };

  // Encode JSON chunk
  const jsonStr = JSON.stringify(gltf);
  const jsonEncoder = new TextEncoder();
  const jsonData = jsonEncoder.encode(jsonStr);
  const jsonPadding = (4 - (jsonData.length % 4)) % 4;
  const jsonChunkLen = jsonData.length + jsonPadding;

  // Binary chunk padding
  const binPadding = (4 - (totalBytes % 4)) % 4;
  const binChunkLen = totalBytes + binPadding;

  // Total GLB size
  const glbSize = 12 + 8 + jsonChunkLen + 8 + binChunkLen;

  const glb = new ArrayBuffer(glbSize);
  const dv = new DataView(glb);
  const glbBytes = new Uint8Array(glb);
  let pos = 0;

  // GLB Header
  dv.setUint32(pos, 0x46546C67, true); pos += 4; // "glTF"
  dv.setUint32(pos, 2, true); pos += 4;           // version
  dv.setUint32(pos, glbSize, true); pos += 4;      // length

  // JSON chunk
  dv.setUint32(pos, jsonChunkLen, true); pos += 4;
  dv.setUint32(pos, 0x4E4F534A, true); pos += 4;  // "JSON"
  glbBytes.set(jsonData, pos); pos += jsonData.length;
  for (let i = 0; i < jsonPadding; i++) glbBytes[pos++] = 0x20;

  // BIN chunk
  dv.setUint32(pos, binChunkLen, true); pos += 4;
  dv.setUint32(pos, 0x004E4942, true); pos += 4;  // "BIN\0"
  glbBytes.set(binView, pos); pos += totalBytes;
  for (let i = 0; i < binPadding; i++) glbBytes[pos++] = 0x00;

  return glb;
}

// ─── OSM Fetch ───

async function fetchOSMData() {
  const query = `
[out:json][timeout:30];
(
  way["building"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  node["natural"="tree"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["leisure"~"park|garden"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["landuse"="grass"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["natural"="water"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["water"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  node["amenity"="fountain"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
  way["amenity"="fountain"](${BOUNDS.south},${BOUNDS.west},${BOUNDS.north},${BOUNDS.east});
);
out body;
>;
out skel qt;
`.trim();

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  console.log("[OSM] Fetching Columbia University campus data...");
  let text = "";
  let ok = false;
  for (const endpoint of endpoints) {
    try {
      console.log(`[OSM] Trying ${endpoint}...`);
      const response = await fetch(endpoint, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      text = await response.text();
      if (response.ok && text.startsWith("{")) {
        ok = true;
        break;
      }
      console.log(`[OSM] ${endpoint} returned ${response.status}, trying next...`);
    } catch (e) {
      console.log(`[OSM] ${endpoint} failed: ${e}, trying next...`);
    }
  }
  if (!ok) {
    throw new Error(`All Overpass endpoints failed. Last response: ${text.slice(0, 200)}`);
  }

  const data = JSON.parse(text);
  console.log(`[OSM] Received ${data.elements.length} elements`);
  return data.elements as (OSMNode | OSMWay)[];
}

// ─── Main ───

async function main() {
  const elements = await fetchOSMData();

  const nodes = new Map<number, OSMNode>();
  const ways: OSMWay[] = [];
  for (const el of elements) {
    if (el.type === "node") nodes.set(el.id, el);
    if (el.type === "way") ways.push(el);
  }

  // Separate tagged nodes (trees, fountains) from geometry nodes
  const treeNodes: OSMNode[] = [];
  const fountainNodes: OSMNode[] = [];
  for (const el of elements) {
    if (el.type === "node" && el.tags) {
      if (el.tags["natural"] === "tree") treeNodes.push(el);
      if (el.tags["amenity"] === "fountain") fountainNodes.push(el);
    }
  }

  console.log(`[OSM] ${nodes.size} nodes, ${ways.length} ways, ${treeNodes.length} trees, ${fountainNodes.length} fountain nodes`);

  const rawMeshes: RawMesh[] = [];

  // Ground plane
  const groundSize = Math.max(
    (BOUNDS.north - BOUNDS.south) * M_PER_DEG_LAT,
    (BOUNDS.east - BOUNDS.west) * M_PER_DEG_LON
  ) * 1.3;

  const groundGeom = new THREE.PlaneGeometry(groundSize, groundSize);
  groundGeom.rotateX(-Math.PI / 2);
  const groundMesh = new THREE.Mesh(groundGeom);
  rawMeshes.push(extractMeshData(groundMesh, "ground_terrain", [0.29, 0.49, 0.35]));

  // Buildings
  let buildingCount = 0;
  for (const way of ways) {
    if (!way.tags?.["building"]) continue;

    const coords: [number, number][] = [];
    for (const nodeId of way.nodes) {
      const node = nodes.get(nodeId);
      if (node) coords.push(latLonToLocal(node.lat, node.lon));
    }

    const height = estimateHeight(way.tags);
    const name = getBuildingName(way.tags);
    const raw = buildBuildingMesh(coords, height, name);
    if (raw) {
      rawMeshes.push(raw);
      buildingCount++;
    }
  }

  // Trees (point nodes → trunk + canopy meshes)
  let treeCount = 0;
  for (const tree of treeNodes) {
    const [x, z] = latLonToLocal(tree.lat, tree.lon);
    const treeMeshes = buildTreeMesh(x, z, tree.id);
    rawMeshes.push(...treeMeshes);
    treeCount++;
  }

  // Vegetation areas (parks, gardens, grass)
  let vegAreaCount = 0;
  for (const way of ways) {
    if (!way.tags) continue;
    const isVeg = way.tags["leisure"] === "park" ||
                  way.tags["leisure"] === "garden" ||
                  way.tags["landuse"] === "grass";
    if (!isVeg) continue;

    const coords: [number, number][] = [];
    for (const nodeId of way.nodes) {
      const node = nodes.get(nodeId);
      if (node) coords.push(latLonToLocal(node.lat, node.lon));
    }

    const name = way.tags["name"] || way.tags["leisure"] || way.tags["landuse"] || "vegetation";
    const raw = buildVegetationAreaMesh(coords, name);
    if (raw) {
      rawMeshes.push(raw);
      vegAreaCount++;
    }
  }

  // Water areas (natural=water, water=*)
  let waterCount = 0;
  for (const way of ways) {
    if (!way.tags) continue;
    const isWater = way.tags["natural"] === "water" || !!way.tags["water"];
    const isFountainWay = way.tags["amenity"] === "fountain";
    if (!isWater && !isFountainWay) continue;
    // Skip if already counted as building
    if (way.tags["building"]) continue;

    const coords: [number, number][] = [];
    for (const nodeId of way.nodes) {
      const node = nodes.get(nodeId);
      if (node) coords.push(latLonToLocal(node.lat, node.lon));
    }

    if (isFountainWay) {
      const name = way.tags["name"] || "fountain";
      const raw = buildWaterMesh(coords, name);
      if (raw) {
        rawMeshes.push(raw);
        waterCount++;
      }
    } else {
      const name = way.tags["name"] || way.tags["water"] || "water";
      const raw = buildWaterMesh(coords, name);
      if (raw) {
        rawMeshes.push(raw);
        waterCount++;
      }
    }
  }

  // Fountain point nodes
  let fountainCount = 0;
  for (const node of fountainNodes) {
    const [x, z] = latLonToLocal(node.lat, node.lon);
    const fMeshes = buildFountainMesh(x, z, node.id);
    rawMeshes.push(...fMeshes);
    fountainCount++;
  }

  console.log(`[Scene] ${buildingCount} buildings, ${treeCount} trees, ${vegAreaCount} vegetation areas, ${waterCount} water areas, ${fountainCount} fountains`);
  console.log(`[Scene] ${rawMeshes.length} total meshes`);

  // Encode GLB
  console.log("[Export] Encoding GLB...");
  const glb = encodeGLB(rawMeshes);

  const outPath = `${import.meta.dir}/../public/models/columbia-campus.glb`;
  await Bun.write(outPath, glb);

  const sizeMB = (glb.byteLength / 1024 / 1024).toFixed(2);
  console.log(`[Export] Wrote ${outPath} (${sizeMB} MB, ${rawMeshes.length} meshes)`);
  console.log("[Done] Open http://localhost:3000 and drag the file onto the page");
}

main().catch(console.error);
