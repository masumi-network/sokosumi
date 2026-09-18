import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PreferenceSwitchRow } from "./preference-switch-row";

describe("PreferenceSwitchRow", () => {
  /**
   * The sentence under the label carries the condition the preference depends
   * on. A reader who only hears the label is told nothing about it, which is
   * the whole reason the sentence is there.
   */
  it("reads its description out with the switch", () => {
    render(
      <PreferenceSwitchRow
        label="Alert me while Sokosumi is open"
        description="Applies only to the groups you set to arrive as a push notification."
        checked={false}
        disabled={false}
        onCheckedChange={vi.fn()}
      />,
    );

    const alertSwitch = screen.getByRole("switch", {
      name: "Alert me while Sokosumi is open",
    });
    expect(alertSwitch).toHaveAccessibleDescription(
      "Applies only to the groups you set to arrive as a push notification.",
    );
  });

  /**
   * Two rows on one page generate their own ids. Sharing one would point both
   * labels at the first switch, so pressing either label would hit that one.
   */
  it("keeps two rows on the same page apart", () => {
    render(
      <>
        <PreferenceSwitchRow
          label="First"
          description="First description"
          checked={false}
          disabled={false}
          onCheckedChange={vi.fn()}
        />
        <PreferenceSwitchRow
          label="Second"
          description="Second description"
          checked={false}
          disabled={false}
          onCheckedChange={vi.fn()}
        />
      </>,
    );

    const first = screen.getByRole("switch", { name: "First" });
    const second = screen.getByRole("switch", { name: "Second" });

    expect(first).not.toBe(second);
    expect(first).toHaveAccessibleDescription("First description");
    expect(second).toHaveAccessibleDescription("Second description");
  });

  it("reports the press to its caller", async () => {
    const onCheckedChange = vi.fn();
    render(
      <PreferenceSwitchRow
        label="Alert me"
        description="A description"
        checked={false}
        disabled={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    await userEvent.click(screen.getByRole("switch", { name: "Alert me" }));

    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  /**
   * The cards disable every control while a write is in flight, because the
   * handler refuses the others then. A control that took the press and did
   * nothing would look broken.
   */
  it("refuses a press while its caller is saving", async () => {
    const onCheckedChange = vi.fn();
    render(
      <PreferenceSwitchRow
        label="Alert me"
        description="A description"
        checked={false}
        disabled={true}
        onCheckedChange={onCheckedChange}
      />,
    );

    const alertSwitch = screen.getByRole("switch", { name: "Alert me" });
    expect(alertSwitch).toBeDisabled();

    await userEvent.click(alertSwitch);

    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
