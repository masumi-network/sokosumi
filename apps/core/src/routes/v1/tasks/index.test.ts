import { describe, expect, it } from "vitest";

import tasksRouter from "./index";

function getScopeDescriptionFromGetOperation(
  doc: ReturnType<typeof tasksRouter.getOpenAPI31Document>,
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

describe("tasks routes OpenAPI scope contract", () => {
  it("exposes scope query parameter for task endpoints", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    expect(getScopeDescriptionFromGetOperation(doc, "/")).toContain(
      "Allowed values: context, owned",
    );
    expect(getScopeDescriptionFromGetOperation(doc, "/{id}")).toContain(
      "Allowed values: context, owned",
    );
    expect(getScopeDescriptionFromGetOperation(doc, "/{id}/jobs")).toContain(
      "Allowed values: context, owned",
    );
  });

  it("marks task deletion as forbidden", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    const deleteResponses = doc.paths?.["/{id}"]?.delete?.responses;

    expect(deleteResponses).toBeDefined();
    expect(deleteResponses).toHaveProperty("403");
    expect(deleteResponses).not.toHaveProperty("200");
  });
});
