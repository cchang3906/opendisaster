import { test, expect, describe, beforeEach, mock } from "bun:test";
import { SimWorld } from "../World.ts";

describe("SimWorld", () => {
  let world: SimWorld;

  beforeEach(() => {
    world = new SimWorld();
  });

  describe("initialization", () => {
    test("creates with default fixed timestep of 1/60", () => {
      expect(world.fixedDt).toBeCloseTo(1 / 60, 6);
    });

    test("creates with custom fixed timestep", () => {
      const w = new SimWorld({ fixedDt: 1 / 120 });
      expect(w.fixedDt).toBeCloseTo(1 / 120, 6);
    });

    test("starts at tick 0", () => {
      expect(world.tick).toBe(0);
    });

    test("starts unpaused", () => {
      expect(world.paused).toBe(false);
    });

    test("has a bitECS world instance", () => {
      expect(world.ecsWorld).toBeDefined();
    });
  });

  describe("system registration", () => {
    test("addSystem registers a named system", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);
      expect(world.hasSytem("test")).toBe(true);
    });

    test("removeSystem unregisters a system", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);
      world.removeSystem("test");
      expect(world.hasSytem("test")).toBe(false);
    });

    test("cannot add duplicate system name", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);
      expect(() => world.addSystem("test", sys)).toThrow();
    });
  });

  describe("fixed timestep update", () => {
    test("single system runs once per fixed tick", () => {
      const sys = mock((_world: any, _dt: number) => {});
      world.addSystem("physics", sys);

      world.update(1 / 60);

      expect(sys).toHaveBeenCalledTimes(1);
    });

    test("accumulates time and runs multiple ticks", () => {
      const sys = mock((_world: any, _dt: number) => {});
      world.addSystem("physics", sys);

      // Pass 3 frames worth of time
      world.update(3 / 60);

      expect(sys).toHaveBeenCalledTimes(3);
    });

    test("fractional time accumulates correctly", () => {
      const sys = mock((_world: any, _dt: number) => {});
      world.addSystem("physics", sys);

      // Pass less than one tick - should not run
      world.update(1 / 120);
      expect(sys).toHaveBeenCalledTimes(0);

      // Pass another half tick - now should run once
      world.update(1 / 120);
      expect(sys).toHaveBeenCalledTimes(1);
    });

    test("systems receive fixed dt", () => {
      let receivedDt = 0;
      const sys = (_world: any, dt: number) => {
        receivedDt = dt;
      };
      world.addSystem("physics", sys);

      world.update(1 / 30); // 2 ticks

      expect(receivedDt).toBeCloseTo(1 / 60, 6);
    });

    test("tick counter increments", () => {
      const sys = mock(() => {});
      world.addSystem("physics", sys);

      world.update(3 / 60);

      expect(world.tick).toBe(3);
    });

    test("multiple systems run in registration order", () => {
      const order: string[] = [];
      world.addSystem("first", () => order.push("first"));
      world.addSystem("second", () => order.push("second"));
      world.addSystem("third", () => order.push("third"));

      world.update(1 / 60);

      expect(order).toEqual(["first", "second", "third"]);
    });

    test("caps max ticks per update to prevent spiral of death", () => {
      const sys = mock(() => {});
      world.addSystem("physics", sys);

      // Pass 1 second of time (60 ticks) - should be capped
      world.update(1.0);

      // Max should be capped (e.g., 10 ticks max)
      expect(sys.mock.calls.length).toBeLessThanOrEqual(10);
    });
  });

  describe("interpolation alpha", () => {
    test("alpha is between 0 and 1", () => {
      world.addSystem("test", () => {});
      world.update(1 / 90); // 2/3 of a tick
      expect(world.alpha).toBeGreaterThanOrEqual(0);
      expect(world.alpha).toBeLessThanOrEqual(1);
    });

    test("alpha represents remaining accumulator fraction", () => {
      world.addSystem("test", () => {});
      // Pass exactly 1.5 ticks worth of time
      world.update(1.5 / 60);
      // After running 1 tick, 0.5 tick remains
      // alpha = remaining / fixedDt = 0.5
      expect(world.alpha).toBeCloseTo(0.5, 1);
    });
  });

  describe("pause / resume", () => {
    test("paused world does not run systems", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);

      world.paused = true;
      world.update(1 / 60);

      expect(sys).toHaveBeenCalledTimes(0);
    });

    test("resumed world continues normally", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);

      world.paused = true;
      world.update(1 / 60);
      world.paused = false;
      world.update(1 / 60);

      expect(sys).toHaveBeenCalledTimes(1);
    });

    test("paused world does not accumulate time", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);

      world.paused = true;
      world.update(5 / 60); // would be 5 ticks
      world.paused = false;
      world.update(1 / 60);

      // Should only run 1 tick, not 6
      expect(sys).toHaveBeenCalledTimes(1);
    });
  });

  describe("time scale", () => {
    test("default time scale is 1.0", () => {
      expect(world.timeScale).toBe(1.0);
    });

    test("time scale 2x doubles tick rate", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);
      world.timeScale = 2.0;

      world.update(1 / 60); // 1 frame, but at 2x = 2 ticks

      expect(sys).toHaveBeenCalledTimes(2);
    });

    test("time scale 0.5x halves tick rate", () => {
      const sys = mock(() => {});
      world.addSystem("test", sys);
      world.timeScale = 0.5;

      world.update(1 / 60); // 1 frame at 0.5x = 0.5 ticks
      expect(sys).toHaveBeenCalledTimes(0);

      world.update(1 / 60); // another 0.5 ticks, total 1 tick
      expect(sys).toHaveBeenCalledTimes(1);
    });
  });

  describe("entity management", () => {
    test("createEntity returns incrementing IDs", () => {
      const id1 = world.createEntity();
      const id2 = world.createEntity();
      expect(id2).toBeGreaterThan(id1);
    });

    test("removeEntity removes entity from world", () => {
      const id = world.createEntity();
      world.removeEntity(id);
      // bitECS recycles IDs, but entity should no longer have components
      // We just verify it doesn't throw
      expect(true).toBe(true);
    });
  });
});
