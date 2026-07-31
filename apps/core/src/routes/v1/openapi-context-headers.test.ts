import { describe, expect, it } from "vitest";

import agentsRouter from "./agents/index.js";
import chatRoomsRouter from "./chats/rooms/index.js";
import hermesRouter from "./hermes/index.js";
import tasksRouter from "./tasks/index.js";
import usersRouter from "./users/index.js";

interface OpenApiParameter {
  $ref?: string;
  name?: string;
}

interface OpenApiOperation {
  parameters?: OpenApiParameter[];
}

interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  patch?: OpenApiOperation;
  delete?: OpenApiOperation;
}

function operationParameterRefs(
  doc: { paths?: Record<string, OpenApiPathItem | undefined> },
  path: string,
  method: keyof OpenApiPathItem,
): string[] {
  const operation = doc.paths?.[path]?.[method];
  return (operation?.parameters ?? [])
    .map((parameter) => parameter.$ref)
    .filter((ref): ref is string => typeof ref === "string");
}

function hasCoworkerContextHeaders(refs: string[]): boolean {
  return (
    refs.includes("#/components/parameters/ContextUserId") &&
    refs.includes("#/components/parameters/ContextOrganizationId")
  );
}

function hasOrchestratorContextHeaders(refs: string[]): boolean {
  return (
    refs.includes("#/components/parameters/OrchestratorContextUserId") &&
    refs.includes("#/components/parameters/OrchestratorContextOrganizationId")
  );
}

function hasAnyContextHeader(refs: string[]): boolean {
  return hasCoworkerContextHeaders(refs) || hasOrchestratorContextHeaders(refs);
}

const openApiInfo = {
  openapi: "3.1.0",
  info: { title: "Sokosumi API", version: "1.0.0" },
} as const;

describe("OpenAPI X-Context-* header documentation", () => {
  it("documents coworker context headers on task create (coworker+context auth)", () => {
    const doc = tasksRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/", "post");
    expect(hasCoworkerContextHeaders(refs)).toBe(true);
    expect(hasOrchestratorContextHeaders(refs)).toBe(false);
  });

  it("documents orchestrator-only context headers on user credits (coworker rejected)", () => {
    const doc = usersRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/{id}/credits", "get");
    expect(hasOrchestratorContextHeaders(refs)).toBe(true);
    expect(hasCoworkerContextHeaders(refs)).toBe(false);
  });

  it("omits context headers on hermes product chat (session-only)", () => {
    const doc = hermesRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/chat", "post");
    expect(hasAnyContextHeader(refs)).toBe(false);
    expect(refs).toContain("#/components/parameters/OrganizationSlug");
  });

  it("omits context headers on public agent catalog list", () => {
    const doc = agentsRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/", "get");
    expect(hasAnyContextHeader(refs)).toBe(false);
  });

  it("documents coworker context headers on agent jobs list", () => {
    const doc = agentsRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/{id}/jobs", "get");
    expect(hasCoworkerContextHeaders(refs)).toBe(true);
  });

  it("documents orchestrator-only context headers on agent job create (coworker rejected)", () => {
    const doc = agentsRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/{id}/jobs", "post");
    expect(hasOrchestratorContextHeaders(refs)).toBe(true);
    expect(hasCoworkerContextHeaders(refs)).toBe(false);
  });

  it("omits context headers on chat rooms list (session-only)", () => {
    const doc = chatRoomsRouter.getOpenAPI31Document(openApiInfo);
    const refs = operationParameterRefs(doc, "/", "get");
    expect(hasAnyContextHeader(refs)).toBe(false);
    expect(refs).toContain("#/components/parameters/OrganizationSlug");
  });
});
