import type { TaskSchedule } from "@sokosumi/core-client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkerOption } from "@/lib/types/coworker";
import type { UploadUserFileDirectOptions } from "@/lib/utils/user-file-upload.client";

import { TaskScheduleDialog } from "./task-schedule-dialog";

const {
  createTaskScheduleMock,
  updateTaskScheduleMock,
  uploadUserFileDirectMock,
  listDriveItemsMock,
  toastMock,
} = vi.hoisted(() => ({
  createTaskScheduleMock: vi.fn(),
  updateTaskScheduleMock: vi.fn(),
  uploadUserFileDirectMock: vi.fn(),
  listDriveItemsMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("next-intl", () => {
  const translate = (key: string) => key;
  return {
    useTranslations: () => translate,
    useFormatter: () => ({ dateTime: (date: Date) => date.toISOString() }),
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/lib/utils/drive-file-list.client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/utils/drive-file-list.client")
  >()),
  listDriveItems: listDriveItemsMock,
}));

vi.mock("@/lib/actions/task-schedule/action", () => ({
  createTaskSchedule: createTaskScheduleMock,
  updateTaskSchedule: updateTaskScheduleMock,
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: (...args: unknown[]) =>
    uploadUserFileDirectMock(...args),
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipMiniPreviewWithMetadata: ({
    url,
    onRemove,
    removeLabel,
  }: {
    url: string;
    onRemove?: () => void;
    removeLabel?: string;
  }) => (
    <div data-testid="attachment-preview">
      {url}
      {onRemove ? (
        <button type="button" onClick={onRemove}>
          {removeLabel}
        </button>
      ) : null}
    </div>
  ),
}));

const COWORKER: CoworkerOption = {
  id: "cow_1",
  slug: "elena",
  name: "Elena",
  image: "",
  kind: "coworker",
  vendor: {
    id: "v1",
    name: "Vendor",
    slug: "vendor",
    logos: { light: null, dark: null },
  },
};

const MEMBER: CoworkerOption = {
  ...COWORKER,
  id: "user_2",
  slug: "maya",
  name: "Maya",
  kind: "user",
};

const SOKO_BOT: CoworkerOption = {
  ...COWORKER,
  id: "bot_1",
  slug: "soko-bot",
  name: "Soko Bot",
  kind: "sokoBot",
};

const SCHEDULE: TaskSchedule = {
  id: "01960001-0001-7001-8001-000000000042",
  workspaceId: "11111111-1111-7111-8111-111111111111",
  organizationId: "org_1",
  ownerId: "user_1",
  creatorUserId: "user_1",
  creatorCoworkerId: null,
  creatorSokoBotId: null,
  state: "ACTIVE",
  rule: {
    expr: "30 8 * * MON",
    timezone: "Europe/Berlin",
    intervalDays: null,
    anchorAt: new Date("2030-01-07T07:30:00.000Z"),
    endsMode: "NEVER",
    endsOn: null,
    targetRunCount: null,
  },
  ruleEffectiveFrom: new Date("2030-01-01T00:00:00.000Z"),
  releasedCount: 2,
  nextRunAt: new Date("2030-01-14T07:30:00.000Z"),
  revision: 4,
  name: "Weekly report",
  description: "**Summarise** the week",
  projectId: null,
  visibility: "PUBLIC",
  assigneeId: "cow_1",
  assigneeSokoBotId: null,
  assigneeUserId: null,
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
};

const onClose = vi.fn();
const onSaved = vi.fn();

function renderDialog(
  props: Partial<Parameters<typeof TaskScheduleDialog>[0]> = {},
) {
  return render(
    <TaskScheduleDialog
      coworkerOptions={[COWORKER]}
      projectOptions={[]}
      canCreatePrivate={false}
      onClose={onClose}
      onSaved={onSaved}
      {...props}
    />,
  );
}

function getFileInput(): HTMLInputElement {
  const input = screen.getByLabelText("uploadFile", {
    selector: 'input[type="file"]',
  });
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("Expected the attachment file input");
  }
  return input;
}

describe("TaskScheduleDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uploadUserFileDirectMock.mockReset();
    uploadUserFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/u1/report.pdf",
    });
    listDriveItemsMock.mockResolvedValue([
      {
        type: "file",
        name: "saved-brief.pdf",
        fileUrl: "https://blob.example/users/u1/saved-brief.pdf",
        pathname: "users/u1/saved-brief.pdf",
        size: 6,
        uploadedAt: new Date("2030-01-01T00:00:00.000Z"),
      },
    ]);
    createTaskScheduleMock.mockResolvedValue({
      ok: true,
      value: { scheduleId: "new-schedule" },
    });
    updateTaskScheduleMock.mockResolvedValue({
      ok: true,
      value: { scheduleId: SCHEDULE.id },
    });
  });

  it("creates a Task Schedule from the blueprint and a daily rule", async () => {
    const user = userEvent.setup();
    renderDialog({
      initialBlueprint: { assigneeId: "cow_1" },
    });

    const save = screen.getByRole("button", { name: "create" });
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("name"), "Daily digest");
    await user.click(save);

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Daily digest",
        description: null,
        projectId: null,
        visibility: "PUBLIC",
        assigneeId: "cow_1",
        assigneeSokoBotId: null,
        assigneeUserId: null,
        rule: expect.objectContaining({
          expr: "0 9 * * *",
          endsMode: "NEVER",
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith("new-schedule");
  });

  it("shows the assignees supplied by Core", async () => {
    const user = userEvent.setup();
    renderDialog({ coworkerOptions: [COWORKER, SOKO_BOT] });

    await user.click(screen.getByRole("combobox", { name: /assignee/ }));

    expect(screen.getByRole("option", { name: "Elena" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Soko Bot" })).toBeEnabled();
    expect(screen.queryByRole("option", { name: "Maya" })).toBeNull();
  });

  it("starts unassigned when repeating a Task assigned to a workspace member", async () => {
    const user = userEvent.setup();
    renderDialog({
      coworkerOptions: [COWORKER],
      initialBlueprint: { name: "Review", assigneeUserId: MEMBER.id },
    });

    expect(
      screen.getByRole("combobox", { name: /assignee/ }),
    ).toHaveTextContent("unassigned");
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });
  });

  it("clears a legacy member assignee when editing a schedule", async () => {
    const user = userEvent.setup();
    renderDialog({
      schedule: {
        ...SCHEDULE,
        assigneeId: null,
        assigneeUserId: MEMBER.id,
      },
    });

    expect(
      screen.getByRole("combobox", { name: /assignee/ }),
    ).toHaveTextContent("unassigned");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
    });
  });

  it("starts from a prefilled blueprint, with its markdown formatted", () => {
    renderDialog({
      initialBlueprint: {
        name: "Review onboarding",
        description: "**Check** the new accounts",
      },
    });

    expect(screen.getByLabelText("name")).toHaveValue("Review onboarding");
    const description = screen.getByRole("textbox", { name: "description" });
    expect(description).toHaveTextContent("Check the new accounts");
    expect(description.querySelector("strong")).toHaveTextContent("Check");
  });

  it("uploads a description attachment and saves its link in the new schedule", async () => {
    const user = userEvent.setup();
    const file = new File(["report"], "report.pdf", {
      type: "application/pdf",
    });
    renderDialog({
      initialBlueprint: { name: "Daily report", description: "Review results" },
    });

    await user.click(screen.getByRole("button", { name: "uploadFile" }));
    expect(screen.getByRole("menuitem", { name: "fromDrive" })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "uploadFile" }));
    await user.upload(getFileInput(), file);

    await waitFor(() =>
      expect(screen.getByTestId("attachment-preview")).toHaveTextContent(
        "https://blob.example/users/u1/report.pdf",
      ),
    );
    expect(createTaskScheduleMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      description: expect.stringContaining(
        "[report.pdf](https://blob.example/users/u1/report.pdf)",
      ),
    });
    expect(createTaskScheduleMock.mock.calls[0]?.[0].description).toContain(
      "Review results",
    );
  });

  it("attaches a file from Files and saves its existing URL", async () => {
    const user = userEvent.setup();
    renderDialog({ initialBlueprint: { name: "Review saved brief" } });

    await user.click(screen.getByRole("button", { name: "uploadFile" }));
    await user.click(screen.getByRole("menuitem", { name: "fromDrive" }));
    await user.click(
      await screen.findByRole("button", { name: /saved-brief.pdf/ }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("attachment-preview")).toHaveTextContent(
        "https://blob.example/users/u1/saved-brief.pdf",
      ),
    );
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock.mock.calls[0]?.[0].description).toContain(
      "[saved-brief.pdf](https://blob.example/users/u1/saved-brief.pdf)",
    );
    expect(uploadUserFileDirectMock).not.toHaveBeenCalled();
  });

  it("keeps a dropped file link when the focused description is edited afterward", async () => {
    const user = userEvent.setup();
    renderDialog({
      initialBlueprint: { name: "Review", description: "Read this report" },
    });
    const editor = screen.getByRole("textbox", { name: "description" });
    const dropzone = editor.closest('[data-slot="file-upload-dropzone"]');
    if (!(dropzone instanceof HTMLElement)) {
      throw new Error("Expected the description dropzone");
    }
    editor.focus();
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["report"], "report.pdf", { type: "application/pdf" }),
    );
    fireEvent.drop(dropzone, { dataTransfer: transfer });

    await waitFor(() =>
      expect(editor.querySelector("a")).toHaveAttribute(
        "href",
        "https://blob.example/users/u1/report.pdf",
      ),
    );
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    await user.keyboard(" Additional note");
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock.mock.calls[0]?.[0].description).toContain(
      "[report.pdf](https://blob.example/users/u1/report.pdf)",
    );
    expect(createTaskScheduleMock.mock.calls[0]?.[0].description).toContain(
      "Additional note",
    );
  });

  it("preserves existing attachment links when the schedule name changes", async () => {
    const user = userEvent.setup();
    const description =
      "**Review** the report\n\n[report.pdf](https://blob.example/users/u1/report.pdf)";
    renderDialog({ schedule: { ...SCHEDULE, description } });

    expect(screen.getByTestId("attachment-preview")).toHaveTextContent(
      "https://blob.example/users/u1/report.pdf",
    );
    await user.type(screen.getByLabelText("name"), " (team)");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      description,
    });
    expect(uploadUserFileDirectMock).not.toHaveBeenCalled();
  });

  it("removes only the selected attachment from the edited blueprint", async () => {
    const user = userEvent.setup();
    renderDialog({
      schedule: {
        ...SCHEDULE,
        description:
          "**Review** the [guide](https://example.com/guide)\n\n[report.pdf](https://blob.example/users/u1/report.pdf)\n\n[notes.txt](https://blob.example/users/u1/notes.txt)",
      },
    });

    const reportPreview = screen
      .getAllByTestId("attachment-preview")
      .find((preview) => preview.textContent?.includes("report.pdf"));
    if (!reportPreview) throw new Error("Expected the report attachment");
    await user.click(
      within(reportPreview).getByRole("button", { name: "removeAttachment" }),
    );

    expect(screen.getAllByTestId("attachment-preview")).toHaveLength(1);
    expect(screen.getByTestId("attachment-preview")).toHaveTextContent(
      "notes.txt",
    );
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      description:
        "**Review** the [guide](https://example.com/guide)\n\n[notes.txt](https://blob.example/users/u1/notes.txt)",
    });
  });

  it("waits for an upload before allowing the schedule to be saved", async () => {
    const user = userEvent.setup();
    let resolveUpload: ((result: { publicUrl: string }) => void) | undefined;
    uploadUserFileDirectMock.mockImplementation(
      () =>
        new Promise<{ publicUrl: string }>((resolve) => {
          resolveUpload = resolve;
        }),
    );
    renderDialog({ schedule: SCHEDULE });
    const save = screen.getByRole("button", { name: "save" });

    await user.upload(
      getFileInput(),
      new File(["report"], "report.pdf", { type: "application/pdf" }),
    );
    await waitFor(() =>
      expect(uploadUserFileDirectMock).toHaveBeenCalledOnce(),
    );

    expect(save).toBeDisabled();
    await user.click(save);
    expect(updateTaskScheduleMock).not.toHaveBeenCalled();
    await act(async () => {
      resolveUpload?.({
        publicUrl: "https://blob.example/users/u1/report.pdf",
      });
    });
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0].description).toContain(
      "[report.pdf](https://blob.example/users/u1/report.pdf)",
    );
  });

  it("keeps the blueprint usable after an upload fails and allows retry", async () => {
    const user = userEvent.setup();
    uploadUserFileDirectMock.mockRejectedValueOnce(new Error("Upload failed"));
    renderDialog({ schedule: SCHEDULE });
    const file = new File(["report"], "report.pdf", {
      type: "application/pdf",
    });

    await user.upload(getFileInput(), file);
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("Upload failed"),
    );
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
    expect(screen.queryByTestId("attachment-preview")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "description" }),
    ).toHaveTextContent("Summarise the week");

    await user.upload(getFileInput(), file);
    await waitFor(() =>
      expect(screen.getByTestId("attachment-preview")).toHaveTextContent(
        "https://blob.example/users/u1/report.pdf",
      ),
    );
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0].description).toContain(
      "[report.pdf](https://blob.example/users/u1/report.pdf)",
    );
  });

  it("aborts the pending attachment upload when the dialog unmounts", async () => {
    const user = userEvent.setup();
    let abortSignal: AbortSignal | undefined;
    uploadUserFileDirectMock.mockImplementation(
      (_file: File, options?: UploadUserFileDirectOptions) =>
        new Promise<{ publicUrl: string }>((_resolve, reject) => {
          abortSignal = options?.abortSignal;
          abortSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Upload canceled.", "AbortError")),
            { once: true },
          );
        }),
    );
    const { unmount } = renderDialog({ schedule: SCHEDULE });

    await user.upload(
      getFileInput(),
      new File(["report"], "report.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(abortSignal).toBeDefined());
    expect(abortSignal?.aborted).toBe(false);
    await act(async () => unmount());

    expect(abortSignal?.aborted).toBe(true);
    await waitFor(() => expect(toastMock.dismiss).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("says an edit changes future Runs only, and saves against the revision it read", async () => {
    const user = userEvent.setup();
    renderDialog({ schedule: SCHEDULE });

    expect(screen.getByText("futureOnlyNotice")).toBeInTheDocument();
    expect(screen.getByLabelText("name")).toHaveValue("Weekly report");

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: SCHEDULE.id,
        expectedRevision: 4,
        name: "Weekly report",
        description: "**Summarise** the week",
        assigneeId: "cow_1",
      }),
    );
    // An unchanged rule is not replaced, so skipped and moved Runs survive.
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "rule",
    );
    expect(createTaskScheduleMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith(SCHEDULE.id);
  });

  it.each([
    ["a custom cron", { expr: "15 7 1,15 * *" }],
    [
      "an every-N-days rule",
      {
        expr: "0 9 * * *",
        intervalDays: 3,
        anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      },
    ],
  ])("keeps %s when only the blueprint changes", async (_label, rule) => {
    const user = userEvent.setup();
    renderDialog({
      schedule: { ...SCHEDULE, rule: { ...SCHEDULE.rule, ...rule } },
    });

    await user.type(screen.getByLabelText("name"), " (team)");
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      name: "Weekly report (team)",
    });
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).not.toHaveProperty(
      "rule",
    );
  });

  describe("every N days", () => {
    // 09:00 UTC is 10:00 in Berlin in January.
    const EVERY_THREE_DAYS: TaskSchedule = {
      ...SCHEDULE,
      rule: {
        ...SCHEDULE.rule,
        expr: "0 10 * * *",
        intervalDays: 3,
        anchorAt: new Date("2030-01-07T09:00:00.000Z"),
      },
    };

    it("previews every third day from the anchor, not every day", () => {
      renderDialog({ schedule: EVERY_THREE_DAYS });

      const preview = screen
        .getAllByRole("listitem")
        .map((item) => item.textContent);
      expect(preview).toEqual([
        "2030-01-07T09:00:00.000Z",
        "2030-01-10T09:00:00.000Z",
        "2030-01-13T09:00:00.000Z",
      ]);
    });

    it("runs at the time of day the form shows, which Core reads from the anchor", async () => {
      const user = userEvent.setup();
      renderDialog({ schedule: EVERY_THREE_DAYS });

      const timeOfDay = screen.getByLabelText("timeOfDay");
      expect(timeOfDay).toHaveValue("10:00");
      fireEvent.change(timeOfDay, { target: { value: "07:15" } });
      await user.click(screen.getByRole("button", { name: "save" }));

      await waitFor(() =>
        expect(updateTaskScheduleMock).toHaveBeenCalledOnce(),
      );
      expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
        rule: {
          expr: "15 7 * * *",
          intervalDays: 3,
          anchorAt: new Date("2030-01-07T06:15:00.000Z"),
          timezone: "Europe/Berlin",
        },
      });
    });
  });

  it("sends the new rule when the time changes", async () => {
    const user = userEvent.setup();
    renderDialog({ schedule: SCHEDULE });

    fireEvent.change(screen.getByLabelText("firstRun"), {
      target: { value: "2030-01-14T10:45" },
    });
    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateTaskScheduleMock).toHaveBeenCalledOnce());
    expect(updateTaskScheduleMock.mock.calls[0]?.[0]).toMatchObject({
      rule: { expr: "45 10 * * MON", timezone: "Europe/Berlin" },
    });
  });

  it("keeps a private Task private instead of assigning its member", async () => {
    const user = userEvent.setup();
    renderDialog({
      canCreatePrivate: true,
      coworkerOptions: [COWORKER],
      initialBlueprint: {
        name: "Confidential",
        visibility: "PRIVATE",
        assigneeUserId: MEMBER.id,
      },
    });

    expect(screen.getByRole("switch")).toBeChecked();
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => expect(createTaskScheduleMock).toHaveBeenCalledOnce());
    expect(createTaskScheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Confidential",
        visibility: "PRIVATE",
        assigneeId: null,
        assigneeSokoBotId: null,
        assigneeUserId: null,
      }),
    );
  });

  it("uses Core's agent choices for a private schedule", async () => {
    const user = userEvent.setup();
    renderDialog({
      schedule: { ...SCHEDULE, visibility: "PRIVATE" },
      coworkerOptions: [COWORKER, SOKO_BOT],
    });

    await user.click(screen.getByRole("combobox", { name: /assignee/ }));

    expect(screen.getByRole("option", { name: "Elena" })).toBeEnabled();
    expect(screen.getByRole("option", { name: "Soko Bot" })).toBeEnabled();
  });

  it("asks to reload when the schedule changed meanwhile", async () => {
    const user = userEvent.setup();
    updateTaskScheduleMock.mockResolvedValue({
      ok: false,
      error: { kind: "stale", message: "changed" },
    });
    renderDialog({ schedule: SCHEDULE });

    await user.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("errors.stale"),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
