import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

export const SEO_TEST_PROJECT = "39d1c2a6-aade-4322-aed5-3f139a34b127";
export const SEO_TEST_PAGE = "2c32dca9-c44f-4372-9114-8c146d5eb30b";
export const SEO_TEST_SCOPE = "b5efedab-c394-4ce9-a089-0979e8a18fdb";
export function seoTestWorkspace(): ProjectSeoWorkspace {
  return {
    projectId: SEO_TEST_PROJECT,
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
    metricsStatus: "not_connected",
    metrics: [],
    timeline: [],
    analyses: [],
    monitors: [],
    history: { limit: 200, limited: false },
    availableActions: {
      canEdit: true,
      canRequestAnalysis: true,
      canSyncMetrics: true,
    },
  };
}
