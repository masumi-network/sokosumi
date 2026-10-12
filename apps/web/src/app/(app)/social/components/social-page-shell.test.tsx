import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SocialPageShell } from "./social-page-shell";

describe("SocialPageShell", () => {
  it("keeps a hidden page name so the outline still starts at Social", () => {
    render(
      <SocialPageShell title="Social">
        <p>Calendar</p>
      </SocialPageShell>,
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Social" });
    expect(heading).toHaveClass("sr-only");
    expect(screen.getByText("Calendar")).toBeInTheDocument();
  });
});
