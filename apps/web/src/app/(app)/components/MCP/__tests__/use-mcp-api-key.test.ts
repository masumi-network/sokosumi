import { act, renderHook, waitFor } from "@testing-library/react";

import { useMcpApiKey } from "@/app/components/MCP/use-mcp-api-key";

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

jest.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_MCP_URL: "https://mcp.example.com",
    NEXT_PUBLIC_NETWORK: "Mainnet",
  }),
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

function makeApiKey(input: {
  id: string;
  enabled: boolean;
  name?: string;
  configId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: Record<string, unknown> | null;
}) {
  return {
    id: input.id,
    configId: input.configId ?? "default",
    name: input.name ?? "MCP",
    start: "soko_",
    prefix: "soko_",
    referenceId: "user-1",
    refillInterval: null,
    refillAmount: null,
    lastRefillAt: null,
    enabled: input.enabled,
    rateLimitEnabled: false,
    rateLimitTimeWindow: null,
    rateLimitMax: null,
    requestCount: 0,
    remaining: null,
    lastRequest: null,
    expiresAt: null,
    createdAt: input.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: input.updatedAt ?? new Date("2026-01-01T00:00:00.000Z"),
    metadata: input.metadata ?? null,
    permissions: null,
  };
}

describe("useMcpApiKey", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("detects existing enabled MCP key from data.apiKeys", async () => {
    listMock.mockResolvedValue({
      data: {
        apiKeys: [makeApiKey({ id: "mcp-1", enabled: true })],
        total: 1,
        limit: undefined,
        offset: undefined,
      },
      error: null,
    });

    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isKeyExisting).toBe(true);
    expect(result.current.isKeyDisabled).toBe(false);
    expect(result.current.mcpUrl).toBe(
      "https://mcp.example.com/mcp?api_key=existingKey&network=mainnet",
    );
    expect(listMock).toHaveBeenCalled();
  });

  it("marks existing disabled MCP key as disabled", async () => {
    listMock.mockResolvedValue({
      data: {
        apiKeys: [makeApiKey({ id: "mcp-2", enabled: false })],
        total: 1,
        limit: undefined,
        offset: undefined,
      },
      error: null,
    });

    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isKeyExisting).toBe(true);
    expect(result.current.isKeyDisabled).toBe(true);
    expect(result.current.mcpUrl).toBeNull();
  });

  it("regenerates by deleting existing key before creating a new one", async () => {
    listMock.mockResolvedValue({
      data: {
        apiKeys: [makeApiKey({ id: "mcp-old", enabled: false })],
        total: 1,
        limit: undefined,
        offset: undefined,
      },
      error: null,
    });
    deleteMock.mockResolvedValue({ data: { success: true }, error: null });
    createMock.mockResolvedValue({
      data: {
        id: "mcp-new",
        key: "new-secret",
      },
      error: null,
    });

    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await waitFor(() => {
      expect(result.current.isKeyExisting).toBe(true);
    });

    await act(async () => {
      await result.current.generateMcpUrl();
    });

    expect(deleteMock).toHaveBeenCalledWith({ keyId: "mcp-old" });
    expect(createMock).toHaveBeenCalledWith({ name: "MCP" });
    expect(result.current.mcpUrl).toBe(
      "https://mcp.example.com/mcp?api_key=new-secret&network=mainnet",
    );

    const deleteOrder = deleteMock.mock.invocationCallOrder[0];
    const createOrder = createMock.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(createOrder);
  });

  it("uses deterministic selection when multiple MCP keys exist", async () => {
    listMock.mockResolvedValue({
      data: {
        apiKeys: [
          makeApiKey({
            id: "mcp-disabled-newer",
            enabled: false,
            updatedAt: new Date("2026-02-01T00:00:00.000Z"),
          }),
          makeApiKey({
            id: "mcp-enabled-older",
            enabled: true,
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          }),
          makeApiKey({
            id: "mcp-other-config",
            enabled: true,
            configId: "legacy",
          }),
        ],
        total: 3,
        limit: undefined,
        offset: undefined,
      },
      error: null,
    });

    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isKeyExisting).toBe(true);
    expect(result.current.isKeyDisabled).toBe(false);
  });

  it("regenerate deletes all matching personal MCP keys before create", async () => {
    listMock.mockResolvedValue({
      data: {
        apiKeys: [
          makeApiKey({ id: "mcp-old-a", enabled: false }),
          makeApiKey({ id: "mcp-old-b", enabled: true }),
          makeApiKey({ id: "mcp-legacy-config", enabled: true, configId: "legacy" }),
          makeApiKey({ id: "not-mcp", enabled: true, name: "Other" }),
        ],
        total: 4,
        limit: undefined,
        offset: undefined,
      },
      error: null,
    });
    deleteMock.mockResolvedValue({ data: { success: true }, error: null });
    createMock.mockResolvedValue({
      data: {
        id: "mcp-new",
        key: "new-secret",
      },
      error: null,
    });

    const { result } = renderHook(() => useMcpApiKey(true, "org-1"));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.generateMcpUrl();
    });

    expect(deleteMock).toHaveBeenCalledTimes(2);
    expect(deleteMock).toHaveBeenCalledWith({ keyId: "mcp-old-a" });
    expect(deleteMock).toHaveBeenCalledWith({ keyId: "mcp-old-b" });

    const latestDeleteOrder = Math.max(...deleteMock.mock.invocationCallOrder);
    const createOrder = createMock.mock.invocationCallOrder[0];
    expect(latestDeleteOrder).toBeLessThan(createOrder);
  });
});
