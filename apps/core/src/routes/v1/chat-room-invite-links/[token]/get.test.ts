import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultValidationHook } from "@/lib/hono";

import mountResolveInviteLink from "./get";

const { getInviteLinkByTokenMock, roomFindUniqueMock } = vi.hoisted(() => ({
  getInviteLinkByTokenMock: vi.fn(),
  roomFindUniqueMock: vi.fn(),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  chatRoomGuestInviteLinkRepository: {
    getInviteLinkByToken: (...args: unknown[]) =>
      getInviteLinkByTokenMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findUnique: (...args: unknown[]) => roomFindUniqueMock(...args),
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const ORG_ID = "org_1";
const NOW = Date.now();

function liveLink() {
  return {
    id: "link_1",
    token: "tok_live",
    roomId: ROOM_ID,
    createdByUserId: "host_1",
    createdAt: new Date(NOW - 1000),
    expiresAt: new Date(NOW + 7 * 24 * 60 * 60 * 1000),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
  };
}

function createApp() {
  const app = new OpenAPIHono({ defaultHook: defaultValidationHook });
  mountResolveInviteLink(app);
  return app;
}

describe("GET /chat-room-invite-links/{token} (public)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid + room preview for a live link on an external channel", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    roomFindUniqueMock.mockResolvedValue({
      id: ROOM_ID,
      name: "External",
      kind: "channel",
      discoverability: "external",
      archivedAt: null,
      organizationId: ORG_ID,
      organization: { id: ORG_ID, name: "Acme" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/tok_live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      status: "valid",
      room: {
        id: ROOM_ID,
        name: "External",
        organizationId: ORG_ID,
        organizationName: "Acme",
      },
    });
  });

  it("returns not_found without room data for unknown tokens", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request("http://localhost/tok_missing");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: "not_found", room: null });
    expect(roomFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns not_found when the room is no longer external", async () => {
    getInviteLinkByTokenMock.mockResolvedValue(liveLink());
    roomFindUniqueMock.mockResolvedValue({
      id: ROOM_ID,
      name: "Was External",
      kind: "channel",
      discoverability: "public",
      archivedAt: null,
      organizationId: ORG_ID,
      organization: { id: ORG_ID, name: "Acme" },
    });

    const app = createApp();
    const response = await app.request("http://localhost/tok_live");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ status: "not_found", room: null });
  });
});
