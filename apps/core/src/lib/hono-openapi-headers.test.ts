import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    const srcDir = join(__dirname, "..");
    const sources = readdirSync(srcDir, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => ({
        file,
        source: readFileSync(join(srcDir, file), "utf8"),
      }));
    const isRoute = (source: string) => source.includes("createRoute(");
    const helpers = sources.filter(({ source }) => !isRoute(source));
    const callsAny = (source: string, names: Set<string>) =>
      [...names].some((name) => source.includes(`${name}(`));

    // A helper that calls a binder binds too: the exported function around
    // each call joins the set, until no helper adds a name.
    const binders = new Set(["requireAuthorizedUserContext"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const { source } of helpers) {
        let enclosing: string | undefined;
        for (const line of source.split("\n")) {
          enclosing =
            /^export (?:async )?function (\w+)/.exec(line)?.[1] ?? enclosing;
          if (enclosing && !binders.has(enclosing) && callsAny(line, binders)) {
            binders.add(enclosing);
            grew = true;
          }
        }
      }
    }

    const undocumented = sources
      .filter(
        ({ source }) =>
          isRoute(source) &&
          callsAny(source, binders) &&
          !source.includes("withCoworkerContextHeaderParameters("),
      )
      .map(({ file }) => file);

    expect(undocumented).toEqual([]);
  });
});
