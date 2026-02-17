import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";

import { LIMITS } from "@/config/constants";

import usersMeRouter from "../index";
import { extractAndValidateFile } from "./post";

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
    expectBadRequest(() => extractAndValidateFile(new FormData()), "File is required");
  });

  it("throws 400 when file is not a File instance", () => {
    const formData = new FormData();
    formData.set("file", "not-a-file");

    expectBadRequest(() => extractAndValidateFile(formData), "File is required");
  });

  it("throws 400 when file is empty", () => {
    const formData = new FormData();
    formData.set("file", new File([], "empty.txt", { type: "text/plain" }));

    expectBadRequest(
      () => extractAndValidateFile(formData),
      "File cannot be empty",
    );
  });

  it("throws 400 when file exceeds maximum size", () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(
        [new Uint8Array(LIMITS.USER_UPLOAD_MAX_SIZE_BYTES + 1)],
        "too-large.bin",
        {
          type: "application/octet-stream",
        },
      ),
    );

    expectBadRequest(
      () => extractAndValidateFile(formData),
      `File exceeds maximum size of ${LIMITS.USER_UPLOAD_MAX_SIZE_BYTES} bytes`,
    );
  });

  it("throws 400 when multiple files are provided", () => {
    const formData = new FormData();
    formData.append("file", new File(["a"], "a.txt", { type: "text/plain" }));
    formData.append("file", new File(["b"], "b.txt", { type: "text/plain" }));

    expectBadRequest(() => extractAndValidateFile(formData), "File is required");
  });
});

describe("users/me files routes OpenAPI contract", () => {
  it("documents 413 response on POST /files", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const responses = doc.paths?.["/files"]?.post?.responses;

    expect(Object.keys(responses ?? {})).toContain("413");
  });
});
