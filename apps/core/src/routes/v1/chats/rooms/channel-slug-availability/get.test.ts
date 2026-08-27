import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChannelSlugAvailability from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { roomFindFirstMock, organizationFindUniqueMock, memberFindUniqueMock } =
  vi.hoisted(() => ({
    roomFindFirstMock: vi.fn(),
    organizationFindUniqueMock: vi.fn(),
    memberFindUniqueMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findFirst: roomFindFirstMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
    },
  },
}));

const USER_ID = "user_123";
const ORG_ID = "org_1";

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetChannelSlugAvailability(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: ORG_ID,
  role: "user",
};

beforeEach(() => {
  vi.clearAllMocks();
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  roomFindFirstMock.mockResolvedValue(null);
});

describe("GET /chats/rooms/channel-slug-availability", () => {
  it("returns free when no Channel occupies the sanitized slug", async () => {
    const response = await createApp(userAuthContext).request(
      "/channel-slug-availability?slug=team-soko",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ status: "free" });
    expect(roomFindFirstMock).toHaveBeenCalledWith({
      where: {
        organizationId: ORG_ID,
        kind: "channel",
        slug: "team-soko",
      },
      select: { id: true },
    });
  });

  it("returns taken for a private or archived Channel without leaking its name", async () => {
    roomFindFirstMock.mockResolvedValue({ id: "hidden-room" });

    const response = await createApp(userAuthContext).request(
      "/channel-slug-availability?slug=secret",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ status: "taken" });
    expect(JSON.stringify(body)).not.toContain("hidden-room");
  });

  it("does not treat a Direct occupant as taking the Channel slug", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const response = await createApp(userAuthContext).request(
      "/channel-slug-availability?slug=elena",
    );

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ status: "free" });
    expect(roomFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kind: "channel",
          slug: "elena",
        }),
      }),
    );
  });

  it("sanitizes the query slug before checking", async () => {
    const response = await createApp(userAuthContext).request(
      "/channel-slug-availability?slug=Team%20Soko",
    );

    expect(response.status).toBe(200);
    expect(roomFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          slug: "team-soko",
        }),
      }),
    );
  });

  it("rejects a slug that is empty after sanitize", async () => {
    const response = await createApp(userAuthContext).request(
      "/channel-slug-availability?slug=---",
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Channel slug is invalid");
    expect(roomFindFirstMock).not.toHaveBeenCalled();
  });
});
