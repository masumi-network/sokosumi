import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  type TaskCopyHandler,
  TaskForOtherProjects,
} from "./task-for-other-projects";

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

function created(projectId: string | null | undefined) {
  return {
    ok: true as const,
    value: { taskId: `t-${projectId}`, identifier: null, name: "Plan" },
  };
}

// What `createTaskCopy` returns for a Core 4xx, such as a deleted Project.
const rejected = { ok: false as const, error: { kind: "REJECTED" as const } };

async function choose(names: string[]) {
  await userEvent.click(screen.getByRole("button", { name: "open" }));
  for (const name of names)
    await userEvent.click(screen.getByRole("checkbox", { name }));
  await userEvent.click(
    screen.getByRole("button", {
      name: `create ${JSON.stringify({ count: names.length })}`,
    }),
  );
}

describe("TaskForOtherProjects", () => {
  it("opens as a disclosure that keeps its button", async () => {
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={vi.fn<TaskCopyHandler>()}
      />,
    );
    const toggle = screen.getByRole("button", { name: "open" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await userEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "title" })).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("makes one Draft per chosen Project with the same brief", async () => {
    const onCreateTask = vi.fn<TaskCopyHandler>(async (i) =>
      created(i.projectId),
    );
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={onCreateTask}
      />,
    );
    await choose(["Alpha", "Gamma"]);

    expect(onCreateTask.mock.calls.map(([call]) => call)).toEqual([
      { ...input, projectId: "p1", status: "DRAFT" },
      { ...input, projectId: "p3", status: "DRAFT" },
    ]);
    expect(screen.getAllByRole("link", { name: /openTask/ })).toHaveLength(2);
  });

  it("retries only the Projects Core refused", async () => {
    let refuseBeta = true;
    const onCreateTask = vi.fn<TaskCopyHandler>(async (i) => {
      if (i.projectId === "p2" && refuseBeta) {
        refuseBeta = false;
        return rejected;
      }
      return created(i.projectId);
    });
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={onCreateTask}
      />,
    );
    await choose(["Alpha", "Beta"]);

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

  it("never resends a create whose answer was lost", async () => {
    // Core may have saved the Draft before the answer was lost, so a resend
    // could make a second one.
    const onCreateTask = vi.fn<TaskCopyHandler>(async (i) => {
      if (i.projectId === "p1") throw new Error("network");
      return created(i.projectId);
    });
    render(
      <TaskForOtherProjects
        input={input}
        projects={projects}
        onCreateTask={onCreateTask}
      />,
    );
    await choose(["Alpha", "Beta"]);

    expect(onCreateTask).toHaveBeenCalledTimes(2);
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /checkProject/ }).getAttribute("href"),
    ).toBe("/tasks?projectId=p1");
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("button", { name: /retry/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(
      'summary {"created":1,"failed":0,"unknown":1}',
    );
  });
});
