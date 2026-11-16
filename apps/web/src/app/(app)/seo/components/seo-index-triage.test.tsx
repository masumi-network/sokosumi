import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoIndexTriage } from "./seo-index-triage";
import { seoTestWorkspace } from "./seo-test-fixture";

type IndexAssessment = NonNullable<
  ProjectSeoWorkspace["indexTriage"]
>["assessments"][number];

function renderNotes(workspace: ReturnType<typeof seoTestWorkspace>) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      formats={createFormats()}
      messages={messages}
    >
      <SeoIndexTriage workspace={workspace} />
    </NextIntlClientProvider>,
  );
}

describe("indexing review notes", () => {
  it("shows review states, page identity and suggested next steps with folded source evidence", async () => {
    const user = userEvent.setup();
    const workspace = seoTestWorkspace();
    const primary = workspace.pages[0];
    const states = ["review", "expected_exclusion", "unavailable"] as const;
    workspace.pages = states.map((status, index) => ({
      ...primary,
      id: `${primary.id}:${status}`,
      url: `${primary.url}${index ? status : ""}`,
    }));
    workspace.scope.pageIds = workspace.pages.map((page) => page.id);
    const checkedAt = new Date("2026-11-16T08:00:00Z");
    workspace.indexTriage = {
      assessments: states.map(
        (status, index): IndexAssessment => ({
          taskId: "task",
          checkedAt,
          pageUrl: workspace.pages[index].url,
          status,
          report: false,
          reason: index
            ? `Reason for ${status}`
            : "Confirm whether this page should be indexed.",
          suggestedFix: index
            ? null
            : "Review the page purpose before changing noindex.",
          evidence: index
            ? []
            : ['Google reported: <script>alert("status")</script>'],
        }),
      ),
    };
    const view = renderNotes(workspace);
    expect(
      screen.getByRole("heading", { name: "Indexing review notes" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Review needed" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Expected exclusion" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "Not checked" })).toBeVisible();
    for (const page of workspace.pages)
      expect(screen.getByRole("link", { name: page.url })).toHaveAttribute(
        "href",
        page.url,
      );
    expect(screen.getAllByText("Suggested next step")).toHaveLength(1);
    expect(
      screen.getByText("Review the page purpose before changing noindex."),
    ).toBeVisible();
    expect(view.container.querySelector("time")).toHaveAttribute(
      "datetime",
      checkedAt.toISOString(),
    );
    const evidence = screen.getByText("View evidence");
    expect(evidence.closest("details")).not.toHaveAttribute("open");
    await user.click(evidence);
    expect(evidence.closest("details")).toHaveAttribute("open");
    expect(
      screen.getByText("Sources: Google Search Console and this audit."),
    ).toBeVisible();
    expect(
      screen.getByText('Google reported: <script>alert("status")</script>'),
    ).toBeVisible();
    expect(view.container.querySelector("script")).toBeNull();
  });

  it("shows an unsaved related URL as an expected exclusion without an audit issue or page creation", () => {
    const workspace = seoTestWorkspace();
    const primary = workspace.pages[0];
    const related = `${primary.url}redirected`;
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "task",
          checkedAt: new Date("2026-11-16T08:00:00Z"),
          pageUrl: related,
          auditPageUrl: primary.url,
          status: "expected_exclusion",
          report: false,
          reason: "This URL redirects to the audited page as intended.",
          suggestedFix: null,
          evidence: [],
        },
      ],
    };
    renderNotes(workspace);
    expect(
      screen.getByRole("heading", { name: "Expected exclusion" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: related })).toHaveAttribute(
      "href",
      related,
    );
    expect(screen.queryByText("Suggested next step")).toBeNull();
    expect(workspace.pages).toHaveLength(1);
    expect(workspace.findings).toHaveLength(0);
  });

  it("shows no section without review data or when the saved notes belong to another page", () => {
    const workspace = seoTestWorkspace();
    const view = renderNotes(workspace);
    expect(
      screen.queryByRole("heading", { name: "Indexing review notes" }),
    ).toBeNull();
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "task",
          checkedAt: new Date("2026-11-16T08:00:00Z"),
          pageUrl: "https://another.example/private",
          status: "review",
          report: false,
          reason: "Private assessment of another page",
          suggestedFix: null,
          evidence: [],
        },
      ],
    };
    view.unmount();
    renderNotes(workspace);
    expect(screen.queryByText("Private assessment of another page")).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Indexing review notes" }),
    ).toBeNull();
  });

  it("keeps an older related-page review and its own date after the main page is indexed in a newer Task", () => {
    const workspace = seoTestWorkspace();
    const primary = workspace.pages[0];
    const related = {
      ...primary,
      id: "related-page",
      url: `${primary.url}guide`,
      relationship: "related" as const,
    };
    workspace.pages.push(related);
    workspace.scope.pageIds.push(related.id);
    const latest = new Date("2026-11-16T08:00:00Z");
    const earlier = new Date("2026-11-15T09:00:00Z");
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "main-page-task",
          checkedAt: latest,
          pageUrl: primary.url,
          status: "indexed",
          report: false,
          reason: "The main page is indexed.",
          suggestedFix: null,
          evidence: [],
        },
        {
          taskId: "related-page-task",
          checkedAt: earlier,
          pageUrl: related.url,
          status: "review",
          report: false,
          reason: "Review whether the related page should be indexed.",
          suggestedFix: null,
          evidence: [],
        },
      ],
    };
    renderNotes(workspace);
    expect(screen.queryByText("The main page is indexed.")).toBeNull();
    const row = screen.getByRole("link", { name: related.url }).closest("li");
    if (!row) throw new Error("Related-page indexing note missing");
    expect(
      within(row).getByText(
        "Review whether the related page should be indexed.",
      ),
    ).toBeVisible();
    expect(row.querySelector("time")).toHaveAttribute(
      "datetime",
      earlier.toISOString(),
    );
    expect(
      row.querySelector(`time[datetime="${latest.toISOString()}"]`),
    ).toBeNull();
  });
});
