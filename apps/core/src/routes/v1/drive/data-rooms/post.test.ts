import { beforeEach, describe, expect, it, vi } from "vitest";

const { backfillMock, createDataRoomMock, moveMock, pending } = vi.hoisted(
  () => ({
    backfillMock: vi.fn(),
    createDataRoomMock: vi.fn(),
    moveMock: vi.fn(),
    pending: [] as Promise<unknown>[],
  }),
);
vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: (work: Promise<unknown>) => pending.push(work),
}));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: vi.fn().mockResolvedValue({
    workspaceId: "ws_1",
    scope: "organization",
    ownerId: "org_1",
    actor: { userId: "u1", organizationId: "org_1", kind: "interactive" },
  }),
}));
vi.mock("@/services/data-room.service", () => ({
  createDataRoom: createDataRoomMock,
  moveDataRoomFiles: moveMock,
}));
vi.mock("@/services/file-backfill.service", () => ({
  backfillDriveStore: backfillMock,
}));

import { coreEvlogMiddleware } from "@/lib/evlog";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  expectBackgroundProbe,
  probeBackgroundFailure,
} from "@/test/background-probe";
import { expectCoreLog } from "@/test/core-log";
import mountPost from "./post.js";

const ROOM_ID = "0b4f6c9e-8d1a-4f3b-9c2e-5a7d1e3f6b80";

function app() {
  const instance = new OpenAPIHonoWithAuth();
  instance.use("*", coreEvlogMiddleware());
  instance.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "u1",
      organizationId: "org_1",
      role: "user",
      authenticationMethod: "session",
    });
    await next();
  });
  mountPost(instance);
  return instance;
}

function createRoom() {
  return app().request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scope: "org",
      organizationId: "org_1",
      folderPath: "Series A",
    }),
  });
}

describe("POST /v1/drive/data-rooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pending.length = 0;
    createDataRoomMock.mockResolvedValue({
      id: ROOM_ID,
      folderPath: "Series A",
      storage: "MOVING_IN",
      token: "room-token",
      title: null,
      welcomeNote: null,
      logoFileId: null,
      allowedDomains: [],
      expiresAt: null,
      allowDownload: true,
      watermark: false,
      notifyOnFirstVisit: false,
      createdByUserId: "u1",
      createdAt: new Date("2026-11-17T00:00:00.000Z"),
      updatedAt: new Date("2026-11-17T00:00:00.000Z"),
      closedAt: null,
    });
    backfillMock.mockResolvedValue(undefined);
    moveMock.mockResolvedValue(undefined);
  });

  it.each([
    { target: "backfillDriveStore", mock: backfillMock },
    { target: "moveDataRoomFiles", mock: moveMock },
  ])(
    "runs $target as background work, off the request's event",
    async ({ target, mock }) => {
      // The real work reaches shared code whose `recordCore*` would otherwise
      // find this request still live.
      expectBackgroundProbe(target);
      mock.mockImplementationOnce(async () => {
        probeBackgroundFailure(target);
      });

      const response = await createRoom();
      await Promise.all(pending);

      expect(response.status).toBe(201);
    },
  );

  it("logs a failed move on its own event without the error's text", async () => {
    const errors = expectCoreLog(
      "error",
      "Could not finish preparing a new data room",
    );
    // A database error quotes the file names it was writing.
    moveMock.mockRejectedValueOnce(
      new Error('Invalid value for "name": "Term sheet - Acme.pdf"'),
    );

    const response = await createRoom();
    await Promise.all(pending);

    expect(response.status).toBe(201);
    expect(errors[0]?.why).toBe(
      "Adopting or moving its files failed after the room was created",
    );
    expect(errors[0]?.cause).toBeUndefined();
    expect(errors[0]?.event).toMatchObject({
      operation: "data_room_create",
      dataRoomId: ROOM_ID,
      failure: { errorName: "Error" },
    });
    expect(errors[0]?.event.method).toBeUndefined();
    expect(JSON.stringify(errors[0]?.event)).not.toContain("Term sheet");
  });
});
