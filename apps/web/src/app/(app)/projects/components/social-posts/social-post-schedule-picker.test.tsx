import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../../messages/en.json";
import { SocialPostSchedulePicker } from "./social-post-schedule-picker";

const EARLIEST = new Date(2026, 5, 15, 10, 0);
const VALUE = "2026-06-15T14:00";

function Picker() {
  const [value, setValue] = useState(VALUE);
  return (
    <NextIntlClientProvider
      formats={createFormats("h12")}
      locale="en"
      messages={messages}
      timeZone="UTC"
    >
      <h3 id="when">When</h3>
      <SocialPostSchedulePicker
        earliest={EARLIEST}
        labelledBy="when"
        onChange={setValue}
        value={value}
      />
    </NextIntlClientProvider>
  );
}

describe("SocialPostSchedulePicker time list", () => {
  it("moves through times with the arrow keys and keeps one tab stop", async () => {
    const user = userEvent.setup();
    render(<Picker />);

    await user.click(screen.getByRole("button", { name: /Time:/ }));
    const list = screen.getByRole("listbox", { name: "Times" });
    expect(within(list).getByRole("option", { selected: true })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(within(list).getByRole("option", { name: "2:15 PM" })).toHaveFocus();

    await user.keyboard("{Home}");
    expect(
      within(list).getByRole("option", { name: "10:00 AM" }),
    ).toHaveFocus();

    const tabStops = within(list)
      .getAllByRole("option")
      .filter((option) => option.tabIndex === 0);
    expect(tabStops).toHaveLength(1);
  });
});
