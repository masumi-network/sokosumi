import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import enMessages from "../../../../../messages/en.json";
import { SeoEditDialog } from "./seo-edit-dialog";
import { SeoRankings } from "./seo-rankings";
import { SeoSearchQueries } from "./seo-search-queries";
import { seoTestStrategy, seoTestWorkspace } from "./seo-test-fixture";
import { useSeoWorkspace } from "./use-seo-workspace";

type Messages = { [key: string]: string | Messages };
/** Keys this change adds; the catalog wins once it carries them. */
function withKeys(base: Messages, extra: Messages): Messages {
  const merged: Messages = { ...extra, ...base };
  for (const [key, value] of Object.entries(extra)) {
    const current = base[key];
    if (typeof value === "object" && typeof current === "object")
      merged[key] = withKeys(current, value);
  }
  return merged;
}
const messages = withKeys(enMessages as Messages, {
  App: {
    Seo: {
      keywords: {
        searchConsoleAverage:
          "{position} avg. · {count, plural, one {# impression} other {# impressions}}",
        searchConsoleNote: "Search Console average",
      },
    },
  },
});

const { mutate, viewer } = vi.hoisted(() => ({
  mutate: vi.fn(),
  viewer: { userId: "owner" as string | null },
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
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
afterEach(() => {
  viewer.userId = "owner";
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function KeywordWorkspace({ workspace }: { workspace: ProjectSeoWorkspace }) {
  const model = useSeoWorkspace(workspace);
  return (
    <>
      <SeoSearchQueries model={model} />
      <SeoRankings model={model} />
      {model.dialog === "edit_keyword" ? <SeoEditDialog model={model} /> : null}
    </>
  );
}
function renderWorkspace(workspace: ProjectSeoWorkspace) {
  // The workspace reads the Audit on mount; never let it reach a real server.
  if (!vi.isMockFunction(globalThis.fetch))
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <KeywordWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

function savedKeywordWorkspace() {
  const workspace = seoTestWorkspace();
  const pricingPage = {
    ...workspace.pages[0],
    id: "a658c5bb-3084-4b26-81ee-b3208ee5ab61",
    label: "Pricing",
    url: "https://example.com/pricing",
  };
  workspace.pages.push(pricingPage);
  workspace.keywords.push({
    id: "saved-keyword",
    keyword: "Stablecoins",
    countryCode: "DE",
    languageCode: "de",
    pageUrl: pricingPage.url,
    targetPageId: workspace.pages[0].id,
    saved: true,
    priority: "medium",
    version: 3,
    source: "saved",
    volume: null,
    intent: null,
    conversion: null,
    feature: null,
    device: null,
    position: null,
    positionStatus: "unavailable",
    checkedResults: null,
    observedAt: null,
    observationId: null,
  });
  return { workspace, pricingPage };
}

describe("Saved keyword edits", () => {
  it("removes a saved keyword without replacing its target with the observed ranking page", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(
      screen.getByRole("button", { name: "Actions for Stablecoins" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Stop tracking" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        command: {
          kind: "save_keyword",
          body: expect.objectContaining({
            pageId: workspace.pages[0].id,
            saved: false,
            expectedVersion: 3,
          }),
        },
      }),
    );
  });

  it("gives a keyword tracked from its check one quiet menu, and a stopped keyword the way back", async () => {
    const user = userEvent.setup();
    const { workspace, pricingPage } = savedKeywordWorkspace();
    const [stored] = workspace.keywords.filter(
      (row) => row.id === "saved-keyword",
    );
    workspace.keywords.push(
      // Tracked from its check: no choice of the reader is stored (version 0).
      {
        ...stored,
        id: "from-check",
        keyword: "usdc",
        source: "focus",
        targetPageId: null,
        saved: true,
        version: 0,
      },
      // The reader stopped tracking it.
      {
        ...stored,
        id: "stopped",
        keyword: "dai",
        source: "focus",
        saved: false,
        version: 2,
      },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    // No button and no state label on a tracked row: the list asks for nothing.
    expect(screen.queryByRole("button", { name: "Stop tracking" })).toBeNull();
    // The stopped keyword has the way back as its one action, and no menu.
    expect(screen.getAllByRole("button", { name: "Track" })).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "Actions for dai" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Actions for usdc" }));
    // Edit stores the first choice of the reader: the priority, the target page.
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Stop tracking" }));
    const { body } = mutate.mock.calls[0][0].command;
    // The first choice of the reader: the page the check read, and no version to expect.
    expect(body).toMatchObject({
      keyword: "usdc",
      pageId: pricingPage.id,
      saved: false,
    });
    expect(body).not.toHaveProperty("expectedVersion");
  });

  it("stores the first choice of a keyword tracked from its check with the page the check read", async () => {
    const user = userEvent.setup();
    const { workspace, pricingPage } = savedKeywordWorkspace();
    const [stored] = workspace.keywords.filter(
      (row) => row.id === "saved-keyword",
    );
    // No choice of the reader is stored (version 0, no target page). The check read the pricing page.
    workspace.keywords = [
      {
        ...stored,
        id: "from-check",
        keyword: "usdc",
        source: "focus",
        targetPageId: null,
        version: 0,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    renderWorkspace(workspace);
    await user.click(screen.getByRole("button", { name: "Actions for usdc" }));
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit keyword" });
    // The same page "Stop tracking" would store: not "No target page".
    expect(
      within(dialog).getByRole("combobox", { name: "Target page" }),
    ).toHaveTextContent("Pricing");
    await user.click(
      within(dialog).getByRole("combobox", { name: "Priority" }),
    );
    await user.click(screen.getByRole("option", { name: "High" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const { body } = mutate.mock.calls[0][0].command;
    expect(body).toMatchObject({
      keyword: "usdc",
      pageId: pricingPage.id,
      saved: true,
      priority: "high",
    });
    // Nothing is stored yet, so there is no version to expect: Core refuses a version 0.
    expect(body).not.toHaveProperty("expectedVersion");
  });

  it("saves while the session loads without a read the server would refuse", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    const viewers: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string, init?: RequestInit) => {
        viewers.push(
          new Headers(init?.headers).get("x-seo-viewer") ?? "missing",
        );
        return Response.json(workspace);
      }),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    viewer.userId = null;
    renderWorkspace(workspace);
    await user.click(
      screen.getByRole("button", { name: "Actions for Stablecoins" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Stop tracking" }));
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    await act(async () => {});
    // A read without the viewer is refused (409); it waits for the session.
    expect(viewers).toEqual([]);
  });

  it.each([
    ["medium", false],
    ["high", true],
  ] as const)(
    "shows the Priority column only when the rows differ (second row %s)",
    (priority, shown) => {
      const { workspace } = savedKeywordWorkspace();
      workspace.keywords.push({
        ...workspace.keywords[0],
        id: "second-keyword",
        keyword: "Payments",
        priority,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      expect(
        screen.queryByRole("columnheader", { name: "Priority" }) !== null,
      ).toBe(shown);
    },
  );

  it("shows a keyword's page as the address after the site, and the home page by name", () => {
    const { workspace, pricingPage } = savedKeywordWorkspace();
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    // An Audit saves no site: its primary page stands for it.
    workspace.websiteUrl = null;
    const saved = workspace.keywords[workspace.keywords.length - 1];
    workspace.keywords.push(
      {
        ...saved,
        id: "home",
        keyword: "Wallets",
        pageUrl: workspace.pages[0].url,
      },
      {
        ...saved,
        id: "other",
        keyword: "Bridges",
        pageUrl: "https://other.example/x",
      },
    );
    renderWorkspace(workspace);
    // The page is text under the keyword: the path after the site, and the home page by name.
    expect(screen.getByText("/pricing")).toBeVisible();
    expect(screen.getByText("Home page")).toBeVisible();
    // A page of another site keeps its site.
    expect(screen.getByText("https://other.example/x")).toBeVisible();
    // No link per keyword: the Health tab holds the page links.
    expect(screen.queryByRole("link", { name: pricingPage.url })).toBeNull();
  });

  it("names no page under a keyword of the one primary page", () => {
    const { workspace, pricingPage } = savedKeywordWorkspace();
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    workspace.websiteUrl = null;
    pricingPage.relationship = "related";
    const saved = workspace.keywords[workspace.keywords.length - 1];
    workspace.keywords.push({
      ...saved,
      id: "home",
      keyword: "Wallets",
      pageUrl: workspace.pages[0].url,
    });
    renderWorkspace(workspace);
    // Most keywords belong to the primary page: only a keyword of another page names its page.
    expect(screen.getByText("Wallets")).toBeVisible();
    expect(screen.queryByText("Home page")).toBeNull();
    expect(screen.getByText("/pricing")).toBeVisible();
  });

  it("shows the filter box only over a list long enough to need it", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    const [saved] = workspace.keywords;
    // Three checked keywords and twenty ideas.
    workspace.keywords = Array.from({ length: 23 }, (_, index) => ({
      ...saved,
      id: `row-${index}`,
      keyword: `row ${index}`,
      saved: false,
      version: 0,
      source: index < 3 ? "focus" : "gap",
      device: "mobile",
      position: index < 3 ? index + 1 : null,
      positionStatus: index < 3 ? "ranked" : "unavailable",
      checkedResults: index < 3 ? 20 : null,
      observedAt: new Date("2026-11-11T00:26:00Z"),
    }));
    renderWorkspace(workspace);
    // The list in view decides: the long Ideas list does not bring a box to three keywords.
    expect(document.getElementById("seo-keyword-search")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Ideas" }));
    expect(document.getElementById("seo-keyword-search")).not.toBeNull();
  });

  it("names a tracked keyword's market in words", () => {
    const { workspace } = savedKeywordWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    expect(screen.getByText("Germany · German")).toBeVisible();
    expect(screen.queryByText(/DE \/ de/)).toBeNull();
  });

  it("keeps the Priority column while a search leaves one row", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    // Enough keywords for the search field; one of them has another priority.
    for (const index of Array.from({ length: 20 }, (_, i) => i))
      workspace.keywords.push({
        ...workspace.keywords[0],
        id: `keyword-${index}`,
        keyword: `Topic ${index}`,
        priority: index === 0 ? "high" : "medium",
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    await user.type(
      screen.getByPlaceholderText("Filter keywords"),
      "Stablecoins",
    );
    await waitFor(() =>
      expect(screen.queryByText("Topic 1")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("columnheader", { name: "Priority" }),
    ).toBeInTheDocument();
  });

  it("edits a saved keyword target and priority with the version shown when editing began", async () => {
    const user = userEvent.setup();
    const { workspace, pricingPage } = savedKeywordWorkspace();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    mutate.mockResolvedValue({ ok: true, value: null });
    const view = renderWorkspace(workspace);
    await user.click(
      screen.getByRole("button", { name: "Actions for Stablecoins" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit keyword" });
    expect(within(dialog).getByLabelText("Keyword")).toHaveAttribute(
      "readonly",
    );
    expect(within(dialog).getByLabelText("Country code")).toHaveValue("DE");
    expect(
      within(dialog).getByRole("combobox", { name: "Target page" }),
    ).toHaveTextContent("Home");
    await act(async () => {
      view.client.setQueryData(
        ["seo-workspace", "org", "owner", "project", workspace.projectId, ""],
        {
          ...workspace,
          keywords: workspace.keywords.map((row) => ({ ...row, version: 4 })),
        },
      );
    });
    await user.click(
      within(dialog).getByRole("combobox", { name: "Target page" }),
    );
    await user.click(screen.getByRole("option", { name: "Pricing" }));
    await user.click(
      within(dialog).getByRole("combobox", { name: "Priority" }),
    );
    await user.click(screen.getByRole("option", { name: "High" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(mutate).toHaveBeenCalledWith({
      owner: { kind: "project", id: workspace.projectId },
      command: {
        kind: "save_keyword",
        body: {
          keyword: "Stablecoins",
          countryCode: "DE",
          languageCode: "de",
          pageId: pricingPage.id,
          saved: true,
          priority: "high",
          expectedVersion: 3,
        },
      },
    });
  });
});

function searchQueryWorkspace() {
  const { workspace } = savedKeywordWorkspace();
  const observedAt = new Date("2026-11-01T12:00:00.000Z");
  const queryRow = (
    query: string,
    clicks: number,
    impressions: number,
    averagePosition: number,
  ) => ({
    id: query,
    query,
    pageUrl: "https://example.com/",
    clicks,
    impressions,
    ctr: clicks / impressions,
    averagePosition,
  });
  workspace.searchQueries = {
    observationId: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11",
    propertyId: "sc-domain:example.com",
    from: "2026-10-01",
    to: "2026-10-28",
    timeZone: "UTC",
    observedAt,
    rowLimit: 250,
    truncated: false,
    rows: [
      queryRow("usdc", 1, 20, 8),
      queryRow("stablecoins", 2, 12, 3),
      queryRow("usdt", 0, 8, 1.5),
    ],
  };
  workspace.metrics = [
    {
      id: "c6b8a2c4-5b8e-4f0e-9a51-1f2f8a3f7c11:impressions",
      key: "impressions",
      label: "Impressions",
      unit: "count",
      source: "search_console",
      propertyId: "sc-domain:example.com",
      value: 100,
      from: "2026-10-01",
      to: "2026-10-28",
      timeZone: "UTC",
      channel: "all",
      observedAt,
      coverage: "complete",
      points: [],
      notes: [],
    },
  ];
  return workspace;
}

function queryOrder() {
  const table = screen
    .getByRole("columnheader", { name: "Query" })
    .closest("table");
  return within(table!)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelector("bdi")?.textContent);
}

describe("Keywords after a check", () => {
  it("says the site audit's keyword result in one closed line under the list, and each keyword's reach and falling searches", () => {
    const { workspace } = savedKeywordWorkspace();
    const row = (keyword: string) => ({
      ...workspace.keywords[0],
      id: keyword,
      keyword,
      saved: false,
      version: 0,
      countryCode: "US",
      languageCode: "en",
    });
    workspace.keywords = [
      row("battery app"),
      // Another keyword of the same group: the group's searches are not its searches.
      row("Battery apps"),
      row("charge timer"),
      row("battery widget"),
      row("no group"),
      // The audit read the US Market; the same keyword in Germany has other numbers.
      {
        ...row("battery health checker"),
        countryCode: "DE",
        languageCode: "de",
      },
    ];
    workspace.strategy = seoTestStrategy();
    // A trend without its recent searches has no number to show.
    workspace.strategy.groups[2].trend = "rising";
    const { unmount } = renderWorkspace(workspace);
    const verdict = screen.getByTestId("seo-strategy-verdict");
    // The closed line is the verdict alone: its reason stands in the open part.
    expect(verdict.textContent).toBe("Keep these keywords");
    // The line is closed and stands after the keyword rows: the result of the list leads the card.
    const fold = verdict.closest("details");
    if (!fold) throw new Error("no strategy fold");
    expect(fold.open).toBe(false);
    expect(
      screen.getByRole("table").compareDocumentPosition(fold) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fold.open = true;
    expect(
      screen.getByText(
        "160 of 160 monthly searches of the keyword groups with a known reach lie in groups the site ranks for or can reach.",
      ),
    ).toBeVisible();
    // A count names what it counts.
    expect(screen.getByText("1 keyword group is in reach")).toBeVisible();
    expect(
      screen.getByText("1 keyword group has a forum in the results"),
    ).toBeVisible();
    // Each keyword's numbers are one line of the folded details.
    expect(
      screen.getByText(
        '"charge timer" rises to 60 searches a month in the last 3 months, against a 12-month mean of 20.',
      ).tagName,
    ).toBe("LI");
    expect(
      screen.getByText(/^1 of 4 keyword groups are left out/).tagName,
    ).toBe("LI");
    expect(screen.getByText("1 keyword group loses searches")).toBeVisible();
    // The help says what a count in view means.
    expect(
      screen.getByText(/A forum in the search results is a sign/),
    ).toBeVisible();
    const cell = (keyword: string) => {
      const found = screen.getByText(keyword).closest("td");
      if (!found) throw new Error(`no cell for ${keyword}`);
      return found;
    };
    expect(cell("battery app")).toHaveTextContent(
      "In reach · Searches fall: 47 a month in recent months",
    );
    expect(cell("Battery apps")).toHaveTextContent("In reach");
    expect(cell("Battery apps")).not.toHaveTextContent("Searches");
    // A rank shows as a position, and flat searches say nothing.
    expect(cell("charge timer")).not.toHaveTextContent(
      /Ranks now|Searches|trend/,
    );
    // A forum in the results is no row fact: it stood on most rows. The strategy line counts it.
    expect(cell("battery widget")).not.toHaveTextContent(/forum|Open:/i);
    expect(cell("battery health checker")).not.toHaveTextContent(
      /reach|Searches/i,
    );
    expect(cell("battery widget")).not.toHaveTextContent("Searches");
    expect(cell("no group")).not.toHaveTextContent(/reach|Searches/i);
    unmount();
    // A help sentence stands only for a reach that a count in view names.
    workspace.strategy = seoTestStrategy();
    workspace.strategy.groups = workspace.strategy.groups.filter(
      (group) => group.reach === "in reach",
    );
    const inReach = renderWorkspace(workspace);
    expect(
      screen.getByText(/A keyword group is in reach when/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/A forum in the search results/)).toBeNull();
    expect(screen.queryByText(/A keyword group ranks when/)).toBeNull();
    inReach.unmount();
    // A verdict word from a newer SEO bot shows as it came.
    workspace.strategy = {
      ...seoTestStrategy(),
      verdict: "expand",
      groups: [],
    };
    renderWorkspace(workspace);
    expect(screen.getByTestId("seo-strategy-verdict")).toHaveTextContent(
      "expand",
    );
    expect(screen.queryByText(/loses searches/)).toBeNull();
  });

  it("names the page on each row of a keyword that two pages hold", () => {
    const workspace = seoTestWorkspace();
    const home = workspace.pages[0].url;
    workspace.pages.push({
      ...workspace.pages[0],
      id: crypto.randomUUID(),
      url: "https://example.com/guides",
      label: "Guides",
      relationship: "related",
      relatedToPageId: workspace.pages[0].id,
    });
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    const row = (id: string, keyword: string, pageUrl: string) => ({
      ...workspace.keywords[0],
      id,
      keyword,
      pageUrl,
      saved: false,
      version: 0,
      countryCode: "US",
      languageCode: "en",
    });
    workspace.keywords = [
      row("home", "battery app", home),
      row("guides", "battery app", "https://example.com/guides"),
      row("alone", "charge timer", home),
      // The same keyword in another Market is on the same page: the Market tells the two rows apart.
      {
        ...row("german", "charge timer", home),
        countryCode: "DE",
        languageCode: "de",
      },
    ];
    renderWorkspace(workspace);
    const cells = screen
      .getAllByText("battery app")
      .map((name) => name.closest("td")?.textContent);
    // Two rows with one name: the page tells them apart, the primary page too.
    expect(cells).toHaveLength(2);
    expect(cells.filter((text) => text?.includes("Home page"))).toHaveLength(1);
    expect(cells.filter((text) => text?.includes("/guides"))).toHaveLength(1);
    // A keyword of the primary page alone names no page: most rows belong to that page.
    const alone = screen.getAllByText("charge timer");
    expect(alone).toHaveLength(2);
    for (const name of alone)
      expect(name.closest("td")).not.toHaveTextContent("Home page");
  });

  it("shows a keyword once, the result first, and the unread keywords as ideas", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    const read = (
      patch: Partial<ProjectSeoWorkspace["keywords"][number]>,
    ): ProjectSeoWorkspace["keywords"][number] => ({
      ...workspace.keywords[0],
      saved: false,
      version: 0,
      source: "focus",
      countryCode: "US",
      languageCode: "en",
      positionStatus: "not_in_range",
      checkedResults: 17,
      observedAt: new Date("2026-11-11T00:26:00Z"),
      ...patch,
    });
    const idea = { device: null, checkedResults: null } as const;
    workspace.keywords = [
      read({ id: "m", keyword: "battery app", device: "mobile", volume: 140 }),
      read({
        id: "d",
        keyword: "battery app",
        device: "desktop",
        checkedResults: 16,
      }),
      // The check lists the read keyword again as a competitor gap.
      read({
        id: "g",
        keyword: "battery app",
        source: "gap",
        positionStatus: "unavailable",
        ...idea,
      }),
      ...Array.from({ length: 12 }, (_, index) =>
        read({
          id: `idea-${index}`,
          keyword: `idea ${index}`,
          source: index % 2 ? "gap" : "opportunity",
          positionStatus: "unavailable",
          volume: 100 - index,
          ...idea,
        }),
      ),
    ];
    renderWorkspace(workspace);
    expect(
      screen.getByText("In Google's top results for 0 of 1 checked keyword"),
    ).toBeVisible();
    expect(screen.getAllByText("battery app")).toHaveLength(1);
    // No keyword shows a page: the result line says so once, with how deep the check read.
    // A Position column of "Not found" in every row would add nothing.
    expect(screen.queryByText("Not found")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Position" })).toBeNull();
    expect(
      // The same words as the keyword tile of the Agent tab.
      screen.getByText(/Results read per keyword: 16 to 17$/),
    ).toBeVisible();
    // A keyword of a check is tracked from the start: its list asks for nothing and explains no button.
    // What a click on "Track" gives stands on the Ideas list alone, where the rows carry the button.
    expect(screen.getAllByText(/Track one to see/)).toHaveLength(1);
    // The market shows once, in the result line, not once per row.
    expect(screen.getAllByText(/^United States · English/)).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        name: "12 keyword ideas",
      }),
    ).toBeVisible();
    expect(screen.getByText("idea 9")).toBeVisible();
    expect(screen.queryByText("idea 10")).toBeNull();
    expect(screen.getAllByText("From competitors")).toHaveLength(5);
    const more = screen.getByRole("button", { name: "Show 2 more ideas" });
    await user.click(more);
    expect(screen.getByText("idea 11")).toBeVisible();
    // The same button stays, so the keyboard focus stays.
    expect(screen.getByRole("button", { name: "Show less" })).toHaveFocus();
  });

  it("shows the reason of an idea only when it tells the ideas in view apart", () => {
    const { workspace } = savedKeywordWorkspace();
    const idea = (
      index: number,
      source: "gap" | "opportunity",
    ): ProjectSeoWorkspace["keywords"][number] => ({
      ...workspace.keywords[0],
      id: `idea-${index}`,
      keyword: `idea ${index}`,
      saved: false,
      version: 0,
      source,
      countryCode: "US",
      languageCode: "en",
      positionStatus: "unavailable",
      device: null,
      checkedResults: null,
      volume: 100 - index,
    });
    workspace.keywords = [idea(0, "opportunity"), idea(1, "opportunity")];
    const { unmount } = renderWorkspace(workspace);
    expect(screen.getByText("idea 1")).toBeVisible();
    expect(
      screen.queryByRole("columnheader", { name: "Why it is listed" }),
    ).toBeNull();
    expect(screen.queryByText("Related search")).toBeNull();
    unmount();
    workspace.keywords[1] = idea(1, "gap");
    renderWorkspace(workspace);
    expect(
      screen.getByRole("columnheader", { name: "Why it is listed" }),
    ).toBeVisible();
    expect(screen.getByText("From competitors")).toBeVisible();
    expect(screen.getByText("Related search")).toBeVisible();
  });

  it("shows the conversion estimate and its feature in the lists that have one, with the note that it is an estimate", () => {
    const { workspace } = savedKeywordWorkspace();
    const base = {
      ...workspace.keywords[0],
      saved: false,
      version: 0,
      countryCode: "US",
      languageCode: "en",
    };
    workspace.keywords = [
      { ...base, id: "read", keyword: "battery app", source: "focus" },
      {
        ...base,
        id: "alerts",
        keyword: "low battery alert",
        source: "opportunity",
        volume: 50,
        conversion: "high",
        feature: "Low battery alerts",
      },
      {
        ...base,
        id: "gap",
        keyword: "battery widget",
        source: "gap",
        volume: 900,
      },
    ];
    renderWorkspace(workspace);
    // Only the Ideas list has an estimate: the Keywords list gets no column of "Not available".
    expect(
      screen.getAllByRole("columnheader", { name: "Chance to convert" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByText(/^Chance to convert is the check's/),
    ).toHaveLength(1);
    const ideas = screen
      .getByRole("heading", { name: "2 keyword ideas" })
      .closest("section");
    if (!ideas) throw new Error("no Ideas section");
    const [, first, second] = within(ideas).getAllByRole("row");
    // The estimate leads, not the searches.
    expect(within(first).getByText("low battery alert")).toBeVisible();
    expect(within(first).getByText("High")).toBeVisible();
    // The feature names itself: "High 80% charge limit" would read as one value.
    expect(first).toHaveTextContent("Feature: Low battery alerts");
    expect(within(second).getByText("battery widget")).toBeVisible();
    expect(within(second).getByText("Not available")).toBeVisible();
  });

  it("shows the estimate of a checked keyword, and its daily positions still span every column", async () => {
    const user = userEvent.setup();
    const workspace = searchQueryWorkspace();
    if (!workspace.searchQueries) throw new Error("fixture");
    workspace.searchQueries.keywordSeries = {
      rowLimit: 10_000,
      truncated: false,
      keywords: [
        {
          keyword: "stablecoins",
          points: [
            { date: "2026-10-01", clicks: 1, impressions: 6, position: 3.2 },
          ],
        },
      ],
    };
    workspace.keywords[0] = {
      ...workspace.keywords[0],
      conversion: "medium",
      feature: "Yield tracker",
    };
    renderWorkspace(workspace);
    const header = screen.getByRole("columnheader", {
      name: "Chance to convert",
    });
    const table = header.closest("table");
    if (!table) throw new Error("no Keywords table");
    const row = within(table).getByText("Stablecoins").closest("tr");
    if (!row) throw new Error("no keyword row");
    expect(within(row).getByText("Medium")).toBeVisible();
    expect(row).toHaveTextContent("Feature: Yield tracker");
    await user.click(screen.getByRole("button", { name: "Daily positions" }));
    const chart = screen
      .getByRole("group", { name: "Average position for “Stablecoins”" })
      .closest("td");
    expect(chart).toHaveAttribute(
      "colspan",
      // The chart holds a table of its own: count the header cells of this table only.
      String(table.querySelectorAll(":scope > thead th").length),
    );
  });

  it("shows no conversion column for a check without an estimate", () => {
    const { workspace } = savedKeywordWorkspace();
    workspace.keywords = [
      {
        ...workspace.keywords[0],
        id: "gap",
        saved: false,
        version: 0,
        source: "gap",
      },
    ];
    renderWorkspace(workspace);
    expect(
      screen.getByRole("heading", { name: "1 keyword idea" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("columnheader", { name: "Chance to convert" }),
    ).toBeNull();
    expect(screen.queryByText(/^Chance to convert is the check's/)).toBeNull();
  });

  it("dates a row from an older check and names an idea's market when the markets differ", () => {
    const { workspace } = savedKeywordWorkspace();
    const [saved] = workspace.keywords;
    const read = {
      ...saved,
      saved: false,
      version: 0,
      source: "focus",
      countryCode: "US",
      languageCode: "en",
      device: "mobile",
      positionStatus: "ranked",
    } as const;
    const idea = {
      ...read,
      keyword: "battery widget",
      source: "gap",
      device: null,
      position: null,
      positionStatus: "unavailable",
    } as const;
    workspace.keywords = [
      {
        ...read,
        id: "new",
        keyword: "new read",
        position: 2,
        observedAt: new Date("2026-11-10T12:00:00Z"),
        observationId: "0d4c7f0e-58a5-4f3a-9d43-0c7f3a1b2c01",
      },
      {
        ...read,
        id: "old",
        keyword: "old read",
        position: 5,
        observedAt: new Date("2026-09-01T12:00:00Z"),
        observationId: "0d4c7f0e-58a5-4f3a-9d43-0c7f3a1b2c02",
      },
      { ...idea, id: "idea-us" },
      { ...idea, id: "idea-de", countryCode: "DE", languageCode: "de" },
    ];
    renderWorkspace(workspace);
    const row = (keyword: string) =>
      within(screen.getByText(keyword).closest("tr") as HTMLElement);
    // The result line carries the newest date; only the older row repeats its own.
    expect(row("old read").getByText(/^Last checked:/)).toBeVisible();
    expect(row("new read").queryByText(/^Last checked:/)).toBeNull();
    expect(screen.getByText("Germany · German")).toBeVisible();
    // Two checked rows and one idea name the other market.
    expect(screen.getAllByText("United States · English")).toHaveLength(3);
  });

  it("does not ask for a check above the ideas a check already found", () => {
    const { workspace } = savedKeywordWorkspace();
    workspace.keywords = [
      {
        ...workspace.keywords[0],
        keyword: "battery widget",
        saved: false,
        version: 0,
        source: "gap",
      },
    ];
    renderWorkspace(workspace);
    expect(
      screen.getByRole("heading", {
        name: "1 keyword idea",
      }),
    ).toBeVisible();
    expect(screen.queryByText("No tracked keywords yet")).toBeNull();
  });

  it("counts keywords, not device rows, and says when a read failed", () => {
    const { workspace } = savedKeywordWorkspace();
    const [saved] = workspace.keywords;
    // Five keywords on two devices: ten rows from Core, five rows in the list.
    workspace.keywords = Array.from({ length: 10 }, (_, index) => ({
      ...saved,
      id: `row-${index}`,
      keyword: `focus ${index % 5}`,
      saved: false,
      version: 0,
      source: "focus",
      device: index < 5 ? ("mobile" as const) : ("desktop" as const),
    }));
    renderWorkspace(workspace);
    expect(screen.getAllByText("No position read")).toHaveLength(5);
    expect(screen.queryByText("Not checked yet")).toBeNull();
    // Too few keywords for a search field.
    expect(document.getElementById("seo-keyword-search")).toBeNull();
  });

  it("shows the ten best checked keywords first and the rest on request", async () => {
    const user = userEvent.setup();
    const { workspace } = savedKeywordWorkspace();
    const [saved] = workspace.keywords;
    workspace.keywords = Array.from({ length: 21 }, (_, index) => ({
      ...saved,
      id: `read-${index}`,
      keyword: `read ${index}`,
      saved: false,
      version: 0,
      source: "focus",
      device: "mobile",
      position: index + 1,
      positionStatus: "ranked",
      checkedResults: 20,
      observedAt: new Date("2026-11-11T00:26:00Z"),
    }));
    renderWorkspace(workspace);
    expect(screen.getByText("read 9")).toBeVisible();
    expect(screen.queryByText("read 10")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Show 11 more keywords" }),
    );
    expect(screen.getByText("read 10")).toBeVisible();
    // A search narrows the rows; the result line still speaks for every keyword.
    const search = document.getElementById("seo-keyword-search");
    if (!search) throw new Error("Keyword search missing");
    await user.type(search, "read 10");
    expect(screen.queryByText("read 9")).toBeNull();
    expect(
      screen.getByText("In Google's top results for 21 of 21 checked keywords"),
    ).toBeVisible();
    // A search without a match says so; it does not ask for a first check.
    await user.clear(search);
    await user.type(search, "nothing");
    expect(
      screen.getByText("No tracked or checked keyword matches this search"),
    ).toBeVisible();
    expect(screen.queryByText("No tracked keywords yet")).toBeNull();
  });
});

describe("Search Console queries", () => {
  it("sorts by impressions first and by best position after a header click", async () => {
    const user = userEvent.setup();
    renderWorkspace(searchQueryWorkspace());
    // Tracked keywords share the column names; check the query table only.
    const queries = () =>
      within(
        screen
          .getByRole("columnheader", { name: "Query" })
          .closest("table") as HTMLElement,
      );
    expect(queryOrder()).toEqual(["usdc", "stablecoins", "usdt"]);
    expect(
      queries().getByRole("columnheader", { name: "Search impressions" }),
    ).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: "Average position" }));
    expect(queryOrder()).toEqual(["usdt", "stablecoins", "usdc"]);
    expect(
      queries().getByRole("columnheader", { name: "Average position" }),
    ).toHaveAttribute("aria-sort", "ascending");
    expect(
      queries().getByRole("columnheader", { name: "Search impressions" }),
    ).not.toHaveAttribute("aria-sort");
  });

  it("opens a tracked keyword's daily positions under its row", async () => {
    const user = userEvent.setup();
    const workspace = searchQueryWorkspace();
    if (!workspace.searchQueries) throw new Error("fixture");
    workspace.searchQueries.keywordSeries = {
      rowLimit: 10_000,
      truncated: false,
      keywords: [
        {
          keyword: "stablecoins",
          points: [
            { date: "2026-10-01", clicks: 1, impressions: 6, position: 3.2 },
          ],
        },
        // The sync read it and Search Console had no impressions.
        { keyword: "frax", points: [] },
      ],
    };
    workspace.keywords.push(
      {
        ...workspace.keywords[0],
        id: "later-keyword",
        keyword: "usdt",
      },
      // Tracked from their check, with no choice of the reader: one the sync did not read, one it read empty.
      {
        ...workspace.keywords[0],
        id: "check-keyword",
        keyword: "dai",
        version: 0,
      },
      {
        ...workspace.keywords[0],
        id: "check-keyword-empty",
        keyword: "frax",
        version: 0,
        positionStatus: "ranked",
        position: 4,
      },
    );
    renderWorkspace(workspace);
    expect(
      screen.queryByText("No Search Console impressions in any country"),
    ).toBeNull();
    // A keyword the reader chose says that the last sync did not read it. A keyword tracked from its
    // check says nothing: the same line on every row of a check would be noise.
    expect(screen.getAllByText(/^Not read in the last sync\./)).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "Daily positions" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("group", { name: "Average position for “Stablecoins”" }),
    ).toBeVisible();
  });

  it("says once that a tracked keyword had no impressions in the daily read", () => {
    const workspace = searchQueryWorkspace();
    if (!workspace.searchQueries) throw new Error("fixture");
    workspace.searchQueries.keywordSeries = {
      rowLimit: 10_000,
      truncated: false,
      keywords: [
        { keyword: "stablecoin yield", points: [] },
        { keyword: "stablecoin rate", points: [] },
      ],
    };
    workspace.keywords.push({
      ...workspace.keywords[0],
      id: "later-keyword",
      keyword: "stablecoin yield",
    });
    // A ranked keyword keeps its rank in the cell; the line under it says the daily read was empty.
    workspace.keywords.push({
      ...workspace.keywords[0],
      id: "ranked-keyword",
      keyword: "stablecoin rate",
      positionStatus: "ranked",
      position: 4,
    });
    // Not among the listed queries, so the daily read is the only word on it.
    renderWorkspace(workspace);
    const table = screen
      .getByRole("columnheader", { name: "Keyword" })
      .closest("table");
    const row = within(table!).getByText("stablecoin yield").closest("tr");
    expect(
      within(row!).getAllByText("No Search Console impressions in any country"),
    ).toHaveLength(1);
    expect(within(row!).queryByText("Not in Search Console's list")).toBeNull();
    expect(
      within(row!).queryByRole("button", { name: "Daily positions" }),
    ).toBeNull();
    const ranked = within(table!).getByText("stablecoin rate").closest("tr");
    expect(within(ranked!).getByText("4")).toBeVisible();
    expect(
      within(ranked!).getAllByText(
        "No Search Console impressions in any country",
      ),
    ).toHaveLength(1);
  });

  it("names the queries' sync only when it differs from the saved Search Console totals", () => {
    // Same sync as the Search Console totals: their card above names the period and sync.
    const view = renderWorkspace(searchQueryWorkspace());
    expect(screen.queryByText(/Last synced/)).toBeNull();
    view.unmount();
    // Queries from an older sync say when they were read.
    const older = searchQueryWorkspace();
    if (!older.searchQueries) throw new Error("fixture");
    older.searchQueries.observedAt = new Date("2026-10-20T12:00:00.000Z");
    const olderView = renderWorkspace(older);
    expect(screen.getByText(/Last synced/)).toBeVisible();
    olderView.unmount();
    // The same sync over another window names its own period.
    const otherWindow = searchQueryWorkspace();
    if (!otherWindow.searchQueries) throw new Error("fixture");
    otherWindow.searchQueries.from = "2026-09-01";
    renderWorkspace(otherWindow);
    expect(screen.getByText(/Last synced/)).toBeVisible();
  });

  it("names the impressions Google listed under no query", () => {
    renderWorkspace(searchQueryWorkspace());
    expect(
      screen.getByText(
        /Google shows the search words for only 40 of your 100 impressions/,
      ),
    ).toBeVisible();
  });

  it("shows the Search Console average for a tracked keyword without a measured position", () => {
    renderWorkspace(searchQueryWorkspace());
    const table = screen
      .getByRole("columnheader", { name: "Keyword" })
      .closest("table");
    const row = within(table!).getByText("Stablecoins").closest("tr");
    expect(within(row!).getByText("3.0 avg. · 12 impressions")).toBeVisible();
    expect(within(row!).getByText(/Search Console average/)).toBeVisible();
    expect(within(row!).queryByText("Not measured")).toBeNull();
    expect(
      within(row!).queryByText("Not among Google's listed searches"),
    ).toBeNull();
  });

  it("shows no Position column where no keyword is found, and dates a row of an older check under its name", () => {
    const { workspace } = savedKeywordWorkspace();
    const missed = (
      patch: Partial<ProjectSeoWorkspace["keywords"][number]>,
    ): ProjectSeoWorkspace["keywords"][number] => ({
      ...workspace.keywords[0],
      saved: false,
      version: 0,
      source: "focus",
      countryCode: "US",
      languageCode: "en",
      device: "desktop",
      position: null,
      positionStatus: "not_in_range",
      checkedResults: 17,
      observedAt: new Date("2026-11-11T00:26:00Z"),
      ...patch,
    });
    workspace.keywords = [
      missed({ id: "new", keyword: "battery app" }),
      missed({
        id: "old",
        keyword: "charge timer",
        observedAt: new Date("2026-10-11T00:26:00Z"),
        observationId: "6d0c7a1e-7f0d-4a53-9f58-7d1f4f0f6a11",
      }),
    ];
    const { unmount } = renderWorkspace(workspace);
    // The result line says once that no keyword is found: a column of "Not found" repeats it on every row.
    expect(screen.queryByRole("columnheader", { name: "Position" })).toBeNull();
    expect(screen.queryByText("Not found")).toBeNull();
    // The result line dates the newest check only: the row of the older check carries its own date.
    expect(screen.getByText("charge timer").closest("td")).toHaveTextContent(
      "Last checked: Oct 11, 2026",
    );
    // The day alone: the minute of an older read is no fact of the row.
    expect(
      screen.getByText("charge timer").closest("td"),
    ).not.toHaveTextContent(/Last checked: Oct 11, 2026,/);
    expect(screen.getByText("battery app").closest("td")).not.toHaveTextContent(
      "Last checked",
    );
    unmount();
    // A read without a depth gives no depth sentence; the result line still says that no keyword is found.
    workspace.keywords = [
      missed({ id: "new", keyword: "battery app", checkedResults: null }),
    ];
    renderWorkspace(workspace);
    expect(screen.queryByRole("columnheader", { name: "Position" })).toBeNull();
    expect(screen.queryByText(/the check read the first/)).toBeNull();
    expect(
      screen.getByText("In Google's top results for 0 of 1 checked keyword"),
    ).toBeVisible();
    cleanup();
    // The tracking sentence stands over rows with a Track button: without a row it has no place.
    workspace.keywords = [];
    renderWorkspace(workspace);
    expect(screen.getByRole("heading", { name: "Keywords" })).toBeVisible();
    expect(screen.queryByText(/Track one to see/)).toBeNull();
    cleanup();
    // It names the next position check too: it has no place where no position check can run.
    // The Ideas list follows the same rule.
    workspace.keywords = [
      missed({ id: "new", keyword: "battery app", checkedResults: null }),
      missed({
        id: "gap",
        keyword: "battery widget",
        source: "gap",
        positionStatus: "unavailable",
        device: null,
        checkedResults: null,
      }),
    ];
    workspace.availableActions = {
      ...workspace.availableActions,
      canUsePaidSearchData: false,
    };
    renderWorkspace(workspace);
    expect(screen.getByText("battery app")).toBeVisible();
    expect(screen.queryByText(/Track one to see/)).toBeNull();
    cleanup();
    // A reader who cannot edit has no Track button, so no sentence about it.
    workspace.availableActions = {
      ...workspace.availableActions,
      canUsePaidSearchData: true,
      canEdit: false,
    };
    renderWorkspace(workspace);
    expect(screen.getByText("battery app")).toBeVisible();
    expect(screen.queryByText(/Track one to see/)).toBeNull();
  });
});
