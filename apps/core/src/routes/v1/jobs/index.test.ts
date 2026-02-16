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
      "Allowed values: context, owned, shared",
    );
    expect(getScopeDescriptionFromGetOperation(doc, "/{id}")).toContain(
      "Allowed values: context, owned, shared",
    );
  });
});
