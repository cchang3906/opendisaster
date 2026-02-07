import * as THREE from "three";
import { query } from "bitecs";
import { Position, Rotation, Scale, MeshRef } from "../core/Components.ts";
import type { MeshDecomposer } from "../mesh/MeshDecomposer.ts";

export class RenderSystem {
  private scene: THREE.Scene;
  private decomposer: MeshDecomposer;

  // Previous positions for interpolation
  private prevPositions = new Map<number, THREE.Vector3>();

  constructor(scene: THREE.Scene, decomposer: MeshDecomposer) {
    this.scene = scene;
    this.decomposer = decomposer;
  }

  /**
   * Call after physics tick to snapshot current positions for interpolation.
   */
  saveState(world: any): void {
    const entities = query(world, [Position, Rotation, Scale, MeshRef]);
    for (const eid of entities) {
      if (!this.prevPositions.has(eid)) {
        this.prevPositions.set(eid, new THREE.Vector3());
      }
      this.prevPositions.get(eid)!.set(
        Position.x[eid]!,
        Position.y[eid]!,
        Position.z[eid]!
      );
    }
  }

  /**
   * Sync ECS state to Three.js objects with interpolation.
   * alpha = accumulator / fixedDt (0 to 1)
   */
  update(world: any, alpha: number): void {
    const entities = query(world, [Position, Rotation, Scale, MeshRef]);

    for (const eid of entities) {
      const obj = this.decomposer.getObject(MeshRef.objectId[eid]!);
      if (!obj) continue;

      // Ensure the object is in the scene
      if (!obj.parent) {
        this.scene.add(obj);
      }

      const prev = this.prevPositions.get(eid);
      const currX = Position.x[eid]!;
      const currY = Position.y[eid]!;
      const currZ = Position.z[eid]!;

      if (prev) {
        // Interpolate between previous and current physics state
        obj.position.set(
          prev.x + (currX - prev.x) * alpha,
          prev.y + (currY - prev.y) * alpha,
          prev.z + (currZ - prev.z) * alpha
        );
      } else {
        obj.position.set(currX, currY, currZ);
      }

      // Rotation (no interpolation for now — quaternion slerp is expensive)
      obj.quaternion.set(
        Rotation.x[eid]!,
        Rotation.y[eid]!,
        Rotation.z[eid]!,
        Rotation.w[eid]!
      );

      obj.scale.set(Scale.x[eid]!, Scale.y[eid]!, Scale.z[eid]!);
    }
  }

  removeEntity(eid: number): void {
    const obj = this.decomposer.getObject(MeshRef.objectId[eid]!);
    if (obj?.parent) {
      obj.parent.remove(obj);
    }
    this.prevPositions.delete(eid);
  }
}
