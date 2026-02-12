import { describe, expect, it } from "vitest";

import coworkersRouter from "./index";

describe("coworkers routes OpenAPI contract", () => {
  it("exposes me endpoints and deprecated fallback id endpoints", () => {
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
    expect(paths).toContain("/{id}/events");
    expect(paths).toContain("/{id}/usage");

    const fallbackEvents = doc.paths?.["/{id}/events"]?.get;
    const fallbackUsage = doc.paths?.["/{id}/usage"]?.post;

    expect(fallbackEvents?.deprecated).toBe(true);
    expect(fallbackUsage?.deprecated).toBe(true);
  });
});
