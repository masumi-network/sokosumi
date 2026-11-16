import type { ProjectSeoAction } from "@sokosumi/core-client";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoActionWorklist } from "./seo-action-worklist";
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

function view(actions: ProjectSeoAction[]) {
  return (
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SeoActionWorklist
        actions={actions}
        severity={severity}
        model={model}
        tools={null}
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
          severity={severity}
          model={
            {
              ...model,
              shownAction: seoActionKey(low),
              setShownAction,
            } as unknown as SeoWorkspaceModel
          }
          tools={null}
        />
      </NextIntlClientProvider>,
    );
    expect(
      await screen.findByRole("dialog", { name: "Fix the redirect" }),
    ).toBeVisible();
    expect(setShownAction).toHaveBeenCalledWith(null);
    await user.keyboard("{Escape}");
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
