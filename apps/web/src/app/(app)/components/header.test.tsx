import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-is-apple-platform", () => ({
  default: () => true,
}));
// Search would show if the top bar placed it: the dialog it opens is there.
vi.mock("@/app/components/history-search-dialog-provider", () => ({
  useOptionalHistorySearch: () => ({
    openHistorySearch: vi.fn(),
    searchShortcutLabel: "⌘K",
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// The top bar's own regions, each tested at its own seam.
vi.mock("@/app/components/project-scope/header-project-scope", () => ({
  HeaderProjectScope: () => null,
}));
vi.mock("@/app/components/project-scope/sidebar-project-scope-mobile", () => ({
  SidebarScopeMobileChip: () => null,
}));
vi.mock("@/app/components/project-scope/project-scope-guard", () => ({
  ProjectScopeGuard: () => null,
}));
vi.mock("@/app/components/header/header-leading-control.client", () => ({
  HeaderLeadingBrandFallback: () => null,
  HeaderLeadingControl: () => null,
}));
vi.mock("@/app/components/header/sidebar-toggle.client", () => ({
  SidebarToggle: () => <button type="button">toggle</button>,
}));
vi.mock("@/app/components/header/header-trailing.client", () => ({
  HeaderTrailing: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-trailing">{children}</div>
  ),
}));
vi.mock("@/app/components/header/header-profile-section", () => ({
  default: () => <button type="button">notifications</button>,
}));

import Header from "@/app/components/header";

vi.mock(
  "@/app/components/workspace-switcher/workspace-switcher-menu.client",
  () => ({
    default: () => <button type="button">Acme</button>,
  }),
);
vi.mock(
  "@/app/components/sidebar/components/sidebar-new-task-button.client",
  () => ({
    SidebarNewTaskButton: () => <button type="button">New task</button>,
  }),
);
vi.mock("@/app/components/header/header-mobile-search.client", () => ({
  HeaderMobileSearchControl: () => (
    <button type="button" className="md:hidden">
      Mobile search
    </button>
  ),
}));

describe("Header", () => {
  it("keeps the toggle in the main header and puts Search and New task there only on phones", () => {
    render(<Header />);
    const controls = within(screen.getByTestId("header-workspace-controls"));
    expect(
      controls.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["toggle", "Acme", "Mobile search", "New task"]);
    expect(
      controls.getByRole("button", { name: "Acme" }).parentElement,
    ).toHaveClass("md:sidebar-hidden:block");
    expect(
      controls.getByRole("button", { name: "Mobile search" }).parentElement,
    ).toHaveClass("md:hidden");
    expect(
      controls.getByRole("button", { name: "New task" }).parentElement,
    ).toHaveClass("md:hidden");
    expect(controls.queryByRole("button", { name: "open" })).toBeNull();
    expect(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "notifications",
      }),
    ).toBeVisible();
  });
});
