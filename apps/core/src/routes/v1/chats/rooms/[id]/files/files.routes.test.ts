import { CHAT_ROOM_FILE_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountPostChatRoomFile from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { roomFindFirstMock, createChatRoomFileUploadSessionMock, getEnvMock } =
  vi.hoisted(() => ({
    roomFindFirstMock: vi.fn(),
    createChatRoomFileUploadSessionMock: vi.fn(),
    getEnvMock: vi.fn(),
  }));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => {
      const base = actual.getEnv();
      return {
        ...base,
        ...getEnvMock(),
      };
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findFirst: roomFindFirstMock,
    },
  },
}));

vi.mock("@/lib/blob", () => ({
  createChatRoomFileUploadSession: (...args: unknown[]) =>
    createChatRoomFileUploadSessionMock(...args),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user_123";
const COWORKER_ID = "cow_123";
const SOKO_BOT_ID = "11111111-1111-7111-8111-222222222222";

const UPLOAD_SESSION = {
  uploadUrl: "https://blob.example/upload?sig=1",
  pathname: `users/${USER_ID}/chats/${ROOM_ID}/report.pdf`,
  access: "public" as const,
  method: "PUT" as const,
  headers: { "Content-Type": "application/pdf" },
  expiresAt: "2026-07-30T12:15:00.000Z",
  maxSizeBytes: CHAT_ROOM_FILE_MAX_SIZE_BYTES,
  addRandomSuffix: true,
};

function createUserApp(userId = USER_ID) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
    });
    return await next();
  });

  mountPostChatRoomFile(app);
  return app;
}

function createCoworkerApp(coworkerId = COWORKER_ID) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId,
      vendorId: "11111111-1111-7111-8111-111111111111",
    });
    return await next();
  });

  mountPostChatRoomFile(app);
  return app;
}

function createOrchestratorApp(sokoBotId = SOKO_BOT_ID) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "sokoBot",
      sokoBotId,
      userId: USER_ID,
      workspaceId: "22222222-2222-7222-8222-222222222222",
      organizationId: null,
    });
    return await next();
  });

  mountPostChatRoomFile(app);
  return app;
}

describe("POST /chats/rooms/{id}/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "blob-token",
    } as ReturnType<typeof getEnvMock>);
    createChatRoomFileUploadSessionMock.mockResolvedValue(UPLOAD_SESSION);
  });

  it("mints a user-owned room chat grant without webhook options", async () => {
    roomFindFirstMock.mockResolvedValueOnce({
      id: ROOM_ID,
      organizationId: null,
      userMembers: [{ access: "member" }],
    });

    const app = createUserApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      uploadUrl: UPLOAD_SESSION.uploadUrl,
      method: "PUT",
      pathname: UPLOAD_SESSION.pathname,
    });
    expect(createChatRoomFileUploadSessionMock).toHaveBeenCalledWith(
      { kind: "user", userId: USER_ID },
      ROOM_ID,
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
        maxSizeBytes: CHAT_ROOM_FILE_MAX_SIZE_BYTES,
      },
      "blob-token",
    );
    expect(createChatRoomFileUploadSessionMock.mock.calls[0]).toHaveLength(4);
  });

  it("mints a coworker-owned room chat grant", async () => {
    roomFindFirstMock.mockResolvedValueOnce({ id: ROOM_ID });
    createChatRoomFileUploadSessionMock.mockResolvedValueOnce({
      ...UPLOAD_SESSION,
      pathname: `coworkers/${COWORKER_ID}/chats/${ROOM_ID}/notes.txt`,
      headers: { "Content-Type": "text/plain" },
    });

    const app = createCoworkerApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "notes.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });

    expect(response.status).toBe(201);
    expect(createChatRoomFileUploadSessionMock).toHaveBeenCalledWith(
      { kind: "coworker", coworkerId: COWORKER_ID },
      ROOM_ID,
      expect.objectContaining({
        filename: "notes.txt",
        contentType: "text/plain",
      }),
      "blob-token",
    );
  });

  it("mints an orchestrator-owned room chat grant", async () => {
    roomFindFirstMock.mockResolvedValueOnce({ id: ROOM_ID });
    createChatRoomFileUploadSessionMock.mockResolvedValueOnce({
      ...UPLOAD_SESSION,
      pathname: `soko-bots/${SOKO_BOT_ID}/chats/${ROOM_ID}/notes.txt`,
      headers: { "Content-Type": "text/plain" },
    });

    const response = await createOrchestratorApp().request(
      `http://localhost/${ROOM_ID}/files`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: "notes.txt",
          contentType: "text/plain",
          size: 5,
        }),
      },
    );

    expect(response.status).toBe(201);
    expect(createChatRoomFileUploadSessionMock).toHaveBeenCalledWith(
      { kind: "sokoBot", sokoBotId: SOKO_BOT_ID },
      ROOM_ID,
      expect.objectContaining({ filename: "notes.txt" }),
      "blob-token",
    );
    expect(roomFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sokoBotMembers: {
            some: { sokoBotId: SOKO_BOT_ID },
          },
        }),
      }),
    );
  });

  it("returns 404 when the user is not a room member", async () => {
    roomFindFirstMock.mockResolvedValueOnce(null);

    const app = createUserApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(404);
    expect(createChatRoomFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the coworker is not a room member", async () => {
    roomFindFirstMock.mockResolvedValueOnce(null);

    const app = createCoworkerApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "notes.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });

    expect(response.status).toBe(404);
    expect(createChatRoomFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob token is missing", async () => {
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "",
    } as ReturnType<typeof getEnvMock>);

    const app = createUserApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(503);
    expect(createChatRoomFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported content types", async () => {
    roomFindFirstMock.mockResolvedValueOnce({
      id: ROOM_ID,
      organizationId: null,
    });

    const app = createUserApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "malware.exe",
        contentType: "application/x-msdownload",
        size: 11,
      }),
    });

    expect(response.status).toBe(400);
    expect(createChatRoomFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects mint over the max size", async () => {
    const app = createUserApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "big.pdf",
        contentType: "application/pdf",
        size: CHAT_ROOM_FILE_MAX_SIZE_BYTES + 1,
      }),
    });

    expect(response.status).toBe(413);
    expect(createChatRoomFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("does not require blob webhook public key", async () => {
    roomFindFirstMock.mockResolvedValueOnce({
      id: ROOM_ID,
      organizationId: null,
      userMembers: [{ access: "member" }],
    });
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "blob-token",
      BLOB_WEBHOOK_PUBLIC_KEY: undefined,
    } as ReturnType<typeof getEnvMock>);

    const app = createUserApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(201);
  });
});
