import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FormErrorText } from "@/components/ui/form";

describe("FormErrorText", () => {
  it("marks the error with a hidden X and announces the words only", () => {
    render(
      <>
        <input aria-describedby="err" aria-label="Last name" />
        <FormErrorText id="err">Last name is required</FormErrorText>
      </>,
    );

    const message = screen.getByText("Last name is required");
    expect(message).toHaveClass("font-medium", "text-destructive");
    expect(message.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByLabelText("Last name")).toHaveAccessibleDescription(
      "Last name is required",
    );
  });
});
