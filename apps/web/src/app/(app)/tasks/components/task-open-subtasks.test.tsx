import { TaskStatus } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ShowOpenSubtasksContext,
  TaskOpenSubtasks,
} from "./task-open-subtasks";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: { count?: number; name?: string }) =>
      values?.count === undefined ? key : `${key}:${values.count}`,
}));

vi.mock("./task-detail-link", () => ({
  TaskDetailLink: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => <a {...props}>{children}</a>,
}));

const open = ["Sitemap", "Wireframes", "Copy deck"].map((name, index) => ({
  id: `sub-${index}`,
  identifier: `WEB-${index + 10}`,
  name,
  status: TaskStatus.READY,
}));

function renderOpen(
  show: boolean,
  progress: { completed: number; total: number },
) {
  return render(
    <ShowOpenSubtasksContext value={show}>
      <TaskOpenSubtasks
        task={{
          id: "parent",
          identifier: "WEB-1",
          name: "Website relaunch",
          subtaskProgress: progress,
          openSubtasks: open,
        }}
      />
    </ShowOpenSubtasksContext>,
  );
}

describe("TaskOpenSubtasks", () => {
  it("shows nothing while the view options switch is off", () => {
    const { container } = renderOpen(false, { completed: 2, total: 9 });

    expect(container).toBeEmptyDOMElement();
  });

  it("links each open sub-task, then says how many more are open", () => {
    renderOpen(true, { completed: 2, total: 9 });

    expect(screen.getByText("Sitemap").closest("a")).toHaveAttribute(
      "href",
      "/tasks/WEB-10-sitemap",
    );
    // Nine sub-tasks, two done, three shown: four more are open.
    // The status is named in the reader's language, not the English default.
    expect(screen.getAllByRole("img")[0]).toHaveAccessibleName("READY");
    expect(screen.getByText("moreOpen:4").closest("a")).toHaveAttribute(
      "href",
      "/tasks/WEB-1-website-relaunch",
    );
  });

  it("drops the more row when every open sub-task is shown", () => {
    renderOpen(true, { completed: 9, total: 12 });

    expect(screen.getAllByRole("link")).toHaveLength(3);
  });

  it("names an untitled sub-task so its link is not empty", () => {
    render(
      <ShowOpenSubtasksContext value>
        <TaskOpenSubtasks
          task={{
            id: "parent",
            identifier: "WEB-1",
            name: "Website relaunch",
            subtaskProgress: { completed: 0, total: 1 },
            openSubtasks: [{ ...open[0], name: " " }],
          }}
        />
      </ShowOpenSubtasksContext>,
    );

    expect(screen.getByRole("link")).toHaveTextContent("noTitle");
  });
});
