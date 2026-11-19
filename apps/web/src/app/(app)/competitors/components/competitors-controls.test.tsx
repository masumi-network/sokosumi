import type {
  ProjectCompetitor,
  ProjectCompetitors,
} from "@sokosumi/core-client";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCompetitor,
  removeCompetitor,
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
vi.mock("@/lib/actions/competitors/action", () => ({
  addCompetitor: vi.fn(),
  addSuggestedCompetitors: vi.fn(),
  findCompetitors: vi.fn(),
  removeCompetitor: vi.fn(),
  runCompetitorCheck: vi.fn(),
  setCompetitorChecks: vi.fn(),
  updateCompetitor: vi.fn(),
}));

const PROJECT_ID = "project-1";
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
    removeCompetitor,
    setCompetitorChecks,
    updateCompetitor,
  ])
    vi.mocked(action).mockResolvedValue({ ok: true, value: undefined });
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

  it("watches for the first check once on, and says why it did not run", async () => {
    vi.mocked(runCompetitorCheck).mockResolvedValue({
      ok: true,
      value: "unfunded",
    });
    bar({ on: true });
    expect(
      screen.getByRole("heading", { name: "The first check is running" }),
    ).toBeVisible();
    expect(screen.getByTestId("poller")).toBeVisible();
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

  it("has no controls on a CMO Project", () => {
    bar({ on: true }, { readOnly: true });
    expect(screen.queryByRole("button")).toBeNull();
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

  it("removes one", async () => {
    list();
    await userEvent.click(
      screen.getByRole("button", { name: "Remove Calendly" }),
    );
    expect(removeCompetitor).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      competitorId: "competitor-1",
    });
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
