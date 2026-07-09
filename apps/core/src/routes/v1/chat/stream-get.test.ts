import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountStreamGetChat from "./stream-get";

const {
  conversationFindFirstMock,
  isUiStreamResumptionConfiguredMock,
  getResumableUiStreamContextMock,
  resumeExistingStreamMock,
  clearActiveUiStreamIdInMetadataMock,
} = vi.hoisted(() => ({
  conversationFindFirstMock: vi.fn(),
  isUiStreamResumptionConfiguredMock: vi.fn(),
  getResumableUiStreamContextMock: vi.fn(),
  resumeExistingStreamMock: vi.fn(),
  clearActiveUiStreamIdInMetadataMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    conversation: {
      findFirst: conversationFindFirstMock,
    },
  },
}));

vi.mock("@/lib/resumable-ui-stream-context", () => ({
  isUiStreamResumptionConfigured: isUiStreamResumptionConfiguredMock,
  getResumableUiStreamContext: getResumableUiStreamContextMock,
}));

vi.mock("@/helpers/active-ui-stream-metadata", () => ({
  readActiveUiStreamIdFromMetadata: (meta: Record<string, unknown>) =>
    meta.active_ui_stream_id as string | null,
  clearActiveUiStreamIdInMetadata: clearActiveUiStreamIdInMetadataMock,
}));

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountStreamGetChat(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /chat/stream/:conversationId", () => {
  const cid = "550e8400-e29b-41d4-a716-446655440000";

  beforeEach(() => {
    vi.clearAllMocks();
    clearActiveUiStreamIdInMetadataMock.mockResolvedValue(undefined);
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

  it("returns 404 when the conversation is missing", async () => {
    conversationFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(404);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });

  it("returns 204 when resumption is not configured", async () => {
    isUiStreamResumptionConfiguredMock.mockReturnValue(false);
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { active_ui_stream_id: "stream_1" },
    });

    const app = createApp();
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(204);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });

  it("returns 204 when there is no active stream id in metadata", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: {},
    });

    const app = createApp();
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(204);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });

  it("returns 204 and clears stale id when resume throws ack timeout", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { active_ui_stream_id: "stream_slow" },
    });
    resumeExistingStreamMock.mockRejectedValueOnce(
      new Error("Timeout waiting for ack"),
    );

    const app = createApp();
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(204);
    expect(clearActiveUiStreamIdInMetadataMock).toHaveBeenCalledWith({
      conversationId: cid,
      userId: "user_123",
    });
  });

  it("returns 204 and clears stale id when resume returns null", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { active_ui_stream_id: "stream_gone" },
    });
    resumeExistingStreamMock.mockResolvedValueOnce(null);

    const app = createApp();
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(204);
    expect(clearActiveUiStreamIdInMetadataMock).toHaveBeenCalledWith({
      conversationId: cid,
      userId: "user_123",
    });
  });

  it("returns 200 with stream when resume succeeds", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: { active_ui_stream_id: "stream_1" },
    });

    const app = createApp();
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(resumeExistingStreamMock).toHaveBeenCalledWith("stream_1");
  });

  it("allows delegated coworker auth to resume the delegated user's stream", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: {
        active_ui_stream_id: "stream_1",
        coworker_id: "cow_123",
      },
    });

    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      delegation: {
        userId: "delegated_user_123",
        organizationId: "delegated_org_123",
      },
    });
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(200);
    expect(conversationFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: cid,
        userId: "delegated_user_123",
        archivedAt: null,
      },
      select: { id: true, metadata: true },
    });
  });

  it("rejects a delegated coworker resuming a stream assigned to another coworker", async () => {
    conversationFindFirstMock.mockResolvedValueOnce({
      id: cid,
      metadata: {
        active_ui_stream_id: "stream_1",
        coworker_id: "cow_other",
      },
    });

    const app = createApp({
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      delegation: {
        userId: "delegated_user_123",
        organizationId: "delegated_org_123",
      },
    });
    const response = await app.request(`http://localhost/stream/${cid}`);

    expect(response.status).toBe(403);
    expect(resumeExistingStreamMock).not.toHaveBeenCalled();
  });
});
