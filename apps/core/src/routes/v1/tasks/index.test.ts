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
  method: "patch" | "post" | "put",
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

function getJsonResponseSchema(
  doc: ReturnType<typeof tasksRouter.getOpenAPI31Document>,
  path: string,
  method: "get" | "post" | "patch",
  status: "200" | "201",
) {
  const operation = doc.paths?.[path]?.[method];
  const response = operation?.responses?.[status];

  if (!response || typeof response !== "object" || !("content" in response)) {
    return null;
  }

  const jsonBody = response.content?.["application/json"];
  const wrapperSchema = resolveSchema(doc, jsonBody?.schema) as {
    properties?: Record<string, unknown>;
  } | null;

  return resolveSchema(doc, wrapperSchema?.properties?.data);
}

describe("tasks routes OpenAPI query contract", () => {
  it("exposes scope on the top-level task list and keeps nested task reads unchanged", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    expect(getQueryDescriptionFromGetOperation(doc, "/", "scope")).toContain(
      "workspace visibility scope",
    );
    expect(getQueryDescriptionFromGetOperation(doc, "/{id}", "scope")).toBe("");
    expect(
      getQueryDescriptionFromGetOperation(doc, "/{id}/jobs", "scope"),
    ).toBe("");
    expect(
      getQueryDescriptionFromGetOperation(doc, "/{id}/links", "scope"),
    ).toBe("");
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

  it("documents dedicated share mutation routes", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/share"]?.put?.responses).toHaveProperty("200");
    expect(doc.paths?.["/{id}/share"]?.delete?.responses).toHaveProperty("200");
  });

  it("exposes the atomic scheduled Task creation command", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    const requestSchema = getJsonRequestSchema(doc, "/scheduled", "post") as {
      properties?: Record<string, unknown>;
    } | null;
    const responses = doc.paths?.["/scheduled"]?.post?.responses;

    expect(requestSchema?.properties).toHaveProperty("operationId");
    expect(requestSchema?.properties).toHaveProperty("source");
    expect(requestSchema?.properties).toHaveProperty("schedule");
    expect(responses).toHaveProperty("201");
    expect(responses).toHaveProperty("409");
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

  it("exposes a dedicated task-link metadata patch route", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    const patchSchema = getJsonRequestSchema(
      doc,
      "/{id}/links/{linkId}",
      "patch",
    ) as {
      properties?: Record<string, unknown>;
    } | null;

    expect(patchSchema?.properties).toHaveProperty("relation");
    expect(patchSchema?.properties).toHaveProperty("note");
    expect(patchSchema?.properties).not.toHaveProperty("fromTaskId");
    expect(patchSchema?.properties).not.toHaveProperty("toTaskId");
  });

  it("exposes task-relative link responses", () => {
    const doc = tasksRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Tasks API",
        version: "1.0.0",
      },
    });

    const taskLinkSchema = getJsonResponseSchema(
      doc,
      "/{id}/links/{linkId}",
      "patch",
      "200",
    ) as {
      properties?: Record<string, unknown>;
    } | null;

    expect(taskLinkSchema?.properties).toHaveProperty("relation");
    expect(taskLinkSchema?.properties).toHaveProperty("peerTask");
    expect(taskLinkSchema?.properties).not.toHaveProperty("type");
    expect(taskLinkSchema?.properties).not.toHaveProperty("direction");
    expect(taskLinkSchema?.properties).not.toHaveProperty("fromTaskId");
    expect(taskLinkSchema?.properties).not.toHaveProperty("toTaskId");
    expect(taskLinkSchema?.properties).not.toHaveProperty("peerTaskId");
  });
});
