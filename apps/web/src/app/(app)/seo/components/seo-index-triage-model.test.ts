import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoIndexEvidence, seoIndexTriage } from "./seo-index-triage-model";
import { seoTestWorkspace } from "./seo-test-fixture";

const checkedAt = new Date("2026-11-16T08:00:00Z");
type IndexAssessment = NonNullable<
  ProjectSeoWorkspace["indexTriage"]
>["assessments"][number];
const assessment = (pageUrl: string): IndexAssessment => ({
  taskId: "task",
  checkedAt,
  pageUrl,
  status: "review",
  report: false,
  reason: "Confirm whether this page should appear in Google.",
  suggestedFix: null,
  evidence: [],
});

describe("indexing review selection", () => {
  it("keeps only exact selected page URLs, in main-page then related-page order", () => {
    const workspace = seoTestWorkspace();
    const primary = workspace.pages[0];
    const related = {
      ...primary,
      id: "related-page",
      url: `${primary.url}guide`,
      relationship: "related" as const,
    };
    const outside = {
      ...primary,
      id: "other-page",
      url: `${primary.url}other`,
    };
    workspace.pages.push(related, outside);
    workspace.scope.pageIds = [primary.id, related.id];
    workspace.indexTriage = {
      assessments: [
        assessment(outside.url),
        assessment(related.url),
        assessment(`${primary.url}#private-fragment`),
        assessment("https://another.example/"),
        assessment(primary.url),
      ],
    };
    expect(
      seoIndexTriage(workspace)?.assessments.map((item) => item.pageUrl),
    ).toEqual([primary.url, related.url]);
    workspace.scope.pageIds = [outside.id];
    expect(
      seoIndexTriage(workspace)?.assessments.map((item) => item.pageUrl),
    ).toEqual([outside.url]);
    workspace.scope.pageIds = [];
    expect(seoIndexTriage(workspace)).toBeNull();
  });

  it("keeps unsaved related evidence under each selected audited parent", () => {
    const workspace = seoTestWorkspace();
    const primary = workspace.pages[0];
    const second = { ...primary, id: "second", url: `${primary.url}second` };
    workspace.pages.push(second);
    workspace.scope.pageIds = [primary.id, second.id];
    const related = `${primary.url}related`;
    workspace.indexTriage = {
      assessments: [
        { ...assessment(related), auditPageUrl: second.url },
        {
          ...assessment(related),
          auditPageUrl: primary.url,
          status: "expected_exclusion",
        },
        {
          ...assessment(`${primary.url}outside`),
          auditPageUrl: `${primary.url}unselected`,
        },
      ],
    };
    expect(
      seoIndexTriage(workspace)?.assessments.map((item) => [
        item.auditPageUrl,
        item.pageUrl,
      ]),
    ).toEqual([
      [primary.url, related],
      [second.url, related],
    ]);
    workspace.scope.pageIds = [second.id];
    expect(
      seoIndexTriage(workspace)?.assessments.map((item) => item.auditPageUrl),
    ).toEqual([second.url]);
    expect(workspace.pages.some((page) => page.url === related)).toBe(false);
  });

  it("omits normal audit issues and indexed pages instead of duplicating findings", () => {
    const workspace = seoTestWorkspace();
    const page = assessment(workspace.pages[0].url);
    workspace.indexTriage = {
      assessments: [{ ...page, status: "issue", report: true }],
    };
    expect(seoIndexTriage(workspace)).toBeNull();
    workspace.indexTriage.assessments = [{ ...page, status: "indexed" }];
    expect(seoIndexTriage(workspace)).toBeNull();
  });

  it("keeps older deployments and unknown selected page IDs empty", () => {
    const workspace = seoTestWorkspace();
    expect(seoIndexTriage(workspace)).toBeNull();
    workspace.indexTriage = null;
    expect(seoIndexTriage(workspace)).toBeNull();
    workspace.indexTriage = {
      assessments: [assessment(workspace.pages[0].url)],
    };
    workspace.scope.pageIds = ["unknown-page"];
    expect(seoIndexTriage(workspace)).toBeNull();
  });
});

describe("seoIndexEvidence", () => {
  it("keeps a state that is not fine, a verdict without a reason and every line it does not know", () => {
    expect(
      seoIndexEvidence([
        "Google URL Inspection: FAIL; no coverage reason returned.",
        "Google did not return a last crawl time.",
        "robotsTxtState: DISALLOWED",
        "pageFetchState: PAGE_FETCH_STATE_UNSPECIFIED",
        "Google's canonical: https://example.com/a.",
        "Google last crawled this URL at not a date.",
      ]),
    ).toEqual({
      reason: null,
      crawledAt: null,
      more: [
        "Google URL Inspection: FAIL; no coverage reason returned.",
        "Google did not return a last crawl time.",
        "robotsTxtState: DISALLOWED",
        "Google's canonical: https://example.com/a.",
        "Google last crawled this URL at not a date.",
      ],
    });
  });
});
