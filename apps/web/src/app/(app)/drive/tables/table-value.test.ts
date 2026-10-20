import { describe, expect, it } from "vitest";
import { parseTableInput, tableError, tableHistoryText } from "./table-value";

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

it("localizes typed validation and Core error categories", () => {
  const translate = (key: string) => `localized:${key}`;
  expect(tableError(new Error("Use YYYY-MM-DD"), translate)).toBe(
    "localized:errors.date",
  );
  expect(
    tableError(
      { error: "Conflict", message: "English server detail" },
      translate,
    ),
  ).toBe("localized:errors.conflict");
  expect(
    tableError(
      { error: "UnprocessableEntity", message: "English server detail" },
      translate,
    ),
  ).toBe("localized:errors.invalid");
});

describe("history text", () => {
  it("names a row move instead of printing its raw position", () => {
    const labels = {
      archived: "Archived",
      active: "Active",
      row: "Row",
      unknown: "Unknown",
      yes: "Yes",
      no: "No",
      position: "New position",
    };
    expect(tableHistoryText({ value: { position: 1.5 } }, labels)).toBe(
      "New position",
    );
    expect(tableHistoryText({ value: { archived: true } }, labels)).toBe(
      "Archived",
    );
  });
});
