import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskForm } from "@/app/tasks/components/task-form";
import { createTask, updateTask } from "@/lib/actions/task/action";
import { TaskStatus } from "@/lib/clients/generated/core";
import { TASK_STATUS_DISPLAY_ORDER } from "@/lib/utils/task-status-order";
import { mockCoworkerOption } from "@/test-fixtures/coworker";

const {
  markdownEditorPropsSpy,
  uploadUserFileDirectMock,
  toastCustomMock,
  toastDismissMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  markdownEditorPropsSpy: vi.fn(),
  uploadUserFileDirectMock: vi.fn(),
  toastCustomMock: vi.fn(),
  toastDismissMock: vi.fn(),
  toastErrorMock: vi.fn(),
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

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      session: { activeOrganizationId: "org-1" },
      user: { id: "user-1" },
    },
  }),
}));

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipWithMetadata: ({
    url,
    fileName,
  }: {
    url: string;
    fileName?: string | null;
  }) => <div>{fileName ?? url}</div>,
  FileChipMiniPreviewWithMetadata: ({
    url,
    onRemove,
    removeLabel,
  }: {
    url: string;
    onRemove?: () => void;
    removeLabel?: string;
  }) => (
    <div data-testid="file-chip-mini-preview">
      {url}
      {onRemove ? (
        <button type="button" onClick={onRemove}>
          {removeLabel ?? "Remove file"}
        </button>
      ) : null}
    </div>
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
      openDrivePicker: () => undefined,
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
  getTaskContextSelectionFromDescription: (
    description: string,
    options: {
      project?: { designMd?: unknown };
    } = {},
  ) => {
    const hasDesign = description.includes("[DESIGN.md]");
    const hasBriefing = description.includes("[BRIEFING.md]");
    const hasMemory = description.includes("[CONTEXT.md]");
    const body = description
      .replace(/\[DESIGN\.md\]\([^)]*\)\n?/g, "")
      .replace(/\[BRIEFING\.md\]\([^)]*\)\n?/g, "")
      .replace(/\[CONTEXT\.md\]\([^)]*\)\n?/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      body,
      selection: {
        brand: {
          enabled: hasDesign,
          source: options.project?.designMd ? "project" : "default",
          custom: null,
        },
        briefingEnabled: hasBriefing,
        contextMdEnabled: hasMemory,
      },
    };
  },
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
  projectPlaceholder: "Select workspace or project",
  projectRequired: "Select the workspace or a project first.",
  projectSearchPlaceholder: "Search projects...",
  projectEmptyResults: "No projects found.",
  projectCreate: "Create project...",
  coworker: "Coworker",
  unassigned: "Unassigned",
  unavailableAssignee: "Unavailable assignee",
  changeCoworker: "Change coworker…",
  noCoworkerMatches: "No coworker matches",
  status: "Status",
  statusDescription: "Pick status",
  statusDraft: "Draft",
  statusQueued: "Queued",
  untitledTask: "Untitled task",
  saveError: "Failed to save task",
  statusReady: "Ready",
  changeStatus: "Change status…",
  noStatusMatches: "No status matches",
  statusLabels: Object.fromEntries(
    TASK_STATUS_DISPLAY_ORDER.map((status) => [
      status,
      status === TaskStatus.DRAFT
        ? "Draft"
        : status === TaskStatus.READY
          ? "Ready"
          : status === TaskStatus.QUEUED
            ? "Queued"
            : status,
    ]),
  ) as Record<(typeof TaskStatus)[keyof typeof TaskStatus], string>,
  back: "Back",
  uploadFile: "Upload File",
  removeAttachment: "Remove attachment",
  submit: "Save",
  createTask: "Create Task",
  scheduleTask: "Schedule Task",
  openRunAt: "Set start time",
  cancel: "Cancel",
  ctrl: "Ctrl",
  taskCreated: "Task created",
  taskCreatedHint: "Everything's set up and ready to go.",
  goToTask: "Bring me to the task",
  createAnother: "Create another task",
  uploadingFile: "Uploading {fileName}",
  uploadingFiles: "Uploading {count} files",
  privateLabel: "Private",
  privateDescription: "Only you can see this.",
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

async function selectTaskStatus(
  user: ReturnType<typeof userEvent.setup>,
  statusLabel: string,
) {
  await user.click(screen.getByRole("combobox", { name: "Status" }));
  await user.click(
    screen.getByRole("option", { name: new RegExp(`^${statusLabel}`) }),
  );
}

const RUN_AT_LOCAL = "2030-01-02T09:00";
const RUN_AT_ISO = new Date(RUN_AT_LOCAL).toISOString();

/** Opens the Run at modal and applies a local time. */
async function setRunAt(
  user: ReturnType<typeof userEvent.setup>,
  localValue = RUN_AT_LOCAL,
) {
  await user.click(screen.getByRole("button", { name: "Set start time" }));
  fireEvent.change(screen.getByLabelText("label"), {
    target: { value: localValue },
  });
  await user.click(screen.getByRole("button", { name: "apply" }));
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
      screen.getByRole("heading", { name: "What should Elena do?" }),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "Upload File" })
        .some((button) => !button.classList.contains("sr-only")),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: /Start from scratch/i }),
    ).not.toBeInTheDocument();
  });

  it("renders attachment previews from description links", () => {
    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          assigneeId: "coworker-2",
          name: "Task",
          description:
            "Body\n\n[brief.pdf](https://blob.example/users/u1/brief.pdf)",
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("file-chip-mini-preview")).toHaveTextContent(
      "https://blob.example/users/u1/brief.pdf",
    );
    expect(
      screen.getByRole("button", { name: "Remove attachment" }),
    ).toBeInTheDocument();
  });

  it("does not create a task from Ctrl+Enter on wizard step 1", async () => {
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
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

  it("hides the title field on create and shows it on edit", () => {
    const { rerender } = render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Task name")).not.toBeInTheDocument();

    rerender(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Task name")).toHaveClass(
      "text-xl",
      "font-semibold",
      "tracking-tight",
    );
  });

  it("places project and context controls above the footer status row", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    const statusControl = screen.getByRole("combobox", { name: "Status" });
    const contextAttachments = screen.getByTestId("context-attachments");
    const projectSelect = screen.getByRole("combobox", { name: "Project" });

    expect(
      contextAttachments.compareDocumentPosition(statusControl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      projectSelect.compareDocumentPosition(statusControl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts visibility on the same chip row as project", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    const row = screen.getByTestId("task-compose-meta-row");
    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    const privateButton = screen.getByLabelText("Private");

    expect(row).toContainElement(projectSelect);
    expect(row).toContainElement(privateButton);
    expect(row).toHaveClass("flex");
    expect(privateButton).not.toHaveClass("w-full");
  });

  it("omits name on create", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "My task"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledTimes(1);
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("name");
  });

  it("shows the footer status pill defaulting to Draft on create", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByText("Pick status")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Status", { selector: "label" })).toHaveLength(
      0,
    );

    const statusControl = screen.getByRole("combobox", { name: "Status" });
    expect(statusControl).toHaveTextContent("Draft");
    expect(
      screen
        .getByTestId("markdown-editor")
        .compareDocumentPosition(statusControl) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      statusControl.compareDocumentPosition(
        screen.getByRole("button", { name: "Set start time" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Save as Draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mark as Ready" }),
    ).not.toBeInTheDocument();
  });

  it("places the status pill before the Run at label in the footer", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await setRunAt(user);

    const statusControl = screen.getByRole("combobox", { name: "Status" });
    const runAtLabel = screen.getByText("footer");
    expect(
      statusControl.compareDocumentPosition(runAtLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides status on the assignee wizard step", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("markdown-editor")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Status" }),
    ).not.toBeInTheDocument();
  });

  it("defaults status to Ready when selecting a coworker", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getAllByRole("button", { name: /Soko/ })[0]!);
    await user.click(
      screen.getByRole("button", { name: /Start from scratch/i }),
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Ready",
    );
  });

  it("submits Draft from the dropdown by default on create", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.DRAFT,
      }),
    );
  });

  it("submits PRIVATE visibility when the private checkbox is checked", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Secret work");
    await user.click(screen.getByLabelText("Private"));
    await user.click(screen.getByRole("button", { name: "Create Task" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visibility: "PRIVATE",
        assigneeUserId: null,
      }),
    );
  });

  it("hides the private checkbox when another human is assigned", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          ...coworkerOptions,
          mockCoworkerOption({
            id: "user-2",
            slug: "bob@example.com",
            name: "Bob",
            kind: "user",
          }),
        ]}
        initialValues={{ assigneeUserId: "user-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText("Private")).not.toBeInTheDocument();
  });

  it("shows the private checkbox for the current user, a coworker, and a bot", () => {
    const { unmount: unmountSelf } = render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          ...coworkerOptions,
          mockCoworkerOption({
            id: "user-1",
            slug: "me@example.com",
            name: "Me",
            kind: "user",
          }),
        ]}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
    unmountSelf();

    const { unmount: unmountCoworker } = render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
    unmountCoworker();

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          mockCoworkerOption({
            id: "bot-1",
            slug: "soko-bots",
            name: "Ada",
            kind: "sokoBot",
          }),
        ]}
        initialValues={{ assigneeSokoBotId: "bot-1" }}
        onSuccess={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Private")).toBeInTheDocument();
  });

  it("submits Ready when the dropdown is set to Ready", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await selectTaskStatus(user, "Ready");
    await user.click(screen.getByRole("button", { name: "Create Task" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.READY,
      }),
    );
  });

  it("opens the Run at modal from the footer calendar button", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Set start time" });
    expect(trigger).toHaveAttribute("aria-pressed", "false");

    await user.click(trigger);

    expect(screen.getByRole("dialog")).toHaveTextContent("title");
    expect(screen.getByLabelText("label")).toHaveAttribute(
      "type",
      "datetime-local",
    );
  });

  it("creates a Queued Task with its Run at", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Ready",
    );

    await setRunAt(user);

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Queued",
    );
    expect(screen.getByText("footer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set start time" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: /Schedule Task/ }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.QUEUED,
        runAt: RUN_AT_ISO,
      }),
    );
  });

  it("clearing the Run at returns the status to Ready and omits it", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await setRunAt(user);
    await user.click(screen.getByRole("button", { name: "Set start time" }));
    await user.click(screen.getByRole("button", { name: "clear" }));

    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Ready",
    );
    expect(screen.queryByText("footer")).not.toBeInTheDocument();

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.READY }),
    );
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("runAt");
  });

  it("disables the Run at button without an agent assignee", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          ...coworkerOptions,
          mockCoworkerOption({
            id: "user-1",
            slug: "bob",
            name: "Bob",
            kind: "user",
          }),
        ]}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Set start time" }),
    ).toBeDisabled();
  });

  it("clears the Run at when a non-Queued status is picked", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await setRunAt(user);
    await selectTaskStatus(user, "Draft");

    expect(screen.queryByText("footer")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set start time" }),
    ).toHaveAttribute("aria-pressed", "false");

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: TaskStatus.DRAFT }),
    );
    expect(createTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("runAt");
  });

  it("offers Queued only once a Run at is set", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(screen.getByRole("option", { name: /^Queued/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.keyboard("{Escape}");
    await setRunAt(user);

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(screen.getByRole("option", { name: /^Queued/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("disables Queued on edit for an agent Ready task without a Run at", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Daily sync",
          description: "Run the sync",
          assigneeId: "coworker-2",
          status: TaskStatus.READY,
          selectableStatuses: [TaskStatus.QUEUED],
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(screen.getByRole("option", { name: /Queued/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("disables Queued on edit for a human Ready task even when the list offers it", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          ...coworkerOptions,
          mockCoworkerOption({
            id: "user-1",
            slug: "bob",
            name: "Bob",
            kind: "user",
          }),
        ]}
        taskId="task-1"
        initialValues={{
          name: "Daily sync",
          description: "Run the sync",
          assigneeUserId: "user-1",
          status: TaskStatus.READY,
          selectableStatuses: [TaskStatus.QUEUED],
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(screen.getByRole("option", { name: /Queued/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("offers only the statuses Core marked selectable on edit", async () => {
    const user = userEvent.setup();

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={{
          ...baseLabels,
          statusLabels: {
            ...baseLabels.statusLabels,
            [TaskStatus.INPUT_REQUIRED]: "Input required",
            [TaskStatus.COMPLETED]: "Completed",
          },
        }}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Daily sync",
          description: "Run the sync",
          assigneeId: "coworker-1",
          status: TaskStatus.READY,
          selectableStatuses: [TaskStatus.DRAFT, TaskStatus.COMPLETED],
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Draft1", "Ready2", "Completed3"]);
    expect(
      screen.queryByRole("option", { name: /Input required/ }),
    ).not.toBeInTheDocument();
  });

  it("starts with a Calendar-provided Run at", () => {
    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2", runAt: RUN_AT_ISO }}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Schedule Task/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("footer")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Queued",
    );
  });

  it("shows the save error when Core refuses the create", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue({
      ok: false,
      error: { kind: "status_not_selectable" },
    });

    render(
      <TaskForm
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

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(baseLabels.saveError),
    );
  });

  it("shows a queued celebration with the Run at after creating", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(
      createTaskSuccess("task-scheduled", "Scheduled docs"),
    );

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await setRunAt(user);
    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: /Schedule Task/ }));

    expect(await screen.findByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Scheduled docs")).toBeInTheDocument();
    expect(screen.getByText("footer")).toBeInTheDocument();
  });

  it("clears a staged Run at when switching to a human assignee", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          ...coworkerOptions,
          mockCoworkerOption({
            id: "user-1",
            slug: "bob",
            name: "Bob",
            kind: "user",
          }),
        ]}
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

    await setRunAt(user);
    expect(screen.getByText("footer")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: /^Coworker/ }));
    await user.click(screen.getByRole("option", { name: "Bob" }));
    expect(screen.queryByText("footer")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent(
      "Draft",
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeUserId: "user-1",
        desiredStatus: TaskStatus.DRAFT,
      }),
    );
    expect(updateTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("runAt");
  });

  it("keeps a prefilled human assignee absent from options on create (SOK-868)", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ assigneeUserId: "user-1" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        assigneeUserId: "user-1",
      }),
    );
  });

  it("clears a staged Run at when switching to Unassigned", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
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

    await setRunAt(user);
    await user.click(screen.getByRole("combobox", { name: /^Coworker/ }));
    await user.click(screen.getByRole("option", { name: "Unassigned" }));
    expect(screen.queryByText("footer")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        assigneeUserId: null,
        desiredStatus: TaskStatus.DRAFT,
      }),
    );
    expect(updateTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("runAt");
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

  it("locks non-agent assignee options on queued tasks (SOK-868)", async () => {
    const user = userEvent.setup();
    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={[
          ...coworkerOptions,
          mockCoworkerOption({
            id: "user-1",
            slug: "bob",
            name: "Bob",
            kind: "user",
          }),
        ]}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.QUEUED,
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: /^Coworker/ }));

    expect(screen.getByRole("option", { name: "Unassigned" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "Bob" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("option", { name: "Soko" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("saves the status selected in the edit dropdown", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
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
          selectableStatuses: [TaskStatus.READY],
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Soko").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("combobox", { name: /^Coworker/ }),
    ).toBeInTheDocument();

    await selectTaskStatus(user, "Ready");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        desiredStatus: TaskStatus.READY,
      }),
    );
  });

  it("queues an edited Task at a newly set Run at", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
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
          selectableStatuses: [TaskStatus.READY],
        }}
        onSuccess={vi.fn()}
      />,
    );

    await setRunAt(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredStatus: TaskStatus.QUEUED,
        runAt: RUN_AT_ISO,
      }),
    );
  });

  it("does not resend an unchanged Run at on edit", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.QUEUED,
          runAt: RUN_AT_ISO,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText("footer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ desiredStatus: TaskStatus.QUEUED }),
    );
    expect(updateTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("runAt");
  });

  it("sends a moved Run at on edit", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.QUEUED,
          runAt: RUN_AT_ISO,
        }}
        onSuccess={vi.fn()}
      />,
    );

    await setRunAt(user, "2030-01-03T10:30");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        desiredStatus: TaskStatus.QUEUED,
        runAt: new Date("2030-01-03T10:30").toISOString(),
      }),
    );
  });

  it("moves a Queued Task back to Draft when its Run at is removed on edit", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "coworker-1",
          status: TaskStatus.QUEUED,
          selectableStatuses: [TaskStatus.READY],
          runAt: RUN_AT_ISO,
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Set start time" }));
    await user.click(screen.getByRole("button", { name: "clear" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ desiredStatus: TaskStatus.DRAFT }),
    );
    expect(updateTaskMock.mock.calls[0]?.[0]).not.toHaveProperty("runAt");
  });

  it("keeps an unassigned task unassigned when saving an unrelated edit", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        taskId="task-1"
        initialValues={{
          name: "Task name",
          description: "Initial description",
          assigneeId: "",
          assigneeSokoBotId: null,
          assigneeUserId: null,
          status: TaskStatus.READY,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText("Unassigned")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /^Coworker/ }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        assigneeId: null,
        assigneeUserId: null,
      }),
    );
  });

  it("does not limit the edit name field length", () => {
    render(
      <TaskForm
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

  it("selects initialValues.projectId when project options are provided", () => {
    render(
      <TaskForm
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      context: {
        brand: { enabled: true, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
    });
  });

  it("skips the DESIGN.md attachment once its checkbox is unchecked", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      context: {
        brand: { enabled: false, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
    });
  });

  it("passes a custom DESIGN.md override when branding is swapped", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
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
      assigneeSokoBotId: null,
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
    });
  });

  it("shows Context on edit with selection derived from description links", () => {
    const designMdUrl = "https://blob.example/design-md/projects/p1/hash.md";
    const briefingUrl = "https://blob.example/projects/p1/BRIEFING.md";
    const contextMdUrl = "https://blob.example/projects/p1/CONTEXT.md";

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        taskId="task-1"
        initialValues={{
          name: "Launch post",
          description: [
            `[DESIGN.md](${designMdUrl})`,
            `[BRIEFING.md](${briefingUrl})`,
            `[CONTEXT.md](${contextMdUrl})`,
            "",
            "Draft the LinkedIn launch post",
          ].join("\n"),
          assigneeId: "coworker-2",
          projectId: "project-1",
          status: TaskStatus.DRAFT,
        }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design-md/org/hash.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("context-attachments")).toBeInTheDocument();
    expect(screen.getByTestId("markdown-editor")).toHaveValue(
      "Draft the LinkedIn launch post",
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

  it("keeps Save enabled for Context-only tasks on edit", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));
    const designMdUrl = "https://blob.example/design-md/projects/p1/hash.md";

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        taskId="task-1"
        initialValues={{
          name: "Launch post",
          description: `[DESIGN.md](${designMdUrl})`,
          assigneeId: "coworker-2",
          projectId: "project-1",
          status: TaskStatus.DRAFT,
        }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design-md/org/hash.md",
          owner: { type: "organization", name: "Acme Inc", logo: null },
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("markdown-editor")).toHaveValue("");
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        description: "",
        context: expect.objectContaining({
          brand: expect.objectContaining({ enabled: true }),
        }),
      }),
    );
  });

  it("sends Context selection when saving an edit", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue(updateTaskSuccess("task-1"));

    render(
      <TaskForm
        mode="edit"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        taskId="task-1"
        initialValues={{
          name: "Launch post",
          description: [
            "[DESIGN.md](https://blob.example/design.md)",
            "",
            "Draft the LinkedIn launch post",
          ].join("\n"),
          assigneeId: "coworker-2",
          projectId: "project-1",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "context-brand" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateTaskMock).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "task-1",
          description: "Draft the LinkedIn launch post",
          context: {
            brand: {
              enabled: false,
              source: "project",
              custom: null,
            },
            briefingEnabled: false,
            contextMdEnabled: false,
          },
        }),
      ),
    );
  });

  it("passes projectId when creating a task from the project picker", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
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

  it("submits a locked project without showing the project picker", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi
      .fn()
      .mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        lockProjectSelection
        initialValues={{ projectId: "project-1", assigneeId: "coworker-2" }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("combobox", { name: "Project" }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
  });

  it("blocks creation while no project selection was made", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi
      .fn()
      .mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: undefined, assigneeId: "coworker-2" }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    expect(projectSelect).toHaveTextContent(baseLabels.projectLabel);

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(onCreateTask).not.toHaveBeenCalled();
    const error = screen.getByText(baseLabels.projectRequired);
    expect(projectSelect).toHaveAttribute("aria-invalid", "true");
    expect(projectSelect).toHaveAttribute("aria-describedby", error.id);
    expect(projectSelect).toHaveFocus();
  });

  it("creates against an explicitly selected workspace", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi
      .fn()
      .mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: null, assigneeId: "coworker-2" }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    expect(projectSelect).toHaveTextContent(baseLabels.projectNone);

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: null }),
    );
    expect(projectSelect).not.toHaveAttribute("aria-invalid");
  });

  it("clears the project error once a selection is made", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi
      .fn()
      .mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: undefined, assigneeId: "coworker-2" }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    const projectSelect = screen.getByRole("combobox", { name: "Project" });
    await user.click(projectSelect);
    await user.click(screen.getByText("Alpha Project"));

    expect(
      screen.queryByText(baseLabels.projectRequired),
    ).not.toBeInTheDocument();
    expect(projectSelect).not.toHaveAttribute("aria-invalid");

    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(onCreateTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1" }),
    );
  });

  it("passes unchecked project-file choices to task creation", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
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

  it("passes agent mention options to MarkdownEditor", () => {
    render(
      <TaskForm
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
      assigneeSokoBotId: null,
      assigneeUserId: null,
      context: {
        brand: { enabled: true, source: "default", custom: null },
        briefingEnabled: true,
        contextMdEnabled: true,
      },
      status: TaskStatus.READY,
    });
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(screen.getByText("Linked task")).toBeInTheDocument();
  });

  it("refuses a Run at that passed while the form was open", async () => {
    const user = userEvent.setup();
    const onCreateTask = vi.fn();

    render(
      <TaskForm
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{
          assigneeId: "coworker-2",
          runAt: "2020-01-02T09:00:00.000Z",
        }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Schedule Task" }));

    expect(toastErrorMock).toHaveBeenCalledWith("notInFuture");
    expect(onCreateTask).not.toHaveBeenCalled();
  });

  it("toasts the generic save error for other create failures", async () => {
    const user = userEvent.setup();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onCreateTask = vi.fn().mockRejectedValue(new Error("boom"));

    render(
      <TaskForm
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

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Failed to save task");
    });
    consoleError.mockRestore();
  });

  it("does not create a duplicate task when Ctrl+Enter is pressed on the success step", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue(createTaskSuccess("task-1", "Task one"));

    render(
      <TaskForm
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
