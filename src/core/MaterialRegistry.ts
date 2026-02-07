export enum MaterialType {
  CONCRETE = 0,
  WOOD = 1,
  GLASS = 2,
  STEEL = 3,
  SOIL = 4,
  WATER = 5,
  ASPHALT = 6,
  VEGETATION = 7,
}

export interface PhysicsMaterial {
  id: string;
  name: string;
  type: MaterialType;
  density: number; // kg/m³
  youngsModulus?: number; // Pa
  compressiveStrength?: number; // Pa
  friction: number; // 0-1
  restitution?: number; // 0-1 (bounciness)
  flammable?: boolean;
  ignitionTemp?: number; // °C
  brittle?: boolean;
  viscosity?: number; // Pa·s
  cohesion?: number; // Pa (for soil)
  frictionAngle?: number; // degrees (for soil)
}

const BUILTIN_MATERIALS: PhysicsMaterial[] = [
  {
    id: "concrete",
    name: "Concrete",
    type: MaterialType.CONCRETE,
    density: 2400,
    youngsModulus: 30e9,
    compressiveStrength: 30e6,
    friction: 0.6,
    restitution: 0.2,
    flammable: false,
  },
  {
    id: "wood",
    name: "Wood",
    type: MaterialType.WOOD,
    density: 500,
    youngsModulus: 12e9,
    compressiveStrength: 40e6,
    friction: 0.4,
    restitution: 0.3,
    flammable: true,
    ignitionTemp: 300,
  },
  {
    id: "glass",
    name: "Glass",
    type: MaterialType.GLASS,
    density: 2500,
    youngsModulus: 70e9,
    compressiveStrength: 45e6,
    friction: 0.2,
    restitution: 0.1,
    flammable: false,
    brittle: true,
  },
  {
    id: "steel",
    name: "Steel",
    type: MaterialType.STEEL,
    density: 7800,
    youngsModulus: 200e9,
    compressiveStrength: 250e6,
    friction: 0.5,
    restitution: 0.3,
    flammable: false,
  },
  {
    id: "soil",
    name: "Soil",
    type: MaterialType.SOIL,
    density: 1500,
    friction: 0.7,
    restitution: 0.05,
    flammable: false,
    cohesion: 10e3,
    frictionAngle: 30,
  },
  {
    id: "water",
    name: "Water",
    type: MaterialType.WATER,
    density: 1000,
    friction: 0.01,
    restitution: 0.0,
    flammable: false,
    viscosity: 0.001,
  },
  {
    id: "asphalt",
    name: "Asphalt",
    type: MaterialType.ASPHALT,
    density: 2300,
    youngsModulus: 3e9,
    friction: 0.65,
    restitution: 0.1,
    flammable: false,
  },
  {
    id: "vegetation",
    name: "Vegetation",
    type: MaterialType.VEGETATION,
    density: 400,
    friction: 0.5,
    restitution: 0.1,
    flammable: true,
    ignitionTemp: 250,
  },
];

export class MaterialRegistry {
  private byType = new Map<MaterialType, PhysicsMaterial>();
  private byId = new Map<string, PhysicsMaterial>();

  constructor() {
    for (const mat of BUILTIN_MATERIALS) {
      this.byType.set(mat.type, mat);
      this.byId.set(mat.id, mat);
    }
  }

  get(type: MaterialType): PhysicsMaterial | undefined {
    return this.byType.get(type);
  }

  getById(id: string): PhysicsMaterial | undefined {
    return this.byId.get(id);
  }

  register(material: PhysicsMaterial): void {
    this.byId.set(material.id, material);
    // Only overwrite type map if this is a new type or explicit override
    if (!this.byType.has(material.type)) {
      this.byType.set(material.type, material);
    }
  }

  getAll(): PhysicsMaterial[] {
    return Array.from(this.byId.values());
  }

  getFlammable(): PhysicsMaterial[] {
    return this.getAll().filter((m) => m.flammable === true);
  }

  getMass(type: MaterialType, volume: number): number {
    const mat = this.byType.get(type);
    if (!mat) throw new Error(`Unknown material type: ${type}`);
    return mat.density * volume;
  }
}
