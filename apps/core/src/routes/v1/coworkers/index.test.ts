import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import coworkersRouter from "./index";

describe("coworkers routes OpenAPI contract", () => {
  it("enables workspace middleware so scope=available can resolve", () => {
    // Production bug: product pickers use scope=available which calls
    // requireWorkspaceContext; without includeWorkspaceContext the middleware
    // always leaves workspaceContext null → 403 "Workspace is missing" and
    // chat RSC falls over (Chat Error).
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "index.ts"),
      "utf8",
    );
    expect(source).toMatch(/includeWorkspaceContext:\s*true/);
  });

  it("exposes coworkers endpoints without deprecated id fallback routes", () => {
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
    expect(paths).toContain("/{id}/whitelist");
    expect(paths).toContain("/{id}/workspace-access");
    expect(paths).toContain("/{id}/unarchive");
    expect(paths).toContain("/{id}/api-keys");
    expect(paths).toContain("/{id}/api-keys/{keyId}");
    expect(paths).not.toContain("/{id}/events");
    expect(paths).not.toContain("/{id}/usage");
  });

  it("documents capability filtering and validation failure for GET /", () => {
    const doc = coworkersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Coworkers API",
        version: "1.0.0",
      },
    });

    const getCoworkersOperation = doc.paths?.["/"]?.get;
    const parameterNames = (getCoworkersOperation?.parameters ?? []).map(
      (parameter) => ("name" in parameter ? parameter.name : null),
    );

    expect(parameterNames).toContain("capability");
    expect(getCoworkersOperation?.responses).toHaveProperty("422");
  });
});
