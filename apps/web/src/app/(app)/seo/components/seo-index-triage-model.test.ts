import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import { seoIndexTriage } from "./seo-index-triage-model";
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
