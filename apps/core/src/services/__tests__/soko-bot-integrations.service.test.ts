import { getSokoBotIntegrationProvider } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  deleteMock,
  fetchMock,
  findManyMock,
  findUniqueMock,
  getEnvMock,
  getWebAppBaseUrlMock,
  getTokenMock,
  getTokenResponseMock,
  revokeTokenMock,
  startAuthorizationMock,
  updateMock,
  upsertMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  deleteMock: vi.fn(),
  fetchMock: vi.fn(),
  findManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  getEnvMock: vi.fn(),
  getWebAppBaseUrlMock: vi.fn(),
  getTokenMock: vi.fn(),
  getTokenResponseMock: vi.fn(),
  revokeTokenMock: vi.fn(),
  startAuthorizationMock: vi.fn(),
  updateMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
  getWebAppBaseUrl: getWebAppBaseUrlMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: botFindFirstMock },
    sokoBotIntegration: {
      delete: deleteMock,
      findMany: findManyMock,
      findUnique: findUniqueMock,
      update: updateMock,
      upsert: upsertMock,
    },
  },
}));
vi.mock("@vercel/connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/connect")>()),
  getToken: getTokenMock,
  getTokenResponse: getTokenResponseMock,
  revokeToken: revokeTokenMock,
  startAuthorization: startAuthorizationMock,
}));

import {
  connectSokoBotIntegration,
  disconnectSokoBotIntegration,
  fetchInboxMessages,
  finalizeSokoBotIntegration,
  listSokoBotIntegrations,
} from "../soko-bot-integrations.service";

const BOT_ID = "019c0000-0000-7000-8000-000000000001";
const USER_ID = "user-1";
const WORKSPACE_ID = "019c0000-0000-7000-8000-000000000002";

function microsoftIntegration() {
  const provider = getSokoBotIntegrationProvider("microsoft");
  if (!provider) throw new Error("Microsoft provider missing");
  return {
    id: "integration-1",
    sokoBotId: BOT_ID,
    provider,
    cursor: null,
  };
}

describe("soko-bot Vercel Connect integrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    getEnvMock.mockReturnValue({
      SOKO_BOT_GOOGLE_CONNECTOR_UID: "oauth/sokosumi-google",
      SOKO_BOT_MICROSOFT_CONNECTOR_UID: undefined,
    });
    getWebAppBaseUrlMock.mockReturnValue("https://app.sokosumi.com");
    botFindFirstMock.mockResolvedValue({ id: BOT_ID });
    findManyMock.mockResolvedValue([]);
  });

  it("lists each provider and its environment availability", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "integration-1",
        provider: "google",
        status: "ACTIVE",
        connectedAt: new Date("2026-08-26T08:00:00Z"),
        lastIngestAt: null,
        lastError: null,
      },
    ]);

    const result = await listSokoBotIntegrations(USER_ID, WORKSPACE_ID);

    expect(result.configured).toBe(true);
    expect(result.integrations).toMatchObject([
      { provider: "google", available: true, status: "ACTIVE" },
      {
        provider: "microsoft",
        available: false,
        status: "DISCONNECTED",
      },
    ]);
  });

  it("starts user authorization with the bot-scoped subject and read scopes", async () => {
    startAuthorizationMock.mockResolvedValue({
      request: "request-1",
      verifier: "verifier-1",
      url: "https://vercel.com/connect/authorize/request-1",
    });
    upsertMock.mockResolvedValue({});

    const result = await connectSokoBotIntegration({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      provider: "google",
    });

    expect(result.redirectUrl).toContain("vercel.com/connect/authorize");
    expect(startAuthorizationMock).toHaveBeenCalledWith(
      "oauth/sokosumi-google",
      {
        subject: { type: "user", id: `soko-bot:${BOT_ID}` },
        scopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/calendar.readonly",
        ],
      },
      {
        callbackUrl:
          "https://app.sokosumi.com/personal-assistant/integrations/return?provider=google",
      },
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  it("marks the integration active after token exchange succeeds", async () => {
    findUniqueMock.mockResolvedValue({ id: "integration-1" });
    getTokenResponseMock.mockResolvedValue({ token: "provider-token" });
    updateMock.mockResolvedValue({});

    const status = await finalizeSokoBotIntegration({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      provider: "google",
    });

    expect(status).toBe("ACTIVE");
    expect(getTokenResponseMock).toHaveBeenCalledWith(
      "oauth/sokosumi-google",
      expect.objectContaining({
        subject: { type: "user", id: `soko-bot:${BOT_ID}` },
      }),
      { forceRefresh: true },
    );
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "integration-1" },
      data: {
        status: "ACTIVE",
        connectedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it("calls Microsoft Graph with a narrow mail token", async () => {
    getEnvMock.mockReturnValue({
      SOKO_BOT_GOOGLE_CONNECTOR_UID: undefined,
      SOKO_BOT_MICROSOFT_CONNECTOR_UID: "microsoft/sokosumi-microsoft",
    });
    getTokenMock.mockResolvedValue("graph-token");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              id: "message-1",
              conversationId: "thread-1",
              from: {
                emailAddress: { name: "Ana", address: "ana@example.com" },
              },
              toRecipients: [],
              subject: "Contract draft",
              bodyPreview: "Please review",
              receivedDateTime: "2026-08-26T08:00:00Z",
              isRead: false,
              categories: [],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const messages = await fetchInboxMessages(microsoftIntegration(), {
      unreadOnly: true,
      limit: 10,
    });

    expect(messages).toMatchObject([
      {
        provider: "microsoft",
        id: "message-1",
        from: "Ana <ana@example.com>",
        unread: true,
      },
    ]);
    expect(getTokenMock).toHaveBeenCalledWith("microsoft/sokosumi-microsoft", {
      subject: { type: "user", id: `soko-bot:${BOT_ID}` },
      scopes: ["Mail.Read"],
    });
    const [requestUrl, request] = fetchMock.mock.calls[0];
    expect(String(requestUrl)).toContain(
      "graph.microsoft.com/v1.0/me/messages",
    );
    expect(new Headers(request.headers).get("Authorization")).toBe(
      "Bearer graph-token",
    );
  });

  it("revokes the bot grant before deleting local state", async () => {
    getEnvMock.mockReturnValue({
      SOKO_BOT_GOOGLE_CONNECTOR_UID: "oauth/sokosumi-google",
      SOKO_BOT_MICROSOFT_CONNECTOR_UID: undefined,
    });
    findUniqueMock.mockResolvedValue({ id: "integration-1" });
    revokeTokenMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue({});

    await disconnectSokoBotIntegration({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      provider: "google",
    });

    expect(revokeTokenMock).toHaveBeenCalledWith("oauth/sokosumi-google", {
      subject: { type: "user", id: `soko-bot:${BOT_ID}` },
    });
    expect(deleteMock).toHaveBeenCalledWith({
      where: { id: "integration-1" },
    });
  });
});
