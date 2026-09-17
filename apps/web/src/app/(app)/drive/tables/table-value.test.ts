import { describe, expect, it } from "vitest";
import { parseTableInput } from "./table-value";

describe("typed grid input", () => {
  it("keeps unknown separate from false and zero", () => {
    expect(parseTableInput({ type: "checkbox", options: [] }, "")).toBeNull();
    expect(parseTableInput({ type: "checkbox", options: [] }, "false")).toBe(
      false,
    );
    expect(parseTableInput({ type: "number", options: [] }, "0")).toBe(0);
  });
  it("validates dates before CSV creation", () => {
    expect(() =>
      parseTableInput({ type: "date", options: [] }, "2025-02-30"),
    ).toThrow();
    expect(parseTableInput({ type: "date", options: [] }, "2024-02-29")).toBe(
      "2024-02-29",
    );
  });
  it("rejects executable URLs and undeclared select values", () => {
    expect(() =>
      parseTableInput({ type: "url", options: [] }, "javascript:alert(1)"),
    ).toThrow();
    expect(() =>
      parseTableInput({ type: "multiple_select", options: ["A"] }, "A; B"),
    ).toThrow();
  });
});
