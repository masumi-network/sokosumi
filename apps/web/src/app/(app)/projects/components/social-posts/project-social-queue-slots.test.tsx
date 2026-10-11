import type { SocialQueueSlots } from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
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
});
