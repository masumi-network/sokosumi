import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioOAuthPopupFlow } from "@/lib/composio/use-composio-oauth-popup";
import messages from "../../../../../messages/en.json";
import { SeoConnectionButton } from "./seo-connection-button";

const m = vi.hoisted(() => ({
  initiate: vi.fn(),
  finalize: vi.fn(),
  disconnect: vi.fn(),
  complete: vi.fn(),
  popup: vi.fn(),
  navigate: vi.fn(),
  callback: vi.fn(),
  error: vi.fn(),
  status: "not_connected",
  resumable: false,
}));
vi.mock("@/lib/actions/seo-connections/action", () => ({
  connectSeoStatisticsAction: m.initiate,
  finalizeSeoStatisticsAction: m.finalize,
  disconnectSeoStatisticsAction: m.disconnect,
}));
vi.mock("@/lib/actions/composio/action", () => ({
  completeComposioAuthCallbackAction: m.complete,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
vi.mock("@/lib/composio/use-composio-oauth-popup", () => ({
  useComposioOAuthPopup: () => ({ runPopupOAuth: m.popup }),
}));
vi.mock("sonner", () => ({ toast: { error: m.error } }));

const clients: QueryClient[] = [];
function show(onConnected = vi.fn(), withAnalytics = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        {withAnalytics ? (
          <SeoConnectionButton provider="ga4" onConnected={onConnected} />
        ) : null}
        <SeoConnectionButton
          provider="search_console"
          onConnected={onConnected}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onConnected;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.status = "not_connected";
  m.resumable = false;
  m.popup.mockImplementation(
    async (run: (flow: ComposioOAuthPopupFlow) => unknown) => ({
      kind: "completed",
      value: await run({
        navigate: m.navigate,
        nonce: "nonce",
        waitForCallback: m.callback,
      }),
    }),
  );
  m.callback.mockResolvedValue({
    kind: "callback",
    payload: {
      status: "success",
      connectionId: "ca-search",
      sessionUri: "https://backend.composio.dev/session/one",
    },
  });
  m.initiate.mockResolvedValue({
    ok: true,
    value: {
      connectionId: "ca-search",
      redirectUrl: "https://connect.composio.dev/one",
    },
  });
  m.complete.mockResolvedValue({ ok: true, value: undefined });
  m.finalize.mockResolvedValue({
    ok: true,
    value: {
      provider: "search_console",
      name: "Search Console",
      status: "connected",
      source: "native",
    },
  });
  m.disconnect.mockImplementation(async () => {
    m.status = "not_connected";
    return { ok: true, value: { disconnected: true } };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: "search_console",
            name: "Search Console",
            status: m.status,
            source: m.status === "connected" ? "native" : "none",
            canResume: m.resumable,
            pendingConnectionId: m.resumable ? "ca-search" : null,
          }),
          { status: 200 },
        ),
    ),
  );
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

async function connectButton() {
  const button = await screen.findByRole("button", {
    name: "Connect Search Console",
  });
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

describe("native SEO connection consent", () => {
  it("names each pending provider's recovery actions", async () => {
    m.status = "pending";
    m.resumable = true;
    show(vi.fn(), true);
    for (const provider of ["Google Analytics", "Search Console"]) {
      expect(
        await screen.findByRole("button", {
          name: `Retry ${provider} verification`,
        }),
      ).toBeVisible();
      expect(
        screen.getByRole("button", {
          name: `Start a new ${provider} connection`,
        }),
      ).toBeVisible();
    }
  });

  it("checks status on mount without starting OAuth or assistant setup", async () => {
    show();
    expect(await connectButton()).toBeEnabled();
    expect(m.initiate).not.toHaveBeenCalled();
    expect(m.popup).not.toHaveBeenCalled();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("connects only the selected source and returns through the current preview callback", async () => {
    const refreshed = show();
    await userEvent.click(await connectButton());
    await waitFor(() =>
      expect(m.finalize).toHaveBeenCalledWith({
        provider: "search_console",
        connectionId: "ca-search",
        viewerId: "owner",
        organizationId: "org",
      }),
    );
    expect(m.initiate).toHaveBeenCalledWith({
      provider: "search_console",
      viewerId: "owner",
      organizationId: "org",
      callbackUrl: expect.any(String),
    });
    const callbackUrl = new URL(m.initiate.mock.calls[0][0].callbackUrl);
    expect(callbackUrl.origin).toBe(window.location.origin);
    expect(callbackUrl.pathname).toBe("/seo/connections/callback");
    expect(callbackUrl.searchParams.get("seo_state")).toBe("nonce");
    expect(m.complete).not.toHaveBeenCalled();
    expect(m.navigate).toHaveBeenCalledWith("https://connect.composio.dev/one");
    expect(await screen.findByText("Search Console connected")).toBeVisible();
    expect(refreshed).toHaveBeenCalledTimes(1);
  });

  it("does not finalize cancelled consent and leaves the source connectable", async () => {
    m.callback.mockResolvedValue({ kind: "cancelled" });
    show();
    await userEvent.click(await connectButton());
    await waitFor(() => expect(m.callback).toHaveBeenCalled());
    expect(m.finalize).not.toHaveBeenCalled();
    expect(m.complete).not.toHaveBeenCalled();
    expect(m.error).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Connect Search Console" }),
    ).toBeEnabled();
  });

  it("reports blocked popups without creating an authorization attempt", async () => {
    m.popup.mockResolvedValue({ kind: "popup_blocked" });
    show();
    await userEvent.click(await connectButton());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Allow popups to connect Search Console, then try again.",
      ),
    );
    expect(m.initiate).not.toHaveBeenCalled();
  });

  it("disconnects through an explicit action and refreshes native status", async () => {
    m.status = "connected";
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Disconnect Search Console" }),
    );
    expect(m.disconnect).toHaveBeenCalledWith({
      provider: "search_console",
      viewerId: "owner",
      organizationId: "org",
    });
    expect(await connectButton()).toBeEnabled();
  });

  it("resumes already redeemed approval without opening another Google consent window", async () => {
    m.status = "pending";
    m.resumable = true;
    show();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Retry Search Console verification",
      }),
    );
    expect(await screen.findByText("Search Console connected")).toBeVisible();
    expect(m.finalize).toHaveBeenCalledWith({
      provider: "search_console",
      connectionId: "ca-search",
      viewerId: "owner",
      organizationId: "org",
    });
    expect(m.initiate).not.toHaveBeenCalled();
    expect(m.popup).not.toHaveBeenCalled();
  });

  it("retains the selected account when replacement consent is cancelled", async () => {
    m.status = "connected";
    m.callback.mockResolvedValue({ kind: "cancelled" });
    show();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Change Search Console account",
      }),
    );
    expect(screen.getByText("Search Console connected")).toBeVisible();
    expect(m.disconnect).not.toHaveBeenCalled();
    expect(m.finalize).not.toHaveBeenCalled();
  });

  it("shows a retryable verification error instead of claiming the source connected", async () => {
    m.finalize.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", status: 503 },
    });
    show();
    await userEvent.click(await connectButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "temporarily unavailable",
    );
    expect(screen.queryByText("Search Console connected")).toBeNull();
  });
});
