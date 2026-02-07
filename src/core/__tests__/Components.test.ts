import { test, expect, describe } from "bun:test";
import {
  createWorld,
  addEntity,
  addComponent,
  hasComponent,
  registerComponent,
} from "bitecs";
import {
  Position,
  Rotation,
  Scale,
  Velocity,
  MeshRef,
  PhysicsBody,
  Health,
  Classification,
  TerrainCell,
  ClassificationType,
} from "../Components.ts";

function setup() {
  const world = createWorld();
  // Register all components with this world
  for (const c of [
    Position,
    Rotation,
    Scale,
    Velocity,
    MeshRef,
    PhysicsBody,
    Health,
    Classification,
    TerrainCell,
  ]) {
    registerComponent(world, c);
  }
  return world;
}

describe("Components", () => {
  describe("Position component", () => {
    test("stores double-precision xyz coordinates", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, Position);

      Position.x[eid] = 123456.789;
      Position.y[eid] = 0.001;
      Position.z[eid] = -987654.321;

      expect(Position.x[eid]).toBeCloseTo(123456.789, 3);
      expect(Position.y[eid]).toBeCloseTo(0.001, 6);
      expect(Position.z[eid]).toBeCloseTo(-987654.321, 3);
    });

    test("x/y/z arrays are Float64Array for km-scale precision", () => {
      expect(Position.x).toBeInstanceOf(Float64Array);
      expect(Position.y).toBeInstanceOf(Float64Array);
      expect(Position.z).toBeInstanceOf(Float64Array);
    });
  });

  describe("Rotation component", () => {
    test("stores quaternion xyzw", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, Rotation);

      Rotation.x[eid] = 0;
      Rotation.y[eid] = 0.7071;
      Rotation.z[eid] = 0;
      Rotation.w[eid] = 0.7071;

      expect(Rotation.y[eid]).toBeCloseTo(0.7071, 4);
      expect(Rotation.w[eid]).toBeCloseTo(0.7071, 4);
    });
  });

  describe("Scale component", () => {
    test("default scale should be settable to 1,1,1", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, Scale);

      Scale.x[eid] = 1;
      Scale.y[eid] = 1;
      Scale.z[eid] = 1;

      expect(Scale.x[eid]).toBe(1);
    });
  });

  describe("Velocity component", () => {
    test("stores velocity vector", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, Velocity);

      Velocity.x[eid] = 5.5;
      Velocity.y[eid] = -9.8;
      Velocity.z[eid] = 3.2;

      expect(Velocity.x[eid]).toBeCloseTo(5.5);
      expect(Velocity.y[eid]).toBeCloseTo(-9.8);
    });
  });

  describe("MeshRef component", () => {
    test("stores object pool index", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, MeshRef);

      MeshRef.objectId[eid] = 42;
      expect(MeshRef.objectId[eid]).toBe(42);
    });
  });

  describe("PhysicsBody component", () => {
    test("stores body ID, mass, and material ID", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, PhysicsBody);

      PhysicsBody.bodyId[eid] = 100;
      PhysicsBody.mass[eid] = 5000.5;
      PhysicsBody.materialId[eid] = 3;

      expect(PhysicsBody.bodyId[eid]).toBe(100);
      expect(PhysicsBody.mass[eid]).toBeCloseTo(5000.5);
      expect(PhysicsBody.materialId[eid]).toBe(3);
    });
  });

  describe("Health component", () => {
    test("tracks current, max, and damage threshold", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, Health);

      Health.current[eid] = 80;
      Health.max[eid] = 100;
      Health.damageThreshold[eid] = 0.04;

      expect(Health.current[eid]).toBe(80);
      expect(Health.max[eid]).toBe(100);
      expect(Health.damageThreshold[eid]).toBeCloseTo(0.04);
    });
  });

  describe("Classification component", () => {
    test("stores classification type enum", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, Classification);

      Classification.type[eid] = ClassificationType.BUILDING;
      expect(Classification.type[eid]).toBe(ClassificationType.BUILDING);

      Classification.type[eid] = ClassificationType.GROUND;
      expect(Classification.type[eid]).toBe(ClassificationType.GROUND);
    });

    test("classification enum values are distinct", () => {
      expect(ClassificationType.GROUND).not.toBe(ClassificationType.BUILDING);
      expect(ClassificationType.BUILDING).not.toBe(ClassificationType.VEGETATION);
      expect(ClassificationType.VEGETATION).not.toBe(ClassificationType.WATER);
      expect(ClassificationType.WATER).not.toBe(ClassificationType.DEBRIS);
    });
  });

  describe("TerrainCell component", () => {
    test("stores terrain properties", () => {
      const world = setup();
      const eid = addEntity(world);
      addComponent(world, eid, TerrainCell);

      TerrainCell.height[eid] = 150.5;
      TerrainCell.moisture[eid] = 0.3;
      TerrainCell.fuelLoad[eid] = 0.8;
      TerrainCell.temperature[eid] = 25.0;

      expect(TerrainCell.height[eid]).toBeCloseTo(150.5);
      expect(TerrainCell.moisture[eid]).toBeCloseTo(0.3);
      expect(TerrainCell.fuelLoad[eid]).toBeCloseTo(0.8);
      expect(TerrainCell.temperature[eid]).toBeCloseTo(25.0);
    });
  });

  describe("component independence", () => {
    test("entities can have different component combinations", () => {
      const world = setup();
      const building = addEntity(world);
      const ground = addEntity(world);

      addComponent(world, building, Position);
      addComponent(world, building, Health);
      addComponent(world, building, PhysicsBody);
      addComponent(world, building, Classification);

      addComponent(world, ground, Position);
      addComponent(world, ground, TerrainCell);
      addComponent(world, ground, Classification);

      expect(hasComponent(world, building, Health)).toBe(true);
      expect(hasComponent(world, ground, Health)).toBe(false);
      expect(hasComponent(world, building, TerrainCell)).toBe(false);
      expect(hasComponent(world, ground, TerrainCell)).toBe(true);
    });
  });
});
