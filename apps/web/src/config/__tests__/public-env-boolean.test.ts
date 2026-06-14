import { describe, expect, it } from "vitest";

import { publicEnvBooleanSchema } from "../public-env-boolean";

describe("publicEnvBooleanSchema", () => {
  const schema = publicEnvBooleanSchema(false);

  it("defaults when unset or empty", () => {
    expect(schema.parse(undefined)).toBe(false);
    expect(schema.parse("")).toBe(false);
  });

  it("parses false-like env strings as false", () => {
    expect(schema.parse("false")).toBe(false);
    expect(schema.parse("FALSE")).toBe(false);
    expect(schema.parse("0")).toBe(false);
    expect(schema.parse("no")).toBe(false);
    expect(schema.parse("off")).toBe(false);
  });

  it("parses true-like env strings as true", () => {
    expect(schema.parse("true")).toBe(true);
    expect(schema.parse("TRUE")).toBe(true);
    expect(schema.parse("1")).toBe(true);
    expect(schema.parse("yes")).toBe(true);
    expect(schema.parse("on")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(() => schema.parse("maybe")).toThrow();
  });
});
