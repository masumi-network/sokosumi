import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
const CONNECT_ANALYTICS = { name: "Connect Google Analytics" };
const clients: QueryClient[] = [];
type Status =
  | "not_connected"
  | "connected"
  | "needs_reconnect"
  | "failed"
  | "unavailable";

function show(
  statuses: { search_console: Status; ga4: Status },
  { inRow = false } = {},
) {
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
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <SeoGoogleConnection onConnected={vi.fn()} inRow={inRow} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SEO Google connection", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    for (const client of clients.splice(0)) client.clear();
    vi.unstubAllGlobals();
  });

  it("starts with one button that says both approvals follow", async () => {
    show({ search_console: "not_connected", ga4: "not_connected" });
    await screen.findByRole("button", { name: "Connect Google" });
    // The second approval is not on offer before the first one is done.
    expect(screen.queryByRole("button", CONNECT_ANALYTICS)).toBeNull();
    expect(screen.getByText(copy.analyticsNext)).toBeVisible();
    // The user leaves Google Analytics out in the approval window, not here.
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("is one button without a note in a row", async () => {
    show(
      { search_console: "not_connected", ga4: "not_connected" },
      { inRow: true },
    );
    await screen.findByRole("button", { name: "Connect Google" });
    // The note is as wide as the row: beside the row's text it squeezes that text.
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
  });

  it("names the missing source in a row and leaves the connected account out", async () => {
    show(
      { search_console: "not_connected", ga4: "connected" },
      { inRow: true },
    );
    await screen.findByRole("button", { name: "Connect Search Console" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("keeps the repair of a Google Analytics account in a row", async () => {
    show(
      { search_console: "not_connected", ga4: "needs_reconnect" },
      { inRow: true },
    );
    await screen.findByRole("button", { name: "Reconnect Google Analytics" });
  });

  it("says Google Analytics is not connected and offers it once Search Console is connected", async () => {
    show({ search_console: "connected", ga4: "not_connected" });
    await screen.findByRole("button", CONNECT_ANALYTICS);
    expect(screen.getByText(copy.analyticsOff)).toBeVisible();
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
  });

  it("shows no missing-account text for a Google Analytics account that is connected", async () => {
    show({ search_console: "connected", ga4: "connected" });
    await screen.findByText("Google Analytics connected");
    expect(screen.queryByText(copy.analyticsOff)).toBeNull();
    // One line per account and no sync: the view has its own sync action.
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Search Console connected", "Google Analytics connected"]);
  });

  it("keeps the Google Analytics control mounted when the Search Console status changes", async () => {
    const statuses = {
      search_console: "connected",
      ga4: "connected",
    } satisfies Record<string, Status>;
    show(statuses);
    const analytics = await screen.findByRole("button", {
      name: "Google Analytics connected",
    });
    // A switch of the Search Console account that fails leaves it not connected.
    (statuses as { search_console: Status }).search_console = "not_connected";
    await clients.at(-1)?.invalidateQueries();
    await screen.findByRole("button", { name: "Connect Search Console" });
    // The same node: a remount would end an approval in flight and drop its error text.
    expect(
      screen.getByRole("button", { name: "Google Analytics connected" }),
    ).toBe(analytics);
  });

  it("keeps the repair of a Google Analytics account in reach before Search Console is connected", async () => {
    show({ search_console: "not_connected", ga4: "needs_reconnect" });
    await screen.findByRole("button", { name: "Reconnect Google Analytics" });
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
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

  it("does not call an unread Google Analytics status not connected", async () => {
    show({ search_console: "connected", ga4: "failed" });
    await screen.findByText("Search Console connected");
    expect(await screen.findByText(copy.loadFailed)).toBeVisible();
    expect(screen.queryByText(copy.analyticsOff)).toBeNull();
  });

  it("says one time that connections are unavailable", async () => {
    show({ search_console: "unavailable", ga4: "unavailable" });
    await screen.findByText(copy.unavailable);
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
  });
});
