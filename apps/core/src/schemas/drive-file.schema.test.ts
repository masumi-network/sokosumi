import { describe, expect, it } from "vitest";

import { createDriveFileUploadSessionRequestSchema } from "./drive-file.schema";

const upload = {
  filename: "weekly (copy).md",
  contentType: "text/markdown",
  size: 42,
};

describe("an upload with its labels pinned empty (Make a copy)", () => {
  it("is accepted for a personal file", () => {
    expect(
      createDriveFileUploadSessionRequestSchema.safeParse({
        ...upload,
        scope: "me",
        pinLabelsEmpty: true,
      }).success,
    ).toBe(true);
  });

  it("is refused for an organization file", () => {
    expect(
      createDriveFileUploadSessionRequestSchema.safeParse({
        ...upload,
        scope: "org",
        organizationId: "org_1",
        pinLabelsEmpty: true,
      }).success,
    ).toBe(false);
  });
});
