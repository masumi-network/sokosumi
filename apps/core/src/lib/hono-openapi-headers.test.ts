import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import ts from "@typescript/typescript6";
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

function calledFunctions(node: ts.Node): Set<string> {
  const names = new Set<string>();
  function visit(child: ts.Node): void {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression))
      names.add(child.expression.text);
    ts.forEachChild(child, visit);
  }
  visit(node);
  return names;
}

type Source = { file: string; source: string };

// Route files that call a binder, directly or through exported helpers, without
// the context header wrapper.
function undocumentedRoutes(sources: Source[]): string[] {
  // Parsing every file dominated the test's time (~65%), so a file is parsed
  // only once its text names a binder: a call to a name always names it. A
  // file with a `\u` escape is parsed too, since the parser decodes escaped
  // identifiers that the text never spells out.
  const trees = new Map<string, ts.SourceFile>();
  const parse = ({ file, source }: Source) => {
    let tree = trees.get(file);
    if (!tree) {
      tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest);
      trees.set(file, tree);
    }
    return tree;
  };
  const mentionsAny = (source: string, names: Set<string>) =>
    source.includes("\\u") || [...names].some((name) => source.includes(name));
  const isRoute = (source: string) => source.includes("createRoute(");
  const helpers = sources.filter(({ source }) => !isRoute(source));
  const callsAny = (node: ts.Node, names: Set<string>) =>
    [...calledFunctions(node)].some((name) => names.has(name));
  const exportedHelpers = (names: Set<string>) =>
    helpers
      .filter(({ source }) => mentionsAny(source, names))
      .flatMap((helper) =>
        parse(helper).statements.filter(
          (node): node is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(node) &&
            !!node.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            ),
        ),
      );

  // A helper that calls a binder binds too: the exported function around
  // each call joins the set, until no helper adds a name.
  const binders = new Set(["requireAuthorizedUserContext"]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const helper of exportedHelpers(binders)) {
      const name = helper.name?.text;
      if (name && !binders.has(name) && callsAny(helper, binders)) {
        binders.add(name);
        grew = true;
      }
    }
  }

  return sources
    .filter(
      (route) =>
        isRoute(route.source) &&
        !route.source.includes("withCoworkerContextHeaderParameters(") &&
        mentionsAny(route.source, binders) &&
        callsAny(parse(route), binders),
    )
    .map(({ file }) => file);
}

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
    expect(undocumentedRoutes(sources)).toEqual([]);
  });

  // The parser decodes identifier escapes, so the text filter must not skip
  // a file that spells a binder with one.
  it("catches a route that calls a binder spelled with a Unicode escape", () => {
    expect(
      undocumentedRoutes([
        {
          file: "route.ts",
          source: "createRoute({});\nrequireAuthorizedUserContex\\u0074();\n",
        },
      ]),
    ).toEqual(["route.ts"]);
  });

  it("catches a route that binds through a helper spelled with a Unicode escape", () => {
    expect(
      undocumentedRoutes([
        {
          file: "helper.ts",
          source:
            "export function bindHelper() {\n  requireAuthorizedUserContex\\u0074();\n}\n",
        },
        { file: "route.ts", source: "createRoute({});\nbindHelper();\n" },
      ]),
    ).toEqual(["route.ts"]);
  });
});
