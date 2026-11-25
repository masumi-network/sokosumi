import type {
  ProjectCompetitor,
  ProjectCompetitors,
} from "@sokosumi/core-client";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageListSearchContext } from "@/components/page-list-search";
import {
  addCompetitor,
  removeCompetitor,
  restoreCompetitor,
  runCompetitorCheck,
  setCompetitorChecks,
  updateCompetitor,
} from "@/lib/actions/competitors/action";
import messages from "@/messages/en.json";

import { CompetitorsCheckBar } from "./competitors-check-bar";
import { CompetitorsStart } from "./competitors-start";
import { CompetitorsWatchList } from "./competitors-watch-list";

vi.mock("@/components/route-poller", () => ({
  RoutePoller: () => <div data-testid="poller" />,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/competitors/action", () => ({
  addCompetitor: vi.fn(),
  addSuggestedCompetitors: vi.fn(),
  findCompetitors: vi.fn(),
  removeCompetitor: vi.fn(),
  restoreCompetitor: vi.fn(),
  runCompetitorCheck: vi.fn(),
  setCompetitorChecks: vi.fn(),
  updateCompetitor: vi.fn(),
}));

const PROJECT_ID = "project-1";
const REMOVAL = 2;
const refresh = vi.hoisted(() => vi.fn());
const source = { status: "ok" as const, needs: null };
const CHECK: ProjectCompetitors["check"] = {
  on: false,
  lastCheckedAt: null,
  nextCheckAt: null,
  creditsPerCompetitor: 3,
  sources: {
    pages: source,
    news: source,
    ads: { status: "not_configured", needs: "Ads are not set up yet." },
    social: source,
  },
};
const CALENDLY: ProjectCompetitor = {
  id: "competitor-1",
  name: "Calendly",
  websiteUrl: "https://www.calendly.com/",
  pricingUrl: "https://calendly.com/pricing",
  instagramHandle: "calendly",
  facebookHandle: null,
  source: "MEMBER",
  createdAt: new Date("2026-11-16T09:00:00Z"),
};

function show(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

function bar(
  check: Partial<ProjectCompetitors["check"]> = {},
  { readOnly = false, competitorCount = 2 } = {},
) {
  return show(
    <CompetitorsCheckBar
      check={{ ...CHECK, ...check }}
      competitorCount={competitorCount}
      projectId={PROJECT_ID}
      readOnly={readOnly}
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const action of [
    addCompetitor,
    restoreCompetitor,
    setCompetitorChecks,
    updateCompetitor,
  ])
    vi.mocked(action).mockResolvedValue({ ok: true, value: undefined });
  vi.mocked(removeCompetitor).mockResolvedValue({
    ok: true,
    value: { removal: REMOVAL },
  });
  vi.mocked(runCompetitorCheck).mockResolvedValue({
    ok: true,
    value: "checked",
  });
});

describe("CompetitorsCheckBar", () => {
  it("says the check is off and what it costs, beside the button that turns it on", async () => {
    bar();
    expect(
      screen.getByRole("heading", { name: "The weekly check is off" }),
    ).toBeVisible();
    expect(
      screen.getByText("It costs 6 credits a week for 2 competitors, 3 each."),
    ).toBeVisible();
    expect(screen.queryByTestId("poller")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Turn on weekly check" }),
    );
    expect(setCompetitorChecks).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      on: true,
    });
  });

  it("watches for the first check the member just turned on", async () => {
    const { rerender } = bar();
    await userEvent.click(
      screen.getByRole("button", { name: "Turn on weekly check" }),
    );
    // The action revalidates the page, which now reads the check as on.
    rerender(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CompetitorsCheckBar
          check={{ ...CHECK, on: true }}
          competitorCount={2}
          projectId={PROJECT_ID}
          readOnly={false}
        />
      </NextIntlClientProvider>,
    );
    expect(
      await screen.findByRole("heading", {
        name: "The first check is running",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("poller")).toBeVisible();
  });

  it("stops saying the first check is running once the page stops asking", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({
        advanceTimers: vi.advanceTimersByTime,
      });
      const { rerender } = bar();
      await user.click(
        screen.getByRole("button", { name: "Turn on weekly check" }),
      );
      // Core took the switch; the first check found too few credits and left
      // nothing behind, so the page keeps reading the check as on, unchecked.
      rerender(
        <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
          <CompetitorsCheckBar
            check={{ ...CHECK, on: true }}
            competitorCount={2}
            projectId={PROJECT_ID}
            readOnly={false}
          />
        </NextIntlClientProvider>,
      );
      expect(
        await screen.findByRole("heading", {
          name: "The first check is running",
        }),
      ).toBeVisible();
      await act(() => vi.advanceTimersByTimeAsync(45 * 4_000));
      expect(
        screen.getByRole("heading", { name: "No check has run yet" }),
      ).toBeVisible();
      expect(screen.queryByText(/about a minute/)).toBeNull();
      expect(screen.queryByTestId("poller")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not claim a check is running when none has finished since an earlier visit", async () => {
    vi.mocked(runCompetitorCheck).mockResolvedValue({
      ok: true,
      value: "unfunded",
    });
    bar({ on: true });
    expect(
      screen.getByRole("heading", { name: "No check has run yet" }),
    ).toBeVisible();
    expect(screen.queryByText(/about a minute/)).toBeNull();
    expect(screen.queryByTestId("poller")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This check costs 6 credits and the workspace has fewer.",
    );
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
  });

  it("says when it last ran, without Check now and without watching", () => {
    bar({
      on: true,
      lastCheckedAt: new Date("2026-11-16T09:00:00Z"),
      nextCheckAt: new Date("2026-11-22T21:00:00Z"),
    });
    expect(
      screen.getByRole("heading", { name: "The weekly check is on" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Last check Nov 16, next Nov 22. It costs 6 credits a week for 2 competitors, 3 each.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
    expect(screen.queryByTestId("poller")).toBeNull();
  });

  it("names a source the last check could not read", () => {
    bar({
      on: true,
      lastCheckedAt: new Date("2026-11-16T09:00:00Z"),
      sources: {
        ...CHECK.sources,
        pages: { status: "failed", needs: null },
      },
    });
    expect(
      screen.getByText(
        "The last check could not read: websites. The next one tries again.",
      ),
    ).toBeVisible();
  });

  it("says only that the next check tries again while the check is on", () => {
    bar({
      lastCheckedAt: new Date("2026-11-16T09:00:00Z"),
      sources: {
        ...CHECK.sources,
        pages: { status: "failed", needs: null },
      },
    });
    expect(
      screen.getByText("The last check could not read: websites."),
    ).toBeVisible();
    expect(screen.queryByText(/next one tries again/)).toBeNull();
  });

  it("has no controls on a CMO Project, and says CMO runs its first check", () => {
    bar({ on: true }, { readOnly: true });
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "No check has run yet" }),
    ).toBeVisible();
    expect(
      screen.getByText(/CMO runs it while Cuso is paid for\./),
    ).toBeVisible();
    expect(screen.queryByTestId("poller")).toBeNull();
  });
});

describe("CompetitorsWatchList", () => {
  function list(competitors = [CALENDLY], readOnly = false, limit = 5) {
    return show(
      <CompetitorsWatchList
        competitors={competitors}
        limit={limit}
        projectId={PROJECT_ID}
        projectName="Cal.com"
        readOnly={readOnly}
      />,
    );
  }

  it("lists each competitor with what the check reads", () => {
    list();
    expect(screen.getByText("Calendly")).toBeVisible();
    expect(
      screen.getByText("calendly.com · pricing page · @calendly"),
    ).toBeVisible();
    expect(screen.getByText("1 of 5")).toBeVisible();
  });

  it("adds a competitor and shows Core's refusal in the form", async () => {
    vi.mocked(addCompetitor).mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", message: "You already track this competitor" },
    });
    list();
    await userEvent.click(
      screen.getByRole("button", { name: "Add competitor" }),
    );
    await userEvent.type(screen.getByLabelText("Name"), "Zcal");
    await userEvent.type(screen.getByLabelText("Website"), "zcal.co");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already track this competitor",
    );
    expect(addCompetitor).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      name: "Zcal",
      websiteUrl: "zcal.co",
      pricingUrl: null,
      instagramHandle: null,
      facebookHandle: null,
    });

    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits one, clearing a field that was emptied", async () => {
    list();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit Calendly" }),
    );
    await userEvent.clear(screen.getByLabelText("Pricing page"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateCompetitor).toHaveBeenCalledWith(
        expect.objectContaining({
          competitorId: "competitor-1",
          name: "Calendly",
          pricingUrl: null,
          instagramHandle: "calendly",
        }),
      ),
    );
  });

  const ZCAL: ProjectCompetitor = {
    ...CALENDLY,
    id: "competitor-2",
    name: "Zcal",
    websiteUrl: "https://zcal.co/",
    pricingUrl: null,
    instagramHandle: null,
    facebookHandle: "zcal",
  };

  /** Clicks Undo on the toast the last remove showed. */
  async function undo() {
    const action = vi.mocked(toast.success).mock.calls[0]?.[1]?.action as
      | { onClick: () => void }
      | undefined;
    await act(async () => action?.onClick());
  }

  /** A remove Core has not answered yet, and the way to answer it. */
  function pendingRemove() {
    let answer: (result: { ok: true; value: { removal: number } }) => void =
      () => {};
    vi.mocked(removeCompetitor).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    return () =>
      act(async () => answer({ ok: true, value: { removal: REMOVAL } }));
  }

  const START = (
    <CompetitorsStart
      creditsPerCompetitor={3}
      limit={5}
      projectId={PROJECT_ID}
      projectName="Cal.com"
    />
  );

  /** Core's answer re-renders the page: the list gives way to the start. */
  function becomesStart(rerender: (ui: React.ReactNode) => void) {
    rerender(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {START}
      </NextIntlClientProvider>,
    );
  }

  it("removes one at once, moves focus to the next Remove and offers Undo", async () => {
    const answer = pendingRemove();
    list([CALENDLY, ZCAL]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    expect(screen.queryByText("Calendly")).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Zcal" })).toHaveFocus();
    expect(removeCompetitor).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      competitorId: "competitor-1",
    });
    expect(toast.success).not.toHaveBeenCalled();

    await answer();
    expect(toast.success).toHaveBeenCalledWith("Calendly removed", {
      action: { label: "Undo", onClick: expect.any(Function) },
    });
  });

  it("undoes exactly that removal through Core, without sending details", async () => {
    list([CALENDLY, ZCAL]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await undo();
    expect(restoreCompetitor).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      competitorId: "competitor-1",
      removal: REMOVAL,
    });
    expect(addCompetitor).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  /** Clicks the action on the last error toast. */
  async function tryAgain() {
    const action = vi.mocked(toast.error).mock.lastCall?.[1]?.action as
      | { onClick: () => void }
      | undefined;
    await act(async () => action?.onClick());
  }

  async function removeThenUndo() {
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await undo();
  }

  it.each([
    ["competitor_removal_stale", "Removing Calendly can no longer be undone."],
    [
      "competitor_name_taken",
      "Calendly could not come back: another competitor has its name now.",
    ],
  ])("says why Core refused the Undo for good (%s)", async (kind, words) => {
    vi.mocked(restoreCompetitor).mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", kind, message: "Core's own English" },
    });
    list([CALENDLY]);
    await removeThenUndo();
    expect(toast.error).toHaveBeenCalledWith(words);
  });

  it("shows what is there now when the removal can no longer be undone", async () => {
    vi.mocked(restoreCompetitor).mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", kind: "competitor_removal_stale" },
    });
    list([CALENDLY]);
    await removeThenUndo();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps Undo on the toast when the list is full, and it still undoes that removal", async () => {
    vi.mocked(restoreCompetitor).mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFLICT", kind: "competitor_limit_reached" },
    });
    list([CALENDLY]);
    await removeThenUndo();
    expect(toast.error).toHaveBeenCalledWith(
      "Calendly could not come back: you already watch 5. Remove one first.",
      { action: { label: "Undo", onClick: expect.any(Function) } },
    );
    await tryAgain();
    expect(restoreCompetitor).toHaveBeenCalledTimes(2);
    expect(restoreCompetitor).toHaveBeenLastCalledWith({
      projectId: PROJECT_ID,
      competitorId: "competitor-1",
      removal: REMOVAL,
    });
  });

  it.each([
    ["a refusal without a reason", "ok"],
    ["a failed request", "throws"],
  ])("offers to try the same Undo again after %s", async (_case, how) => {
    if (how === "throws")
      vi.mocked(restoreCompetitor).mockRejectedValueOnce(
        new Error("Core auth unavailable"),
      );
    else
      vi.mocked(restoreCompetitor).mockResolvedValueOnce({
        ok: false,
        error: { code: "INTERNAL_SERVER_ERROR", message: "Core's own English" },
      });
    list([CALENDLY]);
    await removeThenUndo();
    expect(toast.error).toHaveBeenCalledWith("Calendly could not come back.", {
      action: { label: "Try again", onClick: expect.any(Function) },
    });
    await tryAgain();
    expect(restoreCompetitor).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it("sends one Undo however often it is clicked while it runs", async () => {
    let answer: (result: { ok: true; value: undefined }) => void = () => {};
    vi.mocked(restoreCompetitor).mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    list([CALENDLY]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const action = vi.mocked(toast.success).mock.calls[0]?.[1]
      ?.action as unknown as { onClick: () => void };
    action.onClick();
    action.onClick();
    await act(async () => answer({ ok: true, value: undefined }));
    expect(restoreCompetitor).toHaveBeenCalledTimes(1);
  });

  it("sends a signed-out member to sign in from Undo", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.mocked(restoreCompetitor).mockRejectedValueOnce(
      Object.assign(new Error("masked"), { digest: "UNAUTHENTICATED" }),
    );
    list([CALENDLY]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await undo();
    expect(assign).toHaveBeenCalledWith(
      expect.stringMatching(/^\/signin\?returnUrl=/),
    );
    expect(toast.error).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("moves focus to the Remove before it when the last row goes", async () => {
    const answer = pendingRemove();
    list([CALENDLY, ZCAL]);
    await userEvent.click(screen.getByRole("button", { name: "Remove Zcal" }));
    expect(
      screen.getByRole("button", { name: "Remove Calendly" }),
    ).toHaveFocus();
    await answer();
  });

  it("moves focus to Add once it shows, when a full list filtered to one loses it", async () => {
    const answer = pendingRemove();
    const five = ["A1", "B2", "C3", "D4", "E5"].map((name, index) => ({
      ...CALENDLY,
      id: `competitor-${index}`,
      name,
    }));
    render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <PageListSearchContext.Provider
          value={{ query: "C3", register: () => () => {} }}
        >
          <CompetitorsWatchList
            competitors={five}
            limit={5}
            projectId={PROJECT_ID}
            projectName="Cal.com"
            readOnly={false}
          />
        </PageListSearchContext.Provider>
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Add competitor" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove C3" }));
    expect(
      screen.getByRole("button", { name: "Add competitor" }),
    ).toHaveFocus();
    await answer();
  });

  it("moves focus to Add competitor, then to the start's Add, when the list empties", async () => {
    const answer = pendingRemove();
    const { rerender } = list([CALENDLY]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    expect(
      screen.getByRole("button", { name: "Add competitor" }),
    ).toHaveFocus();
    await answer();
    becomesStart(rerender);
    expect(screen.getByRole("button", { name: "Add by hand" })).toHaveFocus();
  });

  it("leaves focus where the member moved it before the start shows", async () => {
    const answer = pendingRemove();
    const { rerender } = list([CALENDLY]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    const elsewhere = document.createElement("button");
    document.body.append(elsewhere);
    elsewhere.focus();
    await answer();
    becomesStart(rerender);
    expect(elsewhere).toHaveFocus();
    elsewhere.remove();
  });

  it("hands nothing to a start shown after a failed final remove", async () => {
    vi.mocked(removeCompetitor).mockResolvedValueOnce({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Core is down" },
    });
    const { unmount } = list([CALENDLY]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    await screen.findByRole("alert");
    unmount();
    (document.activeElement as HTMLElement | null)?.blur();
    show(START);
    expect(
      screen.getByRole("button", { name: "Add by hand" }),
    ).not.toHaveFocus();
  });

  it("hands nothing to a start shown after the list left the page", async () => {
    const answer = pendingRemove();
    const { unmount } = list([CALENDLY]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    // The member opened another page before Core answered.
    unmount();
    await answer();
    show(START);
    expect(
      screen.getByRole("button", { name: "Add by hand" }),
    ).not.toHaveFocus();
  });

  it("brings the row back and says why when the remove fails, without Undo", async () => {
    vi.mocked(removeCompetitor).mockResolvedValueOnce({
      ok: false,
      error: { code: "NOT_FOUND", message: "Competitor not found" },
    });
    list([CALENDLY, ZCAL]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Competitor not found",
    );
    expect(await screen.findByText("Calendly")).toBeVisible();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("offers no Add at the limit and no controls on a CMO Project", () => {
    const { unmount } = list([CALENDLY], false, 1);
    expect(screen.queryByRole("button", { name: "Add competitor" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Find competitors" }),
    ).toBeNull();
    expect(
      screen.getByText("That is all 1. Remove one to watch another."),
    ).toBeVisible();
    unmount();
    list([CALENDLY], true);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CompetitorsStart", () => {
  function start() {
    return show(
      <CompetitorsStart
        creditsPerCompetitor={3}
        limit={5}
        projectId={PROJECT_ID}
        projectName="Cal.com"
      />,
    );
  }

  it("says what the check gives, shows an example and what it costs", () => {
    start();
    expect(
      screen.getByRole("heading", {
        name: "See what your competitors changed this week",
      }),
    ).toBeVisible();
    const example = within(screen.getByRole("list", { name: "Example" }));
    expect(example.getAllByRole("listitem")).toHaveLength(3);
    expect(
      example.getByText("Pro plan $12 -> $10 per seat a month"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Finding competitors is free. The weekly check costs 3 credits per competitor a week and stays off until you turn it on.",
      ),
    ).toBeVisible();
  });

  it("has one main action, finding competitors, and adding by hand beside it", async () => {
    start();
    expect(
      screen.getByRole("button", { name: "Find competitors" }),
    ).toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "Add by hand" })).not.toHaveClass(
      "bg-primary",
    );
    await userEvent.click(screen.getByRole("button", { name: "Add by hand" }));
    await userEvent.type(screen.getByLabelText("Name"), "Zcal");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(addCompetitor).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT_ID, name: "Zcal" }),
      ),
    );
  });
});
