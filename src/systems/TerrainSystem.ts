export interface TerrainDataOptions {
  width: number; // world units
  depth: number; // world units
  resolution: number; // grid cells per side
}

/**
 * Pure-logic terrain heightmap. No Three.js dependencies.
 * Manages a 2D heightmap with bilinear interpolation, deformation, and normal queries.
 */
export class TerrainData {
  readonly width: number;
  readonly depth: number;
  readonly resolution: number;
  readonly heightmap: Float32Array;

  // Number of vertices per side = resolution + 1
  private readonly vertsPerSide: number;
  private readonly cellSizeX: number;
  private readonly cellSizeZ: number;

  // World-space origin (bottom-left corner)
  private readonly originX: number;
  private readonly originZ: number;

  constructor(options: TerrainDataOptions) {
    this.width = options.width;
    this.depth = options.depth;
    this.resolution = options.resolution;
    this.vertsPerSide = options.resolution + 1;
    this.heightmap = new Float32Array(this.vertsPerSide * this.vertsPerSide);

    this.cellSizeX = this.width / this.resolution;
    this.cellSizeZ = this.depth / this.resolution;
    this.originX = -this.width / 2;
    this.originZ = -this.depth / 2;
  }

  // --- Grid-level access ---

  setHeightAtGrid(i: number, j: number, height: number): void {
    i = Math.max(0, Math.min(this.resolution, i));
    j = Math.max(0, Math.min(this.resolution, j));
    this.heightmap[j * this.vertsPerSide + i] = height;
  }

  getHeightAtGrid(i: number, j: number): number {
    i = Math.max(0, Math.min(this.resolution, i));
    j = Math.max(0, Math.min(this.resolution, j));
    return this.heightmap[j * this.vertsPerSide + i]!;
  }

  // --- World-space queries with bilinear interpolation ---

  getHeightAt(worldX: number, worldZ: number): number {
    // Convert world coords to grid-space (continuous)
    let gx = (worldX - this.originX) / this.cellSizeX;
    let gz = (worldZ - this.originZ) / this.cellSizeZ;

    // Clamp to grid bounds
    gx = Math.max(0, Math.min(this.resolution, gx));
    gz = Math.max(0, Math.min(this.resolution, gz));

    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    const i1 = Math.min(i0 + 1, this.resolution);
    const j1 = Math.min(j0 + 1, this.resolution);

    const fx = gx - i0;
    const fz = gz - j0;

    // Bilinear interpolation
    const h00 = this.getHeightAtGrid(i0, j0);
    const h10 = this.getHeightAtGrid(i1, j0);
    const h01 = this.getHeightAtGrid(i0, j1);
    const h11 = this.getHeightAtGrid(i1, j1);

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;

    return h0 * (1 - fz) + h1 * fz;
  }

  // --- Deformation ---

  deform(worldX: number, worldZ: number, radius: number, delta: number): void {
    // Convert radius to grid units to find affected cells
    const gridRadiusX = radius / this.cellSizeX;
    const gridRadiusZ = radius / this.cellSizeZ;

    const centerGX = (worldX - this.originX) / this.cellSizeX;
    const centerGZ = (worldZ - this.originZ) / this.cellSizeZ;

    const iMin = Math.max(0, Math.floor(centerGX - gridRadiusX));
    const iMax = Math.min(this.resolution, Math.ceil(centerGX + gridRadiusX));
    const jMin = Math.max(0, Math.floor(centerGZ - gridRadiusZ));
    const jMax = Math.min(this.resolution, Math.ceil(centerGZ + gridRadiusZ));

    for (let j = jMin; j <= jMax; j++) {
      for (let i = iMin; i <= iMax; i++) {
        // World-space distance from deformation center
        const wx = this.originX + i * this.cellSizeX;
        const wz = this.originZ + j * this.cellSizeZ;
        const dx = wx - worldX;
        const dz = wz - worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < radius) {
          // Smooth falloff: cosine bell
          const t = dist / radius;
          const falloff = 0.5 * (1 + Math.cos(Math.PI * t));
          const idx = j * this.vertsPerSide + i;
          this.heightmap[idx] =
            (this.heightmap[idx] ?? 0) + delta * falloff;
        }
      }
    }
  }

  // --- Bulk loading ---

  fromHeightmapArray(data: Float32Array): void {
    if (data.length !== this.heightmap.length) {
      throw new Error(
        `Heightmap size mismatch: expected ${this.heightmap.length}, got ${data.length}`
      );
    }
    this.heightmap.set(data);
  }

  // --- Normal computation ---

  getNormalAt(worldX: number, worldZ: number): [number, number, number] {
    const eps = this.cellSizeX;

    const hL = this.getHeightAt(worldX - eps, worldZ);
    const hR = this.getHeightAt(worldX + eps, worldZ);
    const hD = this.getHeightAt(worldX, worldZ - eps);
    const hU = this.getHeightAt(worldX, worldZ + eps);

    // Central difference
    let nx = hL - hR;
    let ny = 2 * eps;
    let nz = hD - hU;

    // Normalize
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    return [nx, ny, nz];
  }

  getSlopeAt(worldX: number, worldZ: number): number {
    const [nx, ny, nz] = this.getNormalAt(worldX, worldZ);
    // Slope angle = acos(dot(normal, up))
    return Math.acos(Math.min(1, Math.abs(ny)));
  }
}
