import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoActionTaskButton } from "./seo-action-finding";
import { SeoChatTurn } from "./seo-chat-turn";
import { SeoSeasonalIdeas } from "./seo-seasonal-ideas";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

type Idea = NonNullable<SeoWorkspaceModel["data"]["seasonalIdeas"]>[number];
const data = seoTestWorkspace();
const winter: Idea = {
  keyword: "sail storage",
  audience: "boat owners",
  country: "DE",
  language: "de",
  url: data.pages[0].url,
  asOf: new Date("2026-11-01T00:00:00Z"),
  pageQuote: "Learn about sail storage for the winter.",
  action: "investigate_angle",
  event: null,
  limitations: ["timing_uncertain"],
  comparison: null,
  windows: [
    {
      targetPeriod: "2026-12",
      historicalPeriod: "2025-12",
      historicalVolume: 80,
      baselineMedian: 15,
    },
  ],
};
const holiday: Idea = {
  ...winter,
  keyword: "festive boat tour",
  audience: "festival visitors",
  country: "IN",
  language: "en",
  pageQuote: "Join our Diwali boat tour on the river.",
  event: {
    name: "Diwali",
    scope: "Uttarakhand government offices",
    date: new Date("2026-11-08T00:00:00Z"),
  },
  windows: [],
  comparison: {
    leadMonth: { period: "2025-09", volume: 5 },
    eventMonth: { period: "2025-10", volume: 10 },
    baselineMedian: 12,
    status: "no_observed_rise",
  },
};
type Action = SeoWorkspaceModel["data"]["actions"][number];
const update: Action = {
  id: "seasonal:1",
  observationId: "00000000-0000-4000-8000-000000000001",
  pageUrl: data.pages[0].url,
  findingIds: [],
  title: 'Update the page for "sail storage" before 2026-12',
  why: "The audited page covers this search.",
  effort: "unknown",
  expectedEffect: "Hypothesis.",
  edit: null,
  taskId: null,
  status: "recommended",
  kind: "opportunity",
  evidence: [],
};
const createActionTask = vi.fn<SeoWorkspaceModel["createActionTask"]>();
function page(
  ideas?: Idea[],
  keywordSearch = "",
  now = new Date("2026-11-19T12:00:00Z"),
  actions: Action[] = [],
) {
  return (
    <NextIntlClientProvider
      key={now.toISOString()}
      locale="en"
      messages={messages}
      now={now}
      timeZone="America/Los_Angeles"
    >
      <SeoSeasonalIdeas
        model={
          {
            data: { ...data, actions, seasonalIdeas: ideas },
            keywordSearch,
            pending: false,
            createActionTask,
          } as unknown as SeoWorkspaceModel
        }
      />
    </NextIntlClientProvider>
  );
}
afterEach(cleanup);

it("shows the month to plan for and opens the source figures on demand", async () => {
  const user = userEvent.setup();
  const view = render(page([winter], "sail"));
  expect(screen.getByRole("heading", { name: winter.keyword })).toBeVisible();
  expect(screen.getByText("Plan for December 2026")).toBeVisible();
  const summary = screen.getByText("Page and demand evidence");
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await user.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(screen.getByText(winter.pageQuote)).toBeVisible();
  expect(
    screen.getByText(
      /For December 2026, review December 2025: 80 estimated local searches/,
    ),
  ).toBeVisible();
  expect(screen.getByText(/earlier three-month median was 15/)).toBeVisible();
  view.rerender(page([winter], "unrelated"));
  expect(screen.queryByRole("heading")).toBeNull();
  view.rerender(page());
  expect(screen.queryByRole("heading")).toBeNull();
});

it("identifies the comparison months when a full preceding baseline is unavailable", async () => {
  const referenceMonths = [
    "2026-03",
    "2026-04",
    "2026-05",
    "2026-06",
    "2026-07",
    "2026-08",
  ];
  const user = userEvent.setup();
  render(
    page([{ ...winter, windows: [{ ...winter.windows[0], referenceMonths }] }]),
  );
  await user.click(screen.getByText("Page and demand evidence"));
  expect(
    screen.getByText(
      /The median was 15 across the other observed months \(March 2026.*August 2026\)/,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/earlier three-month median/)).toBeNull();
});

it("finds a local event by name and preserves its date and demand result across time zones", () => {
  render(page([holiday], "Diwali"));
  expect(screen.getByText("Diwali · Nov 8, 2026")).toBeVisible();
  expect(screen.getByText("Uttarakhand government offices")).toBeVisible();
  expect(screen.getByText(/Audit on Nov 1, 2026/)).toBeVisible();
  expect(
    screen.getByText(
      "Local searches did not rise above the earlier median last year.",
    ),
  ).toBeVisible();
});

it("shows the available estimate even when history cannot support a seasonal comparison", async () => {
  const user = userEvent.setup();
  render(
    page([
      {
        ...holiday,
        limitations: ["demand_unverified"],
        comparison: {
          leadMonth: { period: "2025-09", volume: null },
          eventMonth: { period: "2025-10", volume: 0 },
          baselineMedian: null,
          status: "insufficient",
        },
      },
    ]),
  );
  expect(
    screen.getByText("Check local demand before deciding when to publish."),
  ).toBeVisible();
  await user.click(screen.getByText("Page and demand evidence"));
  expect(
    screen.getByText(/October 2025: 0.*too little data to compare demand/),
  ).toBeVisible();
  expect(screen.queryByText(/September 2025/)).toBeNull();
});

it("states that an older report's planned months and event date have passed", () => {
  const january = new Date("2027-01-10T12:00:00Z");
  const view = render(
    page(
      [{ ...winter, actionId: update.id, action: "improve_existing_page" }],
      "",
      january,
      [update],
    ),
  );
  expect(screen.queryByText(/Plan for/)).toBeNull();
  expect(
    screen.getByText(
      "This timing has passed (December 2026). Run a new audit to plan the next season.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Create draft task/ }),
  ).toBeNull();
  view.rerender(page([holiday], "", january));
  expect(screen.getByText("Diwali · Nov 8, 2026")).toBeVisible();
  expect(
    screen.getByText(/This timing has passed \(Nov 8, 2026\)/),
  ).toBeVisible();
  view.rerender(
    page([{ ...winter, actionId: update.id }], "", january, [
      { ...update, taskId: "task-1", status: "task_created" },
    ]),
  );
  expect(screen.getByRole("link", { name: /Open task/ })).toHaveAttribute(
    "href",
    "/tasks/task-1",
  );
});

it("explains why a seasonal draft already linked to an inaccessible Task cannot be created", () => {
  render(
    page([{ ...winter, actionId: update.id }], "", undefined, [
      { ...update, status: "unavailable" },
    ]),
  );
  expect(screen.getByText("Task unavailable")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Create draft task/ }),
  ).toBeNull();
});

it("keeps a current planned month and an event on its market day", () => {
  const view = render(
    page(
      [
        {
          ...winter,
          windows: [
            { ...winter.windows[0], targetPeriod: "2026-11" },
            winter.windows[0],
          ],
        },
      ],
      "",
      new Date("2026-11-30T22:59:00Z"),
    ),
  );
  expect(
    screen.getByText("Plan for November 2026 and December 2026"),
  ).toBeVisible();
  view.rerender(page([holiday], "", new Date("2026-11-08T18:29:00Z")));
  expect(screen.queryByText(/has passed/)).toBeNull();
});

it("shows the measured months of a query without a qualifying rise", async () => {
  const user = userEvent.setup();
  render(
    page([
      {
        ...winter,
        windows: [],
        observedMonths: [
          { period: "2025-12", volume: 40 },
          { period: "2026-10", volume: 0 },
        ],
      },
    ]),
  );
  expect(
    screen.getByText(
      "Last year, local searches did not rise clearly in this month or the next three.",
    ),
  ).toBeVisible();
  await user.click(screen.getByText("Page and demand evidence"));
  expect(
    screen.getByText(
      "Estimated local searches for this exact query: December 2025: 40 and October 2026: 0.",
    ),
  ).toBeVisible();
});

it("drafts the existing page update from a supported idea", async () => {
  const user = userEvent.setup();
  render(
    page(
      [{ ...winter, action: "improve_existing_page", actionId: update.id }],
      "",
      undefined,
      [update],
    ),
  );
  expect(
    screen.getByText("Update the existing page for boat owners."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Create draft task/ }));
  expect(createActionTask).toHaveBeenCalledWith(update);
});

it("rechecks a cached worklist and chat before offering to draft seasonal work", () => {
  const idea = { ...winter, actionId: update.id };
  const entryPoints = (now: Date, action: Action) => {
    const model = {
      data: { ...data, actions: [action], seasonalIdeas: [idea] },
      pending: false,
      createActionTask,
    } as unknown as SeoWorkspaceModel;
    return (
      <NextIntlClientProvider
        key={now.toISOString()}
        locale="en"
        messages={messages}
        formats={createFormats()}
        now={now}
        timeZone="UTC"
      >
        <SeoActionTaskButton model={model} action={action} />
        <SeoChatTurn
          model={model}
          mine
          turn={{
            id: "old-reply",
            question: "What should I do?",
            response: "Update the page.",
            status: "completed",
            actions: [
              {
                kind: "task",
                actionId: action.id,
                observationId: action.observationId,
              },
            ],
            createdAt: idea.asOf,
            scope: {
              name: "Scope",
              pageIds: [],
              scopeId: null,
              version: 1,
              from: null,
              to: null,
            },
          }}
        />
      </NextIntlClientProvider>
    );
  };
  const view = render(entryPoints(new Date("2026-12-31T22:59:00Z"), update));
  expect(
    screen.getAllByRole("button", { name: /create draft task/i }),
  ).toHaveLength(2);
  view.rerender(entryPoints(new Date("2026-12-31T23:00:00Z"), update));
  expect(
    screen.queryByRole("button", { name: /create draft task/i }),
  ).toBeNull();
  view.rerender(
    entryPoints(new Date("2027-01-01T12:00:00Z"), {
      ...update,
      status: "task_created",
      taskId: "existing",
    }),
  );
  expect(screen.getAllByRole("link", { name: /open task/i })).toHaveLength(2);
});

it("withdraws an open seasonal offer when its last month ends while the owner is reading", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  try {
    vi.setSystemTime(new Date("2026-12-31T22:59:45Z"));
    render(
      page([{ ...winter, actionId: update.id }], "", new Date(), [update]),
    );
    expect(
      screen.getByRole("button", { name: /create draft task/i }),
    ).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      screen.queryByRole("button", { name: /create draft task/i }),
    ).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
