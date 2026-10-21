import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

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

vi.mock(
  "@/app/projects/components/social-posts/social-post-statistics",
  () => ({
    SocialPostStatistics: ({ workspaceId }: { workspaceId: string }) => (
      <p>{`workspace performance ${workspaceId}`}</p>
    ),
  }),
);

import { SocialAllProjectsTabs } from "./social-all-projects-tabs";

function renderTabs(searchParams = "", notice?: string, projectFailed = false) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <SocialAllProjectsTabs
        actions={<button type="button">New post</button>}
        calendar={<p>Calendar panel</p>}
        notice={notice}
        projectFailed={projectFailed}
        workspaceId="workspace-1"
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
      "sections.attention",
      "sections.statistics",
      "sections.accounts",
    ]);
    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "New post" })).toBeVisible();
  });

  it("asks for a project on Drafts, Needs attention and Accounts, and shows workspace Performance", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole("tab", { name: "sections.drafts" }));
    expect(screen.getByText("choose a project for drafts")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "sections.attention" }));
    expect(screen.getByText("choose a project for attention")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "sections.statistics" }));
    expect(screen.getByText("workspace performance workspace-1")).toBeVisible();
    expect(
      screen.queryByText("choose a project for statistics"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "sections.accounts" }));
    expect(screen.getByText("choose a project for accounts")).toBeVisible();
  });

  it("opens the tab the URL names", () => {
    const { unmount } = renderTabs("?tab=accounts");
    expect(
      screen.getByRole("tab", { name: "sections.accounts" }),
    ).toHaveAttribute("aria-selected", "true");
    unmount();

    renderTabs("?tab=attention");
    expect(
      screen.getByRole("tab", { name: "sections.attention" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("choose a project for attention")).toBeVisible();
  });

  it("falls back to the calendar when the URL names an unknown tab", () => {
    renderTabs("?tab=bogus");

    expect(
      screen.getByRole("tab", { name: "sections.calendar" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Calendar panel")).toBeVisible();
  });

  it("shows every project's posts on the calendar without asking for a project", () => {
    renderTabs();

    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.queryByText(/choose a project/)).not.toBeInTheDocument();
  });

  it("sizes the tab row like Tasks: content-width pills, action on the right", () => {
    renderTabs();

    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveClass(
      "w-fit",
      "bg-card-background",
      "max-sm:justify-start",
      "max-sm:overflow-x-auto",
    );
    expect(tablist).not.toHaveClass("min-h-11", "flex-1");
    expect(tablist.parentElement).toHaveClass("min-w-0", "flex-1");
    expect(tablist.parentElement?.parentElement).toHaveClass("justify-between");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).not.toHaveClass("min-h-11");
    }
    expect(screen.getByRole("button", { name: "New post" })).toBeVisible();
  });

  it("says a lost project is gone above the calendar", () => {
    renderTabs("", "That project is gone");

    expect(screen.getByText("That project is gone")).toBeVisible();
    expect(screen.getByText("Calendar panel")).toBeVisible();
  });

  it("shows a slim retry banner, not the big prompt, when the project failed to load", async () => {
    const user = userEvent.setup();
    refreshMock.mockClear();
    renderTabs("", undefined, true);

    const banner = screen.getByTestId("social-project-load-error");
    expect(banner).toHaveAttribute("role", "status");
    expect(banner).toHaveTextContent("title.project");
    expect(banner).toHaveTextContent("projectHelp");
    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.queryByText(/choose a project/)).not.toBeInTheDocument();

    await user.click(within(banner).getByRole("button", { name: "tryAgain" }));
    expect(refreshMock).toHaveBeenCalledOnce();

    // The banner stays above the tabs that need a project, with the prompt.
    await user.click(screen.getByRole("tab", { name: "sections.accounts" }));
    expect(screen.getByTestId("social-project-load-error")).toBeVisible();
    expect(screen.getByText("choose a project for accounts")).toBeVisible();

    // Performance spans every project, so a failed project is not its news.
    await user.click(screen.getByRole("tab", { name: "sections.statistics" }));
    expect(
      screen.queryByTestId("social-project-load-error"),
    ).not.toBeInTheDocument();
  });

  it("shows no banner when the project loaded", () => {
    renderTabs();

    expect(
      screen.queryByTestId("social-project-load-error"),
    ).not.toBeInTheDocument();
  });
});
