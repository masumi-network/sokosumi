import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetAgentJobs from "./agents/[id]/jobs/get";
import mountGetConversations from "./conversations/get";
import mountGetJobs from "./jobs/get";
import mountGetMeCredits from "./users/me/credits/get";

function createCoworkerContextApp(
  mount: (app: OpenAPIHonoWithAuth) => void,
): OpenAPIHono<{ Variables: AuthVariables }> {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: "cow_123",
    });
    return await next();
  });

  mount(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("route actor guards", () => {
  it("returns 403 for coworker auth on jobs routes", async () => {
    const app = createCoworkerContextApp(mountGetJobs);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
  });

  it("returns 403 for coworker auth on users/me routes", async () => {
    const app = createCoworkerContextApp(mountGetMeCredits);
    const response = await app.request("http://localhost/me/credits");

    expect(response.status).toBe(403);
  });

  it("returns 403 for coworker auth on conversation routes", async () => {
    const app = createCoworkerContextApp(mountGetConversations);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
  });

  it("returns 403 for coworker auth on agent jobs routes", async () => {
    const app = createCoworkerContextApp(mountGetAgentJobs);
    const response = await app.request("http://localhost/agent_123/jobs");

    expect(response.status).toBe(403);
  });
});
