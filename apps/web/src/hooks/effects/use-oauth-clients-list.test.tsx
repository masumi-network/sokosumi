import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOAuthClientsList } from "@/hooks/effects/use-oauth-clients-list";

const getClientsMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      getClients: (...args: unknown[]) => getClientsMock(...args),
    },
  },
}));

describe("useOAuthClientsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads OAuth clients on mount and clears initial loading", async () => {
    const client = {
      client_id: "client_1",
      client_name: "Test Client",
      redirect_uris: ["https://example.com/callback"],
    };
    getClientsMock.mockResolvedValue({
      data: [client],
      error: null,
    });
    const t = (messageKey: "Messages.loadError") => messageKey;

    const { result } = renderHook(() => useOAuthClientsList(t));

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(result.current.clients).toEqual([client]);
    expect(result.current.error).toBeNull();
    expect(getClientsMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces result.error.message or translated fallback on failures", async () => {
    getClientsMock
      .mockResolvedValueOnce({
        data: null,
        error: { message: "backend unavailable" },
      })
      .mockResolvedValueOnce({
        data: null,
        error: {},
      })
      .mockRejectedValueOnce(new Error("offline"));
    const t = () => "Could not load clients";

    const { result } = renderHook(() => useOAuthClientsList(t));

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });
    expect(result.current.error).toBe("backend unavailable");
    expect(toast.error).toHaveBeenLastCalledWith("backend unavailable");

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe("Could not load clients");
    expect(toast.error).toHaveBeenLastCalledWith("Could not load clients");

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBe("Could not load clients");
    expect(toast.error).toHaveBeenCalledTimes(3);
  });

  it("re-runs the initial load when translator identity changes", async () => {
    getClientsMock
      .mockResolvedValueOnce({
        data: [{ client_id: "client_1" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ client_id: "client_2" }],
        error: null,
      });

    const t1 = (messageKey: "Messages.loadError") => `en:${messageKey}`;
    const t2 = (messageKey: "Messages.loadError") => `de:${messageKey}`;

    const { result, rerender } = renderHook(
      ({ translate }: { translate: (key: "Messages.loadError") => string }) =>
        useOAuthClientsList(translate),
      { initialProps: { translate: t1 } },
    );

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });
    expect(result.current.clients[0]?.client_id).toBe("client_1");

    rerender({ translate: t2 });

    await waitFor(() => {
      expect(result.current.clients[0]?.client_id).toBe("client_2");
    });
    expect(getClientsMock).toHaveBeenCalledTimes(2);
  });
});
