import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ResultPage from "./page";

const { readTask, replace, markRead } = vi.hoisted(() => ({
  readTask: vi.fn(),
  replace: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(to);
  },
  useRouter: () => ({ replace }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/task.service", () => ({
  taskService: { getTaskById: readTask },
}));
vi.mock("@/components/notifications/mark-notifications-read.client", () => ({
  MarkNotificationsRead: (input: unknown) => {
    markRead(input);
    return null;
  },
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getPrivateCachedSession: async () => ({
    session: { activeOrganizationId: null },
  }),
}));
vi.mock("../_lib/task-workspace-after-miss", () => ({
  taskWorkspaceAfterMiss: () => <span>Task access and workspace switch</span>,
}));

const params = Promise.resolve({ taskId: "task-1" });

describe("completed Task result", () => {
  it.each([
    [
      { auditId: "audit-2", projectId: "project-3" },
      "/seo?projectId=project-3&auditId=audit-2",
    ],
    [
      { auditId: null, projectId: "project-3" },
      "/seo?projectId=project-3&view=project",
    ],
  ])("opens the current authorized SEO result", async (seoAudit, href) => {
    readTask.mockResolvedValue({ id: "task-1", status: "COMPLETED", seoAudit });
    render(await ResultPage({ params }));
    expect(screen.getByRole("link").getAttribute("href")).toBe(href);
    expect(replace).toHaveBeenCalledWith(href);
    expect(markRead).toHaveBeenCalledWith({
      kind: "TASK",
      referenceId: "task-1",
    });
  });
  it.each([
    { status: "COMPLETED", seoAudit: null },
    { status: "RUNNING", seoAudit: { auditId: "old", projectId: null } },
  ])("returns to the Task when a result is unavailable", async (task) => {
    readTask.mockResolvedValue({ id: "task-1", ...task });
    await expect(ResultPage({ params })).rejects.toThrow("/tasks/task-1");
  });
  it("keeps the workspace switch available when Core cannot return the Task", async () => {
    readTask.mockResolvedValue(null);
    render(await ResultPage({ params }));
    expect(
      screen.getByText("Task access and workspace switch"),
    ).toBeInTheDocument();
  });
});
