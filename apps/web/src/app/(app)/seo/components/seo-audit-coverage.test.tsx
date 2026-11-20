import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoSummaryTiles } from "./seo-summary-tiles";
import { seoTestObservation, seoTestWorkspace } from "./seo-test-fixture";

it("opens the verdict evidence on the SEO page and keeps research outside the rule count", () => {
  const workspace = seoTestWorkspace();
  const observation = seoTestObservation(workspace);
  const pageUrl = "https://example.test/guide";
  workspace.observations = [
    {
      ...observation,
      kind: "audit_full",
      coverage: { checked: 3, skipped: 2, failed: 0 },
      checklistBreakdown: {
        passed: 2,
        flagged: 1,
        gaps: [
          {
            pageUrl,
            rowId: "EX-01",
            device: "mobile",
            reason: "Field measurements were unavailable.",
          },
          {
            pageUrl,
            rowId: "EX-01",
            device: "desktop",
            reason: "Field measurements were unavailable.",
          },
        ],
        research: [
          {
            scope: "page",
            pageUrl,
            stages: [
              { name: "seasonal", status: "completed" },
              {
                name: "editorial",
                status: "skipped",
                reason:
                  "The regular keyword list had already filled all 20 places.",
              },
              {
                name: "exploration",
                status: "unknown",
                reason: "This report has no saved exploration result.",
              },
            ],
          },
        ],
      },
    },
  ];
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSummaryTiles workspace={workspace} />
    </NextIntlClientProvider>,
  );
  const tile = screen.getByTestId("seo-summary-tests");
  expect(screen.getByText("Checklist verdicts")).toBeVisible();
  expect(tile).toHaveTextContent("3 of 5");
  const open = within(tile).getByText("View results");
  expect(open.closest("a")).toBeNull();
  fireEvent.click(open);
  expect(
    within(tile).getByText("2 passed, 1 flagged, 2 without a verdict"),
  ).toBeVisible();
  expect(
    within(tile).getAllByText("Field measurements were unavailable."),
  ).toHaveLength(1);
  expect(screen.getByText("Audit research")).toBeVisible();
  expect(
    screen.getByText(
      "The regular keyword list had already filled all 20 places.",
    ),
  ).toBeVisible();
});

it("keeps the last full audit's research visible after a focused check and with zero checklist rows", () => {
  const workspace = seoTestWorkspace();
  const focused = seoTestObservation(workspace);
  const pageUrl = "https://example.test/guide";
  const audit = {
    ...focused,
    id: "d1111111-1111-4111-8111-111111111111",
    kind: "audit_full" as const,
    coverage: { checked: 0, skipped: 0, failed: 0 },
    checklistBreakdown: {
      passed: 0,
      flagged: 0,
      gaps: [],
      research: [
        {
          scope: "page" as const,
          pageUrl,
          stages: [
            { name: "exploration" as const, status: "no_finding" as const },
          ],
        },
      ],
    },
  };
  workspace.observations = [focused, audit];
  const view = (w: typeof workspace) => (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSummaryTiles workspace={w} />
    </NextIntlClientProvider>
  );
  const mounted = render(view(workspace));
  expect(screen.getByText("No new finding")).toBeVisible();
  mounted.rerender(view({ ...workspace, observations: [audit] }));
  expect(screen.getByText("Audit research")).toBeVisible();
});

it("keeps a historical full audit's aggregate on the SEO page when per-rule evidence was not saved", () => {
  const workspace = seoTestWorkspace();
  workspace.observations = [
    {
      ...seoTestObservation(workspace),
      kind: "audit_full",
      coverage: { checked: 4, skipped: 2, failed: 0 },
      checklistBreakdown: {
        passed: null,
        flagged: null,
        gaps: [],
        research: [
          {
            scope: "page",
            pageUrl: "https://example.test/guide",
            stages: [{ name: "exploration", status: "unknown" }],
          },
        ],
      },
    },
  ];
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoSummaryTiles workspace={workspace} />
    </NextIntlClientProvider>,
  );
  const tile = screen.getByTestId("seo-summary-tests");
  fireEvent.click(within(tile).getByText("View results"));
  expect(tile).toHaveTextContent("4 of 6");
  expect(
    within(tile).getByText(
      "This audit saved totals only. A breakdown by check is unavailable.",
    ),
  ).toBeVisible();
});
