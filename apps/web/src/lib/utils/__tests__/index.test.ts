import {
  AgentJobStatus,
  OnChainJobStatus,
  OnChainTransactionStatus,
  type JobWithStatus,
} from "@sokosumi/database";
import { JobInputData } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";
import {
  createHash,
  getInputHash,
  getInputHashDeprecated,
  getMatchedHash,
  getResultHash,
  InputVerificationOptions,
  isJobVerified,
  ResultVerificationOptions,
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
    const mockInputData = { field1: "value1", field2: 123 };
    const mockInputString = JSON.stringify(mockInputData);

    it("should return current hash when it matches", () => {
      const currentHash = getInputHash(mockInputString, mockIdentifier);
      const result = getMatchedHash(
        "input",
        mockIdentifier,
        mockInputString,
        currentHash,
      );
      expect(result).toBe(currentHash);
    });

    it("should return deprecated hash when current does not match but deprecated does", () => {
      const deprecatedHash = getInputHashDeprecated(
        mockInputString,
        mockIdentifier,
      );
      const result = getMatchedHash(
        "input",
        mockIdentifier,
        mockInputString,
        deprecatedHash,
      );
      expect(result).toBe(deprecatedHash);
    });

    it("should return null when neither current nor deprecated hash matches", () => {
      const unmatchedHash = "completely-different-hash";
      const result = getMatchedHash(
        "input",
        mockIdentifier,
        mockInputString,
        unmatchedHash,
      );
      expect(result).toBeNull();
    });

    it("should handle different identifiers correctly", () => {
      const hash1 = getInputHash(mockInputString, "identifier1");
      const hash2 = getInputHash(mockInputString, "identifier2");

      // Hash generated with identifier1 should match
      const result1 = getMatchedHash(
        "input",
        "identifier1",
        mockInputString,
        hash1,
      );
      expect(result1).toBe(hash1);

      // Hash generated with identifier1 should not match identifier2
      const result2 = getMatchedHash(
        "input",
        "identifier1",
        mockInputString,
        hash1,
      );
      expect(result2).not.toBe(hash2);

      // Hash generated with identifier2 should match
      const result3 = getMatchedHash(
        "input",
        "identifier2",
        mockInputString,
        hash2,
      );
      expect(result3).toBe(hash2);
    });
  });

  describe("result hash matching", () => {
    const resultString: string = "success";

    it("should return result hash when it matches", () => {
      const resultHash = getResultHash(resultString, mockIdentifier);
      const result = getMatchedHash(
        "result",
        mockIdentifier,
        resultString,
        resultHash,
      );
      expect(result).toBe(resultHash);
    });

    it("should return null when output hash does not match", () => {
      const unmatchedHash = "different-output-hash";
      const result = getMatchedHash(
        "result",
        mockIdentifier,
        resultString,
        unmatchedHash,
      );
      expect(result).toBeNull();
    });

    it("should handle different output data correctly", () => {
      const resultString1: string = "different";
      const resultString2: string = "another";

      const hash1 = getResultHash(resultString1, mockIdentifier);
      const hash2 = getResultHash(resultString2, mockIdentifier);

      // Different data should produce different hashes
      expect(hash1).not.toBe(hash2);

      // Each hash should match with its corresponding data
      const result1 = getMatchedHash(
        "result",
        mockIdentifier,
        resultString1,
        hash1 ?? "",
      );
      expect(result1).toBe(hash1);

      const result2 = getMatchedHash(
        "result",
        mockIdentifier,
        resultString2,
        hash2 ?? "",
      );
      expect(result2).toBe(hash2);

      // Mismatched data and hash should return null
      const result3 = getMatchedHash(
        "result",
        mockIdentifier,
        resultString1,
        hash2 ?? "",
      );
      expect(result3).toBeNull();
    });

    describe("edge cases", () => {
      it("should handle empty input data", () => {
        const emptyInputData = "";
        const hash = getInputHash(emptyInputData, mockIdentifier);
        const result = getMatchedHash(
          "input",
          mockIdentifier,
          emptyInputData,
          hash,
        );
        expect(result).toBe(hash);
      });

      it("should handle special characters in identifier", () => {
        const specialIdentifier = "test!@#$%^&*()_+-=[]{}|;:,.<>?";
        const inputString = JSON.stringify({ test: "value" });
        const hash = getInputHash(inputString, specialIdentifier);
        const result = getMatchedHash(
          "input",
          specialIdentifier,
          inputString,
          hash,
        );
        expect(result).toBe(hash);
      });

      it("should be case sensitive for hash matching", () => {
        const inputString = JSON.stringify({ test: "value" });
        const hash = getInputHash(inputString, mockIdentifier);
        const upperCaseHash = hash?.toUpperCase();
        const result = getMatchedHash(
          "input",
          mockIdentifier,
          inputString,
          upperCaseHash,
        );
        expect(result).toBeNull();
      });
    });
  });

  describe("isJobVerified", () => {
    const mockIdentifier = "test-identifier-123";

    // Helper function to create a mock job
    function createInputMock(
      overrides: Partial<InputVerificationOptions> = {},
    ): InputVerificationOptions {
      return {
        identifierFromPurchaser: mockIdentifier,
        inputHash: null,
        input: null,
        ...overrides,
      };
    }

    function createResultMock(
      overrides: Partial<ResultVerificationOptions> = {},
    ): ResultVerificationOptions {
      return {
        identifierFromPurchaser: mockIdentifier,
        resultHash: null,
        result: null,
        ...overrides,
      };
    }

    describe("input verification", () => {
      it("should return false when input hash is missing", () => {
        const inputMock = createInputMock({
          input: JSON.stringify({ field1: "value1" }),
          inputHash: null,
        });
        expect(isJobVerified("input", inputMock)).toBe(false);
      });

      it("should return false when input is null", () => {
        const inputMock = createInputMock({
          input: null,
          inputHash: "somehash",
        });
        expect(isJobVerified("input", inputMock)).toBe(false);
      });

      it("should return false when input JSON is malformed", () => {
        const inputMock = createInputMock({
          input: "{malformed json",
          inputHash: "somehash",
        });
        expect(isJobVerified("input", inputMock)).toBe(false);
      });

      it("should return true when input hash matches current format", () => {
        const inputData = { field1: "value1", field2: 123 };
        const inputString = JSON.stringify(inputData);
        const inputHash = getInputHash(inputString, mockIdentifier);

        const inputMock = createInputMock({
          input: inputString,
          inputHash: inputHash,
        });
        expect(isJobVerified("input", inputMock)).toBe(true);
      });

      it("should return true when input hash matches deprecated format", () => {
        const inputData = { field1: "value1", field2: 456 };
        const inputString = JSON.stringify(inputData);
        const deprecatedHash = getInputHashDeprecated(
          inputString,
          mockIdentifier,
        );

        const inputMock = createInputMock({
          input: inputString,
          inputHash: deprecatedHash,
        });
        expect(isJobVerified("input", inputMock)).toBe(true);
      });

      it("should return false when input hash does not match", () => {
        const inputMock = createInputMock({
          input: JSON.stringify({ field1: "value1" }),
          inputHash: "non-matching-hash",
        });
        expect(isJobVerified("input", inputMock)).toBe(false);
      });
    });

    describe("result verification", () => {
      it("should return false when result hash is missing", () => {
        const resultMock = createResultMock({
          result: "success",
          resultHash: null,
        });
        expect(isJobVerified("result", resultMock)).toBe(false);
      });

      it("should return false when result is null", () => {
        const resultMock = createResultMock({
          result: null,
          resultHash: "somehash",
        });
        expect(isJobVerified("result", resultMock)).toBe(false);
      });

      it("should return true when output hash matches", () => {
        const resultString = "success";
        const resultHash = getResultHash(resultString, mockIdentifier);

        const resultMock = createResultMock({
          result: resultString,
          resultHash: resultHash,
        });
        expect(isJobVerified("result", resultMock)).toBe(true);
      });

      it("should return false when output hash does not match", () => {
        const resultString = "success";
        const resultMock = createResultMock({
          result: resultString,
          resultHash: "non-matching-hash",
        });
        expect(isJobVerified("result", resultMock)).toBe(false);
      });
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
