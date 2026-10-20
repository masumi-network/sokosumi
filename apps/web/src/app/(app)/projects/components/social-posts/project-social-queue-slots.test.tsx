import type { SocialQueueSlots } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSocialQueueSlots } from "./project-social-queue-slots";

const { refreshMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

const replaceProjectSocialQueueSlots = vi.hoisted(() => vi.fn());

const MESSAGES: Record<string, string> = {
  title: "Posting queue",
  hint: "Named weekly times.",
  empty: "No queue times yet.",
  emptyHint: "Add a weekly time.",
  add: "Add time",
  save: "Save queue",
  name: "Name",
  weekday: "Day",
  time: "Time",
  timezone: "Time zone",
  remove: "Remove {name}",
  "toasts.saved": "Queue saved.",
  "toasts.empty": "Queue cleared.",
  "toasts.failed": "Could not save queue times. Try again.",
  "weekdays.0": "Sunday",
  "weekdays.1": "Monday",
  "weekdays.2": "Tuesday",
  "weekdays.3": "Wednesday",
  "weekdays.4": "Thursday",
  "weekdays.5": "Friday",
  "weekdays.6": "Saturday",
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    (MESSAGES[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? name,
    ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  replaceProjectSocialQueueSlots,
}));

const EMPTY: SocialQueueSlots = { timezone: null, slots: [] };

describe("ProjectSocialQueueSlots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replaceProjectSocialQueueSlots.mockResolvedValue({
      ok: true,
      value: {
        timezone: "UTC",
        slots: [
          {
            id: "slot-1",
            name: "Monday 09:00",
            weekday: 1,
            minutesFromMidnight: 540,
            timezone: "UTC",
          },
        ],
      },
    });
  });

  it("saves a new weekly time", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialQueueSlots projectId="project-1" queueSlots={EMPTY} />,
    );

    expect(screen.getByText("No queue times yet.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add time" }));
    await user.click(screen.getByRole("button", { name: "Save queue" }));

    await waitFor(() => {
      expect(replaceProjectSocialQueueSlots).toHaveBeenCalledWith({
        projectId: "project-1",
        timezone: expect.any(String),
        slots: [
          {
            name: expect.stringMatching(/09:00/),
            weekday: 1,
            minutesFromMidnight: 540,
          },
        ],
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Queue saved.");
  });

  it("clears the last slot", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialQueueSlots
        projectId="project-1"
        queueSlots={{
          timezone: "UTC",
          slots: [
            {
              id: "slot-1",
              name: "Morning",
              weekday: 1,
              minutesFromMidnight: 540,
              timezone: "UTC",
            },
          ],
        }}
      />,
    );
    replaceProjectSocialQueueSlots.mockResolvedValue({
      ok: true,
      value: EMPTY,
    });
    await user.click(screen.getByRole("button", { name: "Remove Morning" }));
    await user.click(screen.getByRole("button", { name: "Save queue" }));
    await waitFor(() =>
      expect(replaceProjectSocialQueueSlots).toHaveBeenCalledWith({
        projectId: "project-1",
        timezone: "UTC",
        slots: [],
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Queue cleared.");
  });

  it("keeps edits when saving fails", async () => {
    const user = userEvent.setup();
    replaceProjectSocialQueueSlots.mockResolvedValue({
      ok: false,
      error: { message: "Save failed. Try again." },
    });
    render(
      <ProjectSocialQueueSlots projectId="project-1" queueSlots={EMPTY} />,
    );
    await user.click(screen.getByRole("button", { name: "Add time" }));
    await user.type(screen.getByLabelText("Name"), "Morning");
    await user.click(screen.getByRole("button", { name: "Save queue" }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Save failed. Try again."),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Morning");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("keeps new rows independent after editing, removing, and adding times", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialQueueSlots projectId="project-1" queueSlots={EMPTY} />,
    );
    const add = screen.getByRole("button", { name: "Add time" });
    await user.click(add);
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "10:00" },
    });
    await user.click(add);
    await user.click(
      screen.getByRole("button", { name: "Remove Monday 10:00" }),
    );
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "10:00" },
    });
    await user.click(add);
    await user.type(screen.getAllByLabelText("Name")[0], "Morning");
    expect(screen.getAllByLabelText("Name")[0]).toHaveValue("Morning");
    expect(screen.getAllByLabelText("Name")[1]).toHaveValue("");
  });

  it("shows a recovery message for a rejected action", async () => {
    const user = userEvent.setup();
    replaceProjectSocialQueueSlots.mockRejectedValue(new Error("Network lost"));
    render(
      <ProjectSocialQueueSlots projectId="project-1" queueSlots={EMPTY} />,
    );
    await user.click(screen.getByRole("button", { name: "Save queue" }));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Could not save queue times. Try again.",
      ),
    );
  });
});
