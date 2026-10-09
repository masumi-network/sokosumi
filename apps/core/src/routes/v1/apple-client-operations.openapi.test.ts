import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import apiV1 from "./index.js";

const HTTP_METHODS = ["get", "put", "post", "patch", "delete"] as const;

interface OpenApiPaths {
  paths?: Record<string, object | undefined>;
}

function operations(doc: OpenApiPaths): string[] {
  return Object.entries(doc.paths ?? {}).flatMap(([path, item = {}]) =>
    HTTP_METHODS.filter((method) => method in item).map(
      (method) => `${method.toUpperCase()} ${path}`,
    ),
  );
}

const appleSnapshot: OpenApiPaths = JSON.parse(
  readFileSync(
    new URL(
      "../../../../apple/Packages/CoreAPI/Sources/CoreAPI/openapi.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const coreDoc = apiV1.getOpenAPI31Document({
  openapi: "3.1.0",
  info: { title: "Sokosumi API", version: "1.0.0" },
});

describe("Apple client operations", () => {
  it("keeps every Core operation the Apple app selects", () => {
    const served = new Set(operations(coreDoc));
    const missing = operations(appleSnapshot).filter((op) => !served.has(op));

    expect(
      missing,
      `Installed Apple builds call ${missing.join(", ")}, which Core no longer serves. Follow "Removing an Operation" in docs/agents/core-route-patterns.md before removing it.`,
    ).toEqual([]);
  });
});
