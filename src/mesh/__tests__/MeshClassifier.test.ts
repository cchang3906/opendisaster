import { test, expect, describe } from "bun:test";
import {
  MeshClassifier,
  type ClassifiedMesh,
  type MeshData,
} from "../MeshClassifier.ts";

// MeshData is a lightweight representation of mesh geometry
// that can be tested without Three.js

function makeMeshData(overrides: Partial<MeshData> = {}): MeshData {
  return {
    name: overrides.name ?? "mesh_001",
    vertexCount: overrides.vertexCount ?? 100,
    boundingBox: overrides.boundingBox ?? {
      min: [0, 0, 0],
      max: [10, 10, 10],
    },
    // Fraction of normals pointing up (dot with [0,1,0] > 0.8)
    upwardNormalFraction: overrides.upwardNormalFraction ?? 0.1,
    // Average position
    centroid: overrides.centroid ?? [5, 5, 5],
    // Whether the mesh is closed (watertight)
    isClosed: overrides.isClosed ?? true,
    // Dominant material color as [r, g, b] 0-1
    dominantColor: overrides.dominantColor ?? [0.5, 0.5, 0.5],
  };
}

describe("MeshClassifier", () => {
  const classifier = new MeshClassifier();

  describe("name-based classification", () => {
    test("mesh named 'building_01' classified as building", () => {
      const result = classifier.classify(makeMeshData({ name: "building_01" }));
      expect(result.type).toBe("building");
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    test("mesh named 'House' classified as building (case insensitive)", () => {
      const result = classifier.classify(makeMeshData({ name: "House" }));
      expect(result.type).toBe("building");
    });

    test("mesh named 'wall_section' classified as building", () => {
      const result = classifier.classify(makeMeshData({ name: "wall_section" }));
      expect(result.type).toBe("building");
    });

    test("mesh named 'roof_top' classified as building", () => {
      const result = classifier.classify(makeMeshData({ name: "roof_top" }));
      expect(result.type).toBe("building");
    });

    test("mesh named 'ground_plane' classified as ground", () => {
      const result = classifier.classify(makeMeshData({ name: "ground_plane" }));
      expect(result.type).toBe("ground");
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    test("mesh named 'Terrain_main' classified as ground", () => {
      const result = classifier.classify(makeMeshData({ name: "Terrain_main" }));
      expect(result.type).toBe("ground");
    });

    test("mesh named 'floor' classified as ground", () => {
      const result = classifier.classify(makeMeshData({ name: "floor" }));
      expect(result.type).toBe("ground");
    });

    test("mesh named 'tree_oak' classified as vegetation", () => {
      const result = classifier.classify(makeMeshData({ name: "tree_oak" }));
      expect(result.type).toBe("vegetation");
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    test("mesh named 'Bush_01' classified as vegetation", () => {
      const result = classifier.classify(makeMeshData({ name: "Bush_01" }));
      expect(result.type).toBe("vegetation");
    });

    test("mesh named 'grass_patch' classified as vegetation", () => {
      const result = classifier.classify(makeMeshData({ name: "grass_patch" }));
      expect(result.type).toBe("vegetation");
    });

    test("mesh named 'water_surface' classified as water", () => {
      const result = classifier.classify(makeMeshData({ name: "water_surface" }));
      expect(result.type).toBe("water");
    });

    test("mesh named 'ocean' classified as water", () => {
      const result = classifier.classify(makeMeshData({ name: "ocean" }));
      expect(result.type).toBe("water");
    });
  });

  describe("geometry-based classification", () => {
    test("tall narrow mesh classified as building", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "mesh_001",
          boundingBox: { min: [0, 0, 0], max: [5, 20, 5] },
          upwardNormalFraction: 0.1,
          isClosed: true,
          centroid: [2.5, 10, 2.5],
        })
      );
      expect(result.type).toBe("building");
    });

    test("flat wide mesh with mostly upward normals classified as ground", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "mesh_002",
          boundingBox: { min: [-50, -0.5, -50], max: [50, 0.5, 50] },
          upwardNormalFraction: 0.9,
          isClosed: false,
          centroid: [0, 0, 0],
        })
      );
      expect(result.type).toBe("ground");
    });

    test("medium height with branching (not closed, green) classified as vegetation", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "mesh_003",
          boundingBox: { min: [-2, 0, -2], max: [2, 8, 2] },
          upwardNormalFraction: 0.3,
          isClosed: false,
          centroid: [0, 4, 0],
          dominantColor: [0.2, 0.6, 0.15],
        })
      );
      expect(result.type).toBe("vegetation");
    });

    test("flat mesh at ground level classified as ground even without name hint", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "plane_001",
          boundingBox: { min: [-100, -1, -100], max: [100, 0, 100] },
          upwardNormalFraction: 0.95,
          isClosed: false,
          centroid: [0, -0.5, 0],
        })
      );
      expect(result.type).toBe("ground");
    });
  });

  describe("confidence scoring", () => {
    test("name match gives higher confidence than geometry-only", () => {
      const named = classifier.classify(
        makeMeshData({ name: "building_01" })
      );
      const unnamed = classifier.classify(
        makeMeshData({
          name: "obj_001",
          boundingBox: { min: [0, 0, 0], max: [5, 20, 5] },
          upwardNormalFraction: 0.1,
          isClosed: true,
        })
      );
      expect(named.confidence).toBeGreaterThan(unnamed.confidence);
    });

    test("ambiguous mesh gets low confidence", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "object_xyz",
          boundingBox: { min: [0, 0, 0], max: [5, 5, 5] },
          upwardNormalFraction: 0.5,
          isClosed: true,
          dominantColor: [0.5, 0.5, 0.5],
        })
      );
      expect(result.confidence).toBeLessThan(0.6);
    });
  });

  describe("batch classification", () => {
    test("classifyAll processes multiple meshes", () => {
      const meshes = [
        makeMeshData({ name: "building_01" }),
        makeMeshData({ name: "ground_plane" }),
        makeMeshData({ name: "tree_01" }),
      ];

      const results = classifier.classifyAll(meshes);
      expect(results).toHaveLength(3);
      expect(results[0]!.type).toBe("building");
      expect(results[1]!.type).toBe("ground");
      expect(results[2]!.type).toBe("vegetation");
    });

    test("classifyAll returns results in same order as input", () => {
      const meshes = [
        makeMeshData({ name: "tree_01" }),
        makeMeshData({ name: "building_01" }),
      ];

      const results = classifier.classifyAll(meshes);
      expect(results[0]!.type).toBe("vegetation");
      expect(results[1]!.type).toBe("building");
    });
  });

  describe("edge cases", () => {
    test("empty name falls back to geometry heuristics", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "",
          boundingBox: { min: [0, 0, 0], max: [10, 30, 10] },
          upwardNormalFraction: 0.05,
          isClosed: true,
        })
      );
      expect(result.type).toBe("building");
    });

    test("very small mesh gets classified", () => {
      const result = classifier.classify(
        makeMeshData({
          name: "tiny",
          boundingBox: { min: [0, 0, 0], max: [0.1, 0.1, 0.1] },
          vertexCount: 4,
          upwardNormalFraction: 0.5,
        })
      );
      expect(result.type).toBeDefined();
    });
  });
});
