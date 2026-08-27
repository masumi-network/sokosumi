import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountStreamGetRoomStream from "./stream-get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
  isUiStreamResumptionConfiguredMock,
  getResumableUiStreamContextMock,
  resumeExistingStreamMock,
  readActiveUiStreamIdForRoomMock,
  clearActiveUiStreamIdForRoomMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  isUiStreamResumptionConfiguredMock: vi.fn(),
  getResumableUiStreamContextMock: vi.fn(),
  resumeExistingStreamMock: vi.fn(),
  readActiveUiStreamIdForRoomMock: vi.fn(),
  clearActiveUiStreamIdForRoomMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/lib/resumable-ui-stream-context", () => ({
  isUiStreamResumptionConfigured: isUiStreamResumptionConfiguredMock,
  getResumableUiStreamContext: getResumableUiStreamContextMock,
}));

vi.mock("@/helpers/active-ui-stream-room-metadata", () => ({
  readActiveUiStreamIdForRoom: readActiveUiStreamIdForRoomMock,
  clearActiveUiStreamIdForRoom: clearActiveUiStreamIdForRoomMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function createApp(
  authContext: AuthVariables["authContext"] = userAuthContext,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountStreamGetRoomStream(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (callback) =>
    callback({
      chatRoom: {
        findFirst: roomFindFirstMock,
      },
      organization: {
        findUnique: organizationFindUniqueMock,
      },
      member: {
        findUnique: memberFindUniqueMock,
      },
    }),
  );
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  clearActiveUiStreamIdForRoomMock.mockResolvedValue(undefined);
  isUiStreamResumptionConfiguredMock.mockReturnValue(true);
  getResumableUiStreamContextMock.mockReturnValue({
    resumeExistingStream: resumeExistingStreamMock,
  });
  resumeExistingStreamMock.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  );
});

describe("GET /chats/rooms/{id}/stream/active", () => {
  it("returns 404 when room is missing or caller is not a member", async () => {
    roomFindFirstMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/active`);

    expect(response.status).toBe(404);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });

  it("returns 204 when resumption is not configured", async () => {
    isUiStreamResumptionConfiguredMock.mockReturnValue(false);
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/active`);

    expect(response.status).toBe(204);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });

  it("returns 204 when there is no active stream id for the room", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    readActiveUiStreamIdForRoomMock.mockResolvedValue(null);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/active`);

    expect(response.status).toBe(204);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });

  it("returns 204 and clears stale id when resume throws ack timeout", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    readActiveUiStreamIdForRoomMock.mockResolvedValue("stream_slow");
    resumeExistingStreamMock.mockRejectedValueOnce(
      new Error("Timeout waiting for ack"),
    );

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/active`);

    expect(response.status).toBe(204);
    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
    });
  });

  it("returns 204 and clears stale id when resume returns null", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    readActiveUiStreamIdForRoomMock.mockResolvedValue("stream_gone");
    resumeExistingStreamMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/active`);

    expect(response.status).toBe(204);
    expect(clearActiveUiStreamIdForRoomMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      userId: USER_ID,
    });
  });

  it("returns 200 with stream when resume succeeds", async () => {
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      userMembers: [{ access: "member" }],
    });
    readActiveUiStreamIdForRoomMock.mockResolvedValue("stream_1");

    const app = createApp();
    const response = await app.request(`/${ROOM_ID}/stream/active`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(resumeExistingStreamMock).toHaveBeenCalledWith("stream_1");
  });
});
