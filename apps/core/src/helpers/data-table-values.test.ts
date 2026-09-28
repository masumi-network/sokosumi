import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateTableValues } from "./data-table-values";

const id = randomUUID();
describe("table typed values", () => {
  it.each([
    ["text", "hello"],
    ["long_text", "long\ntext"],
    ["number", 1.25],
    ["date", "2024-02-29"],
    ["checkbox", false],
    ["url", "https://example.com"],
    ["email", "person@example.com"],
    ["single_select", "One"],
    ["multiple_select", ["One"]],
  ] as const)("accepts %s including confirmed negatives", (type, value) => {
    expect(() =>
      validateTableValues(
        [{ id, name: "Value", description: "", type, options: ["One"] }],
        { [id]: typeof value === "object" ? [...value] : value },
        {},
      ),
    ).not.toThrow();
  });
  it.each([
    ["number", "3"],
    ["date", "2025-02-29"],
    ["checkbox", "false"],
    ["url", "javascript:alert(1)"],
    ["email", "missing"],
    ["single_select", "Other"],
    ["multiple_select", ["One", "One"]],
  ] as const)("rejects invalid %s", (type, value) => {
    expect(() =>
      validateTableValues(
        [{ id, name: "Value", description: "", type, options: ["One"] }],
        { [id]: typeof value === "object" ? [...value] : value },
        {},
      ),
    ).toThrow();
  });
  it("distinguishes unknown from false and rejects evidence without a corresponding value", () => {
    const columns = [
      {
        id,
        name: "Confirmed",
        description: "",
        type: "checkbox" as const,
        options: [],
      },
    ];
    expect(() =>
      validateTableValues(columns, { [id]: null }, {}),
    ).not.toThrow();
    expect(() =>
      validateTableValues(
        columns,
        {},
        { [id]: [{ url: "https://example.com" }] },
      ),
    ).toThrow("Evidence must accompany");
  });
  it("rejects foreign column IDs and overlarge rows", () => {
    const columns = [
      {
        id,
        name: "Notes",
        description: "",
        type: "long_text" as const,
        options: [],
      },
    ];
    expect(() =>
      validateTableValues(columns, { [randomUUID()]: "other" }, {}),
    ).toThrow("Unknown column");
    expect(() =>
      validateTableValues(columns, { [id]: "x".repeat(65000) }, {}),
    ).toThrow("64 KB");
    const secondId = randomUUID();
    expect(() =>
      validateTableValues(
        [...columns, { ...columns[0], id: secondId }],
        { [id]: "😀".repeat(9000), [secondId]: "😀".repeat(9000) },
        {},
      ),
    ).toThrow("64 KB");
  });
});
