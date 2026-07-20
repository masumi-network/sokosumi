import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOAuthClients } from "@/app/developer/components/oauth-clients/hooks/use-oauth-clients";

const getClientsMock = vi.fn();
const createClientMock = vi.fn();
const updateClientMock = vi.fn();
const deleteClientMock = vi.fn();
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
    oauth2: {
      getClients: (...args: unknown[]) => getClientsMock(...args),
      createClient: (...args: unknown[]) => createClientMock(...args),
      updateClient: (...args: unknown[]) => updateClientMock(...args),
      deleteClient: (...args: unknown[]) => deleteClientMock(...args),
    },
  },
}));

function makeClient(id: string) {
  return {
    client_id: id,
    client_name: `Client ${id}`,
    redirect_uris: ["https://example.com/callback"],
  };
}

describe("useOAuthClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads clients from result.data", async () => {
    const client = makeClient("client-1");
    getClientsMock.mockResolvedValue({
      data: [client],
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    expect(result.current.clients).toEqual([client]);
    expect(getClientsMock).toHaveBeenCalledTimes(1);
  });

  it("creates a client and returns credentials", async () => {
    getClientsMock.mockResolvedValue({ data: [], error: null });
    createClientMock.mockResolvedValue({
      data: {
        client_id: "client-new",
        client_secret: "secret-value",
      },
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let createResult: Awaited<ReturnType<typeof result.current.create>> | null =
      null;

    await act(async () => {
      createResult = await result.current.create({
        name: "My App",
        redirectUris: ["https://example.com/callback"],
      });
    });

    expect(createClientMock).toHaveBeenCalledWith({
      redirect_uris: ["https://example.com/callback"],
      client_name: "My App",
      scope: "openid",
    });
    expect(createResult).toEqual({
      success: true,
      data: {
        clientId: "client-new",
        clientSecret: "secret-value",
      },
    });
    expect(toast.success).toHaveBeenCalledWith("Messages.createSuccess");
  });

  it("updates a client", async () => {
    getClientsMock.mockResolvedValue({ data: [], error: null });
    updateClientMock.mockResolvedValue({
      data: makeClient("client-1"),
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let success = false;

    await act(async () => {
      success = await result.current.update({
        clientId: "client-1",
        name: "Updated",
        redirectUris: ["https://example.com/new"],
      });
    });

    expect(updateClientMock).toHaveBeenCalledWith({
      client_id: "client-1",
      update: {
        client_name: "Updated",
        redirect_uris: ["https://example.com/new"],
      },
    });
    expect(success).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Messages.updateSuccess");
  });

  it("deletes a client", async () => {
    getClientsMock.mockResolvedValue({ data: [], error: null });
    deleteClientMock.mockResolvedValue({
      data: null,
      error: null,
    });

    const { result } = renderHook(() => useOAuthClients());

    await waitFor(() => {
      expect(result.current.isInitialLoading).toBe(false);
    });

    let success = false;

    await act(async () => {
      success = await result.current.delete({ clientId: "client-1" });
    });

    expect(deleteClientMock).toHaveBeenCalledWith({
      client_id: "client-1",
    });
    expect(success).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Messages.deleteSuccess");
  });
});
