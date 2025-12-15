import { hashInput, hashInputDeprecated, hashResult } from "../hash.js";

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
