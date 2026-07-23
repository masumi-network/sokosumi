import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClientsMock = vi.fn();
const createClientMock = vi.fn();
const updateClientMock = vi.fn();
const deleteClientMock = vi.fn();
const rotateClientSecretMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

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
      createClient: (...args: unknown[]) => createClientMock(...args),
      updateClient: (...args: unknown[]) => updateClientMock(...args),
      deleteClient: (...args: unknown[]) => deleteClientMock(...args),
      client: {
        rotateSecret: (...args: unknown[]) => rotateClientSecretMock(...args),
      },
    },
  },
}));

import { useOAuthClients } from "@/app/developer/components/oauth-clients/hooks/use-oauth-clients";

describe("useOAuthClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientsMock.mockResolvedValue({
      data: [
        {
          client_id: "client_1",
          client_name: "Test Client",
          redirect_uris: ["https://example.com/callback"],
        },
      ],
      error: null,
    });
  });

  it("loads clients on mount", async () => {
    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(getClientsMock).toHaveBeenCalled();
    expect(result.current.clients).toHaveLength(1);
    expect(result.current.clients[0]?.client_id).toBe("client_1");
    expect(result.current.error).toBeNull();
  });

  it("surfaces load errors", async () => {
    getClientsMock.mockResolvedValue({
      data: null,
      error: { message: "backend unavailable" },
    });

    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(result.current.error).toBe("backend unavailable");
    expect(result.current.clients).toHaveLength(0);
  });

  it("creates a client and refreshes the list", async () => {
    createClientMock.mockResolvedValue({
      data: {
        client_id: "client_2",
        client_secret: "secret",
      },
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let createResult: Awaited<ReturnType<typeof result.current.create>>;
    await act(async () => {
      createResult = await result.current.create({
        name: "New Client",
        redirectUris: ["https://example.com/cb"],
      });
    });

    expect(createClientMock).toHaveBeenCalledWith({
      redirect_uris: ["https://example.com/cb"],
      client_name: "New Client",
      scope: "openid",
    });
    expect(createResult!.success).toBe(true);
    expect(createResult!.data?.clientId).toBe("client_2");
    expect(createResult!.data?.clientSecret).toBe("secret");
    // List refresh is fire-and-forget after credentials are returned.
    await waitFor(() => {
      expect(getClientsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("registers Core API scope when includeCoreApi is true", async () => {
    createClientMock.mockResolvedValue({
      data: {
        client_id: "client_api",
        client_secret: "secret",
      },
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.create({
        name: "API Client",
        redirectUris: ["https://example.com/cb"],
        includeCoreApi: true,
      });
    });

    expect(createClientMock).toHaveBeenCalledWith({
      redirect_uris: ["https://example.com/cb"],
      client_name: "API Client",
      scope: "openid sokosumi:api",
    });
  });

  it("updates a client with the Better Auth payload shape", async () => {
    updateClientMock.mockResolvedValue({
      data: {
        client_id: "client_1",
        client_name: "Renamed",
        redirect_uris: ["https://example.com/new"],
      },
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let success = false;
    await act(async () => {
      success = await result.current.update({
        clientId: "client_1",
        name: "Renamed",
        redirectUris: ["https://example.com/new"],
      });
    });

    expect(success).toBe(true);
    expect(updateClientMock).toHaveBeenCalledWith({
      client_id: "client_1",
      update: {
        client_name: "Renamed",
        redirect_uris: ["https://example.com/new"],
      },
    });
    expect(getClientsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("updates a client with Core API scope when includeCoreApi is true", async () => {
    updateClientMock.mockResolvedValue({
      data: {
        client_id: "client_1",
        client_name: "API Client",
        redirect_uris: ["https://example.com/cb"],
        scope: "openid sokosumi:api",
      },
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    await act(async () => {
      await result.current.update({
        clientId: "client_1",
        name: "API Client",
        redirectUris: ["https://example.com/cb"],
        includeCoreApi: true,
      });
    });

    expect(updateClientMock).toHaveBeenCalledWith({
      client_id: "client_1",
      update: {
        client_name: "API Client",
        redirect_uris: ["https://example.com/cb"],
        scope: "openid sokosumi:api",
      },
    });
  });

  it("deletes a client", async () => {
    deleteClientMock.mockResolvedValue({ data: {}, error: null });

    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let success = false;
    await act(async () => {
      success = await result.current.delete({ clientId: "client_1" });
    });

    expect(success).toBe(true);
    expect(deleteClientMock).toHaveBeenCalledWith({ client_id: "client_1" });
  });

  it("rotates a client secret and returns the new secret", async () => {
    rotateClientSecretMock.mockResolvedValue({
      data: {
        client_id: "client_1",
        client_secret: "new-secret",
      },
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());
    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let rotateResult: Awaited<ReturnType<typeof result.current.rotateSecret>>;
    await act(async () => {
      rotateResult = await result.current.rotateSecret({
        clientId: "client_1",
      });
    });

    expect(rotateClientSecretMock).toHaveBeenCalledWith({
      client_id: "client_1",
    });
    expect(rotateResult!.success).toBe(true);
    expect(rotateResult!.data?.clientId).toBe("client_1");
    expect(rotateResult!.data?.clientSecret).toBe("new-secret");
    await waitFor(() => {
      expect(getClientsMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});
