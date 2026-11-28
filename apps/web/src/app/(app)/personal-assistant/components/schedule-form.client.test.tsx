import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/messages/en.json";

import { ScheduleForm } from "./schedule-form.client";

const createMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  createSokoBotScheduleAction: (...args: unknown[]) => createMock(...args),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

async function openForm(timezone = "America/Los_Angeles") {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      timeZone="UTC"
      formats={{
        dateTime: {
          dateTimeMedium: { dateStyle: "medium", timeStyle: "short" },
        },
      }}
    >
      <ScheduleForm timezone={timezone} />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "New schedule" }));
  return user;
}

describe("ScheduleForm", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ ok: true, value: { id: "s1" } });
  });

  it("offers plain repeats, no interval and no end", async () => {
    await openForm();
    for (const name of ["Daily", "Weekdays", "Weekly", "Monthly", "Custom"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    expect(
      screen
        .getByRole("button", { name: "Weekdays" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByRole("button", { name: "Every few days" })).toBeNull();
    expect(screen.queryByText("Ends")).toBeNull();
    expect(screen.queryByLabelText("Cron expression")).toBeNull();
  });

  it("moves focus to Name on open and back to New schedule on Cancel", async () => {
    const user = await openForm();
    expect(screen.getByLabelText("Name")).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "New schedule" })).toHaveFocus();
  });

  it("returns focus to New schedule once the schedule is created", async () => {
    const user = await openForm();
    await user.type(screen.getByLabelText("Name"), "Friday check-in");
    await user.type(screen.getByLabelText("Prompt"), "Sum up my week");
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "New schedule" }),
      ).toHaveFocus(),
    );
  });

  it("names the time and timezone chips with their visible values", async () => {
    await openForm();
    expect(screen.getByRole("button", { name: "Time 09:00" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Timezone America/Los_Angeles" }),
    ).toBeTruthy();
  });

  it("shows the next run in the bot's timezone", async () => {
    await openForm();
    expect(screen.getByText(/^Next: .*\(America\/Los Angeles\)$/)).toBeTruthy();
  });

  it("saves a weekly Friday schedule as cron in the bot's timezone", async () => {
    const user = await openForm();
    await user.type(screen.getByLabelText("Name"), "Friday check-in");
    await user.click(screen.getByRole("button", { name: "Weekly" }));
    for (const day of [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]) {
      const chip = screen.getByRole("button", { name: day });
      const want = day === "Friday";
      if ((chip.getAttribute("aria-pressed") === "true") !== want) {
        await user.click(chip);
      }
    }
    await user.type(screen.getByLabelText("Prompt"), "Sum up my week");
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(createMock).toHaveBeenCalledWith({
      botId: undefined,
      input: {
        name: "Friday check-in",
        cronExpression: "0 9 * * 5",
        timezone: "America/Los_Angeles",
        prompt: "Sum up my week",
      },
    });
  });

  it("refuses an invalid custom cron before calling Core", async () => {
    const user = await openForm();
    await user.click(screen.getByRole("button", { name: "Custom" }));
    await user.type(screen.getByLabelText("Cron"), "every friday 4pm");

    expect(screen.getByText("That cron expression isn't valid.")).toBeTruthy();
    expect(screen.getByText("No upcoming runs")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Create schedule" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(createMock).not.toHaveBeenCalled();
  });
});
