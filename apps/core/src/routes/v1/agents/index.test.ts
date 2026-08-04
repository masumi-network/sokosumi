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

function getQueryParamFromGetOperation(
  doc: ReturnType<typeof agentsRouter.getOpenAPI31Document>,
  path: string,
  paramName: string,
): { name: string; in: string; description?: string } | undefined {
  const operation = doc.paths?.[path]?.get;
  const parameters = operation?.parameters ?? [];
  const param = parameters.find(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      !("$ref" in p) &&
      "name" in p &&
      "in" in p &&
      (p as { name: string }).name === paramName,
  );
  return param as
    | { name: string; in: string; description?: string }
    | undefined;
}

describe("agents routes OpenAPI scope contract", () => {
  it("exposes scope query parameter for the agent jobs list endpoint", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    expect(getScopeDescriptionFromGetOperation(doc, "/{id}/jobs")).toContain(
      "workspace visibility scope",
    );
  });

  it("exposes category query parameter for list agents endpoint", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    const categoryParam = getQueryParamFromGetOperation(doc, "/", "category");
    expect(categoryParam).toBeDefined();
    expect(categoryParam?.name).toBe("category");
    expect(categoryParam?.description).toContain("category slug");
    expect(categoryParam?.description).toContain("comma-separated");
    expect(categoryParam?.description).toContain("uncategorized");
  });

  it("documents list agents with categories in response", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    const listGet = doc.paths?.["/"]?.get;
    expect(listGet).toBeDefined();
    expect(listGet?.responses?.["200"]).toBeDefined();
    const components = doc.components?.schemas;
    const agentSchema =
      components && typeof components === "object" && "Agent" in components
        ? (components as { Agent?: { properties?: unknown } }).Agent
        : null;
    expect(agentSchema?.properties).toBeDefined();
    const props = agentSchema?.properties as
      | { categories?: unknown }
      | undefined;
    expect(props?.categories).toBeDefined();
  });

  it("documents agent detail-only fields separately from the list schema", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    const components = doc.components?.schemas as
      | Record<string, { properties?: Record<string, unknown> }>
      | undefined;

    expect(components?.Agent?.properties?.riskClassification).toBeFalsy();
    expect(components?.Agent?.properties?.tags).toBeFalsy();
    expect(components?.Agent?.properties?.exampleOutputs).toBeFalsy();

    expect(
      components?.AgentDetail?.properties?.riskClassification,
    ).toBeDefined();
    expect(components?.AgentDetail?.properties?.tags).toBeDefined();
    expect(components?.AgentDetail?.properties?.exampleOutputs).toBeDefined();
  });

  it("documents the agent reviews endpoint", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/reviews"]?.get).toBeDefined();

    const components = doc.components?.schemas as
      | Record<string, { properties?: Record<string, unknown> }>
      | undefined;
    expect(components?.AgentReviews?.properties?.distribution).toBeDefined();
    expect(
      components?.AgentReviews?.properties?.ratingsWithComments,
    ).toBeDefined();
  });

  it("documents category styles as a structured object schema", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    const components = doc.components?.schemas as
      | Record<string, { properties?: Record<string, unknown> }>
      | undefined;
    const categorySchema = components?.Category;
    const stylesProperty = categorySchema?.properties?.styles;

    expect(stylesProperty).toBeDefined();
    expect(JSON.stringify(stylesProperty)).toContain("CategoryStyles");
  });

  it("documents list agents as anonymous-public and agent by-id as authed", () => {
    const doc = agentsRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Agents API",
        version: "1.0.0",
      },
    });

    const listGet = doc.paths?.["/"]?.get;
    expect(listGet?.security).toEqual([]);
    expect(listGet?.responses?.["401"]).toBeUndefined();

    const byIdGet = doc.paths?.["/{id}"]?.get;
    expect(byIdGet?.responses?.["401"]).toBeDefined();
  });
});
