import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revokeOAuthClientAccess } from "@/lib/actions/oauth/action";
import { TestQueryProvider } from "@/test/query-provider";

import { OAuthAuthorizedClients } from "./authorized-clients";

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: TestQueryProvider });
}

const mockGetConsents = vi.fn();
const mockPublicClient = vi.fn();

// Stable like next-intl's own `t`: the component refetches when `t` changes.
const t = (key: string) => key;

vi.mock("next-intl", () => ({
  useFormatter: () => ({ dateTime: () => "Feb 10, 2026" }),
  useTranslations: () => t,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/actions/oauth/action", () => ({
  revokeOAuthClientAccess: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      getConsents: (...args: unknown[]) => mockGetConsents(...args),
      publicClient: (...args: unknown[]) => mockPublicClient(...args),
    },
  },
}));

describe("OAuthAuthorizedClients", () => {
  beforeEach(() => {
    mockGetConsents.mockReset();
    mockGetConsents.mockResolvedValue({
      data: [
        {
          id: "consent-1",
          clientId: "client-1",
          createdAt: "2026-02-10T00:00:00.000Z",
        },
      ],
      error: null,
    });
    mockPublicClient.mockReset();
    mockPublicClient.mockResolvedValue({
      data: { client_name: "Claude" },
      error: null,
    });
  });

  it("names an app the viewer authorized but does not own", async () => {
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.queryByText("client-1")).not.toBeInTheDocument();
    expect(mockPublicClient).toHaveBeenCalledWith({
      query: { client_id: "client-1" },
    });
  });

  it("falls back to the client id when the name cannot be loaded", async () => {
    mockPublicClient.mockRejectedValue(new Error("not found"));
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("client-1")).toBeInTheDocument();
  });

  it("cancels a pre-revoke read so it cannot bring a revoked app back and refetches after revoke", async () => {
    vi.stubGlobal("confirm", () => true);
    vi.mocked(revokeOAuthClientAccess).mockResolvedValueOnce({
      ok: true,
      value: undefined,
    } as never);

    let finishPreRevokeRead: (value: unknown) => void = () => {};
    mockGetConsents
      .mockResolvedValueOnce({
        data: [
          {
            id: "consent-1",
            clientId: "client-1",
            createdAt: "2026-02-10T00:00:00.000Z",
          },
        ],
        error: null,
      })
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishPreRevokeRead = resolve)),
      )
      .mockResolvedValueOnce({ data: [], error: null });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
        mutations: { gcTime: Number.POSITIVE_INFINITY },
      },
    });
    rtlRender(
      <QueryClientProvider client={client}>
        <OAuthAuthorizedClients />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Claude")).toBeInTheDocument();

    // Start a pre-revoke read that stays in flight while the user revokes.
    const staleRead = client.refetchQueries({
      queryKey: ["connections", "oauth-consents"],
    });
    await waitFor(() => expect(mockGetConsents).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "revokeAccess" }));

    await waitFor(() => expect(mockGetConsents).toHaveBeenCalledTimes(3));
    expect(screen.queryByText("Claude")).not.toBeInTheDocument();

    await act(async () => {
      finishPreRevokeRead({
        data: [
          {
            id: "consent-1",
            clientId: "client-1",
            createdAt: "2026-02-10T00:00:00.000Z",
          },
        ],
        error: null,
      });
      await staleRead;
    });

    expect(screen.queryByText("Claude")).not.toBeInTheDocument();
  });
});
