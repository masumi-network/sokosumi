import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { screen, within } from "@testing-library/react";

/** Shows the fields of the check dialog, which opens on a summary of its defaults. */
export async function openCheckOptions(user: {
  click: (element: Element) => Promise<void>;
}) {
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Change options",
    }),
  );
}

/** Opens the generic statistics setup from the header's Manage menu. */
export async function openStatisticsSetup(user: {
  click: (element: Element) => Promise<void>;
}) {
  await user.click(screen.getByRole("button", { name: "Manage SEO" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "Set up statistics" }),
  );
}

export const SEO_TEST_PROJECT = "39d1c2a6-aade-4322-aed5-3f139a34b127";
export const SEO_TEST_AUDIT = "687d2470-7c63-4779-b10c-462d24ac1e1b";
export const SEO_TEST_PAGE = "2c32dca9-c44f-4372-9114-8c146d5eb30b";
export const SEO_TEST_SCOPE = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
/** One synced Search Console total: with it, the Traffic tab has rows a date can narrow. */
export function seoTestMetric(): ProjectSeoWorkspace["metrics"][number] {
  return {
    id: "sync:clicks",
    key: "clicks",
    label: "",
    unit: "count",
    source: "search_console",
    propertyId: "sc-domain:example.com",
    channel: "organic",
    from: "2026-01-01",
    to: "2026-01-02",
    timeZone: "UTC",
    observedAt: new Date("2026-01-03T00:00:00Z"),
    coverage: "complete",
    notes: [],
    value: 2,
    points: [{ date: "2026-01-02", value: 2 }],
  };
}

/** One finished page check. With it the result card leads the Agent tab, not the setup card. */
export function seoTestObservation(
  workspace: ProjectSeoWorkspace,
): ProjectSeoWorkspace["observations"][number] {
  return {
    id: "5b0f4c1e-4a55-4a43-9a41-0f2f4f7f2b10",
    kind: "page_check",
    source: "seo_coworker",
    observedAt: new Date("2026-01-03T12:00:00Z"),
    pageIds: workspace.scope.pageIds,
    scopeVersion: workspace.scope.version,
    sourceTaskId: null,
    countryCode: "US",
    languageCode: "en",
    devices: ["desktop"],
    rulebookVersion: "html-v1",
    artifactHash: "checked-html",
    issues: 0,
    coverage: { checked: 12, skipped: 0, failed: 0 },
  };
}

/** An Audit with one finished check: the result card leads the Agent tab, not the setup card. */
export function seoTestCheckedAudit(): ProjectSeoWorkspace {
  const workspace = { ...seoTestWorkspace(), auditId: SEO_TEST_AUDIT };
  workspace.observations = [seoTestObservation(workspace)];
  return workspace;
}

export function seoTestWorkspace(): ProjectSeoWorkspace {
  return {
    projectId: SEO_TEST_PROJECT,
    auditId: null,
    auditName: null,
    websiteUrl: "https://example.com/",
    scope: {
      id: SEO_TEST_SCOPE,
      name: "Pages",
      version: 2,
      pageIds: [SEO_TEST_PAGE],
      from: null,
      to: null,
    },
    pages: [
      {
        id: SEO_TEST_PAGE,
        url: "https://example.com/",
        label: "Home",
        relationship: "primary",
        relatedToPageId: null,
        createdAt: new Date("2026-01-01T12:00:00Z"),
      },
    ],
    scopes: [
      {
        id: SEO_TEST_SCOPE,
        name: "Pages",
        pageIds: [SEO_TEST_PAGE],
        version: 2,
      },
    ],
    observations: [],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    searchQueries: null,
    metricsStatus: "not_connected",
    metrics: [],
    timeline: [],
    analyses: [],
    monitors: [],
    history: { limit: 200, limited: false },
    availableActions: {
      canEdit: true,
      canRequestAnalysis: true,
      canCreateMonitor: true,
      canUsePaidSearchData: true,
      canSyncMetrics: true,
    },
  };
}

/** A site audit's strategy results: one group that can be reached, one that ranks, one with words a newer bot sends. */
export function seoTestStrategy(): NonNullable<
  ProjectSeoWorkspace["strategy"]
> {
  const group = {
    pageUrl: "https://example.com/",
    volume: 140,
    recent: 47,
    trend: "falling",
    reach: "in reach",
    position: null,
  } as const;
  return {
    verdict: "keep",
    // The SEO bot's own sentence forms.
    why: '160 of 160 monthly searches of the keyword groups with a known reach lie in groups the site ranks for or can reach. "battery app" falls to 47 searches a month in the last 3 months, against a 12-month mean of 140; "charge timer" rises to 60 searches a month in the last 3 months, against a 12-month mean of 20. 1 of 4 keyword groups are left out: no search volume, or no referring-domains count to compare.',
    groups: [
      {
        ...group,
        lead: "battery app",
        // One search intent, three keywords. The numbers are those of the lead.
        keywords: ["battery app", "Battery Apps", "battery health checker"],
      },
      {
        ...group,
        lead: "charge timer",
        keywords: ["charge timer"],
        trend: "flat",
        reach: "ranks",
        position: 4,
      },
      {
        ...group,
        lead: "battery widget",
        keywords: ["battery widget"],
        trend: null,
        recent: null,
        reach: "open",
      },
    ],
    actions: [
      {
        kind: "get listed",
        title: "Ask to be added to these lists of products",
        why: "2 lists of products are in the top 10.",
        expectedEffect: "People who compare products can find the product.",
        effort: "medium",
        limit: "Ask on the product's merits only.",
        targets: [
          {
            url: "https://lists.example/best",
            title: "Best battery apps",
            type: "listicle",
            state: "not mentioned",
          },
          {
            url: "https://other.example/page",
            title: null,
            type: "other",
            state: "not read",
          },
        ],
      },
      {
        kind: "new page",
        title: "Write a comparison page for “battery app alternative”",
        why: "People search it 90 times a month.",
        expectedEffect: "People who compare apps can find the site.",
        effort: "high",
        limit: null,
        targets: [],
      },
    ],
    observationId: "b5efedab-c394-4ce9-a089-0979e8a18fdb",
    observedAt: new Date("2026-11-11T00:26:00Z"),
    countryCode: "US",
    languageCode: "en",
  };
}

/** A keyword row a rankings check read: "battery app" on the home page, US English, desktop. */
export function seoTestKeyword(
  patch: Partial<ProjectSeoWorkspace["keywords"][number]> = {},
): ProjectSeoWorkspace["keywords"][number] {
  return {
    id: "keyword-1",
    keyword: "battery app",
    pageUrl: "https://example.com/",
    targetPageId: null,
    saved: true,
    countryCode: "US",
    languageCode: "en",
    source: "rank_refresh",
    volume: null,
    intent: null,
    difficulty: null,
    clicks: null,
    conversion: null,
    feature: null,
    device: "desktop",
    position: 4,
    positionStatus: "ranked",
    checkedResults: 100,
    observedAt: new Date("2026-10-08T08:00:00Z"),
    observationId: "observation-1",
    priority: "medium",
    version: 0,
    ...patch,
  };
}
