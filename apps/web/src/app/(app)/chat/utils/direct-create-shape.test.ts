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

  it("allows a single personal assistant with no humans", () => {
    expect(directCreateShapeError([], [], ["pa-1"])).toBeNull();
  });

  it("rejects empty targets", () => {
    expect(directCreateShapeError([], [])).toBe(
      "Choose a direct message target",
    );
  });

  it("rejects mixed human, coworker, and personal-assistant targets", () => {
    expect(directCreateShapeError(["u1"], ["c1"])).toBe(
      "Direct messages cannot mix humans, coworkers, and personal assistants.",
    );
    expect(directCreateShapeError(["u1", "u2"], ["c1"])).toBe(
      "Direct messages cannot mix humans, coworkers, and personal assistants.",
    );
    expect(directCreateShapeError(["u1"], [], ["pa-1"])).toBe(
      "Direct messages cannot mix humans, coworkers, and personal assistants.",
    );
    expect(directCreateShapeError([], ["c1"], ["pa-1"])).toBe(
      "Direct messages cannot mix humans, coworkers, and personal assistants.",
    );
  });

  it("rejects multiple coworkers", () => {
    expect(directCreateShapeError([], ["c1", "c2"])).toBe(
      "Direct messages support one coworker only.",
    );
  });

  it("rejects multiple personal assistants", () => {
    expect(directCreateShapeError([], [], ["pa-1", "pa-2"])).toBe(
      "Direct messages support one personal assistant only.",
    );
  });
});
