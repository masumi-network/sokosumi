import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireBot = vi.fn();

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    COMPOSIO_API_KEY: "test-key",
    COMPOSIO_API_BASE_URL: "https://composio.test",
  }),
}));

vi.mock("@/services/soko-bot-integrations.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/soko-bot-integrations.service")
    >();
  return {
    ...actual,
    requireBot: (userId: string, workspaceId: string) =>
      requireBot(userId, workspaceId),
  };
});

import { SokoBotIntegrationError } from "@/services/soko-bot-integrations.service";

import { completeSokoBotIntegrationAuth } from "./soko-bot-integration-auth.service";

const input = {
  userId: "user-1",
  workspaceId: "workspace-1",
  sessionUri: "session-uri-1",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("completeSokoBotIntegrationAuth", () => {
  beforeEach(() => {
    requireBot.mockResolvedValue({ id: "bot-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    requireBot.mockReset();
  });

  it("redeems the session for the caller's own bot entity", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        connected_account_id: "ca_1",
        toolkit_slug: "GOOGLECALENDAR",
      }),
    );

    await expect(completeSokoBotIntegrationAuth(input)).resolves.toEqual({
      provider: "googlecalendar",
      composioAccountId: "ca_1",
    });

    // The bot must be resolved from the signed-in caller, so an implementation
    // that took the entity from the request or the session URI would fail here.
    expect(requireBot).toHaveBeenCalledWith("user-1", "workspace-1");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://composio.test/api/v3.1/connected_accounts/complete_auth",
    );
    expect(init?.headers).toMatchObject({ "x-api-key": "test-key" });
    // The entity must be the signed-in caller's bot, never one named by the
    // link that was redeemed.
    expect(JSON.parse(String(init?.body))).toEqual({
      session_uri: "session-uri-1",
      user_id: "sokobot:bot-1",
    });
  });

  it("keeps a configured base path on the endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(200, {
        connected_account_id: "ca_1",
        toolkit_slug: "gmail",
      }),
    );

    await completeSokoBotIntegrationAuth(input);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://composio.test/api/v3.1/connected_accounts/complete_auth",
    );
  });

  it("refuses a session started by a different account", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(400, { error: { message: "identity mismatch" } }),
    );

    await expect(completeSokoBotIntegrationAuth(input)).rejects.toMatchObject({
      kind: "IDENTITY_MISMATCH",
    });
  });

  it("reports a spent or expired session as not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(404, { error: { message: "session not found" } }),
    );

    await expect(completeSokoBotIntegrationAuth(input)).rejects.toMatchObject({
      kind: "NOT_FOUND",
    });
  });

  it("rejects a response that names no completed connection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(200, {}));

    await expect(completeSokoBotIntegrationAuth(input)).rejects.toBeInstanceOf(
      SokoBotIntegrationError,
    );
  });
});
