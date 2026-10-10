import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SocialPostStatusBadge } from "./social-post-status-badge";

const STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "MISSED",
  "CANCELED",
] as const;

describe("SocialPostStatusBadge", () => {
  it.each(STATUSES)("names %s on the queue and calendar", (status) => {
    render(
      <SocialPostStatusBadge label={status.toLowerCase()} status={status} />,
    );
    expect(
      screen.getByTestId(`social-post-status-${status}`),
    ).toHaveTextContent(status.toLowerCase());
  });

  it("spins while a post is publishing", () => {
    const { container } = render(
      <SocialPostStatusBadge label="Publishing" status="PUBLISHING" />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("keeps the name on icon-only chips for the calendar", () => {
    render(
      <SocialPostStatusBadge
        label="Failed"
        showLabel={false}
        status="FAILED"
      />,
    );
    const chip = screen.getByRole("img", { name: "Failed" });
    expect(chip).toHaveAttribute("title", "Failed");
    expect(chip.querySelector("span")).toBeNull();
  });
});
