import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import {
  withCoworkerContextHeaderParameters,
  withGlobalHeaderParameters,
  withOrchestratorContextHeaderParameters,
  withOrganizationSlugHeaderParameter,
} from "./hono";

function parameterRefs(route: RouteConfig): string[] {
  return (route.parameters ?? [])
    .filter(
      (parameter): parameter is { $ref: string } =>
        typeof parameter === "object" &&
        parameter !== null &&
        "$ref" in parameter &&
        typeof (parameter as { $ref: unknown }).$ref === "string",
    )
    .map((parameter) => parameter.$ref);
}

const baseRoute = createRoute({
  method: "get",
  path: "/example",
  responses: {
    200: {
      description: "ok",
    },
  },
});

describe("OpenAPI header parameter helpers", () => {
  it("withOrganizationSlugHeaderParameter documents only X-Organization-Slug", () => {
    expect(
      parameterRefs(withOrganizationSlugHeaderParameter(baseRoute)),
    ).toEqual(["#/components/parameters/OrganizationSlug"]);
  });

  it("withGlobalHeaderParameters matches organization-slug-only default", () => {
    expect(parameterRefs(withGlobalHeaderParameters(baseRoute))).toEqual(
      parameterRefs(withOrganizationSlugHeaderParameter(baseRoute)),
    );
  });

  it("withCoworkerContextHeaderParameters documents coworker/orchestrator context headers", () => {
    expect(
      parameterRefs(withCoworkerContextHeaderParameters(baseRoute)),
    ).toEqual([
      "#/components/parameters/OrganizationSlug",
      "#/components/parameters/ContextUserId",
      "#/components/parameters/ContextOrganizationId",
    ]);
  });

  it("withOrchestratorContextHeaderParameters documents orchestrator-only context headers", () => {
    expect(
      parameterRefs(withOrchestratorContextHeaderParameters(baseRoute)),
    ).toEqual([
      "#/components/parameters/OrganizationSlug",
      "#/components/parameters/OrchestratorContextUserId",
      "#/components/parameters/OrchestratorContextOrganizationId",
    ]);
  });
});
