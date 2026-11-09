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
