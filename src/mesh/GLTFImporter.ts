import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshClassifier, type MeshData, type ClassifiedMesh } from "./MeshClassifier.ts";

export interface ImportResult {
  scene: THREE.Group;
  classified: ClassifiedMesh[];
  meshes: THREE.Mesh[];
}

export class GLTFImporter {
  private loader: GLTFLoader;
  private classifier: MeshClassifier;

  constructor() {
    this.loader = new GLTFLoader();
    this.classifier = new MeshClassifier();

    // Draco decoder for compressed meshes
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    this.loader.setDRACOLoader(dracoLoader);
  }

  async loadFromFile(file: File): Promise<ImportResult> {
    const buffer = await file.arrayBuffer();
    return this.loadFromBuffer(buffer, file.name);
  }

  async loadFromURL(url: string): Promise<ImportResult> {
    return new Promise((resolve, reject) => {
      this.loader.load(
        url,
        (gltf) => {
          resolve(this.processScene(gltf.scene));
        },
        undefined,
        reject
      );
    });
  }

  async loadFromBuffer(buffer: ArrayBuffer, filename: string): Promise<ImportResult> {
    return new Promise((resolve, reject) => {
      this.loader.parse(
        buffer,
        "",
        (gltf) => {
          resolve(this.processScene(gltf.scene));
        },
        (error) => reject(error)
      );
    });
  }

  private processScene(scene: THREE.Group): ImportResult {
    const meshes: THREE.Mesh[] = [];
    const meshDataList: MeshData[] = [];

    scene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshes.push(child);
        meshDataList.push(this.extractMeshData(child));
      }
    });

    const classified = this.classifier.classifyAll(meshDataList);

    return { scene, classified, meshes };
  }

  private extractMeshData(mesh: THREE.Mesh): MeshData {
    const geometry = mesh.geometry;
    geometry.computeBoundingBox();

    const bb = geometry.boundingBox!;
    const bbWorld = bb.clone().applyMatrix4(mesh.matrixWorld);

    // Compute upward normal fraction
    let upwardCount = 0;
    let totalCount = 0;
    const normalAttr = geometry.getAttribute("normal");
    if (normalAttr) {
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      const tempNormal = new THREE.Vector3();
      for (let i = 0; i < normalAttr.count; i++) {
        tempNormal.fromBufferAttribute(normalAttr, i);
        tempNormal.applyMatrix3(normalMatrix).normalize();
        if (tempNormal.y > 0.8) upwardCount++;
        totalCount++;
      }
    }

    // Extract dominant color from material
    let dominantColor: [number, number, number] = [0.5, 0.5, 0.5];
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (material && "color" in material) {
      const c = (material as THREE.MeshStandardMaterial).color;
      dominantColor = [c.r, c.g, c.b];
    }

    // Centroid from bounding box
    const center = new THREE.Vector3();
    bbWorld.getCenter(center);

    return {
      name: mesh.name,
      vertexCount: geometry.getAttribute("position")?.count ?? 0,
      boundingBox: {
        min: [bbWorld.min.x, bbWorld.min.y, bbWorld.min.z],
        max: [bbWorld.max.x, bbWorld.max.y, bbWorld.max.z],
      },
      upwardNormalFraction: totalCount > 0 ? upwardCount / totalCount : 0,
      centroid: [center.x, center.y, center.z],
      isClosed: false, // rough heuristic: we'd need to check edges
      dominantColor,
    };
  }
}
