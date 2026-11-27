import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoGoogleConnection } from "./seo-google-connection";

const m = vi.hoisted(() => ({
  initiate: vi.fn(),
  finalize: vi.fn(),
  popup: vi.fn(),
}));
vi.mock("@/lib/actions/seo-connections/action", () => ({
  connectSeoStatisticsAction: m.initiate,
  finalizeSeoStatisticsAction: m.finalize,
  disconnectSeoStatisticsAction: vi.fn(),
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
vi.mock("@/lib/composio/use-composio-oauth-popup", () => ({
  useComposioOAuthPopup: () => ({ runPopupOAuth: m.popup }),
}));

const copy = messages.App.Seo.connections;
/** A source row says its name and state in one line; the state part is for screen readers. */
const row = (text: string) => (_: string, element: Element | null) =>
  element?.tagName === "P" && element.textContent === text;
const CONNECT_ANALYTICS = { name: "Connect Google Analytics" };
const clients: QueryClient[] = [];
type Status =
  | "not_connected"
  | "connected"
  | "pending"
  | "needs_reconnect"
  | "failed"
  | "unavailable";

type Account = {
  email: string;
  name: string | null;
  pictureUrl: string | null;
};

function show(
  statuses: { search_console: Status; ga4: Status },
  {
    inRow = false,
    accounts = {},
  }: {
    inRow?: boolean;
    accounts?: Partial<Record<"search_console" | "ga4", Account>>;
  } = {},
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
          account: accounts[provider] ?? null,
        }),
        { status: 200 },
      );
    }),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
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

  it("says Google Analytics is not connected and offers it in its row once Search Console is connected", async () => {
    show({ search_console: "connected", ga4: "not_connected" });
    await screen.findByRole("button", CONNECT_ANALYTICS);
    expect(
      screen.getByText(row("Google Analytics: Not connected")),
    ).toBeVisible();
    expect(screen.getByText(row("Search Console: Connected"))).toBeVisible();
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
  });

  it("puts two connected sources in one card with one menu", async () => {
    show({ search_console: "connected", ga4: "connected" });
    await screen.findByText(row("Google Analytics: Connected"));
    expect(screen.getByText(row("Search Console: Connected"))).toBeVisible();
    // One menu for both accounts and no sync: the view has its own sync action.
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([copy.options]);
  });

  it("names the Google account and the second account of a source on another one", async () => {
    show(
      { search_console: "connected", ga4: "connected" },
      {
        accounts: {
          search_console: {
            email: "owner@example.com",
            name: "Shop Owner",
            pictureUrl: null,
          },
          ga4: {
            email: "analytics@example.com",
            name: "Analytics Team",
            pictureUrl: null,
          },
        },
      },
    );
    const card = await screen.findByTestId("seo-google-accounts");
    expect(await within(card).findByText("Shop Owner")).toBeVisible();
    expect(within(card).getByText("owner@example.com")).toBeVisible();
    // The Search Console row is on the account above; only the other account is named in its row.
    expect(within(card).getAllByText("owner@example.com")).toHaveLength(1);
    expect(within(card).getByText("analytics@example.com")).toBeVisible();
    expect(within(card).queryByText(/through your google account/i)).toBeNull();
  });

  it("keeps the Google Analytics control mounted when the Search Console status changes", async () => {
    const statuses = {
      search_console: "connected",
      ga4: "connected",
    } satisfies Record<string, Status>;
    show(statuses);
    await screen.findByText(row("Google Analytics: Connected"));
    const card = screen.getByTestId("seo-google-accounts");
    // A switch of the Search Console account that fails leaves it not connected.
    (statuses as { search_console: Status }).search_console = "not_connected";
    await clients.at(-1)?.invalidateQueries();
    await screen.findByRole("button", { name: "Connect Search Console" });
    // The same card: a remount would end an approval in flight and drop its error text.
    expect(screen.getByTestId("seo-google-accounts")).toBe(card);
  });

  it("keeps the card and its approval when a switch of the only connected account reads pending", async () => {
    const statuses: { search_console: Status; ga4: Status } = {
      search_console: "connected",
      ga4: "not_connected",
    };
    let callback = (_: unknown) => {};
    m.popup.mockImplementation(async (run) => ({
      kind: "completed",
      value: await run({
        nonce: "n",
        navigate: vi.fn(),
        waitForCallback: () => new Promise((resolve) => (callback = resolve)),
      }),
    }));
    m.initiate.mockImplementation(async () => {
      // Core reads an open approval on the connected account as pending.
      statuses.search_console = "pending";
      return {
        ok: true,
        value: { connectionId: "new", redirectUrl: "https://x" },
      };
    });
    m.finalize.mockResolvedValue({ ok: false, error: null });
    show(statuses);
    await userEvent.click(
      await screen.findByRole("button", { name: copy.options }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: "Switch account: Search Console",
      }),
    );
    await waitFor(() => expect(m.initiate).toHaveBeenCalled());
    // A status read while the approval window is open: the tab becomes visible again.
    await clients.at(-1)?.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByText(row("Search Console"))).toBeVisible(),
    );
    expect(screen.getByTestId("seo-google-accounts")).toBeVisible();
    // The row's restart must wait: a second approval would end the first one.
    await userEvent.click(
      screen.getByRole("button", { name: /Search Console/ }),
    );
    expect(m.initiate).toHaveBeenCalledTimes(1);
    callback({
      kind: "callback",
      payload: { status: "success", connectionId: "new" },
    });
    await waitFor(() => expect(m.finalize).toHaveBeenCalled());
  });

  it("returns to the first-connection step when both sources are disconnected", async () => {
    const statuses: { search_console: Status; ga4: Status } = {
      search_console: "connected",
      ga4: "not_connected",
    };
    show(statuses);
    await screen.findByTestId("seo-google-accounts");
    statuses.search_console = "not_connected";
    await clients.at(-1)?.invalidateQueries();
    expect(
      await screen.findByRole("button", { name: "Connect Google" }),
    ).toBeVisible();
    expect(screen.queryByTestId("seo-google-accounts")).toBeNull();
  });

  it("shows a failed connection of a source one time", async () => {
    m.popup.mockResolvedValue({ kind: "popup_blocked" });
    show({ search_console: "connected", ga4: "not_connected" });
    await userEvent.click(
      await screen.findByRole("button", { name: "Connect Google Analytics" }),
    );
    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  });

  it("names no account on top when one connected source has no known account", async () => {
    show(
      { search_console: "connected", ga4: "connected" },
      {
        accounts: {
          ga4: {
            email: "analytics@example.com",
            name: "Analytics",
            pictureUrl: null,
          },
        },
      },
    );
    const card = await screen.findByTestId("seo-google-accounts");
    expect(
      await within(card).findByText("analytics@example.com"),
    ).toBeVisible();
    expect(within(card).queryByText("Analytics")).toBeNull();
    expect(within(card).getByText(copy.googleAccount)).toBeVisible();
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
    await screen.findByText(row("Search Console: Connected"));
    expect(await screen.findByText(copy.loadFailed)).toBeVisible();
    // The row names the source and claims no state.
    expect(screen.getByText(row("Google Analytics"))).toBeVisible();
  });

  it("says one time that connections are unavailable", async () => {
    show({ search_console: "unavailable", ga4: "unavailable" });
    await screen.findByText(copy.unavailable);
    expect(screen.queryByText(copy.analyticsNext)).toBeNull();
  });
});
