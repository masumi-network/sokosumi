import { SocialPostStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import messages from "../../../../../../messages/en.json";
import {
  SocialPostStatusBadge,
  socialPostStatusTone,
} from "./social-post-status-badge";

const STATUS_CASES = {
  DRAFT: ["Draft", "dormant", "text-status-done", "lucide-pencil-line"],
  NEEDS_APPROVAL: [
    "Needs approval",
    "warning",
    "text-status-warning",
    "lucide-badge-check",
  ],
  SCHEDULED: ["Scheduled", "info", "text-status-info", "lucide-clock"],
  PUBLISHING: [
    "Publishing",
    "info",
    "text-status-info",
    "lucide-loader-circle",
  ],
  PUBLISHED: ["Published", "success", "text-status-success", "lucide-check"],
  FAILED: [
    "Failed",
    "destructive",
    "text-status-destructive",
    "lucide-circle-x",
  ],
  MISSED: ["Missed", "warning", "text-status-warning", "lucide-circle-alert"],
  CANCELED: ["Canceled", "dormant", "text-status-done", "lucide-circle-slash"],
} as const satisfies Record<SocialPostStatus, readonly string[]>;

describe("SocialPostStatusBadge", () => {
  it.each(Object.values(SocialPostStatus))(
    "gives %s its tone, distinct glyph and localized label",
    (status) => {
      const [label, hue, color, icon] = STATUS_CASES[status];
      expect(messages.App.Projects.SocialPosts.status[status]).toBe(label);
      expect(socialPostStatusTone(status).hue).toBe(hue);
      const { rerender } = render(
        <SocialPostStatusBadge label={label} status={status} />,
      );
      const badge = screen.getByTestId(`social-post-status-${status}`);
      expect(badge).toHaveTextContent(label);
      expect(badge.querySelector("svg")).toHaveClass(icon, color);
      rerender(
        <SocialPostStatusBadge
          label={label}
          status={status}
          showLabel={false}
        />,
      );
      expect(screen.getByRole("img", { name: label })).toHaveAttribute(
        "title",
        label,
      );
      expect(badge).not.toHaveTextContent(label);
    },
  );

  it.each([
    [
      { partiallyPublished: true },
      "Partly posted",
      "lucide-circle-alert",
      "filled",
    ],
    [
      { waitingForQuotedPost: true },
      "Waiting for the quoted post",
      "lucide-hourglass",
      "outline",
    ],
    [
      { partiallyPublished: true, waitingForQuotedPost: true },
      "Partly posted",
      "lucide-circle-alert",
      "filled",
    ],
  ] as const)("uses warning ink for %j", (display, label, icon, weight) => {
    expect(socialPostStatusTone("SCHEDULED", display)).toEqual({
      hue: "warning",
      weight,
    });
    render(
      <SocialPostStatusBadge
        status="SCHEDULED"
        label={label}
        showLabel={false}
        {...display}
      />,
    );
    const badge = screen.getByRole("img", { name: label });
    expect(badge.querySelector("svg")).toHaveClass(icon, "text-status-warning");
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
