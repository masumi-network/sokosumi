import { type JobWithStatus } from "@/lib/db";
import { JobInputData } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";
import {
  createHash,
  getInputHash,
  getInputHashDeprecated,
  getMatchedHash,
  getResultHash,
  isJobVerified,
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
      result: "success",
      error: null,
      job_id: "job_1",
    };

    it("should return output hash when it matches", () => {
      const resultHash = getResultHash(mockOutputData, mockIdentifier);
      const result = getMatchedHash(
        "output",
        mockOutputData,
        mockIdentifier,
        resultHash ?? "",
      );
      expect(result).toBe(resultHash);
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
        result: "different",
      };
      const outputData2: JobStatusResponseSchemaType = {
        ...mockOutputData,
        result: "another",
      };

      const hash1 = getResultHash(outputData1, mockIdentifier);
      const hash2 = getResultHash(outputData2, mockIdentifier);

      // Different data should produce different hashes
      expect(hash1).not.toBe(hash2);

      // Each hash should match with its corresponding data
      const result1 = getMatchedHash(
        "output",
        outputData1,
        mockIdentifier,
        hash1 ?? "",
      );
      expect(result1).toBe(hash1);

      const result2 = getMatchedHash(
        "output",
        outputData2,
        mockIdentifier,
        hash2 ?? "",
      );
      expect(result2).toBe(hash2);

      // Mismatched data and hash should return null
      const result3 = getMatchedHash(
        "output",
        outputData1,
        mockIdentifier,
        hash2 ?? "",
      );
      expect(result3).toBeNull();
    });

    it("should not have deprecated fallback for output mode", () => {
      // Output mode does not use deprecated hash, only input mode does
      const resultHash = getResultHash(mockOutputData, mockIdentifier);
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
        resultHash ?? "",
      );
      expect(result2).toBe(resultHash);
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
        job_id: "job_1",
        status: "completed",
        result: null,
        error: null,
      };
      const hash = getResultHash(outputWithNulls, mockIdentifier);
      const result = getMatchedHash(
        "output",
        outputWithNulls,
        mockIdentifier,
        hash ?? "",
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

describe("isJobVerified", () => {
  const mockIdentifier = "test-identifier-123";

  // Helper function to create a mock job
  function createMockJob(
    overrides: Partial<JobWithStatus> = {},
  ): JobWithStatus {
    return {
      id: "job_1",
      createdAt: new Date(),
      updatedAt: new Date(),
      agentId: "agent_1",
      userId: "user_1",
      organizationId: "org_1",
      input: null,
      inputHash: null,
      output: null,
      resultHash: null,
      identifierFromPurchaser: mockIdentifier,
      status: "completed",
      jobStatusSettled: true,
      // Required relations with proper types
      agent: {
        id: "agent_1",
        name: "Test Agent",
        description: null,
        imageUrl: null,
        verified: false,
        featured: false,
        isActive: true,
        inputSchema: null,
        outputSchema: null,
        blockchainIdentifier: "test",
        agentId: "agent_1",
        sellerId: "seller_1",
        createdAt: new Date(),
        updatedAt: new Date(),
        ratings: [],
        bookmarks: [],
        jobs: [],
      },
      user: {
        id: "user_1",
        email: "test@example.com",
        emailVerified: false,
        name: "Test User",
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedAvatar: false,
        organizationId: "org_1",
      },
      creditTransaction: null,
      refundedCreditTransaction: null,
      blobs: [],
      links: [],
      shares: [],
      ...overrides,
    } as JobWithStatus;
  }

  describe("input verification", () => {
    it("should return false when identifierFromPurchaser is null", () => {
      const job = createMockJob({
        identifierFromPurchaser: null,
        input: JSON.stringify({ field1: "value1" }),
        inputHash: "somehash",
      });
      expect(isJobVerified("input", job)).toBe(false);
    });

    it("should return false when input hash is missing", () => {
      const job = createMockJob({
        input: JSON.stringify({ field1: "value1" }),
        inputHash: null,
      });
      expect(isJobVerified("input", job)).toBe(false);
    });

    it("should return false when input is null", () => {
      const job = createMockJob({
        inputHash: "somehash",
      });
      expect(isJobVerified("input", job)).toBe(false);
    });

    it("should return false when input JSON is malformed", () => {
      const job = createMockJob({
        input: "{malformed json",
        inputHash: "somehash",
      });
      expect(isJobVerified("input", job)).toBe(false);
    });

    it("should return true when input hash matches current format", () => {
      const inputData = { field1: "value1", field2: 123 };
      const inputMap = new Map(Object.entries(inputData)) as JobInputData;
      const inputHash = getInputHash(inputMap, mockIdentifier);

      const job = createMockJob({
        input: JSON.stringify(inputData),
        inputHash: inputHash,
      });
      expect(isJobVerified("input", job)).toBe(true);
    });

    it("should return true when input hash matches deprecated format", () => {
      const inputData = { field1: "value1", field2: 456 };
      const inputMap = new Map(Object.entries(inputData)) as JobInputData;
      const deprecatedHash = getInputHashDeprecated(inputMap, mockIdentifier);

      const job = createMockJob({
        input: JSON.stringify(inputData),
        inputHash: deprecatedHash,
      });
      expect(isJobVerified("input", job)).toBe(true);
    });

    it("should return false when input hash does not match", () => {
      const job = createMockJob({
        input: JSON.stringify({ field1: "value1" }),
        inputHash: "non-matching-hash",
      });
      expect(isJobVerified("input", job)).toBe(false);
    });
  });

  describe("output verification", () => {
    it("should return false when identifierFromPurchaser is null", () => {
      const job = createMockJob({
        identifierFromPurchaser: null,
        output: JSON.stringify({ status: "completed" }),
        resultHash: "somehash",
      });
      expect(isJobVerified("output", job)).toBe(false);
    });

    it("should return false when output hash is missing", () => {
      const job = createMockJob({
        output: JSON.stringify({ status: "completed" }),
        resultHash: null,
      });
      expect(isJobVerified("output", job)).toBe(false);
    });

    it("should return false when output is null", () => {
      const job = createMockJob({
        output: null,
        resultHash: "somehash",
      });
      expect(isJobVerified("output", job)).toBe(false);
    });

    it("should return false when output JSON is malformed", () => {
      const job = createMockJob({
        output: "{broken json",
        resultHash: "somehash",
      });
      expect(isJobVerified("output", job)).toBe(false);
    });

    it("should return true when output hash matches", () => {
      const outputData: JobStatusResponseSchemaType = {
        status: "completed",
        result: "success",
        error: null,
        job_id: "job_1",
      };
      const resultHash = getResultHash(outputData, mockIdentifier);

      const job = createMockJob({
        output: JSON.stringify(outputData),
        resultHash: resultHash,
      });
      expect(isJobVerified("output", job)).toBe(true);
    });

    it("should return false when output hash does not match", () => {
      const outputData: JobStatusResponseSchemaType = {
        job_id: "job_1",
        status: "completed",
        error: null,
        result: "success",
      };

      const job = createMockJob({
        output: JSON.stringify(outputData),
        resultHash: "non-matching-hash",
      });
      expect(isJobVerified("output", job)).toBe(false);
    });

    it("should not use deprecated hash for output verification", () => {
      const outputData: JobStatusResponseSchemaType = {
        job_id: "job_1",
        status: "completed",
        result: "test",
        error: null,
      };

      // Create a fake "deprecated" hash
      const job = createMockJob({
        output: JSON.stringify(outputData),
        resultHash: "fake-deprecated-hash",
      });
      expect(isJobVerified("output", job)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle empty input data", () => {
      const inputData = {};
      const inputMap = new Map() as JobInputData;
      const inputHash = getInputHash(inputMap, mockIdentifier);

      const job = createMockJob({
        input: JSON.stringify(inputData),
        inputHash: inputHash,
      });
      expect(isJobVerified("input", job)).toBe(true);
    });
  });
});

describe("createHash", () => {
  it("should match expected hash for provided meme markdown string", () => {
    const data =
      // "9caaffd05cee4d839e04;# **Your Memes**\\n\\n### Meme 1\\n![Meme 1](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_1.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_1.png)\\n\\n### Meme 2\\n![Meme 2](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_2.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_2.png)\\n\\n### Meme 3\\n![Meme 3](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_3.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_3.png)\\n\\n### Meme 4\\n![Meme 4](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_4.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_4.png)\\n\\n### Meme 5\\n![Meme 5](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_5.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_5.png)\\n\\n### Meme 6\\n![Meme 6](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_6.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_6.png)\\n\\n### Meme 7\\n![Meme 7](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_7.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_7.png)\\n\\n### Meme 8\\n![Meme 8](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_8.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_8.png)\\n\\n### Meme 9\\n![Meme 9](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_9.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_9.png)\\n\\n### Meme 10\\n![Meme 10](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_10.png)\\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_10.png)\\n\\n";
      "9caaffd05cee4d839e04;# **Your Memes**\n\n### Meme 1\n![Meme 1](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_1.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_1.png)\n\n### Meme 2\n![Meme 2](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_2.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_2.png)\n\n### Meme 3\n![Meme 3](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_3.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_3.png)\n\n### Meme 4\n![Meme 4](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_4.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_4.png)\n\n### Meme 5\n![Meme 5](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_5.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_5.png)\n\n### Meme 6\n![Meme 6](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_6.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_6.png)\n\n### Meme 7\n![Meme 7](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_7.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_7.png)\n\n### Meme 8\n![Meme 8](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_8.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_8.png)\n\n### Meme 9\n![Meme 9](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_9.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_9.png)\n\n### Meme 10\n![Meme 10](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_10.png)\n[Download](https://nmkr-general-bucket.fra1.digitaloceanspaces.com/memes/20250929_161417_When_you_build_the_best_AI_Age_10.png)\n\n";
    const expected =
      "1776cd8e429d53559bdf40566f88827724dcceed285f50019df09b62ed92e02f";

    const escaped = JSON.stringify(data).slice(1, -1);
    expect(createHash(escaped)).toBe(expected);
  });
});
