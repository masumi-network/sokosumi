import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoCompetitors } from "./seo-competitors";
import { seoTestWorkspace } from "./seo-test-fixture";
import { useSeoWorkspace } from "./use-seo-workspace";

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { session: { activeOrganizationId: "org" }, user: { id: "owner" } },
  }),
}));

const clients: QueryClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

function CompetitorWorkspace({
  workspace,
}: {
  workspace: ProjectSeoWorkspace;
}) {
  return <SeoCompetitors model={useSeoWorkspace(workspace)} />;
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
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter hasMemory>
          <CompetitorWorkspace workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SEO competitor baselines", () => {
  it("hides a column no row measured and names it, but keeps a measured column", () => {
    const workspace = seoTestWorkspace();
    workspace.competitors = [
      {
        id: "saved-competitor",
        url: "https://competitor.example/",
        role: "competitor",
        confirmed: true,
        source: "saved",
        rank: null,
        backlinks: 12,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: 1,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    renderWorkspace(workspace);
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toContain("Backlinks");
    expect(headers).not.toContain("Best position");
    expect(headers).not.toContain("Linking sites");
    expect(screen.getByRole("cell", { name: "12" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Not measured for these rows yet: Best position and Linking sites.",
      ),
    ).toBeInTheDocument();
  });

  it.each([false, true])(
    "labels the audited page truthfully and keeps its backlink baseline without competitor controls (confirmed=%s)",
    async (confirmed) => {
      const user = userEvent.setup();
      const workspace = seoTestWorkspace();
      const page = {
        id: "page-baseline",
        url: workspace.pages[0].url,
        role: "page" as const,
        confirmed,
        source: "backlinks",
        rank: null,
        backlinks: 10,
        referringDomains: 4,
        observedAt: new Date("2026-11-01T12:00:00Z"),
        observationId: null,
        version: confirmed ? 2 : 0,
        canConfirm: false,
        exclusionReason: null,
      };
      workspace.competitors = [
        page,
        {
          ...page,
          id: "search-competitor",
          url: "https://competitor.example/",
          role: "competitor",
          confirmed: false,
          source: "search",
          rank: 3,
          backlinks: 20,
          referringDomains: 8,
          version: 0,
          canConfirm: true,
        },
        // Added by the reader, then no longer tracked: no check found it.
        {
          ...page,
          id: "stopped",
          url: "https://stopped.example/",
          role: "competitor",
          confirmed: false,
          source: "saved",
          backlinks: null,
          referringDomains: null,
          version: 2,
          canConfirm: true,
        },
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      // The audited page is no competitor: it sits above the table, with its numbers and no controls.
      const ownLink = screen.getByRole("link", { name: page.url });
      expect(ownLink.closest("tr")).toBeNull();
      const own = ownLink.closest("dl");
      expect(own).not.toBeNull();
      expect(within(own!).getByText("Your page")).toBeVisible();
      expect(within(own!).getByText("4 linking sites")).toBeVisible();
      expect(within(own!).queryByRole("button")).toBeNull();
      expect(screen.getAllByText("From the search results")).toHaveLength(1);
      // One menu per competitor row holds its actions.
      await user.click(
        screen.getByRole("button", {
          name: "Actions for https://competitor.example/",
        }),
      );
      expect(
        screen.getByRole("menuitem", { name: "Confirm competitor" }),
      ).toBeVisible();
    },
  );

  it("shows only the measured numbers of the reader's page, and no line for backlinks no check reads", () => {
    const workspace = seoTestWorkspace();
    const page = {
      id: "page-baseline",
      url: workspace.pages[0].url,
      role: "page" as const,
      confirmed: false,
      source: "backlinks",
      rank: null,
      backlinks: null,
      referringDomains: 4,
      observedAt: new Date("2026-11-01T12:00:00Z"),
      observationId: null,
      version: 0,
      canConfirm: false,
      exclusionReason: null,
    };
    workspace.competitors = [
      page,
      {
        ...page,
        id: "search-competitor",
        url: "https://competitor.example/",
        role: "competitor",
        source: "search",
        rank: 3,
        referringDomains: 8,
        canConfirm: true,
      },
    ];
    renderWorkspace(workspace);
    const own = screen
      .getByRole("link", { name: page.url })
      .closest("dd") as HTMLElement;
    expect(within(own).getByText("4 linking sites")).toBeVisible();
    expect(own).not.toHaveTextContent("Backlinks");
    // Position and linking sites are measured; a competitor row never has a backlink count.
    expect(screen.queryByText(/^Not measured for these rows yet/)).toBeNull();
  });

  it("says that paid data is off where only the backlink column is missing", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions = {
      ...workspace.availableActions,
      canUsePaidSearchData: false,
    };
    workspace.competitors = [
      {
        id: "search-competitor",
        url: "https://competitor.example/",
        role: "competitor",
        confirmed: false,
        source: "search",
        rank: 3,
        backlinks: null,
        referringDomains: 8,
        observedAt: new Date("2026-11-01T12:00:00Z"),
        observationId: null,
        version: 0,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    renderWorkspace(workspace);
    expect(
      screen.getByText(
        "Rank and backlink numbers need paid search data, which is off in this workspace.",
      ),
    ).toBeVisible();
  });

  it("shows the first ten pages of a long list and the rest on request", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.competitors = Array.from({ length: 12 }, (_, index) => ({
      id: `competitor-${index}`,
      url: `https://rival-${index}.example/`,
      role: "competitor" as const,
      // Core lists a competitor the reader just added last.
      confirmed: index === 11,
      source: "search",
      // Only a row past the first ten has backlinks: its column still shows.
      rank: index + 1,
      backlinks: index === 11 ? 40 : null,
      referringDomains: null,
      observedAt: null,
      observationId: null,
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    }));
    renderWorkspace(workspace);
    // The chosen competitor leads, so it never hides behind "Show more".
    expect(screen.getByText("rival-11.example")).toBeVisible();
    expect(screen.getByText("rival-8.example")).toBeVisible();
    expect(screen.queryByText("rival-9.example")).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Backlinks" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show 2 more sites" }));
    expect(screen.getByText("rival-10.example")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show less" })).toHaveFocus();
    // A search with no match does not say that there are no competitors.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "zzz");
    // No site matches now: the box stays, with the text in it.
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue(
      "zzz",
    );
    expect(screen.getByText("No competitor matches this search")).toBeVisible();
    expect(screen.queryByText("No competitors yet")).toBeNull();
  });

  it("keeps the date of the check over the list while a search matches no site", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    workspace.competitors = Array.from({ length: 12 }, (_, index) => ({
      id: `competitor-${index}`,
      url: `https://rival-${index}.example/`,
      role: "competitor" as const,
      confirmed: false,
      source: "search",
      rank: index + 1,
      backlinks: null,
      referringDomains: null,
      observedAt: new Date("2026-11-11T01:26:00Z"),
      observationId: "check",
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    }));
    renderWorkspace(workspace);
    expect(screen.getByText(/^Last position check$/)).toBeVisible();
    // The line stands over the search field: if it left with the rows, the field would move under the reader's text.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "zzz");
    expect(screen.getByText("No competitor matches this search")).toBeVisible();
    expect(screen.getByText(/^Last position check$/)).toBeVisible();
  });

  it("leaves the actions cell empty when a row has no button", () => {
    const workspace = seoTestWorkspace();
    workspace.availableActions.canEdit = false;
    workspace.auditId = null;
    workspace.competitors = [
      {
        id: "read-only-competitor",
        url: "https://competitor.example/",
        role: "competitor",
        confirmed: true,
        source: "saved",
        rank: null,
        backlinks: null,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: 1,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    const row = screen
      .getByRole("link", { name: "https://competitor.example/" })
      .closest("tr");
    // An empty cell is hidden on a phone; a wrapper would add a blank row.
    expect(row?.lastElementChild).toBeEmptyDOMElement();
  });

  it("shows no badge on a confirmed competitor", () => {
    const workspace = seoTestWorkspace();
    workspace.competitors = [
      {
        id: "saved-competitor",
        url: "https://competitor.example/guides/keep-it.plugged",
        role: "competitor",
        confirmed: true,
        source: "saved",
        rank: null,
        backlinks: null,
        referringDomains: null,
        observedAt: null,
        observationId: null,
        version: 1,
        canConfirm: true,
        exclusionReason: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(workspace)),
    );
    renderWorkspace(workspace);
    // Confirmed is the default row; a badge would repeat on every row.
    expect(screen.getByText("competitor.example")).toBeVisible();
    expect(screen.queryByText("Confirmed competitor")).toBeNull();
    expect(screen.queryByText("From the search results")).toBeNull();
    // The site is the row's first line, so the page under it shows as its path; the link's name stays the whole address.
    const link = screen.getByRole("link", {
      name: "https://competitor.example/guides/keep-it.plugged",
    });
    expect(link).toHaveTextContent(/^\/guides\/keep-it\.plugged$/);
    // The path may wrap after "." or "/".
    expect(link.innerHTML).toContain("guides/<wbr>");
    expect(link.innerHTML).toContain("keep-it.<wbr>plugged");
  });

  it("shows one row per site, and video sites and forums apart", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const found = (url: string, rank: number, referringDomains: number) => ({
      id: url,
      url,
      role: "competitor" as const,
      confirmed: false,
      source: "search",
      rank,
      backlinks: null,
      referringDomains,
      observedAt: new Date("2026-11-11T01:26:00Z"),
      observationId: "check",
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    });
    workspace.competitors = [
      found("https://rival.example/a", 2, 48),
      found("https://www.youtube.com/watch?v=1", 1, 900),
      found("https://rival.example/b", 5, 37),
      found("https://other.example/", 3, 12),
    ];
    renderWorkspace(workspace);
    // Two sites, not four pages; the best place of the site, and the page that holds it.
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("rival.example")).toBeVisible();
    expect(within(rows[0]).getByRole("cell", { name: "2" })).toBeVisible();
    expect(
      within(rows[0]).getByRole("link", { name: "https://rival.example/a" }),
    ).toBeVisible();
    // The other page of the site is one click away, with its own numbers.
    const more = within(rows[0]).getByText("1 more page of this site");
    const second = within(rows[0]).getByText("Position 5 · 37 linking sites");
    expect(second).not.toBeVisible();
    await user.click(more);
    expect(second).toBeVisible();
    // One check found every row: the line above says so once, and no row repeats it.
    expect(screen.getByText(/^Last position check$/)).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: "Source" })).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "Last checked" }),
    ).toBeNull();
    expect(screen.queryByText("From the search results")).toBeNull();
    // A video site holds a place in the results, but it is no rival: closed, under the list.
    const platform = screen.getByRole("link", {
      name: "https://www.youtube.com/watch?v=1",
    });
    expect(platform).not.toBeVisible();
    // A whole address may wrap after "." or "/", never inside "//".
    expect(platform.innerHTML).not.toContain("/<wbr>/");
    expect(platform.innerHTML).toContain("youtube.<wbr>com/");
    await user.click(screen.getByText("1 other site in the results"));
    expect(platform).toBeVisible();
    expect(screen.getByText("Position 1 · 900 linking sites")).toBeVisible();
    // Every site is in view, so there is nothing to filter: 12 pages of 2 sites show no filter box.
    workspace.competitors = Array.from({ length: 12 }, (_, index) =>
      found(`https://rival-${index % 2}.example/${index}`, index + 1, 1),
    );
    cleanup();
    renderWorkspace(workspace);
    expect(screen.getAllByRole("row").slice(1)).toHaveLength(2);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("marks a found site only in a list that also holds a chosen one", () => {
    const workspace = seoTestWorkspace();
    const row = {
      id: "found",
      url: "https://found.example/",
      role: "competitor" as const,
      confirmed: false,
      source: "search",
      rank: 3,
      backlinks: null,
      referringDomains: null,
      observedAt: null,
      observationId: "check",
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    };
    workspace.competitors = [
      row,
      { ...row, id: "chosen", url: "https://chosen.example/", confirmed: true },
    ];
    renderWorkspace(workspace);
    const rows = screen.getAllByRole("row").slice(1);
    // The chosen site leads and has no badge.
    expect(within(rows[0]).getByText("chosen.example")).toBeVisible();
    expect(within(rows[0]).queryByText("From the search results")).toBeNull();
    expect(within(rows[1]).getByText("From the search results")).toBeVisible();
    // The rows carry no date, so no line dates the check.
    expect(screen.queryByText(/^Last position check$/)).toBeNull();
  });

  it("dates each row when the rows come from several checks", () => {
    const workspace = seoTestWorkspace();
    const row = {
      id: "older",
      url: "https://older.example/",
      role: "competitor" as const,
      confirmed: false,
      source: "search",
      rank: 3,
      backlinks: null,
      referringDomains: null,
      observedAt: new Date("2026-01-03T12:00:00Z"),
      observationId: "first-check",
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    };
    workspace.competitors = [
      row,
      {
        ...row,
        id: "newer",
        url: "https://newer.example/",
        observedAt: new Date("2026-02-03T12:00:00Z"),
        observationId: "second-check",
      },
    ];
    renderWorkspace(workspace);
    // One line with one date would give the older check's rows the newer date.
    expect(screen.queryByText(/^Last position check$/)).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Last checked" }),
    ).toBeVisible();
  });

  it("keeps the results link of your page when another check found the competitors", () => {
    const workspace = seoTestWorkspace();
    const observedAt = new Date("2026-01-03T12:00:00Z");
    const observation = (
      id: string,
      sourceTaskId: string,
    ): ProjectSeoWorkspace["observations"][number] => ({
      id,
      kind: "audit_full",
      source: "seo_coworker",
      observedAt,
      pageIds: [],
      scopeVersion: 2,
      sourceTaskId,
      countryCode: "US",
      languageCode: "en",
      devices: ["desktop"],
      rulebookVersion: "v1",
      artifactHash: "hash",
      issues: 0,
      coverage: { checked: 0, skipped: 0, failed: 0 },
    });
    workspace.observations = [
      observation("check", "check-task"),
      observation("links-read", "links-task"),
    ];
    const row = {
      id: "found",
      url: "https://found.example/",
      role: "competitor" as const,
      confirmed: false,
      source: "search",
      rank: 3,
      backlinks: null,
      referringDomains: null,
      observedAt,
      observationId: "check",
      version: 0,
      canConfirm: true,
      exclusionReason: null,
    };
    workspace.competitors = [
      row,
      {
        ...row,
        id: "own",
        url: workspace.pages[0].url,
        role: "page",
        source: "backlinks",
        rank: null,
        backlinks: 10,
        referringDomains: 4,
        observationId: "links-read",
        canConfirm: false,
      },
      // A competitor the reader added comes from no check: the found rows still have one check.
      {
        ...row,
        id: "added",
        url: "https://added.example/",
        source: "saved",
        rank: null,
        observedAt: null,
        observationId: null,
      },
    ];
    renderWorkspace(workspace);
    // The line under the table names the competitors' check; the page's numbers come from another read.
    const own = screen
      .getByRole("link", { name: workspace.pages[0].url })
      .closest("dl");
    if (!own) throw new Error("Own page list missing");
    expect(
      within(own).getByRole("link", { name: "View results" }),
    ).toHaveAttribute("href", "/tasks/links-task");
    // The date of the competitors' check is the link to its results.
    expect(
      screen.getByRole("link", { name: /^Last position check / }),
    ).toHaveAttribute("href", "/tasks/check-task");
  });
});
