import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
  getTasksSummary: vi.fn(),
  getTasks: vi.fn(),
  getTaskEvents: vi.fn(),
}));
const createTaskComment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clients/core.browser.client", () => ({ coreClient: core }));
vi.mock("@/lib/actions/task/action", () => ({ createTaskComment }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { user: { id: "u1" }, session: { activeOrganizationId: null } },
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/utils/notification-time", () => ({
  useNotificationTimeFormatter: () => () => "now",
}));

import { NotificationWaitingTasks } from "./notification-waiting-tasks";

function task(id: string, status: string) {
  return {
    id,
    name: `Task ${id}`,
    status,
    updatedAt: "2026-11-19T10:00:00.000Z",
    assignee: { type: "sokoBot", sokoBot: { name: "Pip" } },
  };
}

function event(
  id: string,
  comment: string | null,
  extra: Record<string, unknown> = {},
) {
  return { id, comment, status: null, userId: null, ...extra };
}

function renderRows(tasks: ReturnType<typeof task>[]) {
  core.getTasksSummary.mockResolvedValue({
    data: { awaitingInput: tasks.length },
  });
  core.getTasks.mockResolvedValue({ data: tasks });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NotificationWaitingTasks />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationWaitingTasks", () => {
  it("answers a Task waiting for input without leaving the list", async () => {
    core.getTaskEvents.mockResolvedValue({
      data: [event("e1", "Which audience?", { status: "INPUT_REQUIRED" })],
    });
    createTaskComment.mockResolvedValue(undefined);
    renderRows([task("t1", "INPUT_REQUIRED")]);

    await userEvent.click(
      await screen.findByRole("button", { name: "action.INPUT_REQUIRED" }),
    );
    expect(await screen.findByText("Which audience?")).toBeTruthy();
    expect(core.getTaskEvents).toHaveBeenCalledWith("t1");

    await userEvent.type(
      screen.getByRole("textbox"),
      "Small bakeries in Zurich",
    );
    await userEvent.click(screen.getByRole("button", { name: /^send/ }));

    expect(createTaskComment).toHaveBeenCalledWith({
      taskId: "t1",
      comment: "Small bakeries in Zurich",
    });
    expect(await screen.findByText(/^answerSent/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps other waiting Tasks as links to the Task", async () => {
    renderRows([task("t2", "APPROVAL_REQUIRED")]);

    expect(await screen.findByRole("link", { name: /Task t2/ })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "action.APPROVAL_REQUIRED" }),
    ).toBeNull();
  });
});
