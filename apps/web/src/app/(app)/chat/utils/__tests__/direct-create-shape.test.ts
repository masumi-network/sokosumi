import { describe, expect, it } from "vitest";
import { directCreateShapeError } from "@/app/chat/utils/direct-create-shape";

describe("directCreateShapeError", () => {
  it("allows one or more humans with no coworkers", () => {
    expect(directCreateShapeError(["u1"], [])).toBeNull();
    expect(directCreateShapeError(["u1", "u2"], [])).toBeNull();
  });

  it("allows a single coworker with no humans", () => {
    expect(directCreateShapeError([], ["c1"])).toBeNull();
  });

  it("rejects empty targets", () => {
    expect(directCreateShapeError([], [])).toBe(
      "Choose a direct message target",
    );
  });

  it("rejects mixed human and coworker targets", () => {
    expect(directCreateShapeError(["u1"], ["c1"])).toBe(
      "Group direct messages cannot include coworkers.",
    );
    expect(directCreateShapeError(["u1", "u2"], ["c1"])).toBe(
      "Group direct messages cannot include coworkers.",
    );
  });

  it("rejects multiple coworkers", () => {
    expect(directCreateShapeError([], ["c1", "c2"])).toBe(
      "Direct messages support one coworker only.",
    );
  });
});
