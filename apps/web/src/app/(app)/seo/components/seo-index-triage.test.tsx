import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoIndexStatus } from "./seo-index-status";
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
      <SeoIndexStatus workspace={workspace} />
    </NextIntlClientProvider>,
  );
}

describe("indexing review notes", () => {
  it("counts selected pages using completed audit inspections even when no statistics snapshot exists", () => {
    const workspace = seoTestWorkspace();
    const primary = workspace.pages[0];
    const related = `${primary.url}retired`;
    const missing = {
      ...primary,
      id: "unanswered",
      url: `${primary.url}unanswered`,
    };
    const broken = { ...primary, id: "broken", url: `${primary.url}broken` };
    workspace.pages.push(missing, broken);
    workspace.scope.pageIds.push(missing.id, broken.id);
    const note = {
      taskId: "task",
      checkedAt: new Date("2026-11-16T08:00:00Z"),
      pageUrl: primary.url,
      report: false,
      reason: "Google reports this page as indexed.",
      suggestedFix: null,
      evidence: [],
    };
    workspace.indexTriage = {
      assessments: [
        { ...note, status: "indexed" },
        {
          ...note,
          pageUrl: broken.url,
          status: "issue",
          report: true,
          reason: "Google left the broken page out.",
        },
        {
          ...note,
          pageUrl: related,
          auditPageUrl: primary.url,
          status: "expected_exclusion",
          reason: "The redirect is intended.",
        },
        {
          ...note,
          pageUrl: missing.url,
          status: "unavailable",
          reason: "Google did not return a verdict.",
        },
      ],
    };
    renderNotes(workspace);
    expect(
      screen.getByText("No index status yet for 1 page in view."),
    ).toBeVisible();
    expect(screen.getByText("The redirect is intended.")).toBeVisible();
    expect(screen.getByText("Indexed")).toBeVisible();
    expect(screen.queryByText(note.reason)).toBeNull();
  });
  it("shows one Google verdict from the newest confirmed source without reusing older metadata", () => {
    const workspace = seoTestWorkspace();
    const pageUrl = workspace.pages[0].url;
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "task",
          checkedAt: new Date("2026-11-16T08:00:00Z"),
          pageUrl,
          status: "indexed",
          report: false,
          reason: "The page is indexed.",
          suggestedFix: null,
          evidence: [],
        },
      ],
    };
    const sync = {
      checkedAt: new Date("2026-11-15T08:00:00Z"),
      pageUrl,
      verdict: "FAIL" as const,
      coverageState: "Historical noindex",
      lastCrawlTime: null,
      robotsTxtState: null,
      googleCanonical: null,
      userCanonical: null,
    };
    workspace.indexStatus = { pages: [sync] };
    const first = renderNotes(workspace);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Indexed")).toBeVisible();
    expect(screen.queryByText(/Historical noindex/)).toBeNull();
    first.unmount();
    const assessment = workspace.indexTriage.assessments[0];
    workspace.indexTriage = {
      assessments: [
        {
          ...assessment,
          status: "expected_exclusion",
          reason: "This is an intended redirect.",
          evidence: ["Google URL Inspection: NEUTRAL; Page with redirect."],
        },
      ],
    };
    workspace.indexStatus = { pages: [{ ...sync, verdict: "PASS" }] };
    const inverse = renderNotes(workspace);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Not indexed")).toBeVisible();
    expect(screen.getByText("Google: Page with redirect")).toBeVisible();
    inverse.unmount();
    workspace.indexStatus = {
      pages: [
        {
          ...sync,
          checkedAt: new Date("2026-11-17T08:00:00Z"),
          verdict: "VERDICT_UNSPECIFIED",
          coverageState: null,
        },
      ],
    };
    renderNotes(workspace);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Index status unknown")).toBeVisible();
    expect(screen.queryByText("Indexed")).toBeNull();
  });
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
            ? [
                // Lines that say nothing past the reason and the crawl: no fold.
                "Google URL Inspection: NEUTRAL; Page with redirect.",
                "indexingState: INDEXING_ALLOWED",
                "pageFetchState: SUCCESSFUL",
              ]
            : [
                // The lines of a real review (battery-sensei.app, 2026-11-16).
                "Google URL Inspection: NEUTRAL; Page with redirect.",
                "Google last crawled this URL at 2026-09-05T05:29:58Z.",
                "indexingState: INDEXING_ALLOWED",
                "robotsTxtState: ALLOWED",
                "pageFetchState: SUCCESSFUL",
                "Public page evidence was captured at 2026-11-16T23:47:36.703Z.",
                'Google reported: <script>alert("status")</script>',
              ],
        }),
      ),
    };
    const view = renderNotes(workspace);
    expect(screen.getByRole("heading", { name: "Google index" })).toBeVisible();
    expect(screen.getByText("Review needed")).toBeVisible();
    expect(screen.getByText("Expected exclusion")).toBeVisible();
    expect(screen.getByText("Not checked")).toBeVisible();
    for (const page of workspace.pages)
      expect(screen.getByRole("link", { name: page.url })).toHaveAttribute(
        "href",
        page.url,
      );
    // The next step follows the reason in one paragraph.
    expect(
      screen.getByText("Review the page purpose before changing noindex.")
        .parentElement,
    ).toHaveTextContent(
      "Confirm whether this page should be indexed. Review the page purpose before changing noindex.",
    );
    // Google's reason and last crawl show; the states that say all is fine and the capture time do not.
    expect(screen.getAllByText("Google: Page with redirect")).toHaveLength(3);
    expect(screen.getByText("Sep 5, 2026")).toBeVisible();
    expect(
      screen.queryByText(/INDEXING_ALLOWED|NEUTRAL|captured at/),
    ).toBeNull();
    // A line that says more folds under the evidence.
    const evidence = screen.getByText("View evidence");
    expect(evidence.closest("details")).not.toHaveAttribute("open");
    await user.click(evidence);
    expect(evidence.closest("details")).toHaveAttribute("open");
    expect(
      screen.getByText('Google reported: <script>alert("status")</script>'),
    ).toBeVisible();
    expect(screen.getAllByText("View evidence")).toHaveLength(1);
    expect(view.container.querySelector("script")).toBeNull();
  });

  it("puts a page's review state beside its Google verdict without repeating Google's words", () => {
    const workspace = seoTestWorkspace();
    const pageUrl = workspace.pages[0].url;
    const checkedAt = new Date("2026-11-16T08:00:00Z");
    workspace.indexStatus = {
      pages: [
        {
          pageUrl,
          verdict: "NEUTRAL",
          coverageState: "Page with redirect",
          robotsTxtState: null,
          lastCrawlTime: new Date("2026-09-05T05:29:58Z"),
          googleCanonical: null,
          userCanonical: null,
          // The sync read Google's status minutes after the review, on the same day.
          checkedAt: new Date(checkedAt.getTime() + 5 * 60 * 1000),
        },
      ],
    } as NonNullable<typeof workspace.indexStatus>;
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "task",
          checkedAt,
          pageUrl,
          status: "review",
          report: false,
          reason: "Google's stored result may predate a fix.",
          suggestedFix: null,
          evidence: [
            "Google URL Inspection: NEUTRAL; Page with redirect.",
            "Google last crawled this URL at 2026-09-05T05:29:58Z.",
          ],
        },
      ],
    };
    const view = renderNotes(workspace);
    const verdict = screen.getByText("Not indexed").closest("p");
    const row = verdict?.closest("li");
    if (!verdict || !row) throw new Error("Google status row missing");
    // One line: Google's verdict, its reason and the review state.
    expect(
      within(verdict).getByText("Google: Page with redirect"),
    ).toBeVisible();
    expect(within(verdict).getByText("Review needed")).toBeVisible();
    expect(
      within(row).getByText("Google's stored result may predate a fix."),
    ).toBeVisible();
    expect(within(row).getByText("Sep 5, 2026")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    // The review is from the same day as Google's status: no review day.
    expect(within(row).queryByText(/Reviewed/)).toBeNull();
    // A page left out for a reason to act on does not read as fine.
    expect(row.querySelector("[data-icon]")).toHaveAttribute(
      "data-icon",
      "notIndexed",
    );

    // A review that expects the exclusion leaves nothing to act on: the page reads as fine.
    view.unmount();
    workspace.indexTriage = {
      assessments: [
        {
          ...workspace.indexTriage.assessments[0],
          status: "expected_exclusion",
        },
      ],
    };
    const fineView = renderNotes(workspace);
    const fine = screen.getByText("Not indexed").closest("p");
    if (!fine) throw new Error("Google status row missing");
    expect(within(fine).getByText("Expected exclusion")).toBeVisible();
    expect(fine.querySelector("[data-icon]")).toHaveAttribute(
      "data-icon",
      "fine",
    );

    // Google's reason changed after the review: the expected exclusion no longer covers it.
    fineView.unmount();
    workspace.indexStatus.pages[0].coverageState = "Server error (5xx)";
    const changedView = renderNotes(workspace);
    expect(
      screen
        .getByText("Not indexed")
        .closest("p")
        ?.querySelector("[data-icon]"),
    ).toHaveAttribute("data-icon", "notIndexed");

    // Google's warnings stay a warning, whatever the review expects.
    changedView.unmount();
    workspace.indexStatus.pages[0].coverageState = "Page with redirect";
    workspace.indexStatus.pages[0].verdict = "PARTIAL";
    renderNotes(workspace);
    const warnings = screen.getByText("Indexed, with warnings").closest("p");
    if (!warnings) throw new Error("Google status row missing");
    expect(within(warnings).getByText("Expected exclusion")).toBeVisible();
    expect(warnings.querySelector("[data-icon]")).toHaveAttribute(
      "data-icon",
      "warnings",
    );
  });

  it("shows a page Google left out as not fine without a review note or without Google's reason", () => {
    const workspace = seoTestWorkspace();
    workspace.indexStatus = {
      pages: [
        {
          pageUrl: workspace.pages[0].url,
          verdict: "NEUTRAL",
          coverageState: "Page with redirect",
          robotsTxtState: null,
          lastCrawlTime: null,
          googleCanonical: null,
          userCanonical: null,
          checkedAt: new Date("2026-11-16T08:00:00Z"),
        },
      ],
    } as NonNullable<typeof workspace.indexStatus>;
    workspace.indexTriage = null;
    const view = renderNotes(workspace);
    const icon = () =>
      screen
        .getByText("Not indexed")
        .closest("p")
        ?.querySelector("[data-icon]");
    expect(icon()).toHaveAttribute("data-icon", "notIndexed");

    // Neither Google nor the review names a reason: nothing shows the exclusion is the expected one.
    view.unmount();
    workspace.indexStatus.pages[0].coverageState = null;
    workspace.indexTriage = {
      assessments: [
        {
          taskId: "task",
          checkedAt: new Date("2026-11-16T08:00:00Z"),
          pageUrl: workspace.pages[0].url,
          status: "expected_exclusion",
          report: false,
          reason: "The page is excluded on purpose.",
          suggestedFix: null,
          evidence: [],
        },
      ],
    };
    renderNotes(workspace);
    expect(icon()).toHaveAttribute("data-icon", "notIndexed");
  });

  it("pairs each note with its own state when the notes of a page differ", () => {
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
    const checkedAt = new Date("2026-11-16T08:00:00Z");
    workspace.indexStatus = {
      pages: [
        {
          pageUrl: primary.url,
          verdict: "NEUTRAL",
          coverageState: "Page with redirect",
          robotsTxtState: null,
          lastCrawlTime: null,
          googleCanonical: null,
          userCanonical: null,
          checkedAt,
        },
      ],
    } as NonNullable<typeof workspace.indexStatus>;
    const note = {
      taskId: "task",
      checkedAt,
      pageUrl: primary.url,
      report: false,
      suggestedFix: null,
      evidence: [],
    };
    workspace.indexTriage = {
      assessments: [
        { ...note, status: "review", reason: "Check the redirect target." },
        {
          ...note,
          auditPageUrl: related.url,
          status: "expected_exclusion",
          reason: "The redirect is intended.",
        },
      ],
    };
    renderNotes(workspace);
    const verdict = screen.getByText("Not indexed").closest("p");
    if (!verdict) throw new Error("Google status row missing");
    // No shared badge on the verdict line: each note names its own state.
    expect(within(verdict).queryByText("Review needed")).toBeNull();
    const noteOf = (state: string) =>
      screen.getByText(state).parentElement?.parentElement;
    expect(noteOf("Review needed")).toHaveTextContent(
      "Check the redirect target.",
    );
    expect(noteOf("Review needed")).not.toHaveTextContent(
      "The redirect is intended.",
    );
    expect(noteOf("Expected exclusion")).toHaveTextContent(
      "The redirect is intended.",
    );
    expect(screen.getByRole("link", { name: related.url })).toHaveAttribute(
      "href",
      related.url,
    );
    // One note still asks for a check: the page does not read as fine.
    expect(verdict.querySelector("[data-icon]")).toHaveAttribute(
      "data-icon",
      "notIndexed",
    );
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
    expect(screen.getByText("Expected exclusion")).toBeVisible();
    expect(screen.getByRole("link", { name: related })).toHaveAttribute(
      "href",
      related,
    );
    expect(screen.getByRole("link", { name: primary.url })).toHaveAttribute(
      "href",
      primary.url,
    );
    // No Google status stands over the note, so nothing makes it older: no review day.
    expect(screen.queryByText("Reviewed")).toBeNull();
    expect(workspace.pages).toHaveLength(1);
    expect(workspace.findings).toHaveLength(0);
  });

  it("shows no section without review data or when the saved notes belong to another page", () => {
    const workspace = seoTestWorkspace();
    const view = renderNotes(workspace);
    expect(screen.queryByRole("heading", { name: "Google index" })).toBeNull();
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
    expect(screen.queryByRole("heading", { name: "Google index" })).toBeNull();
  });

  it("dates a related-page review older than its Google status and hides the main page's newer indexed note", () => {
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
    // Google's status of the related page was read after its review.
    workspace.indexStatus = {
      pages: [
        {
          pageUrl: related.url,
          verdict: "PASS",
          coverageState: null,
          robotsTxtState: null,
          lastCrawlTime: null,
          googleCanonical: null,
          userCanonical: null,
          checkedAt: latest,
        },
      ],
    } as NonNullable<typeof workspace.indexStatus>;
    renderNotes(workspace);
    expect(screen.queryByText("The main page is indexed.")).toBeNull();
    const row = screen.getByRole("link", { name: related.url }).closest("li");
    if (!row) throw new Error("Related-page indexing note missing");
    expect(
      within(row).getByText(
        "Review whether the related page should be indexed.",
      ),
    ).toBeVisible();
    expect(within(row).getByText("Review needed")).toBeVisible();
    // The review is older than Google's status: its day says so.
    expect(within(row).getByText("Reviewed")).toBeVisible();
    expect(
      row.querySelector(`time[datetime="${earlier.toISOString()}"]`),
    ).toHaveTextContent("Nov 15, 2026");
  });
});
