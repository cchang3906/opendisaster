import * as THREE from "three";
import { addEntity, addComponent, removeEntity } from "bitecs";
import {
  Position,
  Rotation,
  Scale,
  Velocity,
  MeshRef,
  PhysicsBody,
  Classification,
  ClassificationType,
} from "../core/Components.ts";
import { EventBus } from "../core/EventBus.ts";
import type { PhysicsSystem } from "./PhysicsSystem.ts";
import type { MeshDecomposer } from "../mesh/MeshDecomposer.ts";

export interface FractureResult {
  fragments: THREE.Mesh[];
  entityIds: number[];
}

/**
 * Handles structural fracture via simple plane-slicing Voronoi.
 * Listens for STRUCTURE_COLLAPSE events and creates debris fragments.
 */
export class DestructionSystem {
  private eventBus: EventBus;
  private physics: PhysicsSystem;
  private decomposer: MeshDecomposer;
  private scene: THREE.Scene;

  constructor(
    eventBus: EventBus,
    physics: PhysicsSystem,
    decomposer: MeshDecomposer,
    scene: THREE.Scene
  ) {
    this.eventBus = eventBus;
    this.physics = physics;
    this.decomposer = decomposer;
    this.scene = scene;

    this.eventBus.on("STRUCTURE_COLLAPSE", (event) => {
      if (event.type === "STRUCTURE_COLLAPSE") {
        this.onCollapse(event.entityId, event.position);
      }
    });
  }

  private onCollapse(entityId: number, position: [number, number, number]): void {
    const obj = this.decomposer.getObject(MeshRef.objectId[entityId]!);
    if (!obj || !(obj instanceof THREE.Mesh)) return;

    // Remove original body
    this.physics.removeBody(entityId);

    // Generate fragments
    const fragments = this.fractureMesh(obj as THREE.Mesh, 8);

    // Create ECS entities for each fragment
    for (const fragment of fragments) {
      this.spawnFragment(fragment, position);
    }

    // Remove original entity from scene
    if (obj.parent) obj.parent.remove(obj);
    removeEntity(this.decomposer as any, entityId);
  }

  /**
   * Simple fracture: split a mesh into fragments using random planes.
   * This is a simplified version — real Voronoi fracture would use three-pinata.
   */
  fractureMesh(mesh: THREE.Mesh, numFragments: number): THREE.Mesh[] {
    const fragments: THREE.Mesh[] = [];
    const bbox = new THREE.Box3().setFromObject(mesh);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Generate fragment boxes as simple stand-in geometry
    const material = (mesh.material as THREE.Material).clone();
    const fragSize = Math.cbrt(
      (size.x * size.y * size.z) / numFragments
    );

    for (let i = 0; i < numFragments; i++) {
      const sx = fragSize * (0.5 + Math.random() * 0.5);
      const sy = fragSize * (0.5 + Math.random() * 0.5);
      const sz = fragSize * (0.5 + Math.random() * 0.5);

      const geom = new THREE.BoxGeometry(sx, sy, sz);
      const frag = new THREE.Mesh(geom, material);

      // Random position within the bounding box
      frag.position.set(
        center.x + (Math.random() - 0.5) * size.x * 0.8,
        center.y + (Math.random() - 0.5) * size.y * 0.8,
        center.z + (Math.random() - 0.5) * size.z * 0.8
      );

      fragments.push(frag);
    }

    return fragments;
  }

  private spawnFragment(
    mesh: THREE.Mesh,
    origin: [number, number, number]
  ): void {
    const world = null; // Will be set when integrated
    // For now, just add to scene directly
    this.scene.add(mesh);

    // Add outward impulse
    const dx = mesh.position.x - origin[0];
    const dy = mesh.position.y - origin[1] + 2;
    const dz = mesh.position.z - origin[2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const force = 5 + Math.random() * 10;

    mesh.userData.velocity = new THREE.Vector3(
      (dx / len) * force,
      (dy / len) * force + 5,
      (dz / len) * force
    );
  }
}
