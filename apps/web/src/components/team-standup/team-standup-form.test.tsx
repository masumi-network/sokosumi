import type { TeamStandup } from "@sokosumi/core-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamStandupForm } from "./team-standup-form";

const saveTeamStandup = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

vi.mock("@/lib/actions/team-standup/action", () => ({
  saveTeamStandup: (params: unknown) => saveTeamStandup(params),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { updateUser: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), promise: vi.fn() },
}));

const initial = {
  enabled: false,
  timeOfDay: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  timezone: "Europe/Berlin",
  weekInReviewWeekday: 1,
  roomId: null,
  lastRunAt: null,
  nextRunAt: null,
  weekInReviewNextRunAt: null,
} satisfies TeamStandup;

describe("TeamStandupForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveTeamStandup.mockResolvedValue({ ok: true, value: initial });
  });

  it("asks for the time with a time picker", () => {
    render(
      <TeamStandupForm
        organizationId="org-1"
        initial={initial}
        canEdit
        includeMyWeek
      />,
    );

    expect(screen.getByLabelText("timeLabel")).toHaveAttribute("type", "time");
  });

  it("offers UTC and saves it over a Berlin stand-up", async () => {
    render(
      <TeamStandupForm
        organizationId="org-1"
        initial={initial}
        canEdit
        includeMyWeek
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "timezoneLabel" }));
    fireEvent.click(await screen.findByRole("option", { name: "UTC" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "save" }));
    });

    await waitFor(() =>
      expect(saveTeamStandup).toHaveBeenCalledWith(
        expect.objectContaining({ timezone: "UTC" }),
      ),
    );
  });

  it("keeps the saved zone in the list after picking another", async () => {
    render(
      <TeamStandupForm
        organizationId="org-1"
        initial={{ ...initial, timezone: "Etc/GMT-14" }}
        canEdit
        includeMyWeek
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "timezoneLabel" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "Europe/Berlin" }),
    );
    fireEvent.click(screen.getByRole("combobox", { name: "timezoneLabel" }));

    expect(
      await screen.findByRole("option", { name: "Etc/GMT-14" }),
    ).toBeInTheDocument();
  });

  it("saves the time zone picked from the list", async () => {
    render(
      <TeamStandupForm
        organizationId="org-1"
        initial={initial}
        canEdit
        includeMyWeek
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "timezoneLabel" }));
    fireEvent.click(
      await screen.findByRole("option", { name: "America/New York" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "save" }));
    });

    await waitFor(() =>
      expect(saveTeamStandup).toHaveBeenCalledWith(
        expect.objectContaining({
          timeOfDay: "09:00",
          timezone: "America/New_York",
        }),
      ),
    );
  });
});
