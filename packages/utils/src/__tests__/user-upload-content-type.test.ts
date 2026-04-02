import { describe, expect, it } from "vitest";

import { resolveUserUploadContentType } from "../user-upload-content-type.js";

describe("resolveUserUploadContentType", () => {
  it("accepts an allowed declared type", () => {
    expect(resolveUserUploadContentType("x.bin", "application/pdf")).toBe(
      "application/pdf",
    );
  });

  it("normalizes declared type", () => {
    expect(resolveUserUploadContentType("x", "Application/PDF")).toBe(
      "application/pdf",
    );
  });

  it("strips parameters from declared type", () => {
    expect(resolveUserUploadContentType("x", "text/plain; charset=utf-8")).toBe(
      "text/plain",
    );
  });

  it("infers from filename when declared type is empty", () => {
    expect(resolveUserUploadContentType("report.pdf", "")).toBe(
      "application/pdf",
    );
  });

  it("infers from filename when declared type is application/octet-stream", () => {
    expect(
      resolveUserUploadContentType("report.pdf", "application/octet-stream"),
    ).toBe("application/pdf");
  });

  it("returns null when declared type is generic and extension is unknown", () => {
    expect(
      resolveUserUploadContentType("data.bin", "application/octet-stream"),
    ).toBeNull();
  });

  it("returns null for an unsupported explicit type", () => {
    expect(
      resolveUserUploadContentType("x.exe", "application/x-msdownload"),
    ).toBeNull();
  });
});
