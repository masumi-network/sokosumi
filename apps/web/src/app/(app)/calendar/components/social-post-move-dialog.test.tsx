import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  schedule: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock("@/lib/actions/project/action", () => ({
  scheduleProjectSocialPost: mocks.schedule,
}));

import { SocialPostMoveDialog } from "./social-post-move-dialog";

const POST: SocialPostCalendarItem = {
  kind: "socialPost",
  revision: 4,
  id: "social:post-1",
  postId: "post-1",
  provider: "x",
  text: "Launch news",
  status: "SCHEDULED",
  externalHandle: "team",
  avatarUrl: null,
  projectName: "Release planning",
  scheduledByName: "Ada",
  scheduledByImage: null,
  attachmentCount: 0,
  previewMedia: null,
  scheduledAt: new Date("2030-01-03T09:00:00.000Z"),
  lastAttempt: null,
  sourceId: "project:project-1",
  sourceProjectId: "project-1",
  sourceWorkspaceId: "workspace-1",
  sourceType: "PROJECT",
};

function renderDialog(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SocialPostMoveDialog
        item={POST}
        onClose={onClose}
        timeZone="Europe/Prague"
      />
    </NextIntlClientProvider>,
  );
  return onClose;
}

function setTime(value: string) {
  fireEvent.change(screen.getByLabelText("New time"), { target: { value } });
}

describe("SocialPostMoveDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts on the post's time in the calendar's zone and moves it with its revision", async () => {
    const user = userEvent.setup();
    mocks.schedule.mockResolvedValue({ ok: true, value: {} });
    const onClose = renderDialog();

    expect(screen.getByLabelText("New time")).toHaveValue("2030-01-03T10:00");
    setTime("2030-01-04T11:30");
    await user.click(screen.getByRole("button", { name: "Reschedule" }));

    expect(mocks.schedule).toHaveBeenCalledWith({
      projectId: "project-1",
      postId: "post-1",
      scheduledAt: "2030-01-04T10:30:00.000Z",
      revision: 4,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Post rescheduled");
  });

  it("refuses a time already gone without calling Core", async () => {
    const user = userEvent.setup();
    renderDialog();

    setTime("2020-01-04T11:30");
    await user.click(screen.getByRole("button", { name: "Reschedule" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a time in the future.",
    );
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the reason when Core refuses", async () => {
    const user = userEvent.setup();
    mocks.schedule.mockResolvedValue({
      ok: false,
      error: { message: "Account disconnected" },
    });
    const onClose = renderDialog();

    await user.click(screen.getByRole("button", { name: "Reschedule" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Account disconnected",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes and reloads on a revision conflict", async () => {
    const user = userEvent.setup();
    mocks.schedule.mockResolvedValue({
      ok: false,
      error: { kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT },
    });
    const onClose = renderDialog();

    await user.click(screen.getByRole("button", { name: "Reschedule" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.refresh).toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalled();
  });
});
