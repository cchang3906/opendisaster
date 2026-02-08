import * as THREE from "three";

type MaterialKind = "building" | "ground" | "road" | "vegetation" | "water";

export class StylizedMaterialLibrary {
  private materials: Record<MaterialKind, THREE.MeshStandardMaterial>;

  constructor() {
    const roof = makeRoofTexture();
    const wall = makeWallTexture();
    const grass = makeGrassTexture();
    const dirt = makeDirtTexture();
    const asphalt = makeAsphaltTexture();
    const water = makeWaterTexture();

    this.materials = {
      building: createTriplanarMaterial(roof, wall, {
        roughness: 0.85,
        metalness: 0.05,
        texScale: 0.03,
      }),
      ground: createTriplanarMaterial(grass, dirt, {
        roughness: 0.95,
        metalness: 0.0,
        texScale: 0.015,
      }),
      road: createTriplanarMaterial(asphalt, asphalt, {
        roughness: 0.9,
        metalness: 0.0,
        texScale: 0.08,
      }),
      vegetation: new THREE.MeshStandardMaterial({
        color: 0x3f8a4d,
        roughness: 1.0,
        metalness: 0.0,
      }),
      water: new THREE.MeshStandardMaterial({
        color: 0x3a6ea5,
        roughness: 0.2,
        metalness: 0.0,
        transparent: true,
        opacity: 0.8,
      }),
    };
  }

  getMaterial(kind: MaterialKind): THREE.MeshStandardMaterial {
    return this.materials[kind];
  }
}

function createTriplanarMaterial(
  topTex: THREE.Texture,
  sideTex: THREE.Texture,
  opts: { roughness: number; metalness: number; texScale: number }
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: opts.roughness,
    metalness: opts.metalness,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.mapTop = { value: topTex };
    shader.uniforms.mapSide = { value: sideTex };
    shader.uniforms.uTexScale = { value: opts.texScale };

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      [
        "#include <common>",
        "varying vec3 vWorldPos;",
        "varying vec3 vWorldNormal;",
      ].join("\n")
    );

    shader.vertexShader = shader.vertexShader.replace(
      "#include <worldpos_vertex>",
      [
        "#include <worldpos_vertex>",
        "vWorldPos = worldPosition.xyz;",
        "vWorldNormal = normalize(mat3(modelMatrix) * normal);",
      ].join("\n")
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      [
        "#include <common>",
        "uniform sampler2D mapTop;",
        "uniform sampler2D mapSide;",
        "uniform float uTexScale;",
        "varying vec3 vWorldPos;",
        "varying vec3 vWorldNormal;",
      ].join("\n")
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      [
        "vec3 wp = vWorldPos * uTexScale;",
        "vec3 n = normalize(vWorldNormal);",
        "vec3 blend = abs(n);",
        "blend = pow(blend, vec3(4.0));",
        "blend /= (blend.x + blend.y + blend.z);",
        "vec4 topCol = texture2D(mapTop, wp.xz);",
        "vec4 sideX = texture2D(mapSide, wp.zy);",
        "vec4 sideZ = texture2D(mapSide, wp.xy);",
        "vec4 triCol = topCol * blend.y + sideX * blend.x + sideZ * blend.z;",
        "diffuseColor *= triCol;",
      ].join("\n")
    );
  };

  mat.needsUpdate = true;
  return mat;
}

function makeCanvasTexture(
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  size = 256
): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function makeRoofTexture(): THREE.Texture {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#6f5b4b";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    const step = size / 8;
    for (let y = 0; y <= size; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  });
}

function makeWallTexture(): THREE.Texture {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#c9b9a2";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    const brickW = size / 8;
    const brickH = size / 10;
    for (let y = 0; y < size; y += brickH) {
      const offset = (y / brickH) % 2 === 0 ? 0 : brickW / 2;
      for (let x = -offset; x < size; x += brickW) {
        ctx.strokeRect(x + offset, y, brickW, brickH);
      }
    }
  });
}

function makeGrassTexture(): THREE.Texture {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#4b8f3a";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const g = 100 + Math.random() * 80;
      ctx.fillStyle = `rgba(60,${g},60,0.25)`;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

function makeDirtTexture(): THREE.Texture {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#6b5b4b";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const v = 80 + Math.random() * 60;
      ctx.fillStyle = `rgba(${v},${v * 0.9},${v * 0.7},0.35)`;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

function makeAsphaltTexture(): THREE.Texture {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#2f2f2f";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const v = 60 + Math.random() * 50;
      ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, size * 0.5);
    ctx.lineTo(size, size * 0.5);
    ctx.stroke();
  });
}

function makeWaterTexture(): THREE.Texture {
  return makeCanvasTexture((ctx, size) => {
    ctx.fillStyle = "#3a6ea5";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    for (let i = 0; i < 20; i++) {
      const y = (i / 20) * size + 4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  });
}
