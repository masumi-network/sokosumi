import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposioOAuthPopupFlow } from "@/lib/composio/use-composio-oauth-popup";
import messages from "../../../../../messages/en.json";
import { SeoStepRow } from "./seo-agent-steps";
import { SeoConnectionButton } from "./seo-connection-button";
import { seoTestWorkspace } from "./seo-test-fixture";
import { useSeoConnectionStatus } from "./use-seo-connection";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

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

  it("shows a blocked popup in the place of the banner text, so nothing in the banner moves", async () => {
    m.popup.mockResolvedValue({ kind: "popup_blocked" });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const model = { data: seoTestWorkspace(), openStatistics: vi.fn() };
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <SeoStepRow
            banner="Statistics are not set up"
            step={{ kind: "connect", provider: "search_console" }}
            model={model as unknown as SeoWorkspaceModel}
            refresh={vi.fn()}
            refreshing={false}
            first
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    const button = await screen.findByRole("button", {
      name: "Connect Google",
    });
    await userEvent.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Allow popups to connect Search Console, then try again.",
    );
    // The text and the message share one cell: the text keeps its space and is hidden.
    const text = screen.getByText(
      messages.App.Seo.agent.steps.connect.search_console,
    );
    expect(alert.parentElement).toBe(text.parentElement);
    expect(text).toHaveClass("invisible");
    // The button gets no line under it: a line there puts the button on a row of its own.
    expect(button.parentElement?.querySelector("p")).toBeNull();
  });

  it("disconnects through an explicit action and refreshes native status", async () => {
    m.status = "connected";
    show();
    const account = await screen.findByRole("button", {
      name: "Search Console connected",
    });
    // The rare account actions stay out of the row until the reader opens the menu.
    expect(screen.getAllByRole("button")).toEqual([account]);
    await userEvent.click(account);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Disconnect" }),
    );
    // The menu item only asks: the account stays until the reader confirms.
    const confirm = await screen.findByRole("alertdialog", {
      name: "Disconnect Search Console?",
    });
    expect(m.disconnect).not.toHaveBeenCalled();
    await userEvent.click(
      within(confirm).getByRole("button", {
        name: "Disconnect Search Console",
      }),
    );
    expect(m.disconnect).toHaveBeenCalledWith({
      provider: "search_console",
      viewerId: "owner",
      organizationId: "org",
    });
    expect(await connectButton()).toBeEnabled();
  });

  it("does not call a disconnected account connected when the next status read fails", async () => {
    m.status = "connected";
    m.disconnect.mockImplementation(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 503 })),
      );
      return { ok: true, value: { disconnected: true } };
    });
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Search Console connected" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Disconnect" }),
    );
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Disconnect Search Console",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Try again" }),
    ).toBeVisible();
    expect(screen.queryByText("Search Console connected")).toBeNull();
  });

  it("runs the caller's next step when the new status removes the control", async () => {
    const onConnected = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    // A properties read in the view: the connect waits for its new answer.
    function View() {
      useQuery({
        queryKey: ["seo-properties", "search_console"],
        queryFn: () => new Promise((done) => setTimeout(() => done([]), 50)),
      });
      const connected =
        useSeoConnectionStatus("search_console").status.data?.status ===
        "connected";
      return connected ? (
        <p>synced view</p>
      ) : (
        <SeoConnectionButton
          provider="search_console"
          onConnected={onConnected}
        />
      );
    }
    render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <View />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await connectButton());
    expect(await screen.findByText("synced view")).toBeVisible();
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(onConnected).toHaveBeenCalledTimes(1);
  });

  it("keeps the account when the reader cancels the disconnect", async () => {
    m.status = "connected";
    show();
    await userEvent.click(
      await screen.findByRole("button", { name: "Search Console connected" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Disconnect" }),
    );
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(confirm).getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(m.disconnect).not.toHaveBeenCalled();
    // A keyboard reader continues on the account's line, where the question started.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Search Console connected" }),
      ).toHaveFocus(),
    );
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
      await screen.findByRole("button", { name: "Search Console connected" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Switch account" }),
    );
    await waitFor(() => expect(m.callback).toHaveBeenCalled());
    expect(screen.getByText("Search Console connected")).toBeVisible();
    expect(m.disconnect).not.toHaveBeenCalled();
    expect(m.finalize).not.toHaveBeenCalled();
  });

  it("keeps a connected account in view when a later status read fails", async () => {
    m.status = "connected";
    show();
    await screen.findByRole("button", { name: "Search Console connected" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    await clients.at(-1)?.invalidateQueries();
    await waitFor(() =>
      expect(clients.at(-1)?.getQueryCache().getAll()[0]?.state.status).toBe(
        "error",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Search Console connected" }),
    ).toBeVisible();
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
