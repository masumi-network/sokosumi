import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The top-up route spends FAL budget and writes rows, so it must be a POST
 * with a validated body.
 *
 * `@hono/zod-openapi` skips body validation ENTIRELY when a request carries no
 * JSON content-type unless the route declares `required: true`. Without it a
 * body-less POST reaches the handler with `take` undefined, Prisma reads
 * `take: undefined` as "no limit", and the endpoint returns the whole
 * unclaimed pool instead of one capped page.
 */
describe("POST /v1/soko-bots/avatars/top-up", () => {
  const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  function topUpRouteDeclaration(): string {
    const start = source.indexOf("const topUpAvatarsRoute = createRoute({");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("});", start);
    return source.slice(start, end);
  }

  it("declares the request body as required", () => {
    expect(topUpRouteDeclaration()).toContain("required: true");
  });

  it("is a POST, so SameSite=Lax keeps it off a cross-site navigation", () => {
    expect(topUpRouteDeclaration()).toContain('method: "post"');
  });

  it("keeps generation out of the avatar read route", () => {
    const start = source.indexOf("const listAvatarsRoute = createRoute({");
    expect(start).toBeGreaterThan(-1);
    const handlerStart = source.indexOf("app.openapi(listAvatarsRoute", start);
    const handlerEnd = source.indexOf("});", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handler).toContain("listAvailableAvatars");
    expect(handler).not.toContain("topUp");
  });
});
