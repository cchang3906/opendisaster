import * as THREE from "three";
import type { AlignmentParams } from "./RoofProjector.ts";
import { IDENTITY_ALIGNMENT } from "./RoofProjector.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AnchorBuilding {
  name: string;
  lat: number;
  lng: number;
}

export interface GeoExtent {
  north: number;
  south: number;
  east: number;
  west: number;
}

/* ------------------------------------------------------------------ */
/*  AlignmentOptimizer                                                 */
/* ------------------------------------------------------------------ */

/**
 * Computes the affine alignment from **N known buildings**.
 *
 * - N = 2 → similarity transform (4 DOF: rotation, uniform scale, offset)
 * - N ≥ 3 → full affine (6 DOF: handles non-uniform scale + shear)
 * - N > 3 → least-squares best-fit affine
 *
 * Also scans the model for all "building_*" meshes and logs them
 * so new anchors can be identified.
 */
export class AlignmentOptimizer {
  /**
   * Solve the alignment. Pass as many candidate anchors as you like —
   * any whose mesh isn't found are silently skipped.
   */
  static solve(
    model: THREE.Object3D,
    extent: GeoExtent,
    anchors: AnchorBuilding[]
  ): AlignmentParams {
    const bbox = new THREE.Box3().setFromObject(model);
    const bMin = bbox.min;
    const bSize = new THREE.Vector3();
    bbox.getSize(bSize);
    if (bSize.x < 1e-3) bSize.x = 1e-3;
    if (bSize.z < 1e-3) bSize.z = 1e-3;

    /* ---- log available building meshes ---- */
    const buildingMeshes: string[] = [];
    model.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        child.name.startsWith("building_")
      ) {
        buildingMeshes.push(child.name);
      }
    });
    console.log(
      `[Align] ${buildingMeshes.length} building meshes in model:`,
      buildingMeshes.slice(0, 30).join(", ") +
        (buildingMeshes.length > 30 ? " …" : "")
    );

    /* ---- match anchors ---- */
    const pts: {
      cu: number;
      cv: number;
      su: number;
      sv: number;
      name: string;
    }[] = [];

    for (const a of anchors) {
      const mesh = findMesh(model, a.name);
      if (!mesh) continue;

      const center = new THREE.Vector3();
      new THREE.Box3().setFromObject(mesh).getCenter(center);

      const modU = (center.x - bMin.x) / bSize.x;
      const modV = (center.z - bMin.z) / bSize.z; // V=0 south, V=1 north

      const satU = (a.lng - extent.west) / (extent.east - extent.west);
      const satV =
        (a.lat - extent.south) / (extent.north - extent.south);

      // Centred coordinates (the RoofProjector works in centred space)
      pts.push({
        cu: modU - 0.5,
        cv: modV - 0.5,
        su: satU - 0.5,
        sv: satV - 0.5,
        name: a.name,
      });

      console.log(
        `[Align] ✓ "${a.name}"  ` +
          `mod (${modU.toFixed(5)}, ${modV.toFixed(5)})  ` +
          `sat (${satU.toFixed(5)}, ${satV.toFixed(5)})  ` +
          `Δ (${((satU - modU) * 100).toFixed(3)}%, ${((satV - modV) * 100).toFixed(3)}%)`
      );
    }

    if (pts.length < 2) {
      console.warn(
        `[Align] Only ${pts.length} anchor(s) found — need ≥ 2. Using identity.`
      );
      return { ...IDENTITY_ALIGNMENT };
    }

    /* ---- solve ---- */
    let result: AlignmentParams;

    if (pts.length === 2) {
      // Similarity transform (4 DOF)
      result = solveSimilarity(pts[0], pts[1]);
      console.log(`[Align] Similarity (2 anchors)`);
    } else {
      // Full affine (6 DOF) via least squares
      result = solveAffine(pts);
      console.log(`[Align] Affine (${pts.length} anchors)`);
    }

    /* ---- verify ---- */
    let maxErr = 0;
    for (const p of pts) {
      const pu = result.a * p.cu + result.b * p.cv + result.tx;
      const pv = result.c * p.cu + result.d * p.cv + result.ty;
      const eu = Math.abs(pu - p.su);
      const ev = Math.abs(pv - p.sv);
      maxErr = Math.max(maxErr, eu, ev);
      console.log(
        `[Align] Verify "${p.name}": ` +
          `err (${(eu * 1e4).toFixed(2)}e-4, ${(ev * 1e4).toFixed(2)}e-4)`
      );
    }

    // Decompose for readability
    const scaleU = Math.sqrt(result.a ** 2 + result.c ** 2);
    const scaleV = Math.sqrt(result.b ** 2 + result.d ** 2);
    const rot = Math.atan2(result.c, result.a);

    console.log(
      `[Align] Solution: ` +
        `rot≈${((rot * 180) / Math.PI).toFixed(4)}°  ` +
        `scaleU≈${scaleU.toFixed(5)}  scaleV≈${scaleV.toFixed(5)}  ` +
        `off=(${result.tx.toFixed(6)}, ${result.ty.toFixed(6)})  ` +
        `maxErr=${(maxErr * 1e4).toFixed(3)}e-4`
    );

    return result;
  }
}

/* ================================================================== */
/*  Solvers                                                            */
/* ================================================================== */

interface CentredPoint {
  cu: number;
  cv: number;
  su: number;
  sv: number;
}

/** 2-anchor similarity: a = d, c = −b (rotation + uniform scale) */
function solveSimilarity(
  p1: CentredPoint,
  p2: CentredPoint
): AlignmentParams {
  const dx = p2.cu - p1.cu;
  const dy = p2.cv - p1.cv;
  const dxp = p2.su - p1.su;
  const dyp = p2.sv - p1.sv;

  const denom = dx * dx + dy * dy;
  if (denom < 1e-12) return { ...IDENTITY_ALIGNMENT };

  const a = (dxp * dx + dyp * dy) / denom;
  const b = -(dyp * dx - dxp * dy) / denom; // note sign for similarity
  const c = -b;
  const d = a;

  const tx = p1.su - a * p1.cu - b * p1.cv;
  const ty = p1.sv - c * p1.cu - d * p1.cv;

  return { a, b, c, d, tx, ty };
}

/**
 * N-anchor full affine via least squares.
 *
 * We solve two independent 3-variable systems:
 *   for each anchor:  su = a·cu + b·cv + tx
 *   for each anchor:  sv = c·cu + d·cv + ty
 *
 * System 1 (for a, b, tx):
 *   | cu1 cv1 1 |   | a  |   | su1 |
 *   | cu2 cv2 1 | × | b  | = | su2 |
 *   | ...       |   | tx |   | ... |
 *
 * System 2 (for c, d, ty): same A matrix, rhs = sv column.
 */
function solveAffine(pts: CentredPoint[]): AlignmentParams {
  const N = pts.length;

  // Build A^T·A (3×3) and A^T·b for both systems
  let s_uu = 0, s_uv = 0, s_u = 0;
  let s_vv = 0, s_v = 0;
  // rhs for system 1 (su)
  let s_uSu = 0, s_vSu = 0, s_Su = 0;
  // rhs for system 2 (sv)
  let s_uSv = 0, s_vSv = 0, s_Sv = 0;

  for (const p of pts) {
    s_uu += p.cu * p.cu;
    s_uv += p.cu * p.cv;
    s_u += p.cu;
    s_vv += p.cv * p.cv;
    s_v += p.cv;

    s_uSu += p.cu * p.su;
    s_vSu += p.cv * p.su;
    s_Su += p.su;

    s_uSv += p.cu * p.sv;
    s_vSv += p.cv * p.sv;
    s_Sv += p.sv;
  }

  // A^T·A = [[s_uu, s_uv, s_u],
  //          [s_uv, s_vv, s_v],
  //          [s_u,  s_v,  N  ]]
  const ATA = [
    [s_uu, s_uv, s_u],
    [s_uv, s_vv, s_v],
    [s_u, s_v, N],
  ];

  const rhs1 = [s_uSu, s_vSu, s_Su]; // for a, b, tx
  const rhs2 = [s_uSv, s_vSv, s_Sv]; // for c, d, ty

  const sol1 = solve3x3(ATA, rhs1);
  const sol2 = solve3x3(ATA, rhs2);

  if (!sol1 || !sol2) {
    console.warn("[Align] Singular matrix — using identity");
    return { ...IDENTITY_ALIGNMENT };
  }

  return {
    a: sol1[0],
    b: sol1[1],
    tx: sol1[2],
    c: sol2[0],
    d: sol2[1],
    ty: sol2[2],
  };
}

/** Solve a 3×3 system via Cramer's rule. Returns null if singular. */
function solve3x3(
  M: number[][],
  b: number[]
): [number, number, number] | null {
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);

  if (Math.abs(det) < 1e-14) return null;

  const x0 =
    (b[0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (b[1] * M[2][2] - M[1][2] * b[2]) +
      M[0][2] * (b[1] * M[2][1] - M[1][1] * b[2])) /
    det;

  const x1 =
    (M[0][0] * (b[1] * M[2][2] - M[1][2] * b[2]) -
      b[0] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * b[2] - b[1] * M[2][0])) /
    det;

  const x2 =
    (M[0][0] * (M[1][1] * b[2] - b[1] * M[2][1]) -
      M[0][1] * (M[1][0] * b[2] - b[1] * M[2][0]) +
      b[0] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])) /
    det;

  return [x0, x1, x2];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function findMesh(
  root: THREE.Object3D,
  name: string
): THREE.Mesh | null {
  let result: THREE.Mesh | null = null;
  root.traverse((child) => {
    if (!result && child instanceof THREE.Mesh && child.name === name) {
      result = child;
    }
  });
  return result;
}
