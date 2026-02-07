import { test, expect, describe, beforeEach } from "bun:test";
import {
  MaterialRegistry,
  type PhysicsMaterial,
  MaterialType,
} from "../MaterialRegistry.ts";

describe("MaterialRegistry", () => {
  let registry: MaterialRegistry;

  beforeEach(() => {
    registry = new MaterialRegistry();
  });

  describe("built-in materials", () => {
    test("has all predefined materials", () => {
      const expected = [
        MaterialType.CONCRETE,
        MaterialType.WOOD,
        MaterialType.GLASS,
        MaterialType.STEEL,
        MaterialType.SOIL,
        MaterialType.WATER,
        MaterialType.ASPHALT,
        MaterialType.VEGETATION,
      ];

      for (const type of expected) {
        expect(registry.get(type)).toBeDefined();
      }
    });

    test("concrete has correct properties", () => {
      const concrete = registry.get(MaterialType.CONCRETE)!;
      expect(concrete.density).toBe(2400);
      expect(concrete.friction).toBeCloseTo(0.6);
      expect(concrete.flammable).toBe(false);
      expect(concrete.youngsModulus).toBe(30e9);
      expect(concrete.compressiveStrength).toBe(30e6);
    });

    test("wood is flammable with correct ignition temp", () => {
      const wood = registry.get(MaterialType.WOOD)!;
      expect(wood.density).toBe(500);
      expect(wood.flammable).toBe(true);
      expect(wood.ignitionTemp).toBe(300);
      expect(wood.youngsModulus).toBe(12e9);
    });

    test("glass is brittle", () => {
      const glass = registry.get(MaterialType.GLASS)!;
      expect(glass.brittle).toBe(true);
      expect(glass.density).toBe(2500);
    });

    test("steel has highest modulus", () => {
      const steel = registry.get(MaterialType.STEEL)!;
      expect(steel.youngsModulus).toBe(200e9);
      expect(steel.density).toBe(7800);
    });

    test("soil has geotechnical properties", () => {
      const soil = registry.get(MaterialType.SOIL)!;
      expect(soil.cohesion).toBeDefined();
      expect(soil.frictionAngle).toBeDefined();
      expect(soil.cohesion).toBe(10e3);
      expect(soil.frictionAngle).toBe(30);
    });

    test("water has viscosity", () => {
      const water = registry.get(MaterialType.WATER)!;
      expect(water.density).toBe(1000);
      expect(water.viscosity).toBe(0.001);
    });

    test("vegetation is flammable", () => {
      const veg = registry.get(MaterialType.VEGETATION)!;
      expect(veg.flammable).toBe(true);
      expect(veg.ignitionTemp).toBeLessThan(300);
    });
  });

  describe("custom materials", () => {
    test("register and retrieve custom material", () => {
      const custom: PhysicsMaterial = {
        id: "reinforced_concrete",
        name: "Reinforced Concrete",
        type: MaterialType.CONCRETE,
        density: 2500,
        youngsModulus: 35e9,
        compressiveStrength: 50e6,
        friction: 0.65,
        restitution: 0.1,
        flammable: false,
      };

      registry.register(custom);
      const retrieved = registry.getById("reinforced_concrete");
      expect(retrieved).toBeDefined();
      expect(retrieved!.density).toBe(2500);
      expect(retrieved!.compressiveStrength).toBe(50e6);
    });

    test("getById returns undefined for unknown id", () => {
      expect(registry.getById("nonexistent")).toBeUndefined();
    });
  });

  describe("material queries", () => {
    test("getFlammable returns only flammable materials", () => {
      const flammable = registry.getFlammable();
      expect(flammable.length).toBeGreaterThan(0);
      for (const mat of flammable) {
        expect(mat.flammable).toBe(true);
      }
    });

    test("all materials have required base properties", () => {
      const all = registry.getAll();
      for (const mat of all) {
        expect(mat.id).toBeDefined();
        expect(mat.name).toBeDefined();
        expect(mat.density).toBeGreaterThan(0);
        expect(mat.friction).toBeGreaterThanOrEqual(0);
        expect(mat.friction).toBeLessThanOrEqual(1);
      }
    });

    test("getMass computes mass from density and volume", () => {
      const mass = registry.getMass(MaterialType.CONCRETE, 10);
      expect(mass).toBe(2400 * 10);
    });
  });
});
