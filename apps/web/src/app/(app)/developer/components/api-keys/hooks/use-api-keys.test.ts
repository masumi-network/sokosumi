import {
  act,
  renderHook as rtlRenderHook,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useApiKeys } from "@/app/developer/components/api-keys/hooks/use-api-keys";
import { TestQueryProvider } from "@/test/query-provider";

function renderHook<Result>(callback: () => Result) {
  return rtlRenderHook(callback, { wrapper: TestQueryProvider });
}

const listMock = vi.fn();
const createMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const translateMock = (key: string) => key;

vi.mock("next-intl", () => ({
  useTranslations: () => translateMock,
}));

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
      create: (...args: unknown[]) => createMock(...args),
      update: (...args: unknown[]) => updateMock(...args),
      delete: (...args: unknown[]) => deleteMock(...args),
    },
  },
}));

function makeApiKey(id: string) {
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

describe("useApiKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads keys from result.data.apiKeys", async () => {
    const apiKey = makeApiKey("key-1");
    listMock.mockResolvedValue({
      data: {
        apiKeys: [apiKey],
        total: 1,
        limit: undefined,
        offset: undefined,
      },
      error: null,
    });

    const { result } = renderHook(() => useApiKeys());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(result.current.apiKeys).toEqual([apiKey]);
    expect(result.current.error).toBeNull();
    expect(listMock).toHaveBeenCalled();
  });

  it("sets translated error when list returns no data", async () => {
    listMock.mockResolvedValue({
      data: null,
      error: { message: "list failed" },
    });

    const { result } = renderHook(() => useApiKeys());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(result.current.error).toBe("Messages.loadError");
    expect(toast.error).toHaveBeenCalledWith("Messages.loadError");
  });

  it("create returns key and refreshes list", async () => {
    listMock
      .mockResolvedValueOnce({
        data: {
          apiKeys: [],
          total: 0,
          limit: undefined,
          offset: undefined,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          apiKeys: [makeApiKey("key-2")],
          total: 1,
          limit: undefined,
          offset: undefined,
        },
        error: null,
      });

    createMock.mockResolvedValue({
      data: {
        id: "key-2",
        key: "fresh-secret",
      },
      error: null,
    });

    const { result } = renderHook(() => useApiKeys());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    const initialListCallCount = listMock.mock.calls.length;

    let createResult:
      | Awaited<ReturnType<typeof result.current.create>>
      | undefined = undefined;

    await act(async () => {
      createResult = await result.current.create({ name: "My key" });
    });

    expect(createResult).toEqual({
      ok: true,
      value: {
        key: "fresh-secret",
      },
    });
    expect(createMock).toHaveBeenCalledWith({ name: "My key" });
    expect(toast.success).toHaveBeenCalledWith("Messages.createSuccess");
    // List refresh is fire-and-forget after the one-time key is returned.
    await waitFor(() => {
      expect(listMock.mock.calls.length).toBeGreaterThan(initialListCallCount);
    });
  });

  it("flips the status at once, drops a second click, and restores on failure", async () => {
    listMock.mockResolvedValue({
      data: { apiKeys: [makeApiKey("key-1")], total: 1 },
      error: null,
    });
    let finishUpdate: (value: unknown) => void = () => {};
    updateMock.mockImplementationOnce(
      () => new Promise((resolve) => (finishUpdate = resolve)),
    );

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let first: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = result.current.update({ keyId: "key-1", enabled: false });
      void result.current.update({ keyId: "key-1", enabled: false });
    });

    expect(result.current.apiKeys[0]?.enabled).toBe(false);
    expect(updateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishUpdate({ data: null, error: { message: "update failed" } });
      await first;
    });

    expect(result.current.apiKeys[0]?.enabled).toBe(true);
    expect(toast.error).toHaveBeenCalledWith("update failed");
  });

  it("keeps optimistic Disabled when the follow-up list refetch fails", async () => {
    listMock
      .mockResolvedValueOnce({
        data: { apiKeys: [makeApiKey("key-1")], total: 1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "list failed" },
      });
    updateMock.mockResolvedValueOnce({
      data: { ...makeApiKey("key-1"), enabled: false },
      error: null,
    });

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.update({ keyId: "key-1", enabled: false });
    });

    expect(result.current.apiKeys[0]?.enabled).toBe(false);
  });

  it("cancels an in-flight pre-write list before post-delete refetch so stale data cannot restore the deleted key", async () => {
    let finishStaleRefresh: (value: unknown) => void = () => {};
    let finishPostDeleteRefresh: (value: unknown) => void = () => {};
    listMock
      .mockResolvedValueOnce({
        data: { apiKeys: [makeApiKey("key-1")], total: 1 },
        error: null,
      })
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishStaleRefresh = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishPostDeleteRefresh = resolve)),
      );
    deleteMock.mockResolvedValueOnce({ data: { success: true }, error: null });

    const { result } = renderHook(() => useApiKeys());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    // Start a pre-write refresh that stays in flight across the delete.
    let staleRefreshPromise: Promise<void> = Promise.resolve();
    act(() => {
      staleRefreshPromise = result.current.refresh();
    });
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });

    let deletePromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      deletePromise = result.current.delete({ keyId: "key-1" });
    });

    // Must cancel the pre-write list and issue a fresh third list call.
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(3);
    });

    await act(async () => {
      finishPostDeleteRefresh({ data: { apiKeys: [], total: 0 }, error: null });
      await deletePromise;
    });
    await act(async () => {
      finishStaleRefresh({
        data: { apiKeys: [makeApiKey("key-1")], total: 1 },
        error: null,
      });
      await staleRefreshPromise;
    });

    expect(result.current.apiKeys).toEqual([]);
  });
});
