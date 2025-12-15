import { hashInput, hashInputDeprecated, hashResult } from "../hash.js";
import {
  type InputVerificationOptions,
  isInputHashVerified,
  isResultHashVerified,
  type ResultVerificationOptions,
} from "../verification.js";

describe("isInputHashVerified", () => {
  const mockIdentifier = "test-identifier-123";

  // Helper function to create a mock input
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

  it("should return false when input hash is missing", () => {
    const inputMock = createInputMock({
      input: JSON.stringify({ field1: "value1" }),
      inputHash: null,
    });
    expect(isInputHashVerified(inputMock)).toBe(false);
  });

  it("should return false when input is null", () => {
    const inputMock = createInputMock({
      input: null,
      inputHash: "somehash",
    });
    expect(isInputHashVerified(inputMock)).toBe(false);
  });

  it("should return false when input JSON is malformed", () => {
    const inputMock = createInputMock({
      input: "{malformed json",
      inputHash: "somehash",
    });
    expect(isInputHashVerified(inputMock)).toBe(false);
  });

  it("should return true when input hash matches current format", () => {
    const inputData = { field1: "value1", field2: 123 };
    const inputString = JSON.stringify(inputData);
    const inputHash = hashInput(inputString, mockIdentifier);

    const inputMock = createInputMock({
      input: inputString,
      inputHash: inputHash,
    });
    expect(isInputHashVerified(inputMock)).toBe(true);
  });

  it("should return true when input hash matches deprecated format", () => {
    const inputData = { field1: "value1", field2: 456 };
    const inputString = JSON.stringify(inputData);
    const deprecatedHash = hashInputDeprecated(inputString, mockIdentifier);

    const inputMock = createInputMock({
      input: inputString,
      inputHash: deprecatedHash,
    });
    expect(isInputHashVerified(inputMock)).toBe(true);
  });

  it("should return false when input hash does not match", () => {
    const inputMock = createInputMock({
      input: JSON.stringify({ field1: "value1" }),
      inputHash: "non-matching-hash",
    });
    expect(isInputHashVerified(inputMock)).toBe(false);
  });
});

describe("isResultHashVerified", () => {
  const mockIdentifier = "test-identifier-123";

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

  it("should return false when result hash is missing", () => {
    const resultMock = createResultMock({
      result: "success",
      resultHash: null,
    });
    expect(isResultHashVerified(resultMock)).toBe(false);
  });

  it("should return false when result is null", () => {
    const resultMock = createResultMock({
      result: null,
      resultHash: "somehash",
    });
    expect(isResultHashVerified(resultMock)).toBe(false);
  });

  it("should return true when output hash matches", () => {
    const resultString = "success";
    const resultHash = hashResult(resultString, mockIdentifier);

    const resultMock = createResultMock({
      result: resultString,
      resultHash: resultHash,
    });
    expect(isResultHashVerified(resultMock)).toBe(true);
  });

  it("should return false when output hash does not match", () => {
    const resultString = "success";
    const resultMock = createResultMock({
      result: resultString,
      resultHash: "non-matching-hash",
    });
    expect(isResultHashVerified(resultMock)).toBe(false);
  });
});
