import { TaskStatus } from "@sokosumi/utils";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskForm } from "@/app/tasks/components/task-form";
import { createTask, updateTask } from "@/lib/actions/task/action";

const {
  markdownEditorPropsSpy,
  uploadTaskAttachmentMock,
  toastCustomMock,
  toastDismissMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  markdownEditorPropsSpy: vi.fn(),
  uploadTaskAttachmentMock: vi.fn(),
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

vi.mock("@/components/jobs/job-details/file-chip-with-metadata", () => ({
  FileChipMiniPreviewWithMetadata: ({ url }: { url: string }) => (
    <div>{url}</div>
  ),
}));

vi.mock("@/lib/utils/task-attachments.client", () => ({
  uploadTaskAttachment: (...args: unknown[]) =>
    uploadTaskAttachmentMock(...args),
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
}));

vi.mock("../markdown-editor", () => ({
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
  coworker: "Coworker",
  coworkerDescription: "Pick a coworker",
  status: "Status",
  statusDescription: "Pick status",
  statusDraft: "Draft",
  statusReady: "Ready",
  markAsReady: "Mark as Ready",
  revertToDraft: "Revert to Draft",
  back: "Back",
  uploadFile: "Upload File",
  submit: "Save",
  saveAsDraft: "Save as Draft",
  createTask: "Create Task",
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
  {
    id: "coworker-1",
    slug: "soko",
    name: "Soko",
    image: "",
  },
  {
    id: "coworker-2",
    slug: "elena",
    name: "Elena",
    image: "",
  },
];

const projectOptions = [
  {
    id: "project-1",
    name: "Alpha Project",
  },
  {
    id: "project-2",
    name: "Beta Project",
  },
];

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

  it("opens directly on compose when a coworker is prefilled", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

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
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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

  it("shows a success state with a go-to-task action after creating in the modal", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onSuccess = vi.fn();
    const onCreateAnother = vi.fn();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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

  it("toggles status in edit modal and keeps the toggled status on save", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue({ taskId: "task-1" });

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
          coworkerId: "coworker-1",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

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
          coworkerId: "coworker-1",
          status: TaskStatus.DRAFT,
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Task name")).not.toHaveAttribute("maxlength");
  });

  it("selects initialValues.coworkerId when provided", () => {
    render(
      <TaskForm
        variant="page"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    const elenaButton = screen.getByRole("button", { name: /Elena/i });
    const sokoButton = screen.getByRole("button", { name: /Soko/i });
    expect(elenaButton).toHaveAttribute("aria-pressed", "true");
    expect(sokoButton).toHaveAttribute("aria-pressed", "false");
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
        initialValues={{ projectId: "project-2", coworkerId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      "Beta Project",
    );
  });

  it("seeds empty create descriptions with the initial design.md attachment", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("markdown-editor")).toHaveValue(
      "[DESIGN.md](https://blob.example/design.md)\n",
    );
    expect(
      screen.getByText("https://blob.example/design.md"),
    ).toBeInTheDocument();
  });

  it("does not seed design.md over an existing create description", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ description: "Write docs", coworkerId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByTestId("markdown-editor")).toHaveValue("Write docs");
  });

  it("skips design.md attachment when the prefilled link is removed in the editor", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
        initialDesignMdAttachment={{
          label: "DESIGN.md",
          url: "https://blob.example/design.md",
        }}
        onSuccess={vi.fn()}
      />,
    );

    await user.clear(screen.getByTestId("markdown-editor"));
    await user.type(
      screen.getByTestId("markdown-editor"),
      "Build landing page",
    );
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith({
      description: "Build landing page",
      coworkerId: "coworker-2",
      status: TaskStatus.READY,
      skipDesignMdAttachment: true,
    });
  });

  it("passes projectId when creating a task from the project picker", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        initialValues={{ projectId: "project-1", coworkerId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
      }),
    );
  });

  it("passes projectId when updating a task from the project picker", async () => {
    const user = userEvent.setup();
    const updateTaskMock = vi.mocked(updateTask);
    updateTaskMock.mockResolvedValue({ taskId: "task-1" });

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
          coworkerId: "coworker-1",
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
    updateTaskMock.mockResolvedValue({ taskId: "task-1" });

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
          coworkerId: "coworker-1",
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

  it("passes agent mention options to MarkdownEditor", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        agentNameById={new Map([["agent-1", "Writer Agent"]])}
        initialValues={{ coworkerId: "coworker-2" }}
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

    uploadTaskAttachmentMock.mockImplementation(
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
        new Promise<string>((resolve) => {
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
            resolve("https://blob.example/report.pdf");
          };
        }),
    );

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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

    uploadTaskAttachmentMock
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

          return "https://blob.example/first.pdf";
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
          new Promise<string>((resolve) => {
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
              resolve("https://blob.example/second.pdf");
            };
          }),
      );

    const { container } = render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), [firstFile, secondFile]);

    await waitFor(() => {
      expect(uploadTaskAttachmentMock).toHaveBeenCalledTimes(2);
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

    uploadTaskAttachmentMock.mockImplementation(
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
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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

    uploadTaskAttachmentMock.mockImplementation(
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
        new Promise<string>((_resolve, reject) => {
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
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
        onSuccess={vi.fn()}
      />,
    );

    await user.upload(getHiddenFileInput(container), file);

    await waitFor(() => {
      expect(uploadTaskAttachmentMock).toHaveBeenCalledTimes(1);
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

  it("uses a custom create handler when provided", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    const onCreateTask = vi.fn().mockResolvedValue({
      taskId: "linked-task-1",
      name: "Linked task",
    });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
        onCreateTask={onCreateTask}
        onSuccess={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");
    await user.click(screen.getByRole("button", { name: "Create Task" }));

    expect(onCreateTask).toHaveBeenCalledWith({
      description: "Write docs",
      coworkerId: "coworker-2",
      status: TaskStatus.READY,
      skipDesignMdAttachment: false,
    });
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(screen.getByText("Linked task")).toBeInTheDocument();
  });

  it("does not create a duplicate task when Ctrl+Enter is pressed on the success step", async () => {
    const user = userEvent.setup();
    const createTaskMock = vi.mocked(createTask);
    createTaskMock.mockResolvedValue({ taskId: "task-1", name: "Task one" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        initialValues={{ coworkerId: "coworker-2" }}
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
