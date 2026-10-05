import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleSelectWorkspaceMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString().slice(0, 10),
  }),
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastErrorMock(...args) },
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    handleSelectWorkspace: handleSelectWorkspaceMock,
    isPending: false,
  }),
}));

import { PersonalPlanNotice } from "./personal-plan-notice";

describe("PersonalPlanNotice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleSelectWorkspaceMock.mockResolvedValue(undefined);
  });

  it("shows the personal plan without a cancel date", () => {
    render(
      <PersonalPlanNotice
        canSwitchToPersonal
        planName="Pro"
        scheduledCancelDate={null}
      />,
    );

    expect(
      screen.getByText('personalPlanNotice:{"plan":"Pro"}'),
    ).toBeInTheDocument();
  });

  it("shows the cancel date when a cancellation is scheduled", () => {
    render(
      <PersonalPlanNotice
        canSwitchToPersonal
        planName="Pro"
        scheduledCancelDate={new Date("2026-03-01T00:00:00.000Z")}
      />,
    );

    expect(
      screen.getByText(
        'personalPlanNoticeCancels:{"date":"2026-03-01","plan":"Pro"}',
      ),
    ).toBeInTheDocument();
  });

  it("hides the switch control without a personal workspace", () => {
    render(
      <PersonalPlanNotice
        canSwitchToPersonal={false}
        planName="Pro"
        scheduledCancelDate={null}
      />,
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("switches to the personal workspace", () => {
    render(
      <PersonalPlanNotice
        canSwitchToPersonal
        planName="Pro"
        scheduledCancelDate={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "switchToPersonalWorkspace" }),
    );

    expect(handleSelectWorkspaceMock).toHaveBeenCalledWith(null);
  });

  it("shows an error toast when the switch fails", async () => {
    handleSelectWorkspaceMock.mockRejectedValueOnce(new Error("failed"));
    render(
      <PersonalPlanNotice
        canSwitchToPersonal
        planName="Pro"
        scheduledCancelDate={null}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "switchToPersonalWorkspace" }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "switchToPersonalWorkspaceError",
      );
    });
  });
});
