import * as THREE from "three";

export interface GeoExtent {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface SatelliteOptions {
  extent: GeoExtent;
  zoom?: number;
  gridSize?: [cols: number, rows: number];
  tileSize?: number;
}

/**
 * Fetches satellite imagery from Google Maps Static API through /api/satellite,
 * stitches a tile grid into a single texture.
 */
export class SatelliteProvider {
  async fetchTexture(options: SatelliteOptions): Promise<THREE.Texture> {
    const extent = options.extent;
    const zoom = options.zoom ?? 18;
    const [cols, rows] = options.gridSize ?? [3, 3];
    const tileSize = options.tileSize ?? 640;

    const latStep = (extent.north - extent.south) / rows;
    const lngStep = (extent.east - extent.west) / cols;

    const promises: Promise<HTMLImageElement>[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const center = {
          lat: extent.north - latStep * (r + 0.5),
          lng: extent.west + lngStep * (c + 0.5),
        };
        promises.push(this.loadTileImage(center, zoom, tileSize));
      }
    }

    const images = await Promise.all(promises);
    const canvas = document.createElement("canvas");
    canvas.width = cols * tileSize;
    canvas.height = rows * tileSize;
    const ctx = canvas.getContext("2d")!;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.drawImage(
          images[r * cols + c]!,
          c * tileSize,
          r * tileSize,
          tileSize,
          tileSize
        );
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 8;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    // flipY=true (the default) is the standard Three.js convention:
    //   V=0 → image bottom → south,  V=1 → image top → north.
    // The RoofProjector and AlignmentOptimizer use the matching
    // convention:  v = (z − minZ)/sizeZ  → v=0 at south, v=1 at north.
    texture.needsUpdate = true;
    return texture;
  }

  private loadTileImage(
    center: { lat: number; lng: number },
    zoom: number,
    size: number
  ): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        center: `${center.lat},${center.lng}`,
        zoom: String(zoom),
        size: `${size}x${size}`,
        maptype: "satellite",
        scale: "2",
      });

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new Error(
            `[Satellite] Tile fetch failed at ${center.lat.toFixed(5)},${center.lng.toFixed(5)}`
          )
        );
      img.src = `/api/satellite?${params}`;
    });
  }
}
