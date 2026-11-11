import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
    expect(headers).not.toContain("Rank");
    expect(headers).not.toContain("Referring domains");
    expect(screen.getByRole("cell", { name: "12" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Not measured for these rows yet: Rank, Referring domains, and Last checked.",
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
      expect(
        within(own!).getByText("Backlinks: 10 · Referring domains: 4"),
      ).toBeVisible();
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
    expect(screen.getByText("https://rival-11.example/")).toBeVisible();
    expect(screen.getByText("https://rival-8.example/")).toBeVisible();
    expect(screen.queryByText("https://rival-9.example/")).toBeNull();
    expect(
      screen.getByRole("columnheader", { name: "Backlinks" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show 2 more pages" }));
    expect(screen.getByText("https://rival-10.example/")).toBeVisible();
    expect(screen.getByRole("button", { name: "Show less" })).toHaveFocus();
    // A search with no match does not say that there are no competitors.
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "zzz");
    expect(screen.getByText("No competitor matches this search")).toBeVisible();
    expect(screen.queryByText("No competitors yet")).toBeNull();
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
    // Confirmed is the default row; a badge would repeat on every row.
    expect(screen.getByText("https://competitor.example/")).toBeVisible();
    expect(screen.queryByText("Confirmed competitor")).toBeNull();
    expect(screen.queryByText("From the search results")).toBeNull();
    // The address may wrap after "." or "/", never inside "//"; its name stays whole.
    const link = screen.getByRole("link", {
      name: "https://competitor.example/",
    });
    expect(link.querySelectorAll("wbr")).toHaveLength(2);
    expect(link.innerHTML).not.toContain("/<wbr>/");
    expect(link.innerHTML).toContain("competitor.<wbr>example/");
  });
});
