import { beforeEach, describe, expect, it, vi } from "vitest";
const getSessionMock = vi.fn();
const getAgentInputSchemaMock = vi.fn();

vi.mock("@/lib/auth/utils", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getAgentInputSchema: (...args: unknown[]) =>
      getAgentInputSchemaMock(...args),
  },
}));

vi.mock("@/lib/api", () => ({
  createApiSuccessResponse: (data: unknown) =>
    Response.json({
      success: true,
      data,
    }),
  handleApiError: (error: unknown) => {
    const status =
      error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status },
    );
  },
}));

import { GET } from "../route";

function createNextRequest(url: string): Request & { nextUrl: URL } {
  return Object.assign(new Request(url), {
    nextUrl: new URL(url),
  });
}

describe("internal agent input schema route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    getSessionMock.mockResolvedValue(null);

    const response = await GET(
      createNextRequest(
        "https://app.sokosumi.com/api/internal/agents/agent-1/input-schema",
      ) as never,
      {
        params: Promise.resolve({ agentId: "agent-1" }),
      },
    );

    expect(response.status).toBe(401);
  });

  it("returns the parsed input schema from coreClient", async () => {
    getSessionMock.mockResolvedValue({
      session: { activeOrganizationId: null },
      user: { id: "user-1" },
    });
    getAgentInputSchemaMock.mockResolvedValue({
      data: {
        input_data: [
          {
            id: "prompt",
            name: "Prompt",
            type: "string",
          },
        ],
      },
    });

    const response = await GET(
      createNextRequest(
        "https://app.sokosumi.com/api/internal/agents/agent-1/input-schema",
      ) as never,
      {
        params: Promise.resolve({ agentId: "agent-1" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getAgentInputSchemaMock).toHaveBeenCalledWith("agent-1");
    expect(body).toMatchObject({
      success: true,
      data: {
        input_data: [
          {
            id: "prompt",
            name: "Prompt",
            type: "string",
          },
        ],
      },
    });
  });
});
