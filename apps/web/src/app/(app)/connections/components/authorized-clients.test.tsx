import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageListSearchContext } from "@/components/page-list-search";
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
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
    vi.mocked(toast.error).mockClear();
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

  it("shows skeleton rows, not a loading line, while the list first loads", () => {
    mockGetConsents.mockReturnValue(new Promise(() => {}));
    render(<OAuthAuthorizedClients />);

    const rows = screen.getByTestId("authorized-clients-loading");
    expect(rows).toBeVisible();
    expect(rows).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("loadingStatus");
    expect(screen.getByText("description")).toBeVisible();
  });

  it("lets the loading rows shrink to a phone-width card", () => {
    mockGetConsents.mockReturnValue(new Promise(() => {}));
    render(<OAuthAuthorizedClients />);

    for (const placeholder of screen
      .getByTestId("authorized-clients-loading")
      .querySelectorAll('[data-slot="skeleton"]:not(.shrink-0)')) {
      expect(placeholder).toHaveClass("max-w-full");
      expect(placeholder.parentElement).toHaveClass("min-w-0");
    }
  });

  it("keeps the last list when the tab is shown again", async () => {
    // The app's client keeps reads fresh for a minute (get-query-client.ts).
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 60 * 1000 } },
    });
    const ui = (
      <QueryClientProvider client={client}>
        <OAuthAuthorizedClients />
      </QueryClientProvider>
    );
    const first = rtlRender(ui);
    expect(await screen.findByText("Claude")).toBeInTheDocument();
    first.unmount();
    // Switching tabs takes longer than a garbage-collection tick.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    rtlRender(ui);

    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(
      screen.queryByTestId("authorized-clients-loading"),
    ).not.toBeInTheDocument();
    // The cached list still refreshes in the background.
    await waitFor(() => expect(mockGetConsents).toHaveBeenCalledTimes(2));
  });

  it("offers Retry instead of the raw error when the list fails to load", async () => {
    let finishRetry: (value: unknown) => void = () => {};
    mockGetConsents
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRetry = resolve)),
      );
    render(<OAuthAuthorizedClients />);

    expect(await screen.findByText("loadError")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("loadErrorTitle");
    expect(screen.queryByText(/Failed to fetch/)).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();

    const retry = screen.getByRole("button", { name: "retry" });
    retry.focus();
    fireEvent.click(retry);

    // While the retry runs, the same button stays focused and shows it is busy.
    await waitFor(() => expect(retry).toHaveAttribute("aria-busy", "true"));
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("loadingStatus");

    await act(async () => {
      finishRetry({
        data: [
          {
            id: "consent-1",
            clientId: "client-1",
            createdAt: "2026-02-10T00:00:00.000Z",
          },
        ],
        error: null,
      });
    });

    expect(await screen.findByText("Claude")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("loadedStatus");
  });

  it("drops the empty list when the page filter matches no app", async () => {
    render(
      <PageListSearchContext.Provider
        value={{ query: "nothing-matches", register: () => () => {} }}
      >
        <OAuthAuthorizedClients />
      </PageListSearchContext.Provider>,
    );

    expect(await screen.findByText("description")).toBeVisible();
    await waitFor(() => expect(mockPublicClient).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="card-content"]'),
      ).not.toBeInTheDocument(),
    );
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
