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
vi.mock("@/app/components/header/header-trailing.client", () => ({
  HeaderTrailing: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-trailing">{children}</div>
  ),
}));
vi.mock("@/app/components/header/header-profile-section", () => ({
  default: () => <button type="button">notifications</button>,
}));

import Header from "@/app/components/header";

describe("Header", () => {
  // From md, Search sits in the sidebar header beside New task; the top bar
  // ends in the notification bell.
  it("leaves Search to the sidebar header", () => {
    render(<Header />);

    const banner = screen.getByRole("banner");
    expect(within(banner).queryByRole("button", { name: "open" })).toBeNull();
    expect(
      within(banner).getByRole("button", { name: "notifications" }),
    ).toBeInTheDocument();
  });
});
