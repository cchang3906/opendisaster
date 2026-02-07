import { query } from "bitecs";
import { Position, Rotation, Velocity, PhysicsBody } from "../core/Components.ts";
import { EventBus } from "../core/EventBus.ts";

/**
 * Wraps Jolt Physics WASM.
 * Manages rigid body creation, stepping, and sync back to ECS.
 */
export class PhysicsSystem {
  private Jolt: any = null;
  private joltInterface: any = null;
  private physicsSystem: any = null;
  private bodyInterface: any = null;
  private bodies = new Map<number, any>(); // eid -> bodyId
  private eventBus: EventBus;
  private initialized = false;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async init(): Promise<void> {
    try {
      // Try multi-threaded first, fall back to single-threaded
      let initJolt: any;
      try {
        initJolt = (await import("jolt-physics/wasm-multithread")).default;
      } catch {
        initJolt = (await import("jolt-physics")).default;
      }

      this.Jolt = await initJolt();
      this.setupJolt();
      this.initialized = true;
      console.log("[Physics] Jolt Physics initialized");
    } catch (e) {
      console.error("[Physics] Failed to initialize Jolt:", e);
      throw e;
    }
  }

  private setupJolt(): void {
    const J = this.Jolt;

    const settings = new J.JoltSettings();
    settings.mMaxBodies = 10240;
    settings.mMaxBodyPairs = 65536;
    settings.mMaxContactConstraints = 10240;

    this.joltInterface = new J.JoltInterface(settings);
    J.destroy(settings);

    this.physicsSystem = this.joltInterface.GetPhysicsSystem();
    this.bodyInterface = this.physicsSystem.GetBodyInterface();
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Add a box rigid body for an entity.
   */
  addBoxBody(
    eid: number,
    halfExtents: [number, number, number],
    mass: number,
    isStatic: boolean = false
  ): void {
    if (!this.initialized) return;
    const J = this.Jolt;

    const shape = new J.BoxShape(
      new J.Vec3(halfExtents[0], halfExtents[1], halfExtents[2])
    );

    const pos = new J.RVec3(Position.x[eid]!, Position.y[eid]!, Position.z[eid]!);
    const rot = new J.Quat(
      Rotation.x[eid]!,
      Rotation.y[eid]!,
      Rotation.z[eid]!,
      Rotation.w[eid]!
    );

    const layer = isStatic ? 0 : 1; // 0=static, 1=dynamic
    const motionType = isStatic ? J.EMotionType_Static : J.EMotionType_Dynamic;
    const activation = isStatic
      ? J.EActivation_DontActivate
      : J.EActivation_Activate;

    const creationSettings = new J.BodyCreationSettings(
      shape,
      pos,
      rot,
      motionType,
      layer
    );

    if (!isStatic) {
      creationSettings.mMassPropertiesOverride.mMass = mass;
    }

    const body = this.bodyInterface.CreateBody(creationSettings);
    this.bodyInterface.AddBody(body.GetID(), activation);

    this.bodies.set(eid, body.GetID());
    PhysicsBody.bodyId[eid] = body.GetID().GetIndexAndSequenceNumber();
    PhysicsBody.mass[eid] = mass;

    J.destroy(pos);
    J.destroy(rot);
    J.destroy(creationSettings);
  }

  /**
   * Apply an impulse to an entity's body.
   */
  applyImpulse(eid: number, impulse: [number, number, number]): void {
    if (!this.initialized) return;
    const J = this.Jolt;
    const bodyId = this.bodies.get(eid);
    if (!bodyId) return;

    const imp = new J.Vec3(impulse[0], impulse[1], impulse[2]);
    this.bodyInterface.AddImpulse(bodyId, imp);
    J.destroy(imp);
  }

  /**
   * Step physics and sync results back to ECS.
   */
  step(world: any, dt: number): void {
    if (!this.initialized) return;

    // Step Jolt (1 collision step)
    this.joltInterface.Step(dt, 1);

    // Sync Jolt body transforms → ECS
    const entities = query(world, [Position, Rotation, PhysicsBody]);
    const J = this.Jolt;

    for (const eid of entities) {
      const bodyId = this.bodies.get(eid);
      if (!bodyId) continue;

      const pos = this.bodyInterface.GetPosition(bodyId);
      const rot = this.bodyInterface.GetRotation(bodyId);
      const vel = this.bodyInterface.GetLinearVelocity(bodyId);

      Position.x[eid] = pos.GetX();
      Position.y[eid] = pos.GetY();
      Position.z[eid] = pos.GetZ();

      Rotation.x[eid] = rot.GetX();
      Rotation.y[eid] = rot.GetY();
      Rotation.z[eid] = rot.GetZ();
      Rotation.w[eid] = rot.GetW();

      // Check for collapse: if a building falls below ground significantly
      if (Position.y[eid]! < -5) {
        this.eventBus.emit({
          type: "STRUCTURE_COLLAPSE",
          entityId: eid,
          position: [Position.x[eid]!, Position.y[eid]!, Position.z[eid]!],
          fragmentCount: 0,
        });
      }
    }
  }

  removeBody(eid: number): void {
    if (!this.initialized) return;
    const bodyId = this.bodies.get(eid);
    if (!bodyId) return;

    this.bodyInterface.RemoveBody(bodyId);
    this.bodyInterface.DestroyBody(bodyId);
    this.bodies.delete(eid);
  }

  dispose(): void {
    if (this.joltInterface) {
      this.Jolt.destroy(this.joltInterface);
      this.joltInterface = null;
    }
    this.bodies.clear();
    this.initialized = false;
  }
}
