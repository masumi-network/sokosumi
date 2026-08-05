import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";

describe("UserAvatarContent", () => {
  it("defaults to size-8 without a size override", () => {
    const { container } = render(<UserAvatarContent imageAlt="User" />);
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar?.className).toContain("size-8");
    expect(avatar?.className).not.toContain("md:size-10");
  });

  it("lets className size fully override the default (header compact case)", () => {
    const { container } = render(
      <UserAvatarContent className="size-4 shrink-0" imageAlt="User" />,
    );
    const avatar = container.querySelector("[data-slot='avatar']");
    expect(avatar?.className).toContain("size-4");
    expect(avatar?.className).toContain("shrink-0");
    expect(avatar?.className).not.toContain("size-8");
    expect(avatar?.className).not.toContain("md:size-10");
  });
});
