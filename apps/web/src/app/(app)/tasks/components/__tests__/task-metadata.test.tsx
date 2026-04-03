import { TaskStatus } from "@sokosumi/database";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskMetadata } from "@/app/tasks/components/task-metadata";
import type { TaskWithCoworker } from "@/lib/types/task";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: (value: Date) => value.toISOString(),
  }),
}));

describe("TaskMetadata", () => {
  it("renders the task creator in properties", () => {
    const task: TaskWithCoworker = {
      id: "task-1",
      name: "Test task",
      status: TaskStatus.READY,
      userId: "user-1",
      user: {
        id: "user-1",
        name: "Ada Lovelace",
        image: null,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T01:00:00.000Z",
      jobsCount: 0,
      coworker: null,
      share: null,
      commentsCount: 0,
      columnId: "todo",
      description: null,
      descriptionPlain: null,
      events: [],
      agents: [],
    };

    render(
      <TaskMetadata
        task={task}
        labels={{
          propertiesTitle: "Properties",
          creator: "Creator",
          status: "Status",
          coworker: "Coworker",
          created: "Created",
          updated: "Updated",
        }}
      />,
    );

    expect(screen.getByText("Creator")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });
});
