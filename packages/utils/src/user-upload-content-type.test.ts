import { describe, expect, it } from "vitest";

import {
  isUserUploadAllowedContentType,
  normalizeUserUploadContentType,
  resolveUserUploadContentType,
} from "./user-upload-content-type.js";

describe("normalizeUserUploadContentType", () => {
  it("maps image/jpg to image/jpeg", () => {
    expect(normalizeUserUploadContentType("image/jpg")).toBe("image/jpeg");
  });
});

describe("isUserUploadAllowedContentType", () => {
  it("accepts application/pdf", () => {
    expect(isUserUploadAllowedContentType("application/pdf")).toBe(true);
  });

  it("rejects octet-stream", () => {
    expect(isUserUploadAllowedContentType("application/octet-stream")).toBe(
      false,
    );
  });
});

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

  it("maps declared image/jpg to image/jpeg", () => {
    expect(resolveUserUploadContentType("photo.jpg", "image/jpg")).toBe(
      "image/jpeg",
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
