import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskForOtherProjects } from "./task-for-other-projects";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

const projects = [
  { id: "p1", name: "Alpha" },
  { id: "p2", name: "Beta" },
  { id: "p3", name: "Gamma" },
];
const input = {
  name: "Plan",
  description: "Write the plan",
  assigneeId: null,
  assigneeSokoBotId: null,
  assigneeUserId: null,
  context: {
    brand: { enabled: true, source: "project" as const },
    briefingEnabled: true,
    contextMdEnabled: true,
  },
};

function created(id: string) {
  return {
    ok: true as const,
    value: { taskId: `t-${id}`, identifier: null, name: "Plan" },
  };
}

describe("TaskForOtherProjects", () => {
  it("makes one Draft per chosen Project with the same brief", async () => {
    const onCreateTask = vi.fn(async (i: { projectId?: string | null }) =>
      created(i.projectId ?? ""),
    );
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={onCreateTask}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Gamma" }));
    await userEvent.click(
      screen.getByRole("button", { name: 'create {"count":2}' }),
    );

    expect(onCreateTask.mock.calls.map(([call]) => call)).toEqual([
      { ...input, projectId: "p1", status: "DRAFT" },
      { ...input, projectId: "p3", status: "DRAFT" },
    ]);
    expect(screen.getAllByRole("link", { name: /openTask/ })).toHaveLength(2);
  });

  it("retries only the Projects that failed", async () => {
    let failBeta = true;
    const onCreateTask = vi.fn(async (i: { projectId?: string | null }) => {
      if (i.projectId === "p2" && failBeta) {
        failBeta = false;
        return { ok: false as const, error: { kind: "UNKNOWN" } };
      }
      return created(i.projectId ?? "");
    });
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={onCreateTask as never}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
    await userEvent.click(
      screen.getByRole("button", { name: 'create {"count":2}' }),
    );

    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toHaveProperty(
      "disabled",
      true,
    );

    onCreateTask.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: 'retry {"count":1}' }),
    );

    expect(onCreateTask.mock.calls.map(([call]) => call.projectId)).toEqual([
      "p2",
    ]);
    expect(screen.queryByText("failed")).toBeNull();
    expect(screen.getAllByRole("link", { name: /openTask/ })).toHaveLength(2);
  });

  it("counts a thrown create as failed and keeps going", async () => {
    const onCreateTask = vi.fn(async (i: { projectId?: string | null }) => {
      if (i.projectId === "p1") throw new Error("network");
      return created(i.projectId ?? "");
    });
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={onCreateTask}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "open" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
    await userEvent.click(
      screen.getByRole("button", { name: 'create {"count":2}' }),
    );

    expect(onCreateTask).toHaveBeenCalledTimes(2);
    expect(screen.getByText("failed")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe(
      'summary {"created":1,"failed":1}',
    );
  });
});
