import { describe, expect, it } from "vitest";

import {
  parsePublicEnvBoolean,
  publicEnvBooleanSchema,
} from "../public-env-boolean";

describe("parsePublicEnvBoolean", () => {
  it("returns default when unset or empty", () => {
    expect(parsePublicEnvBoolean(undefined, false)).toBe(false);
    expect(parsePublicEnvBoolean("", false)).toBe(false);
    expect(parsePublicEnvBoolean("   ", true)).toBe(true);
  });

  it("parses false-like env strings as false", () => {
    expect(parsePublicEnvBoolean("false", true)).toBe(false);
    expect(parsePublicEnvBoolean("FALSE", true)).toBe(false);
    expect(parsePublicEnvBoolean("0", true)).toBe(false);
  });

  it("parses true-like env strings as true", () => {
    expect(parsePublicEnvBoolean("true", false)).toBe(true);
    expect(parsePublicEnvBoolean("TRUE", false)).toBe(true);
    expect(parsePublicEnvBoolean("1", false)).toBe(true);
  });

  it("falls back to default for unknown values", () => {
    expect(parsePublicEnvBoolean("yes", false)).toBe(false);
    expect(parsePublicEnvBoolean("yes", true)).toBe(true);
  });
});

describe("publicEnvBooleanSchema", () => {
  it("coerces env false string to false", () => {
    expect(publicEnvBooleanSchema(false).parse("false")).toBe(false);
  });

  it("defaults to false when optional", () => {
    expect(publicEnvBooleanSchema(false).parse(undefined)).toBe(false);
  });
});
