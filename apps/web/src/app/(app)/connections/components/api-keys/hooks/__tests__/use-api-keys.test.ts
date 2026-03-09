import { act, renderHook, waitFor } from "@testing-library/react";

import { useApiKeys } from "@/app/connections/components/api-keys/hooks/use-api-keys";
import { toast } from "sonner";

const listMock = jest.fn();
const createMock = jest.fn();
const updateMock = jest.fn();
const deleteMock = jest.fn();
const translateMock = (key: string) => key;

jest.mock("next-intl", () => ({
  useTranslations: () => translateMock,
}));

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/lib/auth/auth.client", () => ({
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
    jest.clearAllMocks();
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
      success: true,
      data: {
        key: "fresh-secret",
      },
    });
    expect(createMock).toHaveBeenCalledWith({ name: "My key" });
    expect(listMock.mock.calls.length).toBeGreaterThan(initialListCallCount);
    expect(toast.success).toHaveBeenCalledWith("Messages.createSuccess");
  });
});
