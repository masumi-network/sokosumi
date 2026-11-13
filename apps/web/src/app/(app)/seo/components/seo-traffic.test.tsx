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

  it("refreshes the search type in view", async () => {
    const user = userEvent.setup();
    mutate.mockResolvedValue({ ok: true, value: null });
    const workspace = seoTestWorkspace();
    workspace.metrics = [{ ...seoTestMetric(), searchType: "discover" }];
    renderTraffic(workspace, "&searchType=discover");
    // The totals card and the empty query table each offer the same refresh.
    await user.click(screen.getAllByRole("button", { name: "Sync now" })[0]);
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
