import type { SessionUser } from "@sokosumi/utils";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import HeaderWorkspaceAvatar from "@/app/components/header/header-workspace-avatar";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const sessionUser: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
  onboardingCompleted: true,
};

describe("HeaderWorkspaceAvatar", () => {
  it("keeps personal compact size-4 for the closed header switcher", () => {
    const { container } = render(
      <HeaderWorkspaceAvatar
        sessionUser={sessionUser}
        organization={null}
        className="size-4 shrink-0"
        logoSize={12}
        decorative
      />,
    );

    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar?.className).toContain("size-4");
    expect(avatar?.className).toContain("shrink-0");
    expect(avatar?.className).not.toContain("size-8");
    expect(avatar?.className).not.toContain("md:size-");
  });

  it("defaults personal avatar to size-8 without a size override", () => {
    const { container } = render(
      <HeaderWorkspaceAvatar sessionUser={sessionUser} organization={null} />,
    );

    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar?.className).toContain("size-8");
    expect(avatar?.className).not.toContain("md:size-");
  });
});
