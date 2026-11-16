import type { ProjectSeoAction } from "@sokosumi/core-client";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";
import messages from "../../../../../messages/en.json";
import { SeoActionWorklist } from "./seo-action-worklist";
import type { SeoIssueSeverity } from "./seo-overview-model";
import { seoTestWorkspace } from "./seo-test-fixture";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

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

  it("closes the dialog of an action that left the list, and does not open it again when it comes back", async () => {
    const user = userEvent.setup();
    const { rerender } = render(view([high, low]));
    await user.click(screen.getByRole("button", { name: "Fix the redirect" }));
    expect(
      await screen.findByRole("dialog", { name: "Fix the redirect" }),
    ).toBeVisible();
    rerender(view([high]));
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(view([high, low]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
