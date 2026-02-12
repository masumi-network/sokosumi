import { describe, expect, it } from "vitest";

import coworkersRouter from "./index";

describe("coworkers routes OpenAPI contract", () => {
  it("exposes me endpoints and keeps by-id lookup only", () => {
    const doc = coworkersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Coworkers API",
        version: "1.0.0",
      },
    });

    const paths = Object.keys(doc.paths ?? {});

    expect(paths).toContain("/");
    expect(paths).toContain("/me");
    expect(paths).toContain("/me/events");
    expect(paths).toContain("/me/usage");
    expect(paths).toContain("/{id}");

    expect(paths).not.toContain("/{id}/events");
    expect(paths).not.toContain("/{id}/usage");
  });
});
