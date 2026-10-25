import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./task-card", () => ({ TaskCard: () => <div /> }));

import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { KanbanColumn } from "./kanban-column";

describe("KanbanColumn", () => {
  it("counts the Tasks it has not loaded yet in its header", () => {
    const tasks = Array.from(
      { length: 20 },
      (_, i) => ({ id: `t${i}` }) as TaskWithCoworker,
    );
    render(
      <KanbanColumn
        title="Backlog"
        statusColor="bg-muted"
        tasks={tasks}
        hiddenCount={7}
        emptyLabel="Empty"
      />,
    );
    expect(screen.getByText("27")).toBeInTheDocument();
  });
});
