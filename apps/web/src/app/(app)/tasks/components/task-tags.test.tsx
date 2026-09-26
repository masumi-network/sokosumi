import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import {
  TaskStatus,
  type TaskTags,
  TaskVisibility,
} from "@/lib/clients/generated/core";
import { TaskCard } from "./task-card";
import { TaskTagEditor } from "./task-tags";

const { updateTaskTagsMock, navigateMock } = vi.hoisted(() => ({
  updateTaskTagsMock: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock("@/lib/actions/task/action", () => ({
  updateTaskTags: updateTaskTagsMock,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
}));
vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatShortDate: () => "Sep 26" }),
}));
vi.mock("./task-detail-link", () => ({
  TaskDetailLink: ({
    children,
    ...props
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        navigateMock();
      }}
    >
      {children}
    </a>
  ),
}));

const initialTags: TaskTags = {
  manual: ["design"],
  automatic: ["research"],
  rejected: [],
};
const correctedTags: TaskTags = {
  manual: ["design", "writing"],
  automatic: [],
  rejected: ["research"],
};

beforeEach(() => {
  vi.clearAllMocks();
  updateTaskTagsMock.mockResolvedValue({ ok: true, value: correctedTags });
});

async function selectCorrection() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "edit" }));
  expect(screen.getByRole("dialog", { name: "edit" })).toBeInTheDocument();
  await user.click(
    screen.getByRole("checkbox", { name: "vocabulary.research" }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "vocabulary.writing" }),
  );
  return user;
}

const correction = {
  taskId: "task-1",
  add: ["design", "writing"],
  remove: ["research"],
};

describe("TaskTagEditor", () => {
  it("saves corrections and shows the returned tags when reopened", async () => {
    render(<TaskTagEditor taskId="task-1" tags={initialTags} editable />);
    const user = await selectCorrection();
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(updateTaskTagsMock).toHaveBeenCalledExactlyOnceWith(correction);
    expect(screen.getByText("vocabulary.writing")).toHaveAttribute(
      "title",
      "manual",
    );
    expect(screen.queryByText("vocabulary.research")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "edit" }));
    expect(
      screen.getByRole("checkbox", { name: "vocabulary.writing" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "vocabulary.research" }),
    ).not.toBeChecked();
  });

  it.each(["error result", "exception"])(
    "retains corrections for retry after an %s",
    async (failure) => {
      if (failure === "exception")
        updateTaskTagsMock.mockRejectedValueOnce(new Error("unavailable"));
      else
        updateTaskTagsMock.mockResolvedValueOnce({
          ok: false,
          error: "unavailable",
        });
      render(<TaskTagEditor taskId="task-1" tags={initialTags} editable />);
      const user = await selectCorrection();
      await user.click(screen.getByRole("button", { name: "save" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("error");
      expect(
        screen.getByRole("checkbox", { name: "vocabulary.writing" }),
      ).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: "vocabulary.research" }),
      ).not.toBeChecked();
      // The error can render before React finishes the pending transition.
      await user.click(await screen.findByRole("button", { name: "save" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(updateTaskTagsMock).toHaveBeenCalledTimes(2);
      expect(updateTaskTagsMock).toHaveBeenNthCalledWith(1, correction);
      expect(updateTaskTagsMock).toHaveBeenNthCalledWith(2, correction);
    },
  );

  it("blocks a sixth tag but permits replacing an existing selection", async () => {
    const tags: TaskTags = {
      manual: ["research", "strategy", "writing", "design", "analysis"],
      automatic: [],
      rejected: [],
    };
    render(<TaskTagEditor taskId="task-1" tags={tags} editable />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "edit" }));
    const development = screen.getByRole("checkbox", {
      name: "vocabulary.development",
    });
    expect(development).toBeDisabled();
    await user.click(development);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(5);
    await user.click(
      screen.getByRole("checkbox", { name: "vocabulary.research" }),
    );
    expect(development).toBeEnabled();
    await user.click(development);
    expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(updateTaskTagsMock).toHaveBeenCalledExactlyOnceWith({
        taskId: "task-1",
        add: ["strategy", "writing", "design", "analysis", "development"],
        remove: ["research"],
      }),
    );
  });

  it("shows tags without editing controls for read-only tasks", () => {
    render(
      <TaskTagEditor taskId="task-1" tags={initialTags} editable={false} />,
    );
    expect(screen.getByText("vocabulary.design")).toBeInTheDocument();
    expect(screen.getByText("vocabulary.research")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "edit" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(updateTaskTagsMock).not.toHaveBeenCalled();
  });
});

it("opens card tag overflow without following the task link", async () => {
  const task: TaskWithCoworker = {
    id: "task-1",
    name: "Review findings",
    status: TaskStatus.READY,
    visibility: TaskVisibility.PUBLIC,
    description: null,
    descriptionPlain: null,
    ownerId: "user-1",
    owner: { id: "user-1", name: "Owner", image: null },
    project: null,
    assignee: null,
    participants: [],
    commentsCount: 0,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    jobsCount: 0,
    columnId: "todo",
    events: [],
    agents: [],
    tags: {
      manual: ["design"],
      automatic: ["research", "writing"],
      rejected: [],
    },
  };
  render(<TaskCard task={task} />);
  const user = userEvent.setup();
  const overflow = screen.getByRole("button", { name: "showAll" });
  expect(overflow.closest("a")).toBeNull();
  await user.click(overflow);
  const dialog = await screen.findByRole("dialog", { name: "label" });
  expect(within(dialog).getByText("vocabulary.writing")).toBeInTheDocument();
  expect(within(dialog).getByText("vocabulary.design")).toBeInTheDocument();
  expect(navigateMock).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("link", { name: task.name }));
  expect(navigateMock).toHaveBeenCalledTimes(1);
});
