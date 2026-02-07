import { test, expect, describe, beforeEach } from "bun:test";
import { TerrainData } from "../../systems/TerrainSystem.ts";

// TerrainData is the pure-logic layer (no Three.js GPU deps)
// that manages the heightmap array and queries

describe("TerrainData", () => {
  let terrain: TerrainData;

  beforeEach(() => {
    terrain = new TerrainData({
      width: 100,
      depth: 100,
      resolution: 32, // 32x32 grid
    });
  });

  describe("initialization", () => {
    test("creates heightmap with correct size", () => {
      expect(terrain.heightmap).toBeInstanceOf(Float32Array);
      expect(terrain.heightmap.length).toBe(33 * 33); // (res+1)^2 vertices
    });

    test("initial heights are 0", () => {
      for (let i = 0; i < terrain.heightmap.length; i++) {
        expect(terrain.heightmap[i]).toBe(0);
      }
    });

    test("stores dimensions", () => {
      expect(terrain.width).toBe(100);
      expect(terrain.depth).toBe(100);
      expect(terrain.resolution).toBe(32);
    });
  });

  describe("setHeight / getHeight at grid points", () => {
    test("set and get height at grid coordinates", () => {
      terrain.setHeightAtGrid(10, 10, 5.5);
      expect(terrain.getHeightAtGrid(10, 10)).toBeCloseTo(5.5);
    });

    test("out-of-bounds grid coordinates clamp", () => {
      terrain.setHeightAtGrid(-1, -1, 10);
      expect(terrain.getHeightAtGrid(0, 0)).toBeCloseTo(10);

      terrain.setHeightAtGrid(100, 100, 20);
      expect(terrain.getHeightAtGrid(32, 32)).toBeCloseTo(20);
    });
  });

  describe("getHeightAt (world-space bilinear interpolation)", () => {
    test("returns 0 on flat terrain", () => {
      expect(terrain.getHeightAt(50, 50)).toBeCloseTo(0);
    });

    test("returns exact value at grid point", () => {
      // Grid point (16, 16) maps to world center (0, 0) if terrain centered
      // With width=100, depth=100, resolution=32:
      // World x range: -50 to +50, z range: -50 to +50
      // Grid (i, j) maps to world (x, z) = (-50 + i * (100/32), -50 + j * (100/32))
      terrain.setHeightAtGrid(16, 16, 10);
      const worldX = -50 + 16 * (100 / 32); // 0
      const worldZ = -50 + 16 * (100 / 32); // 0
      expect(terrain.getHeightAt(worldX, worldZ)).toBeCloseTo(10);
    });

    test("interpolates between grid points", () => {
      terrain.setHeightAtGrid(0, 0, 0);
      terrain.setHeightAtGrid(1, 0, 10);
      terrain.setHeightAtGrid(0, 1, 0);
      terrain.setHeightAtGrid(1, 1, 10);

      // Midpoint between grid 0 and 1 in x
      const cellSize = 100 / 32;
      const midX = -50 + 0.5 * cellSize;
      const midZ = -50;
      const h = terrain.getHeightAt(midX, midZ);
      expect(h).toBeCloseTo(5, 0);
    });

    test("returns clamped height outside terrain bounds", () => {
      terrain.setHeightAtGrid(0, 0, 7);
      // Outside terrain bounds should clamp to edge
      const h = terrain.getHeightAt(-999, -999);
      expect(h).toBeCloseTo(7);
    });
  });

  describe("deform", () => {
    test("deform raises terrain in radius", () => {
      terrain.deform(0, 0, 10, 5); // center, radius=10, delta=5

      const h = terrain.getHeightAt(0, 0);
      expect(h).toBeGreaterThan(0);
    });

    test("deform effect falls off with distance", () => {
      terrain.deform(0, 0, 20, 10);

      const center = terrain.getHeightAt(0, 0);
      const edge = terrain.getHeightAt(15, 0);

      expect(center).toBeGreaterThan(edge);
    });

    test("deform with negative delta creates crater", () => {
      terrain.deform(0, 0, 10, -5);

      const h = terrain.getHeightAt(0, 0);
      expect(h).toBeLessThan(0);
    });

    test("deform does not affect points outside radius", () => {
      terrain.deform(0, 0, 5, 10);

      // Point far from center should be unaffected
      const farH = terrain.getHeightAt(45, 45);
      expect(farH).toBeCloseTo(0, 1);
    });

    test("multiple deforms accumulate", () => {
      terrain.deform(0, 0, 10, 5);
      const h1 = terrain.getHeightAt(0, 0);

      terrain.deform(0, 0, 10, 5);
      const h2 = terrain.getHeightAt(0, 0);

      expect(h2).toBeGreaterThan(h1);
    });
  });

  describe("fromHeightmapArray", () => {
    test("loads height data from flat array", () => {
      const data = new Float32Array(33 * 33);
      data[0] = 42;
      data[33 * 33 - 1] = 99;

      terrain.fromHeightmapArray(data);

      expect(terrain.getHeightAtGrid(0, 0)).toBeCloseTo(42);
      expect(terrain.getHeightAtGrid(32, 32)).toBeCloseTo(99);
    });

    test("throws if array size mismatches", () => {
      const data = new Float32Array(10);
      expect(() => terrain.fromHeightmapArray(data)).toThrow();
    });
  });

  describe("getNormalAt", () => {
    test("flat terrain has upward normal", () => {
      const normal = terrain.getNormalAt(0, 0);
      expect(normal[0]).toBeCloseTo(0, 1);
      expect(normal[1]).toBeCloseTo(1, 1);
      expect(normal[2]).toBeCloseTo(0, 1);
    });

    test("sloped terrain has angled normal", () => {
      // Create a slope: height increases with x
      for (let i = 0; i <= 32; i++) {
        for (let j = 0; j <= 32; j++) {
          terrain.setHeightAtGrid(i, j, i * 2);
        }
      }

      const normal = terrain.getNormalAt(0, 0);
      // Normal should tilt in -x direction
      expect(normal[0]).toBeLessThan(0);
      expect(normal[1]).toBeGreaterThan(0);
    });
  });

  describe("getSlopeAt", () => {
    test("flat terrain has zero slope", () => {
      expect(terrain.getSlopeAt(0, 0)).toBeCloseTo(0, 1);
    });

    test("sloped terrain returns angle in radians", () => {
      for (let i = 0; i <= 32; i++) {
        for (let j = 0; j <= 32; j++) {
          terrain.setHeightAtGrid(i, j, i * 5);
        }
      }

      const slope = terrain.getSlopeAt(0, 0);
      expect(slope).toBeGreaterThan(0);
      expect(slope).toBeLessThan(Math.PI / 2);
    });
  });
});
