import { describe, expect, it } from "vitest";

import {
  buildUserUploadPathname,
  buildUserUploadPrefix,
  sanitizeUserUploadFilename,
} from "../user-upload-path.js";

describe("user upload path helpers", () => {
  it("builds the user upload prefix", () => {
    expect(buildUserUploadPrefix("user_123")).toBe("users/user_123/");
  });

  it("sanitizes uploaded file names", () => {
    expect(sanitizeUserUploadFilename(" ../my file(1).pdf ")).toBe(
      "my_file1.pdf",
    );
  });

  it("falls back to a safe filename when input becomes empty", () => {
    expect(sanitizeUserUploadFilename("...")).toBe("file");
  });

  it("builds the full upload pathname", () => {
    expect(buildUserUploadPathname("user_123", "hello world.txt")).toBe(
      "users/user_123/hello_world.txt",
    );
  });
});
