import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { coreEvlogMiddleware } from "@/lib/evlog";
import { expectCoreLog } from "@/test/core-log";

const { askJevMock } = vi.hoisted(() => ({ askJevMock: vi.fn() }));

vi.mock("@/lib/soko-bot/jev", () => ({ askJev: askJevMock }));
vi.mock("@/routes/v1/chats/rooms/helpers", () => ({
  requireChatRoomUserMembership: vi.fn(),
}));
vi.mock("@/lib/chat-signals/derive", () => ({
  storedChatSignalTags: () => new Set(["workRequest"]),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: {
      findUnique: async () => ({
        roomId: "room-1",
        content: "Please write the launch newsletter",
        deletedAt: null,
        signal: {},
      }),
    },
    coworker: {
      findMany: async () => [
        {
          id: "coworker-1",
          name: "Newsletter writer",
          caption: "Writes newsletters",
          description: null,
        },
      ],
    },
  },
}));

import { suggestCoworkersForChatMessage } from "./chat-signal-routing.service";

describe("suggestCoworkersForChatMessage", () => {
  it("puts a failed Jev rating on the request's event, without the request text, and suggests nothing", async () => {
    const warnings = expectCoreLog(
      "warn",
      "Could not rate which Coworkers fit a chat request",
    );
    askJevMock.mockRejectedValueOnce(
      new TypeError("Jev could not read: Please write the launch newsletter"),
    );
    const app = new Hono();
    app.use(coreEvlogMiddleware());
    app.get("/routing", async (c) =>
      c.json(
        await suggestCoworkersForChatMessage({
          messageId: "message-1",
          userId: "user-1",
          workspaceId: "workspace-1",
        }),
      ),
    );

    const response = await app.request("http://localhost/routing");

    expect(await response.json()).toEqual([]);
    expect(warnings[0]).toMatchObject({
      why: "Jev did not rate the Coworkers",
    });
    expect(warnings[0]?.event).toMatchObject({
      failure: { name: "TypeError" },
    });
    expect(JSON.stringify(warnings[0]?.event)).not.toContain("newsletter");
  });
});
