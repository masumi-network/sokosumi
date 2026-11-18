import type {
  ProjectCompetitor,
  ProjectCompetitors,
} from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
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

import { CompetitorsCheckCard } from "./competitors-check-card";
import { CompetitorsWatchList } from "./competitors-watch-list";

vi.mock("@/lib/actions/competitors/action", () => ({
  addCompetitor: vi.fn(),
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

function card(
  check: Partial<ProjectCompetitors["check"]> = {},
  readOnly = false,
) {
  return show(
    <CompetitorsCheckCard
      check={{ ...CHECK, ...check }}
      competitorCount={2}
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

describe("CompetitorsCheckCard", () => {
  it("shows the weekly price beside the button that turns the check on", async () => {
    card();
    expect(
      screen.getByText(/It costs 3 credits per competitor a week\./),
    ).toHaveTextContent("With 2 competitors that is 6 credits a week.");
    await userEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(setCompetitorChecks).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      on: true,
    });
  });

  it("offers the first check once on, and says why it did not run", async () => {
    vi.mocked(runCompetitorCheck).mockResolvedValue({
      ok: true,
      value: "unfunded",
    });
    card({ on: true });
    await userEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This check costs 6 credits and the workspace has fewer.",
    );
    expect(screen.getByRole("button", { name: "Turn off" })).toBeEnabled();
  });

  it("says when it last ran and what a source needs, without Check now", () => {
    card({
      on: true,
      lastCheckedAt: new Date("2026-11-16T09:00:00Z"),
      nextCheckAt: new Date("2026-11-22T21:00:00Z"),
    });
    expect(screen.getByText("Last check Nov 16, next Nov 22.")).toBeVisible();
    expect(screen.getByText("Ads are not set up yet.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
  });

  it("has no controls on a CMO Project", () => {
    card({ on: true }, true);
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
      screen.getByText("That is all 1. Remove one to watch another."),
    ).toBeVisible();
    unmount();
    list([CALENDLY], true);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
