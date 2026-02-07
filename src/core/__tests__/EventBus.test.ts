import { test, expect, describe, beforeEach, mock } from "bun:test";
import { EventBus, type DisasterEvent } from "../EventBus.ts";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe("subscribe and emit", () => {
    test("listener receives emitted event", () => {
      const received: DisasterEvent[] = [];
      bus.on("GROUND_SHAKE", (e) => received.push(e));

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [100, 0, 200],
        magnitude: 7.0,
        pga: 0.4,
      });

      expect(received).toHaveLength(1);
      expect(received[0]!.type).toBe("GROUND_SHAKE");
      expect((received[0] as any).magnitude).toBe(7.0);
    });

    test("multiple listeners receive same event", () => {
      let count = 0;
      bus.on("GROUND_SHAKE", () => count++);
      bus.on("GROUND_SHAKE", () => count++);

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });

      expect(count).toBe(2);
    });

    test("listener only receives matching event type", () => {
      const shakes: DisasterEvent[] = [];
      const collapses: DisasterEvent[] = [];

      bus.on("GROUND_SHAKE", (e) => shakes.push(e));
      bus.on("STRUCTURE_COLLAPSE", (e) => collapses.push(e));

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 6.0,
        pga: 0.2,
      });

      expect(shakes).toHaveLength(1);
      expect(collapses).toHaveLength(0);
    });

    test("wildcard listener receives all events", () => {
      const all: DisasterEvent[] = [];
      bus.on("*", (e) => all.push(e));

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });
      bus.emit({
        type: "STRUCTURE_COLLAPSE",
        entityId: 42,
        position: [10, 0, 10],
        fragmentCount: 8,
      });

      expect(all).toHaveLength(2);
      expect(all[0]!.type).toBe("GROUND_SHAKE");
      expect(all[1]!.type).toBe("STRUCTURE_COLLAPSE");
    });
  });

  describe("unsubscribe", () => {
    test("off() removes specific listener", () => {
      let count = 0;
      const listener = () => count++;
      bus.on("GROUND_SHAKE", listener);
      bus.off("GROUND_SHAKE", listener);

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });

      expect(count).toBe(0);
    });

    test("on() returns unsubscribe function", () => {
      let count = 0;
      const unsub = bus.on("GROUND_SHAKE", () => count++);

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });
      expect(count).toBe(1);

      unsub();

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });
      expect(count).toBe(1);
    });

    test("clear() removes all listeners", () => {
      let count = 0;
      bus.on("GROUND_SHAKE", () => count++);
      bus.on("STRUCTURE_COLLAPSE", () => count++);
      bus.on("*", () => count++);

      bus.clear();

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });

      expect(count).toBe(0);
    });
  });

  describe("once", () => {
    test("once listener fires only once", () => {
      let count = 0;
      bus.once("GROUND_SHAKE", () => count++);

      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 5.0,
        pga: 0.1,
      });
      bus.emit({
        type: "GROUND_SHAKE",
        epicenter: [0, 0, 0],
        magnitude: 6.0,
        pga: 0.3,
      });

      expect(count).toBe(1);
    });
  });

  describe("event types", () => {
    test("GROUND_DISPLACEMENT event", () => {
      let received: any = null;
      bus.on("GROUND_DISPLACEMENT", (e) => (received = e));

      bus.emit({
        type: "GROUND_DISPLACEMENT",
        region: [0, 0, 100, 100],
        maxDisplacement: 2.5,
      });

      expect(received.maxDisplacement).toBe(2.5);
      expect(received.region).toEqual([0, 0, 100, 100]);
    });

    test("FLOOD_LEVEL event", () => {
      let received: any = null;
      bus.on("FLOOD_LEVEL", (e) => (received = e));

      bus.emit({
        type: "FLOOD_LEVEL",
        position: [50, 0, 50],
        waterHeight: 3.0,
        velocity: [0.5, 0, 0.2],
      });

      expect(received.waterHeight).toBe(3.0);
    });

    test("FIRE_SPREAD event", () => {
      let received: any = null;
      bus.on("FIRE_SPREAD", (e) => (received = e));

      bus.emit({
        type: "FIRE_SPREAD",
        position: [30, 0, 40],
        intensity: 0.8,
        radius: 5.0,
      });

      expect(received.intensity).toBe(0.8);
    });

    test("WIND_FIELD_UPDATE event", () => {
      let received: any = null;
      bus.on("WIND_FIELD_UPDATE", (e) => (received = e));

      bus.emit({
        type: "WIND_FIELD_UPDATE",
        direction: [1, 0, 0],
        speed: 45.0,
        center: [200, 0, 200],
      });

      expect(received.speed).toBe(45.0);
    });
  });
});
