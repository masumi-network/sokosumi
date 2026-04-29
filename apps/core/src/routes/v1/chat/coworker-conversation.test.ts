import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCoworkerConversation } from "./coworker-conversation";

const fetchMock = vi.fn();

const DEFAULT_BASE_URL = "https://api.coworker.example.com/v1";

describe("coworker-conversation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when responsesApiBaseUrl is missing", async () => {
    fetchMock.mockClear();
    await expect(
      createCoworkerConversation({
        responsesApiBaseUrl: "",
        sokosumiUserId: "user_1",
        sokosumiOrganizationId: null,
        coworkerSlug: "ops-agent",
        sokosumiConversationId: "conv-local-1",
      }),
    ).rejects.toThrow("Responses API base URL is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs /conversations with metadata and delegation headers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "conv_remote_1" }),
    });

    const result = await createCoworkerConversation({
      responsesApiBaseUrl: DEFAULT_BASE_URL,
      sokosumiUserId: "user_1",
      sokosumiOrganizationId: "org_1",
      coworkerSlug: "ops-agent",
      sokosumiConversationId: "conv-local-1",
    });

    expect(result).toEqual({ id: "conv_remote_1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.coworker.example.com/v1/conversations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Sokosumi-User-Id": "user_1",
          "X-Delegation-User-Id": "user_1",
          "X-Coworker-Slug": "ops-agent",
          "X-Sokosumi-Organization-Id": "org_1",
          "X-Delegation-Organization-Id": "org_1",
        }),
      }),
    );
    const [, initWithOrg] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(initWithOrg.headers["X-Sokosumi-User-Id"]).toBe("user_1");
    expect(initWithOrg.headers["X-Sokosumi-Organization-Id"]).toBe("org_1");
    expect(JSON.parse(initWithOrg.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        sokosumi_organization_id: "org_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });

  it("accepts id nested under data in JSON body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: "conv_nested" } }),
    });

    const result = await createCoworkerConversation({
      responsesApiBaseUrl: DEFAULT_BASE_URL,
      sokosumiUserId: "user_1",
      sokosumiOrganizationId: null,
      coworkerSlug: "ops-agent",
      sokosumiConversationId: "conv-local-1",
    });

    expect(result).toEqual({ id: "conv_nested" });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(init.headers["X-Sokosumi-User-Id"]).toBe("user_1");
    expect(init.headers["X-Delegation-Organization-Id"]).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({
      metadata: {
        sokosumi_user_id: "user_1",
        coworker_slug: "ops-agent",
        sokosumi_conversation_id: "conv-local-1",
      },
    });
  });
});
