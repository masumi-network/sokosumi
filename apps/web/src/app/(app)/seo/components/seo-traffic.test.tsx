import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE } from "@sokosumi/utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
import {
  SEO_TEST_PROJECT,
  seoTestMetric,
  seoTestWorkspace,
} from "./seo-test-fixture";
import { SeoWorkspace } from "./seo-workspace";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  )),
  useRouter: () => ({ push: vi.fn() }),
}));

const clients: QueryClient[] = [];
function renderTraffic(
  workspace: ProjectSeoWorkspace,
  searchParams = "",
  searchConnected = false,
  searchConsoleStatus?: Promise<Response>,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  clients.push(client);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "https://web.test");
      if (
        searchConsoleStatus &&
        url.pathname.endsWith("/connections/search_console")
      )
        return searchConsoleStatus;
      if (url.pathname.endsWith("/statistics/traffic")) {
        const { scope, from, to } = JSON.parse(String(init?.body));
        const site = scope === "site";
        const home = {
          url: "https://www.example.com/",
          clicks: 3,
          impressions: 78,
        };
        const about = {
          url: "https://example.com/about",
          clicks: 6,
          impressions: 12,
        };
        return Response.json({
          site: "example.com",
          propertyId: "sc-domain:example.com",
          from,
          to,
          limited: false,
          totals: site
            ? { clicks: 9, impressions: 90 }
            : { clicks: 3, impressions: 78 },
          pages: [
            { ...home, submitted: ["https://example.com/"], variants: [home] },
            ...(site ? [{ ...about, submitted: [], variants: [about] }] : []),
          ],
        });
      }
      if (init?.method === "POST" && url.pathname.endsWith("/statistics"))
        return Response.json(null);
      if (searchConnected && url.pathname.includes("/connections/")) {
        const provider = url.pathname.split("/").at(-1);
        return Response.json({
          provider,
          name: provider,
          status: provider === "search_console" ? "connected" : "not_connected",
          source: "native",
        });
      }
      if (searchConnected && url.pathname.endsWith("statistics/properties"))
        return Response.json({
          provider: "search_console",
          status: "available",
          reason: null,
          properties: [
            { id: "sc-domain:second-site.test", name: "second-site.test" },
            { id: "sc-domain:example.com", name: "example.com" },
          ],
        });
      return Response.json(workspace);
    }),
  );
  return render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter
          searchParams={`?tab=traffic${searchParams}`}
          hasMemory
        >
          <SeoWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

it("loads the whole website when the workspace also tracks a different domain and more than ten pages", async () => {
  const workspace = seoTestWorkspace();
  const home = workspace.pages[0];
  const extra = Array.from({ length: 12 }, (_, i) => ({
    ...home,
    id: crypto.randomUUID(),
    url: i === 0 ? "https://second-site.test/" : home.url + i,
  }));
  workspace.pages.push(...extra);
  workspace.scope.pageIds.push(...extra.map((page) => page.id));
  renderTraffic(workspace, "", true);
  expect(await screen.findByText("90", { selector: "dd" })).toBeVisible();
  const call = vi
    .mocked(fetch)
    .mock.calls.find(([url]) => String(url).endsWith("/statistics/traffic"));
  const body = JSON.parse(String(call?.[1]?.body));
  expect(body.propertyId).toBe("sc-domain:example.com");
  expect(body.pageIds).toHaveLength(10);
  expect(body.pageIds).not.toContain(extra[0].id);
});
it("opens traffic for the current website and narrows it to the selected page and its verified URL", async () => {
  renderTraffic(seoTestWorkspace(), "&to=2024-03-01", true);
  const user = userEvent.setup();
  expect(
    screen.getByRole("button", { name: "Whole site", pressed: true }),
  ).toBeVisible();
  const report = (
    await screen.findByRole("heading", { name: "example.com", level: 2 })
  ).closest("section")!;
  expect(within(report).getByText("90")).toBeVisible();
  expect(report.querySelector("summary")?.textContent).toContain("/about");
  await user.click(
    within(report).getByRole("combobox", { name: "Order pages by" }),
  );
  await user.click(screen.getByRole("option", { name: "Search impressions" }));
  expect(report.querySelector("summary")?.textContent).toContain(
    "www.example.com",
  );
  await user.click(screen.getByRole("button", { name: "Selected pages" }));
  const selected = (await screen.findByText("78", { selector: "dd" })).closest(
    "section",
  )!;
  expect(within(selected).queryByText("https://example.com/about")).toBeNull();
  await user.click(selected.querySelector("summary")!);
  expect(
    within(selected).getByRole("link", { name: "https://www.example.com/" }),
  ).toBeVisible();
  expect(
    within(selected).getByRole("link", { name: "https://example.com/" }),
  ).toBeVisible();
  const calls = vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => String(url).endsWith("/statistics/traffic"))
    .map(([, init]) => JSON.parse(String(init?.body)));
  expect(calls[0]).toMatchObject({ from: "2023-12-03", to: "2024-03-01" });
  expect(calls.map(({ scope, propertyId }) => [scope, propertyId])).toEqual([
    ["site", "sc-domain:example.com"],
    ["selected", "sc-domain:example.com"],
  ]);
});

describe("SEO Traffic search type", () => {
  it("keeps an unfinished or failed connection check distinct from a disconnected account", async () => {
    const response = Promise.withResolvers<Response>();
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      {
        ...seoTestMetric(),
        source: "ga4",
        key: "sessions",
        propertyId: "properties/1",
      },
    ];
    renderTraffic(workspace, "", false, response.promise);
    const section = screen
      .getByRole("heading", { name: "Search Console queries" })
      .closest("section");
    if (!section) throw new Error("Missing search queries section");
    const queries = within(section);
    expect(queries.queryByText("Search Console is not connected")).toBeNull();
    response.resolve(new Response(null, { status: 503 }));
    expect(
      await queries.findByText("Could not check this connection. Try again."),
    ).toBeVisible();
    expect(queries.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("shows a scoped Search Console investigation only for complete matched weeks from the personal workspace", async () => {
    const workspace = seoTestWorkspace();
    workspace.sharing = "personal";
    workspace.metrics = (["clicks", "impressions", "position"] as const).map(
      (key) => ({
        ...seoTestMetric(),
        id: "verified-read:" + key,
        coverage: "partial",
        notes: [SEO_STATISTICS_SEARCH_CONSOLE_FINAL_DATA_NOTE],
        key,
        unit: key === "position" ? "position" : "count",
        source: "search_console",
        from: "2026-01-01",
        to: "2026-01-14",
        timeZone: "America/Los_Angeles",
        observedAt: new Date("2026-01-18T12:00:00Z"),
        propertyId: "sc-domain:example.com",
        points: Array.from({ length: 14 }, (_, i) => ({
          date: "2026-01-" + String(i + 1).padStart(2, "0"),
          value:
            key === "clicks"
              ? i < 7
                ? 10
                : 6
              : key === "impressions"
                ? 100
                : 5,
        })),
      }),
    );
    const headline = "Clicks fell while impressions held up";
    const ui = renderTraffic(workspace);
    expect(
      await screen.findByRole("heading", { name: headline }),
    ).toBeVisible();
    expect(
      screen.getByText(/1 selected page on sc-domain:example.com/),
    ).toBeVisible();
    expect(
      screen.getByText(/70 clicks, 700 impressions, average position 5/),
    ).toBeVisible();
    expect(
      screen.getByText(/42 clicks, 700 impressions, average position 5/),
    ).toBeVisible();
    ui.unmount();
    workspace.sharing = "organization";
    const shared = renderTraffic(workspace);
    expect(
      screen.queryByRole("heading", { name: headline }),
    ).not.toBeInTheDocument();
    shared.unmount();
    workspace.sharing = "personal";
    workspace.metrics[2].points[10].value = null;
    const missing = renderTraffic(workspace);
    expect(
      screen.queryByRole("heading", { name: headline }),
    ).not.toBeInTheDocument();
    missing.unmount();
    workspace.metrics[2].points[10].value = 5;
    workspace.metrics[2].id = "different-read:position";
    renderTraffic(workspace);
    expect(
      screen.queryByRole("heading", { name: headline }),
    ).not.toBeInTheDocument();
  });
  it("explains a shift in organic landing mix without reporting better engagement on individual pages", async () => {
    const workspace = seoTestWorkspace();
    workspace.landingEngagementChange = {
      propertyId: "properties/31",
      timeZone: "Europe/Madrid",
      pageCount: 2,
      before: {
        from: "2025-05-01",
        to: "2025-05-28",
        sessions: 100,
        observationId: "f1111111-1111-4111-8111-111111111111",
      },
      after: {
        from: "2025-05-29",
        to: "2025-06-25",
        sessions: 100,
        observationId: "f2222222-2222-4222-8222-222222222222",
      },
      engagementSecondsPerSession: {
        before: 72,
        after: 132,
        withinPageChange: 0,
        mixChange: 60,
      },
      viewsPerSession: {
        before: 1.2,
        after: 2.2,
        withinPageChange: 0,
        mixChange: 1,
      },
    };
    renderTraffic(workspace, "&channel=organic");
    expect(
      await screen.findByRole("heading", {
        name: "What changed in organic visits",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        /distribution of visits across landing pages accounted for the change/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Compare which entry pages gained visits/),
    ).toBeVisible();
    await userEvent.setup().click(screen.getByText("Why this recommendation"));
    const row = screen.getByRole("row", {
      name: /Engagement seconds per session/,
    });
    expect(within(row).getByText("72")).toBeVisible();
    expect(within(row).getByText("132")).toBeVisible();
    expect(within(row).getByText("+60")).toBeVisible();
  });
  it.each(["ga4", "search_console"] as const)(
    "labels the full %s aggregate period when the last day had no traffic",
    (source) => {
      const workspace = seoTestWorkspace();
      workspace.metrics = [
        {
          ...seoTestMetric(),
          source,
          points: [{ date: "2026-01-01", value: 2 }],
          ...(source === "search_console"
            ? { previous: { from: "2025-12-30", to: "2025-12-31", value: 3 } }
            : {}),
        },
      ];
      renderTraffic(workspace);
      const section = screen
        .getByRole("heading", { name: "Traffic" })
        .closest("section");
      if (!section) throw new Error("Measurements section missing");
      expect(within(section).getByText(/Jan 1.*2, 2026/)).toBeVisible();
    },
  );

  it("reads the chosen Search Console search type and offers no choice without Search Console data", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "web" }];
    renderTraffic(workspace);
    const choice = screen.getByRole("combobox", { name: "Search type" });
    expect(choice).toHaveTextContent("Web");
    await user.click(choice);
    await user.click(screen.getByRole("option", { name: "Discover" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("searchType=discover"),
        expect.anything(),
      ),
    );
    cleanup();
    const analytics = seoTestWorkspace();
    analytics.metrics = [{ ...seoTestMetric(), source: "ga4" }];
    renderTraffic(analytics);
    expect(screen.queryByRole("combobox", { name: "Search type" })).toBeNull();
  });

  it("keeps the channel on Traffic: another tab hides and clears it", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), source: "ga4", channel: "all" }];
    renderTraffic(workspace, "&channel=all");
    expect(screen.getByRole("combobox", { name: "Traffic" })).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Actions" }));
    // The workspace read: the only call with a query right after the owner's SEO path.
    const reads = () =>
      vi
        .mocked(fetch)
        .mock.calls.map(([url]) => String(url))
        .filter((url) =>
          url.includes(`/api/projects/${SEO_TEST_PROJECT}/seo?`),
        );
    await waitFor(() => expect(reads().at(-1)).not.toContain("channel"));
    expect(reads().some((url) => url.includes("channel=all"))).toBe(true);
    expect(screen.queryByRole("combobox", { name: "Traffic" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(
      await screen.findByRole("combobox", { name: "Traffic" }),
    ).toHaveTextContent("All measured segments");
  });

  it("keeps the search type on Traffic: another tab reads web search and clears it", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input, "https://web.test");
        if (url.pathname.includes("/connections/")) {
          const provider = url.pathname.split("/").at(-1);
          return Response.json({
            provider,
            name: provider,
            status:
              provider === "search_console" ? "connected" : "not_connected",
            source: "native",
          });
        }
        if (url.pathname.endsWith("statistics/properties"))
          return Response.json({
            provider: "search_console",
            status: "available",
            reason: null,
            properties: [{ id: "sc-domain:example.com", name: "example.com" }],
          });
        return Response.json(workspace);
      }),
    );
    renderTraffic(workspace, "&searchType=discover");
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).not.toContain(
        "searchType",
      ),
    );
    await user.click(screen.getByRole("tab", { name: "Traffic" }));
    expect(
      await screen.findByRole("combobox", { name: "Search type" }),
    ).toHaveTextContent("Web");
  });

  it("shows a Discover split by device beside the no query data note", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
    workspace.searchBreakdown = {
      observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
      propertyId: "sc-domain:example.com",
      from: "2026-10-01",
      to: "2026-10-28",
      observedAt: new Date("2026-10-29T00:00:00Z"),
      devices: {
        rowLimit: 250,
        truncated: false,
        rows: [
          {
            key: "mobile",
            clicks: 3,
            impressions: 40,
            ctr: 0.075,
            averagePosition: null,
          },
        ],
      },
    };
    renderTraffic(workspace, "&searchType=discover");
    expect(
      screen.getByText("This search type has no query data"),
    ).toBeVisible();
    const section = screen
      .getByRole("heading", { name: "Countries and devices" })
      .closest("section");
    if (!section) throw new Error("Breakdown section missing");
    const mobile = within(section).getByRole("row", { name: /Mobile/ });
    expect(within(mobile).getAllByRole("cell").at(-1)).toHaveTextContent(
      "Not available",
    );
  });

  it("automatically collects the search type in view", async () => {
    mutate.mockResolvedValue({ ok: true, value: null });
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
    renderTraffic(workspace, "&searchType=discover", true);
    // Discover syncs no query rows, so the query table says that instead of asking for a sync.
    expect(
      screen.getByText("This search type has no query data"),
    ).toBeVisible();
    expect(screen.queryByText("No query rows saved yet")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/statistics$/),
        expect.objectContaining({ method: "POST", body: expect.any(String) }),
      ),
    );
    const request = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url).endsWith("/statistics") && init?.method === "POST",
      );
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      searchType: "discover",
      automatic: true,
    });
  });
});

/** Two pages with Search Console rows each: the Top pages table shows. */
function twoPageWorkspace() {
  const workspace = seoTestWorkspace();
  const home = workspace.pages[0];
  const shop = {
    ...home,
    id: "8f9d3c55-2f5d-4c55-9e43-7d1a5a0c2b61",
    url: "https://example.com/shop",
    relationship: "related" as const,
    relatedToPageId: home.id,
  };
  workspace.pages.push(shop);
  workspace.scope.pageIds = [home.id, shop.id];
  const row = (pageUrl: string, query: string) => ({
    id: `${pageUrl}:${query}`,
    query,
    pageUrl,
    clicks: 3,
    impressions: 40,
    ctr: 0.075,
    averagePosition: 4,
  });
  workspace.metrics = [seoTestMetric()];
  workspace.searchQueries = {
    observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
    propertyId: "sc-domain:example.com",
    from: "2026-01-01",
    to: "2026-01-02",
    timeZone: "UTC",
    observedAt: new Date("2026-01-03T00:00:00Z"),
    rowLimit: 250,
    truncated: false,
    rows: [row(home.url, "example"), row(shop.url, "example shop")],
  };
  return workspace;
}
function landingPages(rows: Array<{ pageUrl: string; keyEvents: number }>) {
  return {
    channel: "organic" as const,
    observationId: "0b6f6a3e-1c55-4b1a-9a43-1f3d2c4b5a69",
    propertyId: "properties/123",
    from: "2026-01-01",
    to: "2026-01-02",
    observedAt: new Date("2026-01-03T00:00:00Z"),
    rows: rows.map((row) => ({ ...row, sessions: 9 })),
  };
}
function topPagesTable() {
  const section = screen
    .getByRole("heading", { name: "Top pages" })
    .closest("section");
  if (!section) throw new Error("Top pages section missing");
  return section;
}

describe("SEO Traffic key events", () => {
  it("shows organic key events per page beside the clicks", () => {
    const workspace = twoPageWorkspace();
    workspace.landingPages = landingPages([
      { pageUrl: "https://example.com/shop", keyEvents: 3 },
    ]);
    renderTraffic(workspace);
    const table = within(topPagesTable());
    expect(
      table.getByRole("columnheader", { name: "Key events (organic)" }),
    ).toBeVisible();
    const shop = table.getByRole("row", { name: /example\.com\/shop/ });
    expect(within(shop).getAllByRole("cell").at(-2)).toHaveTextContent("3");
    expect(topPagesTable()).not.toHaveTextContent("recorded no key events");
    // The key events read names its own period beside the Search Console one.
    expect(topPagesTable()).toHaveTextContent(/Key events \(organic\) Jan 1/);
  });

  it("says a page left out of the landing read was not read", () => {
    const workspace = twoPageWorkspace();
    workspace.landingPages = {
      ...landingPages([{ pageUrl: "https://example.com/shop", keyEvents: 3 }]),
      skippedUrls: ["https://example.com/"],
    };
    renderTraffic(workspace);
    const table = within(topPagesTable());
    const home = table.getByRole("row", { name: /example\.com\/(?!shop)/ });
    expect(within(home).getAllByRole("cell").at(-2)).toHaveTextContent(
      "Not read: shares a landing path with another selected page",
    );
    const shop = table.getByRole("row", { name: /example\.com\/shop/ });
    expect(within(shop).getAllByRole("cell").at(-2)).toHaveTextContent("3");
  });

  it("says when Google Analytics recorded no key events and shows no column without a read", () => {
    const workspace = twoPageWorkspace();
    workspace.landingPages = landingPages([
      { pageUrl: "https://example.com/shop", keyEvents: 0 },
    ]);
    renderTraffic(workspace);
    expect(topPagesTable()).toHaveTextContent(
      "Google Analytics recorded no key events for these pages.",
    );
    cleanup();
    renderTraffic(twoPageWorkspace());
    expect(
      within(topPagesTable()).queryByRole("columnheader", {
        name: "Key events (organic)",
      }),
    ).toBeNull();
  });
});

describe("SEO Traffic AI assistant channel", () => {
  it("reads AI assistant traffic when that channel is chosen and names its key events", async () => {
    const user = userEvent.setup();
    const workspace = twoPageWorkspace();
    workspace.metrics.push({ ...seoTestMetric(), source: "ga4" });
    workspace.landingPages = {
      ...landingPages([{ pageUrl: "https://example.com/", keyEvents: 1 }]),
      channel: "ai_assistant",
    };
    renderTraffic(workspace);
    expect(
      within(topPagesTable()).getByRole("columnheader", {
        name: "Key events (AI assistants)",
      }),
    ).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Traffic" }));
    await user.click(
      screen.getByRole("option", {
        name: "AI assistants (ChatGPT, Gemini, Copilot)",
      }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("channel=ai_assistant"),
        expect.anything(),
      ),
    );
  });
});

describe("SEO Traffic AI assistants", () => {
  it("names each assistant per landing page, or says the channel had no data", () => {
    const workspace = seoTestWorkspace();
    workspace.metrics = [
      { ...seoTestMetric(), source: "ga4", channel: "ai_assistant" },
    ];
    workspace.landingPages = {
      ...landingPages([{ pageUrl: "https://example.com/", keyEvents: 1 }]),
      channel: "ai_assistant",
      sources: [
        {
          pageUrl: "https://example.com/",
          source: "chatgpt.com",
          sessions: 5,
          keyEvents: 1,
        },
        {
          pageUrl: "https://example.com/",
          source: "perplexity.ai",
          sessions: 2,
          keyEvents: 0,
        },
      ],
      truncated: false,
    };
    renderTraffic(workspace, "&channel=ai_assistant");
    const section = screen
      .getByRole("heading", { name: "AI assistants" })
      .closest("section");
    if (!section) throw new Error("AI assistants section missing");
    const chatgpt = within(section).getByRole("row", { name: /chatgpt\.com/ });
    expect(chatgpt).toHaveTextContent("5");
    expect(
      within(section).getByRole("row", { name: /perplexity\.ai/ }),
    ).toBeVisible();
    cleanup();
    workspace.landingPages = {
      ...workspace.landingPages,
      rows: [],
      sources: [],
    };
    renderTraffic(workspace, "&channel=ai_assistant");
    expect(screen.getByText("No AI Assistant channel data")).toBeVisible();
    // An empty read is no key events claim either.
    expect(screen.queryByText(/recorded no key events/)).toBeNull();
  });
});

describe("SEO Traffic branded split", () => {
  function brandWorkspace(terms?: string[]) {
    const workspace = twoPageWorkspace();
    workspace.searchQueries?.rows.push({
      id: "acme",
      query: "Acmé shoes",
      pageUrl: "https://example.com/",
      clicks: 9,
      impressions: 50,
      ctr: 0.18,
      averagePosition: 1.5,
    });
    if (terms) workspace.brandTerms = terms;
    return workspace;
  }
  const queriesSection = () => {
    const section = screen
      .getByRole("heading", { name: "Search Console queries" })
      .closest("section");
    if (!section) throw new Error("Queries section missing");
    return within(section);
  };

  it("lists branded or non-branded queries and gives the clicks on each side", async () => {
    const user = userEvent.setup();
    renderTraffic(brandWorkspace(["acme"]));
    expect(screen.getByTestId("seo-brand-totals")).toHaveTextContent(
      "Listed queries: 9 clicks branded, 6 clicks non-branded",
    );
    await user.click(screen.getByRole("button", { name: "Branded" }));
    expect(queriesSection().getByText("Acmé shoes")).toBeVisible();
    expect(queriesSection().queryByText("example shop")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Non-branded" }));
    expect(queriesSection().queryByText("Acmé shoes")).toBeNull();
    expect(queriesSection().getByText("example shop")).toBeVisible();
  });

  it("counts only the queries the search filter lists", async () => {
    const user = userEvent.setup();
    const workspace = brandWorkspace(["acme"]);
    // The filter box shows once the list is long enough to need it.
    for (let index = 0; index < 20; index++)
      workspace.searchQueries?.rows.push({
        id: `filler-${index}`,
        query: `garden tool ${index}`,
        pageUrl: "https://example.com/",
        clicks: 1,
        impressions: 5,
        ctr: 0.2,
        averagePosition: 9,
      });
    renderTraffic(workspace);
    await user.type(await screen.findByRole("searchbox"), "acm");
    expect(screen.getByTestId("seo-brand-totals")).toHaveTextContent(
      "Listed queries: 9 clicks branded, 0 clicks non-branded",
    );
  });

  it("saves the brand terms the owner types, one per line", async () => {
    const user = userEvent.setup();
    mutate.mockResolvedValue({ ok: true, value: null });
    renderTraffic(brandWorkspace());
    expect(screen.queryByRole("group", { name: "Brand split" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Add brand terms" }));
    await user.type(
      screen.getByLabelText("Brand terms"),
      "Acme{enter}acme shop",
    );
    await user.click(screen.getByRole("button", { name: "Save brand terms" }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          command: {
            kind: "save_brand_terms",
            body: { terms: ["Acme", "acme shop"] },
          },
        }),
      ),
    );
  });
});
