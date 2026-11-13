import type {
  ProjectSeoMonitor,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SeoAutomation } from "./seo-monitors";
import { SEO_TEST_PAGE, seoTestWorkspace } from "./seo-test-fixture";
import { useSeoWorkspace } from "./use-seo-workspace";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("next/navigation", async () => ({
  ...(await vi.importActual<typeof import("next/navigation")>(
    "next/navigation",
  )),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/actions/seo/action", () => ({ mutateSeo: mutate }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      session: { activeOrganizationId: "org" },
      user: { id: "owner" },
    },
  }),
}));

const MONITOR_ID = "6b0b1f8e-1f61-4a49-9b8e-2f0f3a7c1d01";
const t = messages.App.Seo.monitor;

function monitor(patch: Partial<ProjectSeoMonitor> = {}): ProjectSeoMonitor {
  return {
    id: MONITOR_ID,
    name: "SEO weekly page_check",
    state: "ACTIVE",
    revision: 3,
    createdAt: new Date("2026-11-01T08:00:00Z"),
    nextRunAt: new Date("2026-11-16T08:00:00Z"),
    rule: {
      expr: "0 9 * * MON",
      timezone: "Europe/Berlin",
      endsMode: "AFTER",
      targetRunCount: 4,
    },
    releasedCount: 2,
    pageIds: [SEO_TEST_PAGE],
    scopeVersion: 2,
    countryCode: "US",
    languageCode: "en",
    devices: ["mobile", "desktop"],
    kind: "page_check",
    maxProviderCalls: 0,
    isOwner: true,
    lastRun: {
      at: new Date("2026-11-09T08:00:00Z"),
      status: "completed",
      taskId: null,
    },
    change: null,
    ...patch,
  };
}

function Panel({ workspace }: { workspace: ProjectSeoWorkspace }) {
  return <SeoAutomation model={useSeoWorkspace(workspace)} />;
}
function mountCard(workspace: ProjectSeoWorkspace) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(workspace)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        timeZone="UTC"
        formats={createFormats()}
        messages={messages}
      >
        <NuqsTestingAdapter>
          <Panel workspace={workspace} />
        </NuqsTestingAdapter>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
function renderCard(workspace: ProjectSeoWorkspace) {
  mountCard(workspace);
  return screen.getByTestId("seo-automation");
}
function withMonitors(...monitors: ProjectSeoMonitor[]) {
  const workspace = seoTestWorkspace();
  workspace.monitors = monitors;
  return workspace;
}

beforeEach(() => {
  vi.clearAllMocks();
  mutate.mockResolvedValue({ ok: true, value: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SEO monitor card", () => {
  it("shows no card before the first monitor, where a schedule can be made: the run's arrow makes it", () => {
    const workspace = withMonitors();
    expect(workspace.availableActions.canCreateMonitor).toBe(true);
    mountCard(workspace);
    expect(screen.queryByTestId("seo-automation")).toBeNull();
    expect(screen.queryByRole("heading", { name: t.title })).toBeNull();
  });

  it("shows the plan in words, the last run, the runs left, and keeps the create button", () => {
    const card = renderCard(withMonitors(monitor()));
    expect(
      within(card).getByText(
        "Page check for 1 saved page, every Monday at 9:00 AM (Europe/Berlin). Ends after 4 scheduled runs.",
      ),
    ).toBeVisible();
    expect(within(card).getByText(/Completed,/)).toBeVisible();
    expect(within(card).getByText("2 runs")).toBeVisible();
    expect(within(card).getByText(t.change.none)).toBeVisible();
    expect(
      within(card).getByRole("button", { name: t.createAnother }),
    ).toBeEnabled();
  });

  it("names what got worse and what got better, with the items one press away", async () => {
    const user = userEvent.setup();
    const card = renderCard(
      withMonitors(
        monitor({
          change: {
            from: new Date("2026-11-02T08:00:00Z"),
            to: new Date("2026-11-09T08:00:00Z"),
            comparable: true,
            newFailureCount: 1,
            fixedCount: 1,
            newFailures: [
              {
                rowId: "title",
                title: "Title too long",
                pageUrl: "https://example.com/pricing",
                device: "desktop",
              },
            ],
            fixed: [
              {
                rowId: "h1",
                title: "Missing H1",
                pageUrl: "https://example.com/",
                device: "mobile",
              },
            ],
            moves: [
              {
                keyword: "agent payments",
                pageUrl: "https://example.com/",
                device: "mobile",
                from: 2,
                to: 9,
              },
            ],
            moveCount: 1,
            dropCount: 1,
          },
        }),
      ),
    );
    const summary = within(card).getByRole("button", {
      name: "Since the last run: 1 new failure, 1 fixed, and 1 ranking drop",
    });
    expect(within(card).queryByText("Title too long")).toBeNull();
    await user.click(summary);
    expect(within(card).getByText("Title too long")).toBeVisible();
    expect(within(card).getByText("Missing H1")).toBeVisible();
    expect(
      within(card).getByText("agent payments: position 2 → 9"),
    ).toBeVisible();
  });

  it("pauses an active monitor and resumes a paused one", async () => {
    const user = userEvent.setup();
    let card = renderCard(withMonitors(monitor()));
    await user.click(within(card).getByRole("button", { name: t.pause }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].command).toEqual({
      kind: "monitor_state",
      monitorId: MONITOR_ID,
      action: "pause",
    });
    document.body.innerHTML = "";
    card = renderCard(withMonitors(monitor({ state: "PAUSED" })));
    expect(within(card).getByText(t.pausedNext)).toBeVisible();
    await user.click(within(card).getByRole("button", { name: t.resume }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1][0].command.action).toBe("resume");
  });

  it("lets another member pause, but only the owner run now or edit", async () => {
    const user = userEvent.setup();
    const card = renderCard(withMonitors(monitor({ isOwner: false })));
    expect(
      within(card).queryByRole("button", { name: t.runNow }),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByRole("button", { name: t.edit }),
    ).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: t.pause }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
  });

  it("runs now against the revision it shows", async () => {
    const user = userEvent.setup();
    const card = renderCard(withMonitors(monitor()));
    await user.click(within(card).getByRole("button", { name: t.runNow }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command).toEqual({
      kind: "monitor_run_now",
      monitorId: MONITOR_ID,
      expectedRevision: 3,
    });
  });

  it("ends a monitor only after the reader confirms", async () => {
    const user = userEvent.setup();
    const card = renderCard(withMonitors(monitor()));
    await user.click(within(card).getByRole("button", { name: t.end }));
    expect(mutate).not.toHaveBeenCalled();
    const confirm = await screen.findByRole("alertdialog");
    await user.click(
      within(confirm).getByRole("button", { name: t.endConfirm }),
    );
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command.action).toBe("end");
  });

  it("edits only the rule, and refuses a count at or below the runs already made", async () => {
    const user = userEvent.setup();
    const card = renderCard(withMonitors(monitor()));
    await user.click(within(card).getByRole("button", { name: t.edit }));
    const count = within(card).getByLabelText("Ends", { selector: "input" });
    fireEvent.change(count, { target: { value: "2" } });
    expect(
      within(card).getByText(
        "This check already ran 2 times. Choose a higher count, or let it run until someone stops it.",
      ),
    ).toBeVisible();
    const save = within(card).getByRole("button", { name: t.saveRule });
    expect(save).toBeDisabled();
    fireEvent.change(count, { target: { value: "6" } });
    await user.click(within(card).getByRole("button", { name: "Daily" }));
    await user.click(save);
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0].command).toEqual({
      kind: "monitor_update",
      monitorId: MONITOR_ID,
      expectedRevision: 3,
      rule: {
        expr: "0 9 * * *",
        timezone: "Europe/Berlin",
        endsMode: "AFTER",
        targetRunCount: 6,
      },
    });
  });

  it("warns when the page group changed after the monitor froze its pages", () => {
    const workspace = withMonitors(monitor());
    workspace.scope.pageIds = [
      SEO_TEST_PAGE,
      "9b1d3c55-7b70-4ad1-9a43-7b7f0f6c2a10",
    ];
    const card = renderCard(workspace);
    expect(
      within(card).getByText(/The selected page group changed/),
    ).toBeVisible();
  });

  it("shows an ended monitor without commands, and a read-only reader no commands at all", () => {
    let card = renderCard(withMonitors(monitor({ state: "ENDED" })));
    expect(within(card).getByText("None")).toBeVisible();
    expect(within(card).queryByRole("button", { name: t.runNow })).toBeNull();
    expect(within(card).queryByRole("button", { name: t.edit })).toBeNull();
    document.body.innerHTML = "";
    const workspace = withMonitors(monitor());
    workspace.availableActions.canEdit = false;
    card = renderCard(workspace);
    expect(within(card).getByText(t.blocked.readOnly)).toBeVisible();
    expect(within(card).queryByRole("button", { name: t.pause })).toBeNull();
    expect(
      within(card).getByRole("button", { name: t.createAnother }),
    ).toBeDisabled();
  });
});
