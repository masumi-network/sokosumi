import { describe, expect, it } from "vitest";

import tasksRouter from "./index";

function getQueryDescriptionFromGetOperation(
  doc: ReturnType<typeof tasksRouter.getOpenAPI31Document>,
  path: string,
  name: string,
): string {
  const operation = doc.paths?.[path]?.get;
  const parameters = operation?.parameters ?? [];
  const queryParameter = parameters.find((parameter) => {
    if (!parameter || typeof parameter !== "object") {
      return false;
    }

    return (
      "name" in parameter &&
      parameter.name === name &&
      "in" in parameter &&
      parameter.in === "query"
    );
  }) as { description?: string } | undefined;

  return queryParameter?.description ?? "";
}

function resolveSchema(
  doc: ReturnType<typeof tasksRouter.getOpenAPI31Document>,
  schema: unknown,
) {
  if (!schema || typeof schema !== "object") {
    return null;
  }

  if ("$ref" in schema && typeof schema.$ref === "string") {
    const schemaName = schema.$ref.split("/").pop();
    if (!schemaName) {
      return null;
    }

    return doc.components?.schemas?.[schemaName] ?? null;
  }

  return schema;
}

function getJsonRequestSchema(
  doc: ReturnType<typeof tasksRouter.getOpenAPI31Document>,
  path: string,
  method: "patch" | "put",
) {
  const operation = doc.paths?.[path]?.[method];
  const requestBody = operation?.requestBody;

  if (
    !requestBody ||
    typeof requestBody !== "object" ||
    !("content" in requestBody)
  ) {
    return null;
  }

  const jsonBody = requestBody.content?.["application/json"];
  return resolveSchema(doc, jsonBody?.schema);
}

describe("tasks routes OpenAPI query contract", () => {
  it("exposes scope query parameter for task endpoints", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    expect(getQueryDescriptionFromGetOperation(doc, "/", "scope")).toContain(
      "Allowed values: context, owned",
    );
    expect(
      getQueryDescriptionFromGetOperation(doc, "/{id}", "scope"),
    ).toContain("Allowed values: context, owned");
    expect(
      getQueryDescriptionFromGetOperation(doc, "/{id}/jobs", "scope"),
    ).toContain("Allowed values: context, owned");
  });

  it("exposes multi-status query parameter for the task list endpoint", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    expect(getQueryDescriptionFromGetOperation(doc, "/", "status")).toContain(
      "Comma-separated status filters",
    );
  });

  it("exposes task archive on delete route", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    const deleteResponses = doc.paths?.["/{id}"]?.delete?.responses;

    expect(deleteResponses).toBeDefined();
    expect(deleteResponses).toHaveProperty("200");
    expect(deleteResponses).toHaveProperty("403");
    expect(deleteResponses).toHaveProperty("404");
  });

  it("keeps task patch metadata-only and exposes a dedicated workspace update route", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    const patchSchema = getJsonRequestSchema(doc, "/{id}", "patch") as {
      properties?: Record<string, unknown>;
    } | null;
    const workspaceSchema = getJsonRequestSchema(
      doc,
      "/{id}/workspace",
      "put",
    ) as {
      properties?: Record<string, unknown>;
    } | null;
    const workspaceResponses = doc.paths?.["/{id}/workspace"]?.put?.responses;

    expect(patchSchema?.properties).not.toHaveProperty("organizationId");
    expect(workspaceSchema?.properties).toHaveProperty("organizationId");
    expect(workspaceResponses).toHaveProperty("409");
  });
});
