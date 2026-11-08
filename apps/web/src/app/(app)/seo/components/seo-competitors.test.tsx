import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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
    expect(headers).not.toContain("Observed rank");
    expect(headers).not.toContain("Referring domains");
    expect(screen.getByRole("cell", { name: "12" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Not measured for these rows yet: Observed rank, Referring domains, and Last checked.",
      ),
    ).toBeInTheDocument();
  });

  it.each([false, true])(
    "labels the audited page truthfully and keeps its backlink baseline without competitor controls (confirmed=%s)",
    async (confirmed) => {
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
      ];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(workspace)),
      );
      renderWorkspace(workspace);
      const ownLink = screen.getByRole("link", { name: page.url });
      const ownRow = ownLink.closest("tr");
      expect(ownRow).not.toBeNull();
      expect(within(ownRow!).getByText("Your page")).toBeVisible();
      expect(within(ownRow!).getByText("10")).toBeVisible();
      expect(within(ownRow!).getByText("4")).toBeVisible();
      expect(within(ownRow!).queryByRole("button")).toBeNull();
      expect(screen.getAllByText("Suggested competing page")).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: "Confirm competitor" }),
      ).toBeVisible();
    },
  );
});
