import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import enMessages from "../../../../../messages/en.json";
import { SeoEditDialog } from "./seo-edit-dialog";
import { SeoKeywords } from "./seo-keywords";
import { SeoSearchQueries } from "./seo-search-queries";
import { seoTestWorkspace } from "./seo-test-fixture";
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
      <SeoKeywords model={model} />
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
    await user.click(screen.getByRole("button", { name: "Stop tracking" }));
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
    await user.click(screen.getByRole("button", { name: "Stop tracking" }));
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
    for (const index of Array.from({ length: 10 }, (_, i) => i))
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
      screen.getByPlaceholderText("Filter queries and keywords"),
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
    await user.click(screen.getByRole("button", { name: "Edit" }));
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
      screen.getByText("Found in Google's results for 0 of 1 checked keyword"),
    ).toBeVisible();
    expect(screen.getAllByText("battery app")).toHaveLength(1);
    // One line for both devices, with the depth that holds for both.
    expect(screen.getByText("Not in the first 16 results")).toBeVisible();
    // The market shows once, in the result line, not once per row.
    expect(screen.getAllByText("United States · English")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Keyword ideas (12)" }),
    ).toBeVisible();
    expect(screen.getByText("idea 9")).toBeVisible();
    expect(screen.queryByText("idea 10")).toBeNull();
    expect(screen.getAllByText("Competitors rank for it")).toHaveLength(5);
    const more = screen.getByRole("button", { name: "Show 2 more keywords" });
    await user.click(more);
    expect(screen.getByText("idea 11")).toBeVisible();
    // The same button stays, so the keyboard focus stays.
    expect(screen.getByRole("button", { name: "Show less" })).toHaveFocus();
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
      screen.getByRole("heading", { name: "Keyword ideas (1)" }),
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
    workspace.keywords = Array.from({ length: 11 }, (_, index) => ({
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
      screen.getByRole("button", { name: "Show 1 more keyword" }),
    );
    expect(screen.getByText("read 10")).toBeVisible();
    // A search narrows the rows; the result line still speaks for every keyword.
    const search = document.getElementById("seo-keyword-search");
    if (!search) throw new Error("Keyword search missing");
    await user.type(search, "read 10");
    expect(screen.queryByText("read 9")).toBeNull();
    expect(
      screen.getByText(
        "Found in Google's results for 11 of 11 checked keywords",
      ),
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
      ],
    };
    workspace.keywords.push({
      ...workspace.keywords[0],
      id: "later-keyword",
      keyword: "usdt",
    });
    renderWorkspace(workspace);
    // A keyword the last sync did not read says so.
    expect(screen.getByText(/^Not read in the last sync\./)).toBeVisible();
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
});
