import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { openStatisticsSetup, seoTestWorkspace } from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

const { statistics, viewer } = vi.hoisted(() => ({
  statistics: vi.fn(),
  viewer: { userId: "owner" as string | null },
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: vi.fn() }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    // A null viewer is a session the client has not read yet.
    data: viewer.userId
      ? {
          session: { activeOrganizationId: "org" },
          user: { id: viewer.userId },
        }
      : null,
  }),
}));

const clients: QueryClient[] = [];
function metric(change: Partial<ProjectSeoMetric>): ProjectSeoMetric {
  return {
    id: "ga4-views",
    key: "page_views",
    label: "Page views",
    unit: "count",
    source: "ga4",
    propertyId: "properties/123",
    value: 100,
    from: "2026-09-01",
    to: "2026-09-28",
    timeZone: "UTC",
    channel: "all",
    observedAt: new Date("2026-10-01T10:00:00Z"),
    coverage: "complete",
    points: [],
    notes: [],
    ...change,
  };
}

function renderWorkspace(workspace: ProjectSeoWorkspace) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { gcTime: Number.POSITIVE_INFINITY },
    },
  });
  clients.push(client);
  const content = () => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  const view = render(content());
  return { refreshViewer: () => view.rerender(content()) };
}

function properties(provider: string) {
  return {
    provider,
    status: "available",
    reason: null,
    properties:
      provider === "ga4"
        ? [
            { id: "properties/123", name: "Saved Analytics property" },
            { id: "properties/456", name: "Other Analytics property" },
          ]
        : [{ id: "sc-domain:example.com", name: "Saved Search property" }],
  };
}

function connection(pathname: string, connected = ["search_console"]) {
  const provider = pathname.split("/").at(-1) ?? "search_console";
  return {
    provider,
    name: provider === "ga4" ? "Google Analytics" : "Search Console",
    status: connected.includes(provider) ? "connected" : "not_connected",
    source: connected.includes(provider) ? "native" : "none",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  statistics.mockImplementation(async () => Response.json(null));
  viewer.userId = "owner";
});
afterEach(() => {
  // Unmount first: a mounted connection query refetches when its client
  // clears, and without the stub that request goes to the network.
  cleanup();
  sessionStorage.clear();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

async function renderWithPendingAgentRefresh() {
  const workspace = seoTestWorkspace();
  workspace.metrics = [
    metric({
      id: "search-clicks",
      key: "clicks",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      channel: "organic",
    }),
  ];
  let finish: (value: { ok: true; value: null }) => void = () => {};
  statistics.mockReturnValue(
    new Promise((resolve) => {
      finish = () => resolve(Response.json(null));
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://web.test");
      if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
        return statistics(JSON.parse(String(init.body)));
      if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
      if (url.pathname.includes("/connections/"))
        return Response.json(connection(url.pathname));
      return Response.json(
        url.pathname.endsWith("statistics/properties")
          ? properties(url.searchParams.get("provider") ?? "ga4")
          : workspace,
      );
    }),
  );
  renderWorkspace(workspace);
  await waitFor(() => expect(statistics).toHaveBeenCalledOnce());
  return { finish: (value: { ok: true; value: null }) => finish(value) };
}

describe("statistics source and property recovery", () => {
  it("lets the agent refresh only once the session is known, and reads as that viewer", async () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      metric({
        id: "search-clicks",
        key: "clicks",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        channel: "organic",
      }),
    ];
    const viewers: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
          return statistics(JSON.parse(String(init.body)));
        if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
        viewers.push(
          new Headers(init?.headers).get("x-seo-viewer") ?? "missing",
        );
        if (url.pathname.includes("/connections/"))
          return Response.json(connection(url.pathname));
        if (url.pathname.endsWith("statistics/properties"))
          return Response.json(
            properties(url.searchParams.get("provider") ?? "ga4"),
          );
        return Response.json(workspace);
      }),
    );
    viewer.userId = null;
    const view = renderWorkspace(workspace);
    await act(async () => {});
    expect(statistics).not.toHaveBeenCalled();
    viewer.userId = "owner";
    view.refreshViewer();
    await waitFor(() => expect(statistics).toHaveBeenCalledOnce());
    await waitFor(() => expect(viewers.length).toBeGreaterThan(0));
    // A read without the viewer is refused (409) and would hide the page.
    expect(viewers.every((id) => id === "owner")).toBe(true);
  });

  it("syncs the displayed source's saved property and traffic while generic setup shows each source with its own", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.observations = [
      {
        id: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
        kind: "page_check",
        source: "seo_coworker",
        observedAt: new Date("2026-10-01T10:00:00Z"),
        pageIds: workspace.scope.pageIds,
        scopeVersion: 2,
        sourceTaskId: null,
        countryCode: "US",
        languageCode: "en",
        devices: ["desktop"],
        rulebookVersion: "html-v1",
        artifactHash: "checked-html",
        issues: 0,
        coverage: { checked: 2, skipped: 0, failed: 0 },
      },
    ];
    workspace.metrics = [
      metric({}),
      metric({
        id: "search-clicks",
        key: "clicks",
        source: "search_console",
        propertyId: "sc-domain:example.com",
        from: "2026-10-01",
        to: "2026-10-28",
        channel: "organic",
        observedAt: new Date("2026-10-29T10:00:00Z"),
      }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
          return statistics(JSON.parse(String(init.body)));
        if (url.pathname.includes("/connections/"))
          return Response.json(
            connection(url.pathname, ["ga4", "search_console"]),
          );
        return Response.json(
          url.pathname.endsWith("statistics/properties")
            ? properties(url.searchParams.get("provider") ?? "ga4")
            : workspace,
        );
      }),
    );
    renderWorkspace(workspace);
    // Stale Search Console data makes the agent refresh it once on open.
    // Both connected sources now collect automatically, using their saved properties.
    await waitFor(() => expect(statistics).toHaveBeenCalledTimes(2));
    expect(statistics.mock.calls.map(([input]) => input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "search_console",
          propertyId: "sc-domain:example.com",
          automatic: true,
        }),
        expect.objectContaining({
          provider: "ga4",
          propertyId: "properties/123",
          automatic: true,
        }),
      ]),
    );
    statistics.mockClear();
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    await user.click(screen.getByRole("combobox", { name: "Source" }));
    await user.click(screen.getByRole("option", { name: "Google Analytics" }));
    // Analytics has no one-click sync; its button opens the dialog on the displayed source.
    await user.click(
      screen.getAllByRole("button", { name: "Google connections" })[0],
    );
    const dialog = screen.getByRole("dialog");
    const analytics = within(dialog).getByRole("region", {
      name: "Google Analytics",
    });
    expect(analytics).toHaveAttribute("aria-current", "true");
    await waitFor(() =>
      expect(
        within(analytics).getByRole("combobox", { name: "Property" }),
      ).toHaveTextContent("Saved Analytics property"),
    );
    // No range and no traffic field: the dialog says what it reads. The saved source keeps its traffic.
    expect(within(dialog).queryByLabelText("Start date")).toBeNull();
    expect(
      within(dialog).queryByRole("combobox", { name: "Traffic" }),
    ).toBeNull();
    expect(
      within(analytics).getByTestId("seo-statistics-reads-ga4"),
    ).toHaveTextContent("Reads the last 90 days of all website traffic.");
    await user.click(
      within(dialog).getAllByRole("button", { name: "Close" })[0],
    );
    await openStatisticsSetup(user);
    const generic = screen.getByRole("dialog");
    const search = within(generic).getByRole("region", {
      name: "Search Console",
    });
    // One property: a line, not a field.
    expect(
      await within(search).findByText("Saved Search property"),
    ).toBeVisible();
    expect(
      within(search).queryByRole("combobox", { name: "Property" }),
    ).toBeNull();
    expect(
      within(search).getByTestId("seo-statistics-reads-search_console"),
    ).toHaveTextContent("Reads the last 90 days of Google search data.");
    // Each source shows its own last sync: its property and its traffic.
    const genericAnalytics = within(generic).getByRole("region", {
      name: "Google Analytics",
    });
    await waitFor(() =>
      expect(
        within(genericAnalytics).getByRole("combobox", { name: "Property" }),
      ).toHaveTextContent("Saved Analytics property"),
    );
    expect(
      within(genericAnalytics).getByTestId("seo-statistics-reads-ga4"),
    ).toHaveTextContent("Reads the last 90 days of all website traffic.");
    expect(statistics).not.toHaveBeenCalled();
  });

  it("keeps an open dialog while the agent refreshes stale Search Console data", async () => {
    const user = userEvent.setup();
    const { finish } = await renderWithPendingAgentRefresh();
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    // The user's own dialog is not blocked by the background refresh.
    expect(
      within(dialog).getAllByRole("button", { name: "Close" })[0],
    ).toBeEnabled();
    finish({ ok: true, value: null });
    await waitFor(() =>
      expect(screen.queryByText("Loading Google statistics.")).toBeNull(),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("does not duplicate an in-flight collection when Google settings open", async () => {
    const user = userEvent.setup();
    const { finish } = await renderWithPendingAgentRefresh();
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    await within(dialog).findAllByTestId(/^seo-statistics-reads-/);
    expect(within(dialog).queryByRole("button", { name: /sync/i })).toBeNull();
    expect(statistics).toHaveBeenCalledOnce();
    finish({ ok: true, value: null });
    await waitFor(() =>
      expect(screen.queryByText("Loading Google statistics.")).toBeNull(),
    );
    expect(statistics).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("chooses the property that names the audit's site among several", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
          return statistics(JSON.parse(String(init.body)));
        if (url.pathname.includes("/connections/"))
          return Response.json(connection(url.pathname, ["ga4"]));
        return Response.json(
          url.pathname.endsWith("statistics/properties")
            ? {
                provider: "ga4",
                status: "available",
                reason: null,
                properties: [
                  { id: "properties/1", name: "Company blog" },
                  { id: "properties/2", name: "example.com website" },
                ],
              }
            : workspace,
        );
      }),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    // Nothing is saved and nothing is clicked: the sync is ready.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Property" }),
      ).toHaveTextContent("example.com website"),
    );
    await waitFor(() => expect(statistics).toHaveBeenCalledOnce());
    expect(statistics.mock.calls[0][0]).toMatchObject({
      provider: "ga4",
      propertyId: "properties/2",
      automatic: true,
    });
    expect(within(dialog).queryByRole("button", { name: /sync/i })).toBeNull();
  });

  it("retries a temporary unavailable property result in place", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    let propertyReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const url = new URL(input, "https://web.test");
        if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
          return statistics(JSON.parse(String(init.body)));
        if (url.pathname.endsWith("statistics/properties")) {
          propertyReads += 1;
          return Response.json(
            propertyReads === 1
              ? {
                  provider: "ga4",
                  status: "unavailable",
                  properties: [],
                  reason: "Temporary native property read failure",
                }
              : properties("ga4"),
          );
        }
        if (url.pathname.includes("/connections/"))
          return Response.json(connection(url.pathname, ["ga4"]));
        if (url.pathname.endsWith("/chat")) return Response.json({ turns: [] });
        return Response.json(workspace);
      }),
    );
    renderWorkspace(workspace);
    await openStatisticsSetup(user);
    const dialog = screen.getByRole("dialog");
    await within(dialog).findByText("Temporary native property read failure");
    expect(within(dialog).queryByRole("button", { name: /sync/i })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Try again" }));
    await within(dialog).findByRole("combobox", { name: "Property" });
    expect(propertyReads).toBe(2);
    expect(statistics).not.toHaveBeenCalled();
  });
});
