import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface EngineOptions {
  canvas?: HTMLCanvasElement;
  antialias?: boolean;
  forceWebGL?: boolean;
}

export class Engine {
  renderer!: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  controls!: OrbitControls;

  private onUpdateCallbacks: ((dt: number) => void)[] = [];
  private onBeforeRenderCallbacks: (() => void)[] = [];
  private lastTime = 0;
  private _running = false;

  private forceWebGL: boolean;

  constructor(options: EngineOptions = {}) {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      10000
    );
    this.camera.position.set(400, 300, 400);
    this.camera.lookAt(0, 0, 0);

    // Lighting
    this.setupLighting();

    // Ground plane
    this.setupGround();

    // Resize handler
    window.addEventListener("resize", this.onResize);

    this.forceWebGL = options.forceWebGL ?? false;
  }

  private setupLighting(): void {
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556633, 0.6);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(100, 150, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.camera.left = -600;
    sun.shadow.camera.right = 600;
    sun.shadow.camera.top = 600;
    sun.shadow.camera.bottom = -600;
    sun.shadow.camera.far = 1500;
    this.scene.add(sun);
  }

  private setupGround(): void {
    const geometry = new THREE.PlaneGeometry(1200, 1200);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a7c59,
      roughness: 0.9,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = "ground";
    this.scene.add(ground);
  }

  onUpdate(callback: (dt: number) => void): void {
    this.onUpdateCallbacks.push(callback);
  }

  onBeforeRender(callback: () => void): void {
    this.onBeforeRenderCallbacks.push(callback);
  }
  async start(): Promise<void> {
    // Try WebGPU first, fall back to WebGL
    let renderer: THREE.WebGLRenderer;
    let backendName = "WebGL";

    if (!this.forceWebGL && "gpu" in navigator) {
      try {
        const { WebGPURenderer } = await import("three/webgpu");
        renderer = new WebGPURenderer({
          antialias: true,
        }) as unknown as THREE.WebGLRenderer;
        await (renderer as any).init();
        backendName = "WebGPU";
      } catch {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      }
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    }

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    this.renderer = renderer;
    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this._running = true;
    console.log(`[Engine] Renderer initialized (backend: ${backendName})`);
    this.lastTime = performance.now();
    renderer.setAnimationLoop(this.loop);
  }

  stop(): void {
    this._running = false;
    this.renderer?.setAnimationLoop(null);
  }

  get running(): boolean {
    return this._running;
  }

  private loop = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, 0.1);
    this.lastTime = time;

    for (const cb of this.onUpdateCallbacks) {
      cb(dt);
    }

    this.controls.update();
    for (const cb of this.onBeforeRenderCallbacks) {
      cb();
    }
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer?.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer?.setAnimationLoop(null);
    this.renderer?.dispose();
    this.controls?.dispose();
  }
}
