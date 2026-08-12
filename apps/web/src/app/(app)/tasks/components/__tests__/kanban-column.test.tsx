import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KanbanColumn } from "@/app/tasks/components/kanban-column";

describe("KanbanColumn", () => {
  it("pads the column scrollport so mobile create FAB clearance reaches the scroll area", () => {
    const { container } = render(
      <KanbanColumn
        title="Backlog"
        statusColor="bg-muted"
        tasks={[]}
        emptyLabel="Empty"
        footer={<div>Add task</div>}
      />,
    );

    const scrollport = container.querySelector(".overflow-y-auto");
    expect(scrollport).not.toBeNull();
    // twMerge keeps mobile FAB pad and overrides md:pb-0 → md:pb-2 for desktop columns.
    expect(scrollport?.className).toContain("pb-[calc(3.5rem+1rem)]");
    expect(scrollport?.className).toContain("md:pb-2");
    expect(scrollport?.className).not.toContain("md:pb-0");
  });
});
