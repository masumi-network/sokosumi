import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { cusoLock, cusoLockedBotId } from "./cuso-lock";

const CUSO = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000c0";
const ASSISTANT = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000a0";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        where.id === CUSO ? { id: CUSO } : null,
    },
  },
}));

const sokoBotsRouter = (await import("./index")).default;

/** Every by-id write route of the Soko Bots router, as `METHOD /path`. */
const byIdWrites = [
  ...new Set(
    sokoBotsRouter.routes
      .filter(
        ({ method, path }) =>
          !["GET", "ALL"].includes(method) && path.startsWith("/:sokoBotId"),
      )
      .map(({ method, path }) => `${method} ${path}`),
  ),
];

function lockedRoute(route: string) {
  const [method = "", path = ""] = route.split(" ");
  const concrete = path.replace(":sokoBotId", CUSO);
  return cusoLockedBotId(method, `/v1/soko-bots${concrete}`) !== null;
}

describe("cusoLockedBotId on the Soko Bots router", () => {
  it("locks the writes that change Cuso", () => {
    expect(byIdWrites.filter(lockedRoute).sort()).toEqual(
      [
        "DELETE /:sokoBotId",
        "POST /:sokoBotId",
        "PUT /:sokoBotId/name",
        "PUT /:sokoBotId/version",
        "POST /:sokoBotId/memory/reset",
        "DELETE /:sokoBotId/permanent",
        "PUT /:sokoBotId/proactive",
        "PUT /:sokoBotId/board-following",
        "POST /:sokoBotId/schedules",
        "PATCH /:sokoBotId/schedules/:scheduleId",
        "DELETE /:sokoBotId/schedules/:scheduleId",
      ].sort(),
    );
  });

  it("leaves chat, decisions and integrations open, complete-auth among them", () => {
    const open = byIdWrites.filter((route) => !lockedRoute(route));
    expect(open).toContain("POST /:sokoBotId/integrations/complete-auth");
    expect(open).toContain("POST /:sokoBotId/turns");
    expect(open).toContain("POST /:sokoBotId/decisions/:decisionId");
  });
});

describe("cusoLock", () => {
  function app() {
    const hono = new Hono();
    hono.use("*", cusoLock);
    hono.all("*", (c) => c.text("route reached"));
    hono.onError(errorHandler);
    return hono;
  }

  it("answers a rename of Cuso with 409 and lets other bots through", async () => {
    const cuso = await app().request(`/v1/soko-bots/${CUSO}/name`, {
      method: "PUT",
    });
    expect(cuso.status).toBe(409);
    expect(await cuso.json()).toMatchObject({
      kind: "cmo_project_read_only",
    });

    const assistant = await app().request(`/v1/soko-bots/${ASSISTANT}/name`, {
      method: "PUT",
    });
    expect(assistant.status).toBe(200);
  });

  it("keeps CMO's measurement connection open", async () => {
    const response = await app().request(
      `/v1/soko-bots/${CUSO}/integrations/complete-auth`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
  });
});
