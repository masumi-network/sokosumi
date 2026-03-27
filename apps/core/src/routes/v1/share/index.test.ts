import { describe, expect, it } from "vitest";

import shareRouter from "./index";

describe("share routes OpenAPI contract", () => {
  it("documents the public shared-job route", () => {
    const doc = shareRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Share API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/jobs/{token}"]?.get?.description).toContain(
      "publicly shared job",
    );
  });
});
