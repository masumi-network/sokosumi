import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock(
  "@/app/projects/components/social-posts/social-post-statistics",
  () => ({
    SocialPostStatistics: ({ workspaceId }: { workspaceId: string }) => (
      <p data-testid="workspace-performance" data-workspace={workspaceId}>
        Workspace performance
      </p>
    ),
  }),
);

// The prompt reaches for the sidebar switcher; here only its copy matters.
vi.mock("./social-accounts-project-prompt", () => ({
  SocialAccountsProjectPrompt: ({
    kind = "accounts",
    notice,
  }: {
    kind?: string;
    notice?: string;
  }) => <p>{notice ?? `choose a project for ${kind}`}</p>,
}));

import { SocialAllProjectsTabs } from "./social-all-projects-tabs";

function renderTabs(searchParams = "", notice?: string) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <SocialAllProjectsTabs
        workspaceId="workspace-1"
        actions={<button type="button">New post</button>}
        calendar={<p>Calendar panel</p>}
        notice={notice}
      />
    </NuqsTestingAdapter>,
  );
}

describe("SocialAllProjectsTabs", () => {
  it("shows the same tabs a project gets, opening on the calendar", () => {
    renderTabs();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "sections.calendar",
      "sections.drafts",
      "sections.statistics",
      "sections.accounts",
    ]);
    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "New post" })).toBeVisible();
  });

  it("asks for a project on Drafts and Accounts", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole("tab", { name: "sections.drafts" }));
    expect(screen.getByText("choose a project for drafts")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "sections.statistics" }));
    expect(screen.getByText("Workspace performance")).toBeVisible();
    expect(screen.getByTestId("workspace-performance")).toHaveAttribute(
      "data-workspace",
      "workspace-1",
    );

    await user.click(screen.getByRole("tab", { name: "sections.accounts" }));
    expect(screen.getByText("choose a project for accounts")).toBeVisible();
  });

  it("opens the tab the URL names, and falls back for a project-only one", () => {
    const { unmount } = renderTabs("?tab=accounts");
    expect(
      screen.getByRole("tab", { name: "sections.accounts" }),
    ).toHaveAttribute("aria-selected", "true");
    unmount();

    renderTabs("?tab=attention");
    expect(
      screen.getByRole("tab", { name: "sections.calendar" }),
    ).toHaveAttribute("aria-selected", "true");
  });
  it("opens combined workspace performance directly from its existing deep link", () => {
    renderTabs("?tab=statistics");
    expect(screen.getByText("Workspace performance")).toBeVisible();
    expect(
      screen.queryByText("choose a project for statistics"),
    ).not.toBeInTheDocument();
  });

  it("shows every project's posts on the calendar without asking for a project", () => {
    renderTabs();

    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.queryByText(/choose a project/)).not.toBeInTheDocument();
  });

  it("says a lost project is gone above the calendar", () => {
    renderTabs("", "That project is gone");

    expect(screen.getByText("That project is gone")).toBeVisible();
    expect(screen.getByText("Calendar panel")).toBeVisible();
  });
});
