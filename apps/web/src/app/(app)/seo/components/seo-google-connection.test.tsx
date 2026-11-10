import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoGoogleConnection } from "./seo-google-connection";

vi.mock("@/lib/actions/seo-connections/action", () => ({
  connectSeoStatisticsAction: vi.fn(),
  finalizeSeoStatisticsAction: vi.fn(),
  disconnectSeoStatisticsAction: vi.fn(),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
vi.mock("@/lib/composio/use-composio-oauth-popup", () => ({
  useComposioOAuthPopup: () => ({ runPopupOAuth: vi.fn() }),
}));

const copy = messages.App.Seo.connections;
const ANALYTICS_CHOICE = { name: copy.includeAnalytics };
const CONNECT_ANALYTICS = { name: "Connect Google Analytics" };
const clients: QueryClient[] = [];
type Status =
  | "not_connected"
  | "connected"
  | "needs_reconnect"
  | "failed"
  | "unavailable";

function show(statuses: { search_console: Status; ga4: Status }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const provider = String(input).endsWith("/ga4")
        ? "ga4"
        : "search_console";
      if (statuses[provider] === "failed")
        return new Response(null, { status: 503 });
      return new Response(
        JSON.stringify({
          provider,
          name: provider === "ga4" ? "Google Analytics" : "Search Console",
          status: statuses[provider],
          source: statuses[provider] === "connected" ? "native" : "none",
          canResume: false,
          pendingConnectionId: null,
        }),
        { status: 200 },
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const onSync = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <SeoGoogleConnection onConnected={vi.fn()} onSync={onSync} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return onSync;
}

describe("SEO Google connection", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
    vi.unstubAllGlobals();
  });

  it("starts with one button and Google Analytics as a choice", async () => {
    show({ search_console: "not_connected", ga4: "not_connected" });
    await screen.findByRole("button", { name: "Connect Google" });
    expect(screen.getByRole("checkbox", ANALYTICS_CHOICE)).toBeChecked();
    // The second approval is not on offer before the first one is done.
    expect(screen.queryByRole("button", CONNECT_ANALYTICS)).toBeNull();
    expect(screen.getByText(copy.analyticsNext)).toBeVisible();
  });

  it("offers Google Analytics as the second approval once Search Console is connected", async () => {
    const onSync = show({ search_console: "connected", ga4: "not_connected" });
    await screen.findByRole("button", CONNECT_ANALYTICS);
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Sync statistics" }),
    );
    expect(onSync).toHaveBeenCalledExactlyOnceWith("search_console");
  });

  it("says Google Analytics is not connected when the user leaves it out", async () => {
    show({ search_console: "connected", ga4: "not_connected" });
    await screen.findByRole("button", CONNECT_ANALYTICS);
    await userEvent.click(screen.getByRole("checkbox", ANALYTICS_CHOICE));
    expect(screen.queryByRole("button", CONNECT_ANALYTICS)).toBeNull();
    expect(screen.getByText(copy.analyticsOff)).toBeVisible();
    // The choice is not final: the user can take Google Analytics back in.
    await userEvent.click(screen.getByRole("checkbox", ANALYTICS_CHOICE));
    expect(screen.getByRole("button", CONNECT_ANALYTICS)).toBeVisible();
  });

  it("shows no choice for a Google Analytics account that is connected", async () => {
    show({ search_console: "connected", ga4: "connected" });
    await screen.findByText("Google Analytics connected");
    expect(screen.queryByRole("checkbox", ANALYTICS_CHOICE)).toBeNull();
  });

  it("keeps the repair of a Google Analytics account in reach before Search Console is connected", async () => {
    show({ search_console: "not_connected", ga4: "needs_reconnect" });
    await screen.findByRole("button", { name: "Reconnect Google Analytics" });
    expect(screen.queryByRole("checkbox", ANALYTICS_CHOICE)).toBeNull();
    // The first button names the one source that is missing.
    expect(
      screen.getByRole("button", { name: "Connect Search Console" }),
    ).toBeVisible();
  });

  it("keeps a Google Analytics account in view when the Search Console read fails", async () => {
    show({ search_console: "failed", ga4: "needs_reconnect" });
    await screen.findByRole("button", { name: "Reconnect Google Analytics" });
    expect(await screen.findByText(copy.loadFailed)).toBeVisible();
  });

  it("offers no Google Analytics choice where connections are unavailable", async () => {
    show({ search_console: "unavailable", ga4: "unavailable" });
    await screen.findByText(copy.unavailable);
    expect(screen.queryByRole("checkbox", ANALYTICS_CHOICE)).toBeNull();
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
  });
});
