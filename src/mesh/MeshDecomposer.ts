import * as THREE from "three";
import { addComponent, addEntity } from "bitecs";
import {
  Position,
  Rotation,
  Scale,
  MeshRef,
  Health,
  Classification,
  ClassificationType,
} from "../core/Components.ts";
import { MaterialType } from "../core/MaterialRegistry.ts";
import type { ClassifiedMesh, MeshType } from "./MeshClassifier.ts";

const TYPE_TO_CLASSIFICATION: Record<MeshType, ClassificationType> = {
  building: ClassificationType.BUILDING,
  ground: ClassificationType.GROUND,
  vegetation: ClassificationType.VEGETATION,
  water: ClassificationType.WATER,
  unknown: ClassificationType.GROUND,
};

const TYPE_TO_MATERIAL: Record<MeshType, MaterialType> = {
  building: MaterialType.CONCRETE,
  ground: MaterialType.SOIL,
  vegetation: MaterialType.VEGETATION,
  water: MaterialType.WATER,
  unknown: MaterialType.SOIL,
};

export interface DecomposedEntity {
  entityId: number;
  mesh: THREE.Mesh;
  classificationType: ClassificationType;
  materialType: MaterialType;
}

export class MeshDecomposer {
  private objectPool: THREE.Object3D[] = [];

  decompose(
    ecsWorld: any,
    classifiedMeshes: ClassifiedMesh[],
    threeMeshes: THREE.Mesh[]
  ): DecomposedEntity[] {
    const entities: DecomposedEntity[] = [];

    for (let i = 0; i < classifiedMeshes.length; i++) {
      const classified = classifiedMeshes[i]!;
      const mesh = threeMeshes[i]!;

      const eid = addEntity(ecsWorld);

      // Position
      addComponent(ecsWorld, Position, eid);
      Position.x[eid] = mesh.position.x;
      Position.y[eid] = mesh.position.y;
      Position.z[eid] = mesh.position.z;

      // Rotation
      addComponent(ecsWorld, Rotation, eid);
      Rotation.x[eid] = mesh.quaternion.x;
      Rotation.y[eid] = mesh.quaternion.y;
      Rotation.z[eid] = mesh.quaternion.z;
      Rotation.w[eid] = mesh.quaternion.w;

      // Scale
      addComponent(ecsWorld, Scale, eid);
      Scale.x[eid] = mesh.scale.x;
      Scale.y[eid] = mesh.scale.y;
      Scale.z[eid] = mesh.scale.z;

      // MeshRef
      addComponent(ecsWorld, MeshRef, eid);
      const poolIdx = this.objectPool.length;
      this.objectPool.push(mesh);
      MeshRef.objectId[eid] = poolIdx;

      // Classification
      addComponent(ecsWorld, Classification, eid);
      const classificationType = TYPE_TO_CLASSIFICATION[classified.type];
      Classification.type[eid] = classificationType;

      // Health (for buildings)
      if (classified.type === "building") {
        addComponent(ecsWorld, Health, eid);
        Health.current[eid] = 100;
        Health.max[eid] = 100;
        Health.damageThreshold[eid] = 0.04;
      }

      entities.push({
        entityId: eid,
        mesh,
        classificationType,
        materialType: TYPE_TO_MATERIAL[classified.type],
      });
    }

    return entities;
  }

  getObject(poolIdx: number): THREE.Object3D | undefined {
    return this.objectPool[poolIdx];
  }

  get poolSize(): number {
    return this.objectPool.length;
  }
}
