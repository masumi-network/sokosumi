import { describe, expect, it } from "vitest";

import jobsRouter from "./index";

function getScopeDescriptionFromGetOperation(
  doc: ReturnType<typeof jobsRouter.getOpenAPI31Document>,
  path: string,
): string {
  const operation = doc.paths?.[path]?.get;
  const parameters = operation?.parameters ?? [];
  const scopeParameter = parameters.find((parameter) => {
    if (!parameter || typeof parameter !== "object") {
      return false;
    }

    return (
      "name" in parameter &&
      parameter.name === "scope" &&
      "in" in parameter &&
      parameter.in === "query"
    );
  }) as { description?: string } | undefined;

  return scopeParameter?.description ?? "";
}

describe("jobs routes OpenAPI scope contract", () => {
  it("exposes scope query parameter for job endpoints", () => {
    const doc = jobsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Jobs API",
        version: "1.0.0",
      },
    });

    expect(getScopeDescriptionFromGetOperation(doc, "/")).toContain(
      "Allowed values: context, owned",
    );
    expect(getScopeDescriptionFromGetOperation(doc, "/")).not.toContain(
      "shared",
    );
    expect(getScopeDescriptionFromGetOperation(doc, "/{id}")).toContain(
      "Allowed values: context, owned",
    );
    expect(getScopeDescriptionFromGetOperation(doc, "/{id}")).not.toContain(
      "shared",
    );
  });

  it("documents dedicated share mutation routes", () => {
    const doc = jobsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Jobs API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/share"]?.put?.responses).toHaveProperty("200");
    expect(doc.paths?.["/{id}/share"]?.delete?.responses).toHaveProperty("200");
  });

  it("uses summary schema for lists and details schema for single-job reads", () => {
    const doc = jobsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Jobs API",
        version: "1.0.0",
      },
    });

    expect(JSON.stringify(doc.paths?.["/"]?.get?.responses?.["200"])).toContain(
      "JobSummary",
    );
    expect(
      JSON.stringify(doc.paths?.["/{id}"]?.get?.responses?.["200"]),
    ).toContain("#/components/schemas/Job");
  });
});
