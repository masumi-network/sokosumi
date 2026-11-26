import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyRecord } from "@/app/developer/components/api-keys/types";
import { useApiKeysList } from "@/hooks/effects/use-api-keys-list";

const listMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    apiKey: {
      list: (...args: unknown[]) => listMock(...args),
    },
  },
}));

function makeApiKey(id: string): ApiKeyRecord {
  return {
    id,
    configId: "default",
    name: `key-${id}`,
    start: "soko_",
    prefix: "soko_",
    referenceId: "user-1",
    refillInterval: null,
    refillAmount: null,
    lastRefillAt: null,
    enabled: true,
    rateLimitEnabled: false,
    rateLimitTimeWindow: null,
    rateLimitMax: null,
    requestCount: 0,
    remaining: null,
    lastRequest: null,
    expiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    metadata: null,
    permissions: null,
  };
}

describe("useApiKeysList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads API keys on mount and clears initial loading", async () => {
    const key = makeApiKey("key-1");
    listMock.mockResolvedValue({
      data: { apiKeys: [key] },
      error: null,
    });
    const t = (messageKey: "Messages.loadError") => messageKey;

    const { result } = renderHook(() => useApiKeysList(t));

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(result.current.apiKeys).toEqual([key]);
    expect(result.current.error).toBeNull();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("sets translated error and toasts when list returns no data or rejects", async () => {
    listMock
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockRejectedValueOnce(new Error("offline"));
    const t = () => "Could not load keys";

    const { result } = renderHook(() => useApiKeysList(t));

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });
    expect(result.current.error).toBe("Could not load keys");
    expect(toast.error).toHaveBeenCalledWith("Could not load keys");

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe("Could not load keys");
    expect(toast.error).toHaveBeenCalledTimes(2);
  });

  it("re-runs the initial load when the translator identity changes and keeps non-initial refresh silent on isInitialLoading", async () => {
    listMock
      .mockResolvedValueOnce({
        data: { apiKeys: [makeApiKey("key-1")] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { apiKeys: [makeApiKey("key-2")] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { apiKeys: [makeApiKey("key-3")] },
        error: null,
      });

    const t1 = (messageKey: "Messages.loadError") => `en:${messageKey}`;
    const t2 = (messageKey: "Messages.loadError") => `de:${messageKey}`;

    const { result, rerender } = renderHook(
      ({ translate }: { translate: (key: "Messages.loadError") => string }) =>
        useApiKeysList(translate),
      { initialProps: { translate: t1 } },
    );

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });
    expect(result.current.apiKeys[0]?.id).toBe("key-1");

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.isInitialLoading).toBe(false);
    expect(result.current.apiKeys[0]?.id).toBe("key-2");

    rerender({ translate: t2 });

    await waitFor(() => {
      expect(result.current.apiKeys[0]?.id).toBe("key-3");
    });
    expect(listMock).toHaveBeenCalledTimes(3);
  });
});
