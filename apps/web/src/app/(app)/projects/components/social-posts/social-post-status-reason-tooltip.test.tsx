import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SocialPostStatusReasonTooltip } from "./social-post-status-reason-tooltip";

describe("SocialPostStatusReasonTooltip", () => {
  it("names the failure without opening the calendar card", () => {
    const onCardClick = vi.fn();
    render(
      <button type="button" onClick={onCardClick}>
        <SocialPostStatusReasonTooltip
          label="Failed"
          reason="The network refused the post."
        >
          Failed
        </SocialPostStatusReasonTooltip>
      </button>,
    );

    const chip = screen.getByTestId("social-post-status-reason");
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);

    expect(onCardClick).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "The network refused the post.",
    );
    expect(chip).toHaveAttribute("aria-label", "Failed");
  });
});
