import { describe, expect, it } from "vitest";

import {
  hashCanonicalJsonValue,
  hashInput,
  hashInputDeprecated,
  hashInputSchema,
  hashResult,
} from "./hash.js";

describe("hashInput", () => {
  const mockIdentifier = "test-identifier-123";

  it("should generate a hash for valid JSON input", () => {
    const inputData = { field1: "value1", field2: 123 };
    const inputString = JSON.stringify(inputData);
    const hash = hashInput(inputString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash?.length).toBe(64); // SHA-256 produces 64-character hex string
  });

  it("should produce the same hash for the same input and identifier", () => {
    const inputData = { field1: "value1", field2: 123 };
    const inputString = JSON.stringify(inputData);

    const hash1 = hashInput(inputString, mockIdentifier);
    const hash2 = hashInput(inputString, mockIdentifier);

    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different identifiers", () => {
    const inputData = { field1: "value1", field2: 123 };
    const inputString = JSON.stringify(inputData);

    const hash1 = hashInput(inputString, "identifier1");
    const hash2 = hashInput(inputString, "identifier2");

    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hashes for different input data", () => {
    const inputData1 = { field1: "value1" };
    const inputData2 = { field1: "value2" };
    const inputString1 = JSON.stringify(inputData1);
    const inputString2 = JSON.stringify(inputData2);

    const hash1 = hashInput(inputString1, mockIdentifier);
    const hash2 = hashInput(inputString2, mockIdentifier);

    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty object input", () => {
    const inputString = JSON.stringify({});
    const hash = hashInput(inputString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should handle complex nested objects", () => {
    const complexData = {
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
    };
    const inputString = JSON.stringify(complexData);
    const hash = hashInput(inputString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should return null for invalid JSON input", () => {
    const invalidJson = "not a json {broken}";
    const hash = hashInput(invalidJson, mockIdentifier);

    expect(hash).toBeNull();
  });

  it("should handle special characters in identifier", () => {
    const specialIdentifier = "test!@#$%^&*()_+-=[]{}|;:,.<>?";
    const inputData = { test: "value" };
    const inputString = JSON.stringify(inputData);
    const hash = hashInput(inputString, specialIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should be deterministic - same input produces same hash", () => {
    const inputData = { field1: "value1", field2: 123, field3: true };
    const inputString = JSON.stringify(inputData);

    const hash1 = hashInput(inputString, mockIdentifier);
    const hash2 = hashInput(inputString, mockIdentifier);
    const hash3 = hashInput(inputString, mockIdentifier);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });
});

describe("hashInputDeprecated", () => {
  const mockIdentifier = "test-identifier-123";

  it("should generate a hash for valid JSON input", () => {
    const inputData = { field1: "value1", field2: 123 };
    const inputString = JSON.stringify(inputData);
    const hash = hashInputDeprecated(inputString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash?.length).toBe(64);
  });

  it("should produce different hash than hashInput for the same input", () => {
    const inputData = { field1: "value1", field2: 123 };
    const inputString = JSON.stringify(inputData);

    const currentHash = hashInput(inputString, mockIdentifier);
    const deprecatedHash = hashInputDeprecated(inputString, mockIdentifier);

    expect(currentHash).not.toBe(deprecatedHash);
  });

  it("should return null for invalid JSON input", () => {
    const invalidJson = "not a json {broken}";
    const hash = hashInputDeprecated(invalidJson, mockIdentifier);

    expect(hash).toBeNull();
  });

  it("should be deterministic", () => {
    const inputData = { field1: "value1" };
    const inputString = JSON.stringify(inputData);

    const hash1 = hashInputDeprecated(inputString, mockIdentifier);
    const hash2 = hashInputDeprecated(inputString, mockIdentifier);

    expect(hash1).toBe(hash2);
  });
});

describe("hashInputSchema", () => {
  it("should generate the same hash for equivalent input_data wrappers", () => {
    const innerArray = [{ id: "prompt", name: "Prompt", type: "string" }];
    const wrapperSchema = JSON.stringify({ input_data: innerArray });

    const hash = hashInputSchema(wrapperSchema);

    expect(hash).toBeTruthy();
    expect(hashInputSchema(wrapperSchema)).toBe(hash);
  });

  it("should return null for invalid json", () => {
    expect(hashInputSchema("{")).toBeNull();
  });

  it("should return null for nullish input", () => {
    expect(hashInputSchema(null)).toBeNull();
    expect(hashInputSchema(undefined)).toBeNull();
  });

  it("should hash bare input field arrays (legacy stored schema)", () => {
    const bareSchema = JSON.stringify([
      { id: "prompt", name: "Prompt", type: "string" },
    ]);
    const innerArray = [{ id: "prompt", name: "Prompt", type: "string" }];
    const wrapperSchema = JSON.stringify({ input_data: innerArray });

    const bareHash = hashInputSchema(bareSchema);
    const wrapperHash = hashInputSchema(wrapperSchema);

    expect(bareHash).toBeTruthy();
    expect(wrapperHash).toBeTruthy();
    expect(bareHash).toBe(wrapperHash);
  });

  it("should hash input_groups wrapper and bare input_groups arrays equivalently", () => {
    const innerGroups = [
      {
        id: "group-1",
        title: "Group 1",
        input_data: [{ id: "field1", name: "Field 1", type: "string" }],
      },
    ];
    const wrapperSchema = JSON.stringify({ input_groups: innerGroups });
    const bareSchema = JSON.stringify(innerGroups);

    const wrapperHash = hashInputSchema(wrapperSchema);
    const bareHash = hashInputSchema(bareSchema);

    expect(wrapperHash).toBeTruthy();
    expect(bareHash).toBeTruthy();
    expect(wrapperHash).toBe(bareHash);
  });
});

describe("hashCanonicalJsonValue", () => {
  it("should generate the same hash for equivalent objects with different key order", () => {
    const firstHash = hashCanonicalJsonValue({ b: 2, a: 1 });
    const secondHash = hashCanonicalJsonValue({ a: 1, b: 2 });

    expect(firstHash).toBe(
      "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
    );
    expect(secondHash).toBe(firstHash);
  });

  it("should generate different hashes when the payload changes", () => {
    const firstHash = hashCanonicalJsonValue({
      status: "running",
      result: null,
    });
    const secondHash = hashCanonicalJsonValue({
      status: "completed",
      result: "done",
    });

    expect(firstHash).not.toBe(secondHash);
  });

  it("should return null for unsupported values", () => {
    expect(hashCanonicalJsonValue(123n as unknown)).toBeNull();
  });

  it("should return null for non-finite numbers", () => {
    expect(hashCanonicalJsonValue(Number.NaN)).toBeNull();
    expect(hashCanonicalJsonValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(hashCanonicalJsonValue(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe("hashResult", () => {
  const mockIdentifier = "test-identifier-123";

  it("should generate a hash for a result string", () => {
    const resultString = "success";
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
    expect(hash?.length).toBe(64);
  });

  it("should produce the same hash for the same result and identifier", () => {
    const resultString = "success";

    const hash1 = hashResult(resultString, mockIdentifier);
    const hash2 = hashResult(resultString, mockIdentifier);

    expect(hash1).toBe(hash2);
  });

  it("should produce different hashes for different identifiers", () => {
    const resultString = "success";

    const hash1 = hashResult(resultString, "identifier1");
    const hash2 = hashResult(resultString, "identifier2");

    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hashes for different result strings", () => {
    const resultString1 = "success";
    const resultString2 = "failure";

    const hash1 = hashResult(resultString1, mockIdentifier);
    const hash2 = hashResult(resultString2, mockIdentifier);

    expect(hash1).not.toBe(hash2);
  });

  it("should handle empty string result", () => {
    const resultString = "";
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should handle multiline result strings", () => {
    const resultString = "line1\nline2\nline3";
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should handle special characters in result", () => {
    const resultString =
      "result with special chars: !@#$%^&*()_+-=[]{}|;:,.<>?";
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should handle unicode characters in result", () => {
    const resultString = "result with unicode: 你好世界 🌍";
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should handle very long result strings", () => {
    const resultString = "a".repeat(10000);
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should be deterministic", () => {
    const resultString = "test result";

    const hash1 = hashResult(resultString, mockIdentifier);
    const hash2 = hashResult(resultString, mockIdentifier);
    const hash3 = hashResult(resultString, mockIdentifier);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("should handle escaped characters correctly", () => {
    const resultString = "result with\nnewline\tand\ttab";
    const hash = hashResult(resultString, mockIdentifier);

    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });
});

describe("hashInput vs hashResult", () => {
  const mockIdentifier = "test-identifier-123";

  it("should produce different hashes for same string when used as input vs result", () => {
    const data = JSON.stringify({ test: "value" });
    const resultString = data;

    const inputHash = hashInput(data, mockIdentifier);
    const resultHash = hashResult(resultString, mockIdentifier);

    expect(inputHash).not.toBe(resultHash);
  });
});
