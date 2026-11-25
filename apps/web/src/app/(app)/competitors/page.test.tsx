import type { ProjectCompetitors } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { loadCompetitorsPage } from "./competitors-page-data";
import CompetitorsPage from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("./competitors-page-data", () => ({ loadCompetitorsPage: vi.fn() }));
vi.mock("@/app/components/workspace-page-shell", () => ({
  WorkspacePageShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/components/cmo-project-banner", () => ({
  CmoProjectBanner: () => null,
}));
vi.mock("./components/competitors-check-bar", () => ({
  CompetitorsCheckBar: () => <section aria-label="CompetitorsCheckBar" />,
}));
vi.mock("./components/competitors-findings", () => ({
  CompetitorsFindings: () => <section aria-label="CompetitorsFindings" />,
}));
vi.mock("./components/competitors-scoreboard", () => ({
  CompetitorsScoreboard: () => <section aria-label="CompetitorsScoreboard" />,
}));
vi.mock("./components/competitors-this-week", () => ({
  CompetitorsThisWeek: () => <section aria-label="CompetitorsThisWeek" />,
}));
vi.mock("./components/competitors-watch-list", () => ({
  CompetitorsWatchList: () => <section aria-label="CompetitorsWatchList" />,
}));

const source = { status: "ok" as const, needs: null };
const COMPETITORS = {
  competitors: [{ id: "c1", name: "Acme Roasters" }],
  limit: 5,
  signals: [],
  feed: null,
  scoreboard: [],
  check: {
    on: false,
    lastCheckedAt: null,
    nextCheckAt: null,
    creditsPerCompetitor: 3,
    sources: { pages: source, news: source, ads: source, social: source },
  },
} as unknown as ProjectCompetitors;

async function page(competitors: Partial<ProjectCompetitors> = {}) {
  vi.mocked(loadCompetitorsPage).mockResolvedValue({
    project: { id: "p1", name: "Ada Coffee", cmo: false },
    competitors: { ...COMPETITORS, ...competitors },
  } as never);
  render(
    await CompetitorsPage({
      searchParams: Promise.resolve({ projectId: "p1" }),
    }),
  );
  return screen
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-label"));
}

describe("CompetitorsPage", () => {
  it("puts Watching before the example while the check is off and found nothing", async () => {
    expect(await page()).toEqual([
      "CompetitorsCheckBar",
      "CompetitorsWatchList",
      "CompetitorsThisWeek",
      "CompetitorsFindings",
      "CompetitorsScoreboard",
    ]);
  });

  it("keeps real findings ahead of Watching", async () => {
    const order = await page({
      signals: [{ id: "s1", kind: "NEWS" }] as ProjectCompetitors["signals"],
    });
    expect(order.indexOf("CompetitorsFindings")).toBeLessThan(
      order.indexOf("CompetitorsWatchList"),
    );
  });

  it("keeps findings first once a check ran or while it is on", async () => {
    for (const check of [
      { ...COMPETITORS.check, lastCheckedAt: new Date() },
      { ...COMPETITORS.check, on: true },
    ] as ProjectCompetitors["check"][]) {
      document.body.innerHTML = "";
      const order = await page({ check });
      expect(order.indexOf("CompetitorsFindings")).toBeLessThan(
        order.indexOf("CompetitorsWatchList"),
      );
    }
  });
});
