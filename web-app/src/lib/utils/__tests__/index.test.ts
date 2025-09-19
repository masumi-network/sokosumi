import { JobInputData } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";
import {
  getInputHash,
  getInputHashDeprecated,
  getMatchedHash,
  getOutputHash,
  toJobInputData,
  tryParseJson,
} from "@/lib/utils";

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

describe("toJobInputData", () => {
  it("should convert plain object to JobInputData Map", () => {
    const plainObject = {
      field1: "value1",
      field2: 123,
      field3: true,
    };
    const result = toJobInputData(plainObject);
    expect(result).toBeInstanceOf(Map);
    expect(result?.get("field1")).toBe("value1");
    expect(result?.get("field2")).toBe(123);
    expect(result?.get("field3")).toBe(true);
  });

  it("should return null for null input", () => {
    const result = toJobInputData(null);
    expect(result).toBeNull();
  });

  it("should return null for undefined input", () => {
    const result = toJobInputData(undefined);
    expect(result).toBeNull();
  });

  it("should return null for non-object input", () => {
    const result1 = toJobInputData("string");
    const result2 = toJobInputData(123);
    const result3 = toJobInputData(true);
    expect(result1).toBeNull();
    expect(result2).toBeNull();
    expect(result3).toBeNull();
  });

  it("should handle empty object", () => {
    const result = toJobInputData({});
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
    const result = toJobInputData(nestedObject);
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

describe("getMatchedHash", () => {
  const mockIdentifier = "test-identifier-123";

  describe("input hash matching", () => {
    const mockInputData = new Map([
      ["field1", "value1"],
      ["field2", 123],
    ]) as JobInputData;

    it("should return current hash when it matches", () => {
      const currentHash = getInputHash(mockInputData, mockIdentifier);
      const result = getMatchedHash(
        "input",
        mockInputData,
        mockIdentifier,
        currentHash,
      );
      expect(result).toBe(currentHash);
    });

    it("should return deprecated hash when current does not match but deprecated does", () => {
      const deprecatedHash = getInputHashDeprecated(
        mockInputData,
        mockIdentifier,
      );
      const result = getMatchedHash(
        "input",
        mockInputData,
        mockIdentifier,
        deprecatedHash,
      );
      expect(result).toBe(deprecatedHash);
    });

    it("should return null when neither current nor deprecated hash matches", () => {
      const unmatchedHash = "completely-different-hash";
      const result = getMatchedHash(
        "input",
        mockInputData,
        mockIdentifier,
        unmatchedHash,
      );
      expect(result).toBeNull();
    });

    it("should handle different identifiers correctly", () => {
      const hash1 = getInputHash(mockInputData, "identifier1");
      const hash2 = getInputHash(mockInputData, "identifier2");

      // Hash generated with identifier1 should match
      const result1 = getMatchedHash(
        "input",
        mockInputData,
        "identifier1",
        hash1,
      );
      expect(result1).toBe(hash1);

      // Hash generated with identifier1 should not match identifier2
      const result2 = getMatchedHash(
        "input",
        mockInputData,
        "identifier2",
        hash1,
      );
      expect(result2).toBeNull();

      // Hash generated with identifier2 should match
      const result3 = getMatchedHash(
        "input",
        mockInputData,
        "identifier2",
        hash2,
      );
      expect(result3).toBe(hash2);
    });
  });

  describe("output hash matching", () => {
    const mockOutputData: JobStatusResponseSchemaType = {
      status: "completed",
      output_data: {
        result: "success",
        value: 42,
      },
      error: null,
      error_trace: null,
      compute_time: 1000,
      output_blobs: [],
    };

    it("should return output hash when it matches", () => {
      const outputHash = getOutputHash(mockOutputData, mockIdentifier);
      const result = getMatchedHash(
        "output",
        mockOutputData,
        mockIdentifier,
        outputHash,
      );
      expect(result).toBe(outputHash);
    });

    it("should return null when output hash does not match", () => {
      const unmatchedHash = "different-output-hash";
      const result = getMatchedHash(
        "output",
        mockOutputData,
        mockIdentifier,
        unmatchedHash,
      );
      expect(result).toBeNull();
    });

    it("should handle different output data correctly", () => {
      const outputData1: JobStatusResponseSchemaType = {
        ...mockOutputData,
        output_data: { result: "different" },
      };
      const outputData2: JobStatusResponseSchemaType = {
        ...mockOutputData,
        output_data: { result: "another" },
      };

      const hash1 = getOutputHash(outputData1, mockIdentifier);
      const hash2 = getOutputHash(outputData2, mockIdentifier);

      // Different data should produce different hashes
      expect(hash1).not.toBe(hash2);

      // Each hash should match with its corresponding data
      const result1 = getMatchedHash(
        "output",
        outputData1,
        mockIdentifier,
        hash1,
      );
      expect(result1).toBe(hash1);

      const result2 = getMatchedHash(
        "output",
        outputData2,
        mockIdentifier,
        hash2,
      );
      expect(result2).toBe(hash2);

      // Mismatched data and hash should return null
      const result3 = getMatchedHash(
        "output",
        outputData1,
        mockIdentifier,
        hash2,
      );
      expect(result3).toBeNull();
    });

    it("should not have deprecated fallback for output mode", () => {
      // Output mode does not use deprecated hash, only input mode does
      const outputHash = getOutputHash(mockOutputData, mockIdentifier);
      const fakeDeprecatedHash = "fake-deprecated-hash";

      // Even if we pass a "deprecated" style hash, it should not match
      const result = getMatchedHash(
        "output",
        mockOutputData,
        mockIdentifier,
        fakeDeprecatedHash,
      );
      expect(result).toBeNull();

      // Only exact match should work
      const result2 = getMatchedHash(
        "output",
        mockOutputData,
        mockIdentifier,
        outputHash,
      );
      expect(result2).toBe(outputHash);
    });
  });

  describe("edge cases", () => {
    it("should handle empty input data", () => {
      const emptyInputData = new Map() as JobInputData;
      const hash = getInputHash(emptyInputData, mockIdentifier);
      const result = getMatchedHash(
        "input",
        emptyInputData,
        mockIdentifier,
        hash,
      );
      expect(result).toBe(hash);
    });

    it("should handle output data with null fields", () => {
      const outputWithNulls: JobStatusResponseSchemaType = {
        status: "completed",
        output_data: null,
        error: null,
        error_trace: null,
        compute_time: 0,
        output_blobs: [],
      };
      const hash = getOutputHash(outputWithNulls, mockIdentifier);
      const result = getMatchedHash(
        "output",
        outputWithNulls,
        mockIdentifier,
        hash,
      );
      expect(result).toBe(hash);
    });

    it("should handle special characters in identifier", () => {
      const specialIdentifier = "test!@#$%^&*()_+-=[]{}|;:,.<>?";
      const inputData = new Map([["test", "value"]]) as JobInputData;
      const hash = getInputHash(inputData, specialIdentifier);
      const result = getMatchedHash(
        "input",
        inputData,
        specialIdentifier,
        hash,
      );
      expect(result).toBe(hash);
    });

    it("should be case sensitive for hash matching", () => {
      const inputData = new Map([["test", "value"]]) as JobInputData;
      const hash = getInputHash(inputData, mockIdentifier);
      const upperCaseHash = hash.toUpperCase();
      const result = getMatchedHash(
        "input",
        inputData,
        mockIdentifier,
        upperCaseHash,
      );
      expect(result).toBeNull();
    });
  });
});
