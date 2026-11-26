import type { ProjectSeoAction } from "@sokosumi/core-client";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoActionWorklist } from "./seo-action-worklist";
import { seoActionsExport } from "./seo-export-model";
import type { SeoIssueSeverity } from "./seo-overview-model";
import { seoTestWorkspace } from "./seo-test-fixture";
import { type SeoWorkspaceModel, seoActionKey } from "./use-seo-workspace";

afterEach(cleanup);

const model = {
  data: seoTestWorkspace(),
  pending: false,
} as unknown as SeoWorkspaceModel;

function action(id: string, title: string): ProjectSeoAction {
  return {
    id,
    observationId: "962a86bb-5702-4d64-a6c4-15be5bf8ed80",
    pageUrl: model.data.pages[0].url,
    findingIds: [],
    title,
    why: "Why",
    effort: "low",
    expectedEffect: "Effect",
    edit: null,
    taskId: null,
    status: "recommended",
    kind: "fix",
    evidence: [],
  };
}

const high = action("high", "Fix the price");
const low = action("low", "Fix the redirect");
const severity = (item: ProjectSeoAction): SeoIssueSeverity | null =>
  item.id === "high" ? "major" : "minor";

function view(actions: ProjectSeoAction[], currentModel = model) {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoActionWorklist
        actions={actions}
        severity={severity}
        model={currentModel}
      />
    </NextIntlClientProvider>
  );
}

const titles = () =>
  within(screen.getByRole("list", { name: "Actions" }))
    .getAllByRole("button")
    .map((row) => row.getAttribute("aria-labelledby"))
    .map((id) => document.getElementById(id ?? "")?.textContent);

describe("SEO action worklist", () => {
  it("goes back to all rows when a filter's rows leave, and stays there when they come back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(view([high, low]));
    await user.click(screen.getByRole("button", { name: "Low impact 1" }));
    expect(titles()).toEqual(["Fix the redirect"]);
    // A new check: the low row is gone, then a later check has it again.
    rerender(view([high]));
    rerender(view([high, low]));
    expect(titles()).toEqual(["Fix the price", "Fix the redirect"]);
    expect(screen.getByRole("button", { name: "All 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("gives the focus to All when the pressed filter leaves", async () => {
    const user = userEvent.setup();
    const idea = {
      ...action("idea", "Write a guide"),
      kind: "opportunity",
    } as const;
    const { rerender } = render(view([high, low, idea]));
    await user.click(screen.getByRole("button", { name: "Low impact 1" }));
    rerender(view([high, idea]));
    expect(screen.getByRole("button", { name: "All 2" })).toHaveFocus();
  });

  it("gives the focus to the first row when the whole filter line leaves", async () => {
    const user = userEvent.setup();
    const { rerender } = render(view([high, low]));
    await user.click(screen.getByRole("button", { name: "Low impact 1" }));
    rerender(view([high]));
    expect(screen.queryByRole("group", { name: "Filter actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Fix the price" })).toHaveFocus();
  });

  it("keeps the focused row in place when a new check takes the pressed filter away", async () => {
    const user = userEvent.setup();
    const { rerender } = render(view([high, low]));
    await user.click(screen.getByRole("button", { name: "High impact 1" }));
    const row = screen.getByRole("button", { name: "Fix the price" });
    row.focus();
    // Only high actions are left: the filter line goes, the row stays the same element with the focus.
    rerender(view([high]));
    expect(row).toHaveFocus();
  });

  it("gives the focus to the first row when the filter line leaves with All focused, or a focused row leaves", async () => {
    const user = userEvent.setup();
    const { rerender } = render(view([high, low]));
    // The reader is elsewhere on the page: a new check moves no focus.
    rerender(view([low, high]));
    expect(document.body).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Low impact 1" }));
    await user.click(screen.getByRole("button", { name: "All 2" }));
    rerender(view([high]));
    expect(screen.getByRole("button", { name: "Fix the price" })).toHaveFocus();
    // A new check takes the focused row away.
    rerender(view([low]));
    expect(
      screen.getByRole("button", { name: "Fix the redirect" }),
    ).toHaveFocus();
  });

  it("opens the action the Agent tab sent, and gives the focus to its row when its dialog closes", async () => {
    const user = userEvent.setup();
    const setShownAction = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <SeoActionWorklist
          actions={[high, low]}
          evidence={Array.from({ length: 6 }, (_, index) => ({
            key: String(index),
            kind: "evidence",
            bucket: "high",
            title: "High priority " + index,
            facts: [],
          }))}
          severity={severity}
          model={
            {
              ...model,
              shownAction: seoActionKey(low),
              setShownAction,
            } as unknown as SeoWorkspaceModel
          }
        />
      </NextIntlClientProvider>,
    );
    expect(
      await screen.findByRole("dialog", { name: "Fix the redirect" }),
    ).toBeVisible();
    await user.keyboard("{Escape}");
    expect(setShownAction).toHaveBeenCalledWith(null);
    // Its row, not the first row: no row was pressed to open it.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Fix the redirect" }),
      ).toHaveFocus(),
    );
  });

  it("closes the dialog of an action that left the list, and does not open it again when it comes back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(view([high, low]));
    await user.click(screen.getByRole("button", { name: "Fix the redirect" }));
    expect(
      await screen.findByRole("dialog", { name: "Fix the redirect" }),
    ).toBeVisible();
    rerender(view([high]));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Its row left with it: the focus goes to the first row, not to the page.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Fix the price" }),
      ).toHaveFocus(),
    );
    rerender(view([high, low]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

it("puts an idea with evidence after the major fix and before the minor cleanup", () => {
  const idea = {
    ...action("idea", "Test a cost section"),
    decision: {
      kind: "content_opportunity",
      alternative: "Keep the page as it is.",
      nextCheck: "Compare clicks next month.",
    },
  } as ProjectSeoAction;
  render(view([low, idea, high]));
  expect(titles()).toEqual([high.title, idea.title, low.title]);
});

it("shows the alternative, evidence and next check for a strategy action", async () => {
  const user = userEvent.setup();
  const item = {
    ...action("idea", "Repair the buying guide link"),
    kind: "opportunity",
    effort: "unknown",
    why: "The guide links to the old page.",
    evidence: ["Guide links to /retired."],
    decision: {
      kind: "internal_link_opportunity",
      alternative: "Update the source article.",
      nextCheck: "Crawl both pages after publication.",
    },
  } as const;
  const accepted: ProjectSeoAction = {
    ...item,
    evidence: [...item.evidence, "c".repeat(64), "rankingData.page.ranked"],
    taskId: "accepted-task",
    status: "implemented",
    completedAt: new Date("2026-06-01T12:00:00Z"),
  };
  const page = model.data.pages[0]!;
  const saved = {
    ...model,
    brief: {
      data: {
        pages: [],
        priorities: [],
        followUps: [
          {
            pageId: page.id,
            status: "unknown",
            indexReview: "unknown",
            latestClosedGoal: {
              from: "2026-06-02",
              to: "2026-06-08",
              count: 9,
              event: "sign_up",
              timeZone: "Europe/Oslo",
            },
            goalInvestigation: {
              pageUrl: page.url,
              event: "sign_up",
              timeZone: "Europe/Oslo",
              assessment: "both_declined",
              weekdayMix: "uneven",
              before: {
                from: "2026-05-26",
                to: "2026-06-01",
                organic: { rate: 0.2, sessions: 100 },
                direct: { rate: 0.1, sessions: 120 },
              },
              after: {
                from: "2026-06-02",
                to: "2026-06-08",
                organic: { rate: 0.1, sessions: 90 },
                direct: { rate: 0.05, sessions: 100 },
              },
            },
          },
        ],
      },
    },
  } as unknown as SeoWorkspaceModel;
  const { rerender } = render(view([accepted], saved));
  await user.click(screen.getByRole("button", { name: item.title }));
  const detail = within(screen.getByRole("dialog"));
  for (const text of [
    item.why,
    item.decision.alternative,
    item.decision.nextCheck,
    ...item.evidence,
  ])
    expect(detail.getByText(text)).toBeVisible();
  expect(detail.getByText("Keywords this page ranked for")).toBeVisible();
  const records = detail.getByText("c".repeat(64)).closest("details");
  expect(records).not.toHaveAttribute("open");
  await user.click(records!.querySelector("summary")!);
  expect(records).toHaveAttribute("open");
  expect(detail.getByText(/9 occurrences of sign_up/)).toBeVisible();
  expect(detail.getByText(/different numbers of some weekdays/)).toBeVisible();
  expect(detail.getByText(/Both channels had a lower goal rate/)).toBeVisible();
  expect(detail.getByRole("link", { name: "Open task" })).toHaveAttribute(
    "href",
    "/tasks/accepted-task",
  );
  rerender(
    view(
      [{ ...accepted, completedAt: new Date("2026-06-02T01:00:00Z") }],
      saved,
    ),
  );
  expect(detail.queryByText(/9 occurrences of sign_up/)).toBeNull();
});

it("shows the new observation on a completed recommendation while keeping its original Task", async () => {
  const user = userEvent.setup();
  const item: ProjectSeoAction = {
    ...low,
    status: "implemented",
    taskId: "same-task",
    followUpReview: {
      kind: "rank_crosses",
      keyword: "printed manuals",
      before: 12,
      after: 8,
      baselineObservationId: "earlier",
      baselineObservedAt: new Date("2026-09-01T00:00:00Z"),
      observationId: "later",
      observedAt: new Date("2026-11-01T00:00:00Z"),
    },
  };
  render(view([item]));
  expect(screen.getByText("Review again")).toBeVisible();
  await user.click(
    within(screen.getByRole("list", { name: "Actions" })).getByRole("button"),
  );
  expect(
    screen.getByText(
      /DataForSEO recorded “printed manuals” at position 12 on Sep 1, 2026 and 8 on Nov 1, 2026/,
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: messages.App.Seo.openTask }),
  ).toHaveAttribute("href", "/tasks/same-task");
});

it("puts a historical review first, filters it, and acknowledges without creating a task", async () => {
  const user = userEvent.setup();
  const acknowledgeReview = vi.fn();
  const item: ProjectSeoAction = {
    ...low,
    kind: "opportunity",
    status: "needs_review",
    followUpReview: {
      kind: "demand_returns",
      keyword: "電池",
      period: "2026-10",
      before: 90,
      after: 280,
      observationId: "newer",
      observedAt: new Date("2026-11-01T12:00:00Z"),
      baselineObservationId: "earlier",
      baselineObservedAt: new Date("2026-06-01T12:00:00Z"),
    },
  };
  render(view([high, item], { ...model, acknowledgeReview }));
  expect(titles()).toEqual([item.title, high.title]);
  await user.click(screen.getByRole("button", { name: "Review again 1" }));
  expect(titles()).toEqual([item.title]);
  await user.click(screen.getByRole("button", { name: item.title }));
  const dialog = within(screen.getByRole("dialog"));
  expect(
    dialog.getByText(
      /DataForSEO estimated 280 searches for “電池” in October 2026/,
    ),
  ).toBeVisible();
  expect(
    dialog.queryByRole("button", { name: messages.App.Seo.actions.createTask }),
  ).toBeNull();
  await user.click(dialog.getByRole("button", { name: "Mark reviewed" }));
  expect(acknowledgeReview).toHaveBeenCalledWith(item);
});

it("shows the private organic metric, periods and sample sizes in English without exporting the review", async () => {
  const user = userEvent.setup();
  const item: ProjectSeoAction = {
    ...low,
    status: "needs_review",
    followUpReview: {
      kind: "engagement_changed",
      before: 40,
      after: 25,
      baselineObservationId: "base",
      observationId: "later",
      baselineObservedAt: new Date("2026-09-08"),
      observedAt: new Date("2026-09-16"),
      beforePeriod: {
        from: new Date("2026-09-01"),
        to: new Date("2026-09-07"),
        sessions: 90,
      },
      afterPeriod: {
        from: new Date("2026-09-09"),
        to: new Date("2026-09-15"),
        sessions: 100,
      },
    },
  };
  render(view([item]));
  await user.click(
    within(screen.getByRole("list", { name: "Actions" })).getByRole("button"),
  );
  expect(
    screen.getByText(
      /Your private GA4 data shows average engagement seconds per organic session changed from 40 to 25.*90 sessions.*100 sessions/,
    ),
  ).toBeVisible();
  const t = createTranslator({
    locale: "en",
    messages,
    namespace: "App.Seo",
  }) as unknown as IntlTranslation<"App.Seo">;
  expect(seoActionsExport([item], t).rows).toHaveLength(0);
  const current = seoActionsExport([{ ...item, status: "implemented" }], t);
  expect(current.rows).toHaveLength(1);
  expect(current.header).not.toContain("Review again");
});
