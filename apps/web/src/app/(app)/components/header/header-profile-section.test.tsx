import type { Session } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/components/workspace-switcher/workspace-switcher", () => ({
  WorkspaceSwitcher: () => <button type="button">Acme</button>,
}));
vi.mock("@/app/components/header/header-trailing-tools", () => ({
  HeaderTrailingTools: () => <button type="button">Notifications</button>,
}));

import HeaderProfileSection from "@/app/components/header/header-profile-section";

const session: Session = {
  user: {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    image: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    termsAccepted: true,
    marketingOptIn: false,
  },
  session: {
    id: "session-1",
    userId: "user-1",
    expiresAt: "2026-02-01T00:00:00.000Z",
    token: "token-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeOrganizationId: "org-a",
  },
};

function tokens(element: Element | null | undefined): string[] {
  return (element?.className ?? "").split(/\s+/).filter(Boolean);
}

describe("HeaderProfileSection", () => {
  // From md the switcher is the sidebar header's, and hides with it: the
  // desktop top bar ends in Search and the bell.
  it("keeps the Workspace switcher for the phone only", () => {
    render(<HeaderProfileSection session={session} />);

    const switcher = screen.getByRole("button", { name: "Acme" });
    expect(tokens(switcher.parentElement)).toContain("md:hidden");
  });

  it("keeps Notification Center on every width", () => {
    render(<HeaderProfileSection session={session} />);

    const bell = screen.getByRole("button", { name: "Notifications" });
    for (let node = bell.parentElement; node; node = node.parentElement) {
      expect(tokens(node)).not.toContain("md:hidden");
    }
  });
});
