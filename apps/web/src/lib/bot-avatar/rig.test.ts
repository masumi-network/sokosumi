import { AVATAR_STATES } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";
import { blinkAt, edt, pose } from "./rig";

describe("pose", () => {
  it.each(AVATAR_STATES)(
    "gives finite values for %s, with and without a pointer",
    (state) => {
      for (const t of [0, 0.4, 1.7, 3.3, 12.9, 600.25]) {
        for (const look of [null, { x: -1, y: 1 }]) {
          for (const value of Object.values(pose(7, t, state, look)))
            expect(Number.isFinite(value)).toBe(true);
        }
      }
    },
  );

  it("shuts the eyes while sleeping, whatever the pointer does", () => {
    expect(pose(1, 2, "sleeping", { x: 1, y: 1 }).blink).toBe(1);
  });

  it("is the same at the same time (deterministic)", () => {
    expect(pose(3, 5.5, "working", null)).toEqual(
      pose(3, 5.5, "working", null),
    );
  });
});

describe("blinkAt", () => {
  it("stays between open and shut", () => {
    for (let t = 0; t < 30; t += 0.05) {
      const b = blinkAt(9, t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe("edt", () => {
  it("measures the distance to the nearest zero", () => {
    const W = 5;
    const f = new Float64Array(W * W).fill(1e20);
    f[0] = 0;
    edt(f, W);
    expect(f[4]).toBeCloseTo(4);
    expect(f[W * 4 + 4]).toBeCloseTo(Math.hypot(4, 4));
  });
});
