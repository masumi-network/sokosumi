import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/middleware/auth-middleware", () => ({
  withSession:
    <TParams extends Record<string, unknown>, TResult>(
      handler: (params: TParams) => Promise<TResult>,
    ) =>
    async (params: TParams) =>
      handler(params),
}));

const completeComposioCallbackMock = vi.fn();
const toCoreApiActionErrorMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    completeComposioCallback: completeComposioCallbackMock,
  },
  toCoreApiActionError: toCoreApiActionErrorMock,
}));

describe("Composio actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redeems a callback with a plain Flight-safe result DTO", async () => {
    completeComposioCallbackMock.mockResolvedValue({ ok: true });

    const { completeComposioAuthCallbackAction } = await import("../action");
    const result = await completeComposioAuthCallbackAction({
      connectionId: "ca_123",
      sessionUri: "https://backend.composio.dev/session/single-use",
    });

    expect(completeComposioCallbackMock).toHaveBeenCalledWith({
      connectionId: "ca_123",
      sessionUri: "https://backend.composio.dev/session/single-use",
    });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(structuredClone(result)).toEqual(result);
  });

  it("converts Core callback errors to a plain action error DTO", async () => {
    completeComposioCallbackMock.mockRejectedValue(
      new Error("Unknown or expired connection"),
    );
    toCoreApiActionErrorMock.mockReturnValue({
      code: "NOT_FOUND",
      message: "Unknown or expired connection",
    });

    const { completeComposioAuthCallbackAction } = await import("../action");
    const result = await completeComposioAuthCallbackAction({
      connectionId: "ca_123",
      sessionUri: "https://backend.composio.dev/session/single-use",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Unknown or expired connection",
      },
    });
  });
});
