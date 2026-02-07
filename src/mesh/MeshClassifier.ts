export interface BoundingBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface MeshData {
  name: string;
  vertexCount: number;
  boundingBox: BoundingBox;
  upwardNormalFraction: number; // 0-1: fraction of normals pointing up
  centroid: [number, number, number];
  isClosed: boolean;
  dominantColor?: [number, number, number]; // RGB 0-1
}

export type MeshType = "building" | "ground" | "vegetation" | "water" | "unknown";

export interface ClassifiedMesh {
  mesh: MeshData;
  type: MeshType;
  confidence: number; // 0-1
}

const NAME_PATTERNS: { pattern: RegExp; type: MeshType }[] = [
  { pattern: /building|house|wall|roof|tower|apartment|office|store|shop|facade/i, type: "building" },
  { pattern: /water|ocean|sea|river|lake|pond|stream/i, type: "water" },
  { pattern: /tree|bush|grass|plant|vegetation|forest|hedge|shrub|leaf/i, type: "vegetation" },
  { pattern: /ground|terrain|floor|land|earth|surface|plane/i, type: "ground" },
];

export class MeshClassifier {
  classify(mesh: MeshData): ClassifiedMesh {
    // 1. Name-based classification (highest priority)
    const nameResult = this.classifyByName(mesh.name);
    if (nameResult) {
      return { mesh, type: nameResult, confidence: 0.9 };
    }

    // 2. Geometry + material heuristics
    return this.classifyByGeometry(mesh);
  }

  classifyAll(meshes: MeshData[]): ClassifiedMesh[] {
    return meshes.map((m) => this.classify(m));
  }

  private classifyByName(name: string): MeshType | null {
    if (!name) return null;
    for (const { pattern, type } of NAME_PATTERNS) {
      if (pattern.test(name)) return type;
    }
    return null;
  }

  private classifyByGeometry(mesh: MeshData): ClassifiedMesh {
    const scores: Record<MeshType, number> = {
      building: 0,
      ground: 0,
      vegetation: 0,
      water: 0,
      unknown: 0.1, // small bias so something always wins
    };

    const bb = mesh.boundingBox;
    const width = bb.max[0] - bb.min[0];
    const height = bb.max[1] - bb.min[1];
    const depth = bb.max[2] - bb.min[2];
    const footprint = Math.max(width, depth);
    const aspectRatio = footprint > 0 ? height / footprint : 0;

    // Building heuristics: tall, closed, low upward normal fraction
    if (aspectRatio > 0.5) scores.building += 0.2;
    if (aspectRatio > 1.0) scores.building += 0.15;
    if (mesh.isClosed) scores.building += 0.2; // closed mesh is strong building signal
    if (mesh.upwardNormalFraction < 0.3) scores.building += 0.1;
    // Open meshes are unlikely to be buildings
    if (!mesh.isClosed) scores.building -= 0.15;

    // Ground heuristics: flat, mostly upward normals, large footprint
    if (mesh.upwardNormalFraction > 0.8) scores.ground += 0.4;
    if (aspectRatio < 0.1) scores.ground += 0.3;
    if (footprint > 20) scores.ground += 0.1;
    if (!mesh.isClosed) scores.ground += 0.05;

    // Vegetation heuristics: not closed, green color, moderate height
    if (mesh.dominantColor) {
      const [r, g, b] = mesh.dominantColor;
      if (g > r && g > b && g > 0.3) scores.vegetation += 0.4;
    }
    if (!mesh.isClosed && aspectRatio > 0.3 && aspectRatio < 5) {
      scores.vegetation += 0.15;
    }

    // Water heuristics: blue color, flat, not closed
    if (mesh.dominantColor) {
      const [r, g, b] = mesh.dominantColor;
      if (b > r && b > g && b > 0.3) scores.water += 0.3;
    }
    if (mesh.upwardNormalFraction > 0.9 && !mesh.isClosed) {
      scores.water += 0.1;
    }

    // Find winner
    let bestType: MeshType = "unknown";
    let bestScore = 0;
    for (const [type, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type as MeshType;
      }
    }

    return {
      mesh,
      type: bestType,
      confidence: Math.min(bestScore, 1),
    };
  }
}
