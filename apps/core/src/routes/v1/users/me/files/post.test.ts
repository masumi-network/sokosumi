import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { LIMITS } from "@/config/constants";

import { extractAndValidateFile, uploadUserFileRequestSchema } from "./post";

function expectBadRequest(action: () => unknown, expectedMessage: string) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    const httpError = error as HTTPException;
    expect(httpError.status).toBe(400);
    expect(httpError.message).toBe(expectedMessage);
    return;
  }

  throw new Error("Expected HTTPException to be thrown");
}

describe("extractAndValidateFile", () => {
  it("throws 400 when file is missing", () => {
    expectBadRequest(() => extractAndValidateFile({}), "File is required");
  });

  it("throws 400 when file is empty", () => {
    expectBadRequest(
      () =>
        extractAndValidateFile({
          file: new File([], "empty.txt", { type: "text/plain" }),
        }),
      "File cannot be empty",
    );
  });

  it("throws 400 when file exceeds maximum size", () => {
    expectBadRequest(
      () =>
        extractAndValidateFile({
          file: new File(
            [new Uint8Array(LIMITS.USER_UPLOAD_MAX_SIZE_BYTES + 1)],
            "too-large.bin",
            {
              type: "application/octet-stream",
            },
          ),
        }),
      `File exceeds maximum size of ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
    );
  });
});

describe("uploadUserFileRequestSchema", () => {
  it("accepts a File instance", () => {
    const parsed = uploadUserFileRequestSchema.parse({
      file: new File(["hello"], "hello.txt", { type: "text/plain" }),
    });

    expect(parsed.file).toBeInstanceOf(File);
  });

  it("rejects non-file values", () => {
    expect(() => {
      uploadUserFileRequestSchema.parse({
        file: "not-a-file",
      });
    }).toThrow();
  });

  it("rejects file arrays", () => {
    expect(() => {
      uploadUserFileRequestSchema.parse({
        file: [new File(["a"], "a.txt", { type: "text/plain" })],
      });
    }).toThrow();
  });
});
