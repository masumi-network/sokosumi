import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskForm } from "@/app/tasks/components/task-form";
import { createTask, updateTask } from "@/lib/actions/task/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import { mockCoworkerOption } from "@/test-fixtures/coworker";

const {
  markdownEditorPropsSpy,
  uploadUserFileDirectMock,
  toastCustomMock,
  toastDismissMock,
  toastErrorMock,
  showCalendarClientUpgradeModalMock,
} = vi.hoisted(() => ({
  markdownEditorPropsSpy: vi.fn(),
  uploadUserFileDirectMock: vi.fn(),
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
  toastErrorMock: vi.fn(),
  showCalendarClientUpgradeModalMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-os-detection", () => ({
  useOSDetection: () => ({
    os: "MacOS",
    isMobile: false,
  }),
}));

vi.mock("@/lib/actions/task/action", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("@/components/modals/global-modals-context", () => ({
  useGlobalModalsContext: () => ({
    showCalendarClientUpgradeModal: showCalendarClientUpgradeModalMock,
  }),
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipMiniPreviewWithMetadata: ({ url }: { url: string }) => (
    <div>{url}</div>
  ),
}));

vi.mock("@/lib/utils/task-attachments.client", () => ({
  uploadTaskAttachment: vi.fn(() => {
    throw new Error(
      "TaskForm must not call uploadTaskAttachment for description attaches",
    );
  }),
}));

vi.mock("@/lib/utils/user-file-upload.client", () => ({
  uploadUserFileDirect: (...args: unknown[]) =>
    uploadUserFileDirectMock(...args),
  getUserFileUploadErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock("sonner", () => ({
  toast: {
    custom: (...args: unknown[]) => toastCustomMock(...args),
    dismiss: (...args: unknown[]) => toastDismissMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

vi.mock("./markdown-editor", () => ({
  MarkdownEditor: forwardRef(function MockMarkdownEditor(
    {
      value,
      onChange,
      id,
      placeholder,
      onAttachClick,
      attachLabel,
      mentions,
    }: {
      value: string;
      onChange: (value: string) => void;
      id: string;
      placeholder: string;
      onAttachClick?: () => void;
      attachLabel?: string;
      mentions?: Record<string, { value: string }>;
    },
    ref,
  ) {
    markdownEditorPropsSpy({
      value,
      id,
      placeholder,
      attachLabel,
      mentions,
    });

    useImperativeHandle(ref, () => ({
      insertText: (text: string) => onChange(`${value}${text}`),
      insertLink: (label: string, url: string) =>
        onChange(`${value}[${label}](${url})`),
    }));
    return (
      <div>
        <textarea
          data-testid="markdown-editor"
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {onAttachClick ? (
          <button type="button" onClick={onAttachClick}>
            {attachLabel ?? "Attach"}
          </button>
        ) : null}
      </div>
    );
  }),
}));

vi.mock("@/app/projects/components/inline-create-project-modal", () => ({
  InlineCreateProjectModal: ({
    open,
    onCreated,
  }: {
    open: boolean;
    onCreated: (result: {
      projectId: string;
      name: string;
      project?: { designMd?: { url: string; extractionId: string | null } };
    }) => void;
  }) =>
    open ? (
      <button
        type="button"
        data-testid="confirm-inline-create"
        onClick={() =>
          onCreated({
            projectId: "project-created",
            name: "Northstar",
            project: {
              designMd: {
                url: "https://blob.example/northstar-design.md",
                extractionId: null,
              },
            },
          })
        }
      >
        confirm-create
      </button>
    ) : null,
}));

vi.mock("./task-context-attachments", () => ({
  getDefaultTaskContextSelection: (project?: { designMd?: unknown }) => ({
    brand: {
      enabled: true,
      source: project?.designMd ? "project" : "default",
      custom: null,
    },
    briefingEnabled: true,
    contextMdEnabled: true,
  }),
  TaskContextAttachmentsField: ({
    selection,
    onSelectionChange,
    project,
  }: {
    selection: {
      brand: {
        enabled: boolean;
        source: "project" | "default" | "custom";
        custom: null | { label: string; url: string; sourceUrl: string };
      };
      briefingEnabled: boolean;
      contextMdEnabled: boolean;
    };
    onSelectionChange: (next: {
      brand: {
        enabled: boolean;
        source: "project" | "default" | "custom";
        custom: null | { label: string; url: string; sourceUrl: string };
      };
      briefingEnabled: boolean;
      contextMdEnabled: boolean;
    }) => void;
    project?: {
      name: string;
      briefingUrl?: string | null;
      contextMd?: { updatedAt: string | Date } | null;
    };
  }) => (
    <div
      data-testid="context-attachments"
      data-brand-source={selection.brand.source}
      data-project={project?.name}
    >
      <button
        type="button"
        aria-label="context-brand"
        aria-pressed={selection.brand.enabled}
        onClick={() =>
          onSelectionChange({
            ...selection,
            brand: { ...selection.brand, enabled: !selection.brand.enabled },
          })
        }
      />
      <button
        type="button"
        aria-label="context-briefing"
        aria-pressed={selection.briefingEnabled}
        onClick={() =>
          onSelectionChange({
            ...selection,
            briefingEnabled: !selection.briefingEnabled,
          })
        }
      />
      <button
        type="button"
        aria-label="context-memory"
        aria-pressed={selection.contextMdEnabled}
        onClick={() =>
          onSelectionChange({
            ...selection,
            contextMdEnabled: !selection.contextMdEnabled,
          })
        }
      />
      <button
        type="button"
        onClick={() =>
          onSelectionChange({
            ...selection,
            brand: {
              enabled: true,
              source: "custom",
              custom: {
                label: "DESIGN.md",
                url: "https://blob.example/design-md/adhoc/user-1/hash.md",
                sourceUrl: "https://competitor.com",
              },
            },
          })
        }
      >
        set-custom-branding
      </button>
    </div>
  ),
}));

const baseLabels = {
  details: "Details",
  detailsDescription: "Describe the task",
  name: "Task name",
  namePlaceholder: "Name",
  descriptionPlaceholder: "Description",
  projectLabel: "Project",
  projectNone: "No project",
  projectSearchPlaceholder: "Search projects...",
  projectEmptyResults: "No projects found.",
  projectCreate: "Create project...",
  coworker: "Coworker",
  coworkerDescription: "Pick a coworker",
  assignee: "Assignee",
  assigneeUnassigned: "Unassigned",
  assigneeMe: "Me",
  assigneePeople: "People",
  assigneeCoworkers: "Coworkers",
  assigneePersonalAssistants: "Personal assistants",
  assigneeSearchPlaceholder: "Search assignees...",
  assigneeEmptyResults: "No assignees found.",
  status: "Status",
  statusDescription: "Pick status",
  statusDraft: "Draft",
  statusQueued: "Queued",
  statusReady: "Ready",
  markAsReady: "Mark as Ready",
  revertToDraft: "Revert to Draft",
  back: "Back",
  uploadFile: "Upload File",
  submit: "Save",
  saveAsDraft: "Save as Draft",
  createTask: "Create Task",
  scheduleTask: "Schedule Task",
  openSchedule: "Set schedule",
  cancel: "Cancel",
  ctrl: "Ctrl",
  taskCreated: "Task created",
  taskCreatedHint: "Everything's set up and ready to go.",
  goToTask: "Bring me to the task",
  createAnother: "Create another task",
  uploadingFile: "Uploading {fileName}",
  uploadingFiles: "Uploading {count} files",
};

const coworkerOptions = [
  mockCoworkerOption({
    id: "coworker-1",
    slug: "soko",
    name: "Soko",
  }),
  mockCoworkerOption({
    id: "coworker-2",
    slug: "elena",
    name: "Elena",
  }),
];

const memberOptions = [
  { id: "user-1", name: "Ada", image: null },
  { id: "user-2", name: "Grace", image: null },
];

const projectOptions = [
  {
    id: "project-1",
    name: "Alpha Project",
    logo: "https://blob.example/project-logo.png",
    designMd: { url: "https://blob.example/project-design.md" },
    briefingUrl: "https://blob.example/briefing.md",
    contextMd: {
      url: "https://blob.example/context.md",
      updatedAt: new Date("2026-08-16T08:00:00.000Z"),
    },
  },
  {
    id: "project-2",
    name: "Beta Project",
  },
];

function createTaskSuccess(taskId: string, name: string) {
  return { ok: true as const, value: { taskId, name } };
}

function updateTaskSuccess(taskId: string) {
  return { ok: true as const, value: { taskId } };
}

describe("TaskForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markdownEditorPropsSpy.mockClear();
    try {
      window.localStorage.clear();
    } catch {
      // Ignore environments without localStorage.
    }
  });

  function getHiddenFileInput(container: HTMLElement): HTMLInputElement {
    const input = container.querySelector('input[type="file"]');

    if (!(input instanceof HTMLInputElement)) {
      throw new Error("Expected a hidden file input");
    }

    return input;
  }

  function renderLatestUploadToast() {
    const renderToast = toastCustomMock.mock.calls.at(-1)?.[0];

    if (typeof renderToast !== "function") {
      throw new Error("Expected toast.custom to receive a render callback");
    }

    return render(renderToast("task-upload-toast"));
  }

  it("shows the wizard when only a prompt is prefilled without a coworker", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ description: "Analyze competitors" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("markdown-editor")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Start from scratch/i }),
    ).toBeInTheDocument();
  });

  it("opens directly on compose when a coworker is prefilled", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Start from scratch/i }),
    ).not.toBeInTheDocument();
  });

  it("does not create a task from Ctrl+Enter on wizard step 1", async () => {
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "user" },
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("markdown-editor")).not.toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
        }),
      );
    });

    expect(createTaskMock).not.toHaveBeenCalled();
  });

  it("submits as draft from create modal actions", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");

    await user.click(screen.getByRole("button", { name: "Save as Draft" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.DRAFT,
      }),
    );
  });

  it("submits as ready from create modal actions", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");

    await user.click(screen.getByRole("button", { name: "Create Task" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.READY,
      }),
    );
  });

  it("opens schedule setup from the footer calendar button", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByText("timezone")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Set schedule" }));

    expect(screen.getByText("timezone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeInTheDocument();
  });

  it("changes the primary action to schedule task when a schedule is set", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Set schedule" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    expect(screen.getByText("footer.oneTimeAt")).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /Schedule Task/ }),
    ).toBeInTheDocument();

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: /Schedule Task/ }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.READY,
        schedule: expect.objectContaining({
          mode: "once",
          timezone: expect.any(String),
          oneTimeLocalIso: expect.any(String),
        }),
      }),
    );
  });

  it("opens the required-upgrade modal instead of showing a generic error", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue({
      ok: false,
      error: { kind: "calendar_client_upgrade_required" },
    });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(showCalendarClientUpgradeModalMock).toHaveBeenCalledOnce();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows a queued celebration after creating a scheduled task", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(
      createTaskSuccess("task-scheduled", "Scheduled docs"),
    );

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Set schedule" }));
    await user.click(screen.getByRole("button", { name: "save" }));
    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: /Schedule Task/ }));

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Scheduled docs")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("clears a configured schedule from the schedule modal", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Set schedule" }));
    await user.click(screen.getByRole("button", { name: "save" }));
    expect(
      screen.getByRole("button", { name: /Schedule Task/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Set schedule" }));
    await user.click(screen.getByRole("button", { name: "clearSchedule" }));

    expect(screen.queryByText("footer.oneTimeAt")).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "Create Task" }),
    ).toBeInTheDocument();

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          mode: "none",
          timezone: expect.any(String),
        },
      }),
    );
  });

  it("shows a success state with a go-to-task action after creating in the modal", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onSuccess = vi.fn();
    const onCreateAnother = vi.fn();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onCreated={onCreated}
        onSuccess={onSuccess}
        onCreateAnother={onCreateAnother}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    const goToTask = await screen.findByRole("button", {
      name: baseLabels.goToTask,
    });
    expect(onCreated).toHaveBeenCalledWith("task-1");
    expect(onSuccess).not.toHaveBeenCalled();

    await user.click(goToTask);
    expect(onSuccess).toHaveBeenCalledWith("task-1");
  });

  it("disables Mark as Ready in edit mode when the task has a schedule", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.DRAFT,
          metadata: JSON.stringify({
            version: 1,
            mode: "once",
            scheduledAt: "2026-06-26T09:00:00.000Z",
            runAt: "2026-06-26T09:00:00.000Z",
          }),
        }}
        onSuccess={vi.fn()}
      />,
    );

    const markAsReadyButton = screen.getByRole("button", {
      name: "Mark as Ready",
    });
    expect(markAsReadyButton).toBeDisabled();

    await user.click(markAsReadyButton);
    expect(
      screen.getByRole("button", { name: "Mark as Ready" }),
    ).toBeInTheDocument();
  });

  it("disables Mark as Ready after adding a schedule while editing", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Mark as Ready" }),
    ).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Set schedule" }));
    await user.click(screen.getByRole("button", { name: "save" }));

    const markAsReadyButton = screen.getByRole("button", {
      name: "Mark as Ready",
    });
    expect(markAsReadyButton).toBeDisabled();

    await user.click(markAsReadyButton);
    expect(
      screen.getByRole("button", { name: "Mark as Ready" }),
    ).toBeInTheDocument();
  });

  it("toggles status in edit modal and keeps the toggled status on save", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Soko");

    await user.click(screen.getByRole("button", { name: "Mark as Ready" }));
    expect(
      screen.getByRole("button", { name: "Revert to Draft" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        currentStatus: TaskStatus.DRAFT,
        desiredStatus: TaskStatus.READY,
      }),
    );
  });

  it("does not limit the edit name field length", () => {
    render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Task name")).not.toHaveAttribute("maxlength");
  });

  it("selects initialValues.assigneeId when provided", () => {
    render(
      <TaskForm
        variant="page"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Elena");
  });

  it("selects initialValues.projectId when project options are provided", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: "project-2", assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      "Beta Project",
    );
  });

  it("shows project avatars and selects project brand context when a branded project is chosen", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: "project-2", assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    expect(
      projectSelect.querySelector('[data-testid="project-avatar"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("context-attachments")).toHaveAttribute(
      "data-brand-source",
      "default",
    );

    await user.click(projectSelect);
    await user.click(screen.getByText("Alpha Project"));

    expect(screen.getByTestId("context-attachments")).toHaveAttribute(
      "data-brand-source",
      "project",
    );
  });

  it("keeps briefing and memory toggles when switching project", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: "project-1", assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "context-memory" }));
    await user.click(screen.getByRole("button", { name: "context-briefing" }));
    expect(
      screen.getByRole("button", { name: "context-memory" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "context-briefing" }),
    ).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(screen.getByText("Beta Project"));

    expect(screen.getByTestId("context-attachments")).toHaveAttribute(
      "data-brand-source",
      "default",
    );
    expect(
      screen.getByRole("button", { name: "context-memory" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: "context-briefing" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("uses the created project object for default brand context", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(screen.getByText("Create project..."));
    await user.click(screen.getByTestId("confirm-inline-create"));

    expect(screen.getByTestId("context-attachments")).toHaveAttribute(
      "data-brand-source",
      "project",
    );
    expect(screen.getByTestId("context-attachments")).toHaveAttribute(
      "data-project",
      "Northstar",
    );
  });

  it("shows default-enabled project context for a project-page prefill", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        defaultProjectId="project-1"
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("context-attachments")).toHaveAttribute(
      "data-brand-source",
      "project",
    );
    expect(
      screen.getByRole("button", { name: "context-brand" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "context-briefing" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "context-memory" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the DESIGN.md attachment field without seeding it into the description", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    // The description stays exactly what the user sees — the attachment is
    // a separate control now, not text prepended into the editor.
    expect(screen.getByTestId("markdown-editor")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "context-brand" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("does not touch an existing create description either", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ description: "Write docs", assigneeId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("markdown-editor")).toHaveValue("Write docs");
  });

  it("attaches the resolved DESIGN.md by default when creating a task", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(
      screen.getByTestId("markdown-editor"),
      "Build landing page",
    );
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith({
      description: "Build landing page",
      assigneeId: "coworker-2",
      assigneeUserId: null,
      context: {
        brand: { enabled: true, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
      schedule: {
        mode: "none",
        timezone: expect.any(String),
      },
    });
  });

  it("skips the DESIGN.md attachment once its checkbox is unchecked", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "context-brand" }));
    await user.type(
      screen.getByTestId("markdown-editor"),
      "Build landing page",
    );
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith({
      description: "Build landing page",
      assigneeId: "coworker-2",
      assigneeUserId: null,
      context: {
        brand: { enabled: false, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
      schedule: {
        mode: "none",
        timezone: expect.any(String),
      },
    });
  });

  it("passes a custom DESIGN.md override when branding is swapped", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "set-custom-branding" }),
    );
    await user.type(
      screen.getByTestId("markdown-editor"),
      "Build landing page",
    );
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith({
      description: "Build landing page",
      assigneeId: "coworker-2",
      assigneeUserId: null,
      context: {
        brand: {
          enabled: true,
          source: "custom",
          custom: {
            url: "https://blob.example/design-md/adhoc/user-1/hash.md",
          },
        },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
      schedule: {
        mode: "none",
        timezone: expect.any(String),
      },
    });
  });

  it("passes projectId when creating a task from the project picker", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: "project-1", assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        context: {
          brand: { enabled: true, source: "project", custom: null },
          briefingEnabled: true,
          contextMdEnabled: true,
        },
      }),
    );
  });

  it("passes unchecked project-file choices to task creation", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: "project-1", assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "context-memory" }));
    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        context: {
          brand: { enabled: true, source: "project", custom: null },
          briefingEnabled: true,
          contextMdEnabled: false,
        },
      }),
    );
  });

  it("passes projectId when updating a task from the project picker", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          projectId: "project-2",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        projectId: "project-2",
      }),
    );
  });

  it("passes null when clearing the selected project", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          projectId: "project-2",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(screen.getByText("No project"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        projectId: null,
      }),
    );
  });

  it("selects the Elena coworker by default on first open", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        onSuccess={vi.fn()}
      />,
    );

    // The create modal defaults to Elena (matched by slug/name), not the first
    // option. The rail renders twice (mobile + desktop), so assert all matches.
    for (const button of screen.getAllByRole("button", { name: /Elena/ })) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
    for (const button of screen.getAllByRole("button", { name: /Soko/ })) {
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("opens compose unassigned when Unassigned is picked on the wizard rail", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        currentUserId="user-1"
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Unassigned/ })[0]);

    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Unassigned");
    expect(screen.getByRole("button", { name: "Set schedule" })).toBeDisabled();

    await user.type(screen.getByTestId("markdown-editor"), "Inbox later");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        assigneeUserId: null,
        status: TaskStatus.READY,
      }),
    );
  });

  it("opens compose assigned to Me when Me is picked on the wizard rail", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        currentUserId="user-1"
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Me/ })[0]);

    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Me");
    expect(screen.getByRole("button", { name: "Set schedule" })).toBeDisabled();

    await user.type(screen.getByTestId("markdown-editor"), "Do it myself");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        assigneeUserId: "user-1",
        status: TaskStatus.READY,
      }),
    );
  });

  it("submits a human assignee on create", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="page"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));
    await user.click(screen.getByRole("option", { name: /Ada/ }));
    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        assigneeUserId: "user-1",
        status: TaskStatus.READY,
      }),
    );
  });

  it("keeps a human assignee when editing instead of defaulting to Elena", () => {
    render(
      <TaskForm
        variant="page"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeUserId: "user-1",
          status: TaskStatus.READY,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Ada");
  });

  it("keeps an unset assignee when editing instead of defaulting to Elena", () => {
    render(
      <TaskForm
        variant="page"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: null,
          assigneeUserId: null,
          status: TaskStatus.READY,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Assignee" }),
    ).toHaveTextContent("Unassigned");
  });

  it("disables schedule setup when the assignee is not a coworker", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        memberOptions={memberOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Set schedule" })).toBeDisabled();

    await user.click(screen.getByRole("combobox", { name: "Assignee" }));
    await user.click(screen.getByRole("option", { name: /Elena/ }));

    expect(
      screen.getByRole("button", { name: "Set schedule" }),
    ).not.toBeDisabled();
  });

  it("passes agent mention options to MarkdownEditor", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        agentNameById={new Map([["agent-1", "Writer Agent"]])}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(markdownEditorPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mentions: {
          "agent-1": {
            value: "Writer Agent",
          },
        },
      }),
    );
  });

  it("shows a persistent upload toast with progress for a single attachment", async () => {
    const user = userEvent.setup();
    const file = new File(["report"], "report.pdf", {
      type: "application/pdf",
    });
    let resolveUpload: (() => void) | null = null;

    uploadUserFileDirectMock.mockImplementation(
      (
        _file: File,
        options?: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) =>
        new Promise<{ publicUrl: string }>((resolve) => {
          options?.onUploadProgress?.({
            loaded: 3,
            total: 6,
            percentage: 50,
          });
          resolveUpload = () => {
            options?.onUploadProgress?.({
              loaded: 6,
              total: 6,
              percentage: 100,
            });
            resolve({ publicUrl: "https://blob.example/report.pdf" });
          };
        }),
    );

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description: "Body",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(toastCustomMock).toHaveBeenCalled();
    });

    expect(toastCustomMock.mock.calls[0]?.[1]).toMatchObject({
      duration: Infinity,
      dismissible: false,
    });

    renderLatestUploadToast();

    expect(screen.getByText("Uploading report.pdf")).toBeInTheDocument();
    expect(screen.getAllByText("50%")).toHaveLength(2);
    expect(screen.getAllByText("3 B / 6 B")).toHaveLength(2);
    expect(toastDismissMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpload?.();
    });

    await waitFor(() => {
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("shows a batch upload toast for multiple attachments", async () => {
    const user = userEvent.setup();
    const firstFile = new File(["one"], "first.pdf", {
      type: "application/pdf",
    });
    const secondFile = new File(["two"], "second.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(firstFile, "size", {
      value: 4,
      configurable: true,
    });
    Object.defineProperty(secondFile, "size", {
      value: 4,
      configurable: true,
    });
    let resolveSecondUpload: (() => void) | null = null;

    uploadUserFileDirectMock
      .mockImplementationOnce(
        async (
          _file: File,
          options?: {
            onUploadProgress?: (progress: {
              loaded: number;
              total: number;
              percentage: number;
            }) => void;
          },
        ) => {
          options?.onUploadProgress?.({
            loaded: 4,
            total: 4,
            percentage: 100,
          });

          return { publicUrl: "https://blob.example/first.pdf" };
        },
      )
      .mockImplementationOnce(
        (
          _file: File,
          options?: {
            onUploadProgress?: (progress: {
              loaded: number;
              total: number;
              percentage: number;
            }) => void;
          },
        ) =>
          new Promise<{ publicUrl: string }>((resolve) => {
            options?.onUploadProgress?.({
              loaded: 2,
              total: 4,
              percentage: 50,
            });
            resolveSecondUpload = () => {
              options?.onUploadProgress?.({
                loaded: 4,
                total: 4,
                percentage: 100,
              });
              resolve({ publicUrl: "https://blob.example/second.pdf" });
            };
          }),
      );

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description: "Body",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), [firstFile, secondFile]);

    await waitFor(() => {
      expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(2);
    });

    renderLatestUploadToast();

    expect(screen.getByText("Uploading 2 files")).toBeInTheDocument();
    expect(screen.getByText("6 B / 8 B")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getAllByText("50%")).toHaveLength(1);
    expect(screen.getAllByText("100%")).toHaveLength(1);

    await act(async () => {
      resolveSecondUpload?.();
    });

    await waitFor(() => {
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
    });
  });

  it("dismisses the progress toast before showing upload errors", async () => {
    const user = userEvent.setup();
    const file = new File(["broken"], "broken.pdf", {
      type: "application/pdf",
    });

    uploadUserFileDirectMock.mockImplementation(
      async (
        _file: File,
        options?: {
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) => {
        options?.onUploadProgress?.({
          loaded: 3,
          total: 6,
          percentage: 50,
        });
        throw new Error("Upload broke");
      },
    );

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description: "Body",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith("Upload broke");
    });

    expect(toastDismissMock.mock.invocationCallOrder[0]).toBeLessThan(
      toastErrorMock.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("shows the custom cancel toast when in-progress uploads abort on unmount", async () => {
    const user = userEvent.setup();
    const file = new File(["report"], "report.pdf", {
      type: "application/pdf",
    });
    let abortSignal: AbortSignal | undefined;

    uploadUserFileDirectMock.mockImplementation(
      (
        _file: File,
        options?: {
          abortSignal?: AbortSignal;
          onUploadProgress?: (progress: {
            loaded: number;
            total: number;
            percentage: number;
          }) => void;
        },
      ) =>
        new Promise<{ publicUrl: string }>((_resolve, reject) => {
          abortSignal = options?.abortSignal;
          options?.onUploadProgress?.({
            loaded: 3,
            total: 6,
            percentage: 50,
          });

          options?.abortSignal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("Upload canceled.", "AbortError"));
            },
            { once: true },
          );
        }),
    );

    const { container, unmount } = render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description: "Body",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(1);
      expect(abortSignal).toBeDefined();
    });

    await act(async () => {
      unmount();
    });

    await waitFor(() => {
      expect(abortSignal?.aborted).toBe(true);
      expect(toastDismissMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).toHaveBeenCalledWith("Upload canceled.");
    });
  });

  it("uploads create-mode description attachments via user files without creating a task", async () => {
    const user = userEvent.setup();
    const file = new File(["notes"], "DESIGN.md", {
      type: "text/markdown",
    });
    const createTaskMock = vi.mocked(createTask);
    uploadUserFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/u1/DESIGN.md",
    });

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(1);
      expect(toastDismissMock).toHaveBeenCalled();
    });

    expect(uploadUserFileDirectMock).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("uploads edit-mode description attachments via user files, not task files", async () => {
    const user = userEvent.setup();
    const file = new File(["notes"], "notes.pdf", {
      type: "application/pdf",
    });
    uploadUserFileDirectMock.mockResolvedValue({
      publicUrl: "https://blob.example/users/u1/notes.pdf",
    });

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description: "Body",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadUserFileDirectMock).toHaveBeenCalledTimes(1);
      expect(toastDismissMock).toHaveBeenCalled();
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("uses a custom create handler when provided", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    const onCreateTask = vi
      .fn()
      .mockResolvedValue(createTaskSuccess("linked-task-1", "Linked task"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      description: "Write docs",
      assigneeId: "coworker-2",
      assigneeUserId: null,
      context: {
        brand: { enabled: true, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
      schedule: {
        mode: "none",
        timezone: expect.any(String),
      },
    });
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(screen.getByText("Linked task")).toBeInTheDocument();
  });

  it("does not create a duplicate task when Ctrl+Enter is pressed on the success step", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Bring me to the task" }),
    ).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });

    expect(createTaskMock).toHaveBeenCalledTimes(1);
  });
});
