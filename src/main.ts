import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Engine } from "./core/Engine.ts";
import { SimWorld } from "./core/World.ts";
import { EventBus } from "./core/EventBus.ts";
import { MaterialRegistry } from "./core/MaterialRegistry.ts";

async function main() {
  const engine = new Engine();
  const world = new SimWorld();
  const eventBus = new EventBus();
  const materials = new MaterialRegistry();

  // Start renderer first
  await engine.start();
  console.log("[OpenDisaster] Engine started");

  // Load Columbia campus directly
  const loader = new GLTFLoader();
  loader.load(
    "/models/columbia-campus.glb",
    (gltf) => {
      console.log("[Import] GLB loaded, adding to scene");
      const model = gltf.scene;

      // Configure meshes
      let meshCount = 0;
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
          child.castShadow = true;
          child.receiveShadow = true;

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

function updateInfo(text: string) {
  const el = document.getElementById("info");
  if (el) el.textContent = `OpenDisaster — ${text}`;
}

main().catch(console.error);
