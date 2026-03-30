import { describe, expect, it } from "vitest";

import shareRouter from "./index";

describe("share routes OpenAPI contract", () => {
  it("documents the canonical public shared-resource route", () => {
    const doc = shareRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Share API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{token}"]?.get?.description).toContain(
      "publicly shared resource",
    );
    expect(
      doc.components?.schemas?.PublicSharedResourceResponse?.discriminator,
    ).toEqual({
      propertyName: "kind",
      mapping: {
        job: "#/components/schemas/PublicSharedJobResource",
        task: "#/components/schemas/PublicSharedTaskResource",
      },
    });
  });

  it("does not document the legacy job-only shared route", () => {
    const doc = shareRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Share API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/jobs/{token}"]).toBeUndefined();
  });
});
