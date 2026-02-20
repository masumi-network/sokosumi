import "@testing-library/jest-dom";
import { TaskStatus } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, useImperativeHandle } from "react";

import { TaskForm } from "@/app/tasks/components/task-form";
import { createTask, updateTask } from "@/lib/actions/task/action";

const markdownEditorPropsSpy = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock("@/hooks/use-os-detection", () => ({
  useOSDetection: () => ({
    os: "MacOS",
    isMobile: false,
  }),
}));

jest.mock("@/lib/actions/task/action", () => ({
  createTask: jest.fn(),
  updateTask: jest.fn(),
}));

jest.mock("../markdown-editor", () => ({
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
};

const coworkerOptions = [
  {
    id: "coworker-1",
    name: "Soko",
    image: "",
  },
];

describe("TaskForm", () => {
  beforeEach(() => {
    markdownEditorPropsSpy.mockClear();
  });

  it("submits draft and ready from create modal actions", async () => {
    const user = userEvent.setup();
    const createTaskMock = jest.mocked(createTask);
    createTaskMock.mockResolvedValue({ taskId: "task-1" });

    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        onSuccess={jest.fn()}
      />,
    );

    await user.type(screen.getByTestId("markdown-editor"), "Write docs");

    await user.click(screen.getByRole("button", { name: "Save as Draft" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.DRAFT,
      }),
    );

    createTaskMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Create Task" }));
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: TaskStatus.READY,
      }),
    );
  });

  it("toggles status in edit modal and keeps the toggled status on save", async () => {
    const user = userEvent.setup();
    const updateTaskMock = jest.mocked(updateTask);
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
        onSuccess={jest.fn()}
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

  it("passes agent mention options to MarkdownEditor", () => {
    render(
      <TaskForm
        variant="modal"
        mode="create"
        showCancel={false}
        labels={baseLabels}
        coworkerOptions={coworkerOptions}
        agentNameById={new Map([["agent-1", "Writer Agent"]])}
        onSuccess={jest.fn()}
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
});
