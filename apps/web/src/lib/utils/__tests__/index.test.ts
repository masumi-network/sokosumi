import { toInputSchema, tryParseJson } from "@/lib/utils";

describe("tryParseJson", () => {
  it("should parse valid JSON string", () => {
    const validJson = '{"name": "test", "value": 123}';
    const result = tryParseJson<{ name: string; value: number }>(validJson);
    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("should return null for invalid JSON string", () => {
    const invalidJson = "not a json {broken}";
    const result = tryParseJson(invalidJson);
    expect(result).toBeNull();
  });

  it("should return null for null input", () => {
    const result = tryParseJson(null);
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = tryParseJson("");
    expect(result).toBeNull();
  });

  it("should parse complex nested objects", () => {
    const complexJson = JSON.stringify({
      user: {
        id: 1,
        profile: {
          name: "John",
          settings: {
            theme: "dark",
          },
        },
      },
      items: [1, 2, 3],
    });
    const result = tryParseJson(complexJson);
    expect(result).toEqual({
      user: {
        id: 1,
        profile: {
          name: "John",
          settings: {
            theme: "dark",
          },
        },
      },
      items: [1, 2, 3],
    });
  });

  it("should parse arrays", () => {
    const arrayJson = '[1, 2, 3, "test"]';
    const result = tryParseJson(arrayJson);
    expect(result).toEqual([1, 2, 3, "test"]);
  });

  it("should handle malformed JSON gracefully", () => {
    const malformedJson = '{"key": undefined}';
    const result = tryParseJson(malformedJson);
    expect(result).toBeNull();
  });
});

describe("toInputSchema", () => {
  it("should convert plain object to InputSchemaType Map", () => {
    const plainObject = {
      field1: "value1",
      field2: 123,
      field3: true,
    };
    const result = toInputSchema(plainObject);
    expect(result).toBeInstanceOf(Map);
    expect(result?.get("field1")).toBe("value1");
    expect(result?.get("field2")).toBe(123);
    expect(result?.get("field3")).toBe(true);
  });

  it("should return null for null input", () => {
    const result = toInputSchema(null);
    expect(result).toBeNull();
  });

  it("should return null for undefined input", () => {
    const result = toInputSchema(undefined);
    expect(result).toBeNull();
  });

  it("should return null for non-object input", () => {
    const result1 = toInputSchema("string");
    const result2 = toInputSchema(123);
    const result3 = toInputSchema(true);
    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(result3).toBeNull();
  });

  it("should handle empty object", () => {
    const result = toInputSchema({});
    expect(result).toBeInstanceOf(Map);
    expect(result?.size).toBe(0);
  });

  it("should handle nested objects", () => {
    const nestedObject = {
      field1: "value1",
      field2: {
        nested: "value",
        deep: {
          level: 3,
        },
      },
      field3: [1, 2, 3],
    };
    const result = toInputSchema(nestedObject);
    expect(result).toBeInstanceOf(Map);
    expect(result?.get("field1")).toBe("value1");
    expect(result?.get("field2")).toEqual({
      nested: "value",
      deep: {
        level: 3,
      },
    });
    expect(result?.get("field3")).toEqual([1, 2, 3]);
  });
});
