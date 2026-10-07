import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import {
  withCoworkerContextHeaderParameters,
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

  it("withCoworkerContextHeaderParameters documents coworker context headers", () => {
    expect(
      parameterRefs(withCoworkerContextHeaderParameters(baseRoute)),
    ).toEqual([
      "#/components/parameters/OrganizationSlug",
      "#/components/parameters/ContextUserId",
      "#/components/parameters/ContextOrganizationId",
    ]);
  });
});

describe("coworker context responses", () => {
  it("withCoworkerContextHeaderParameters documents the context 400", () => {
    const responses: RouteConfig["responses"] =
      withCoworkerContextHeaderParameters(baseRoute).responses;

    expect(responses[400]).toMatchObject({
      description: expect.stringContaining("context_organization_required"),
    });
  });

  it("keeps a route's own 400", () => {
    const route = withCoworkerContextHeaderParameters(
      createRoute({
        method: "post",
        path: "/example",
        responses: {
          200: { description: "ok" },
          400: { description: "Bad Request - invalid body" },
        },
      }),
    );

    expect(route.responses[400]?.description).toBe(
      "Bad Request - invalid body",
    );
  });

  it("documents the context headers on every route that binds coworker context", () => {
    const routesDir = join(__dirname, "../routes");
    const undocumented = readdirSync(routesDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .filter((file) => {
        const source = readFileSync(join(routesDir, file), "utf8");
        return (
          source.includes("requireAuthorizedUserContext(") &&
          !source.includes("withCoworkerContextHeaderParameters(")
        );
      })
      .map((file) => relative(routesDir, join(routesDir, file)));

    expect(undocumented).toEqual([]);
  });
});
