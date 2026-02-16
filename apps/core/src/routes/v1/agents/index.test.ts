import { describe, expect, it } from "vitest";

import agentsRouter from "./index";

function getScopeDescriptionFromGetOperation(
  doc: ReturnType<typeof agentsRouter.getOpenAPI31Document>,
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

describe("agents routes OpenAPI scope contract", () => {
  it("exposes scope query parameter for agent jobs endpoint", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    expect(getScopeDescriptionFromGetOperation(doc, "/{id}/jobs")).toContain(
      "Allowed values: context, owned, shared",
    );
  });
});
