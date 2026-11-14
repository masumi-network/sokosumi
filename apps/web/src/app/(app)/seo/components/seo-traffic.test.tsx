import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
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
import { seoTestMetric, seoTestWorkspace } from "./seo-test-fixture";
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
function renderTraffic(workspace: ProjectSeoWorkspace, searchParams = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  clients.push(client);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(workspace)),
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

describe("SEO Traffic search type", () => {
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

  it("keeps the search type on Traffic: another tab reads web search and clears it", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
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

  it("refreshes the search type in view", async () => {
    const user = userEvent.setup();
    mutate.mockResolvedValue({ ok: true, value: null });
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
    renderTraffic(workspace, "&searchType=discover");
    // Discover syncs no query rows, so the query table says that instead of asking for a sync.
    expect(
      screen.getByText("This search type has no query data"),
    ).toBeVisible();
    expect(screen.queryByText("No query rows saved yet")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          command: expect.objectContaining({
            kind: "sync_statistics",
            body: expect.objectContaining({ searchType: "discover" }),
          }),
        }),
      ),
    );
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
