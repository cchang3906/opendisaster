import * as THREE from "three";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * Full 2D affine transform (6 DOF) from model UV to satellite UV.
 *
 *   u' = a·(u − 0.5) + b·(v − 0.5) + 0.5 + tx
 *   v' = c·(u − 0.5) + d·(v − 0.5) + 0.5 + ty
 *
 * Identity: a=1, b=0, c=0, d=1, tx=0, ty=0
 */
export interface AlignmentParams {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const IDENTITY_ALIGNMENT: AlignmentParams = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

/* ------------------------------------------------------------------ */
/*  RoofProjector                                                      */
/* ------------------------------------------------------------------ */

export class RoofProjector {
  private root: THREE.Group | null = null;
  private roofMaterial: THREE.MeshStandardMaterial | null = null;
  private bboxMin = new THREE.Vector3();
  private bboxSize = new THREE.Vector3();

  apply(
    texture: THREE.Texture,
    model: THREE.Object3D,
    alignment: AlignmentParams = IDENTITY_ALIGNMENT
  ): number {
    const bbox = new THREE.Box3().setFromObject(model);
    this.bboxMin.copy(bbox.min);
    bbox.getSize(this.bboxSize);
    if (this.bboxSize.x < 0.001) this.bboxSize.x = 0.001;
    if (this.bboxSize.z < 0.001) this.bboxSize.z = 0.001;

    if (this.root) {
      this.root.parent?.remove(this.root);
    }
    this.root = new THREE.Group();
    this.root.name = "roof_overlays";
    model.add(this.root);

    this.roofMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.75,
      metalness: 0.0,
    });
    this.roofMaterial.polygonOffset = true;
    this.roofMaterial.polygonOffsetFactor = -1;
    this.roofMaterial.polygonOffsetUnits = -1;

    let count = 0;
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (isNonRoofMesh(child.name)) return;
      const roofGeom = this.buildRoofGeometry(child, alignment);
      if (!roofGeom) return;
      const roofMesh = new THREE.Mesh(roofGeom, this.roofMaterial!);
      roofMesh.name = `${child.name}_roof`;
      roofMesh.castShadow = false;
      roofMesh.receiveShadow = true;
      this.root!.add(roofMesh);
      count++;
    });
    console.log(`[RoofProjector] Applied roof imagery to ${count} mesh(es)`);
    return count;
  }

  private buildRoofGeometry(
    mesh: THREE.Mesh,
    al: AlignmentParams
  ): THREE.BufferGeometry | null {
    const geom = mesh.geometry;
    const posAttr = geom.getAttribute("position");
    if (!posAttr) return null;

    const index = geom.getIndex();
    const positions: number[] = [];
    const uvs: number[] = [];
    const normal = new THREE.Vector3();
    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();

    mesh.updateWorldMatrix(true, false);
    const wm = mesh.matrixWorld;

    const count = index ? index.count : posAttr.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;

      vA.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(wm);
      vB.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(wm);
      vC.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(wm);

      normal.copy(vB).sub(vA).cross(vC.clone().sub(vA)).normalize();
      if (normal.y < 0.6) continue;

      for (const v of [vA, vB, vC]) {
        positions.push(v.x, v.y, v.z);

        // Centred model UV (V=0 south, V=1 north)
        const cu = (v.x - this.bboxMin.x) / this.bboxSize.x - 0.5;
        const cv = (v.z - this.bboxMin.z) / this.bboxSize.z - 0.5;

        // Full affine → satellite UV
        uvs.push(
          al.a * cu + al.b * cv + 0.5 + al.tx,
          al.c * cu + al.d * cv + 0.5 + al.ty
        );
      }
    }

    if (positions.length < 9) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );
    out.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    out.computeVertexNormals();
    return out;
  }
}

function isNonRoofMesh(name: string): boolean {
  const n = name.toLowerCase();
  return /(ground|terrain|road|street|path|walk|sidewalk|water|river|lake|pond|tree|vegetation|grass)/.test(
    n
  );
}
