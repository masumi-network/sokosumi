import type { Task, TaskEvent } from "@sokosumi/core-client";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listTaskActivityFeedMock = vi.fn();
const taskActivitySectionMock = vi.fn();

class FakeCoreApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

vi.mock("server-only", () => ({}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const translator = (key: string) => key;
    translator.raw = (key: string) => key;
    return translator;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({
    session: { activeOrganizationId: null },
    user: { id: "user_admin", name: "Admin", email: "admin@example.com" },
  }),
}));

vi.mock("@/lib/services/task.service", () => ({
  taskService: {
    listTaskActivityFeed: (...args: unknown[]) =>
      listTaskActivityFeedMock(...args),
  },
}));
vi.mock("@/lib/services/agent.service", () => ({
  agentService: { getAvailableAgentsWithCreditsPrice: async () => [] },
}));
vi.mock("@/lib/services/coworker.service", () => ({
  coworkerService: { listCoworkers: async () => [] },
}));
vi.mock("@/lib/services/design-md.service", () => ({
  designMdService: { resolveEffectiveDesignMd: async () => null },
}));
vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: { hasAssignedSeat: async () => false },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: async () => null },
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: async () => [],
    getWorkspaceAccess: async () => ({ hasPersonalWorkspace: true }),
  },
}));
vi.mock("@/app/tasks/utils/task-activity-plan", () => ({
  resolveTaskDetailViewerPlan: async () => null,
}));
vi.mock("@/app/tasks/utils/task-assignee-options", () => ({
  listTaskAssigneeOptions: async () => [],
}));
vi.mock("@/app/tasks/utils/task-assignee-members", () => ({
  listTaskAssigneeMemberOptions: async () => [],
}));

vi.mock("@/app/tasks/components/task-activity", () => ({
  TaskActivitySection: (props: unknown) => {
    taskActivitySectionMock(props);
    return <div data-testid="task-activity" />;
  },
}));
vi.mock("@/app/tasks/components/task-context-section", () => ({
  TaskContextSection: () => null,
}));
vi.mock("@/app/tasks/components/task-description", () => ({
  TaskDescription: () => null,
}));
vi.mock("@/app/tasks/components/task-detail-actions", () => ({
  TaskDetailActions: () => null,
}));
vi.mock("@/app/tasks/components/task-detail-header", () => ({
  TaskDetailHeader: ({ actions }: { actions: ReactElement }) => actions,
}));
vi.mock("@/app/tasks/components/task-files", () => ({
  TaskFiles: () => null,
}));
vi.mock("@/app/tasks/components/task-from-schedule", () => ({
  TaskFromSchedule: () => null,
}));
vi.mock("@/app/tasks/components/task-jobs", () => ({
  TaskJobs: () => null,
}));
vi.mock("@/app/tasks/components/task-metadata", () => ({
  TaskMetadata: () => null,
}));
vi.mock("@/app/tasks/components/task-related-tasks", () => ({
  TaskRelatedTasks: () => null,
}));
vi.mock("@/app/tasks/components/task-status-realtime-listener", () => ({
  TaskStatusRealtimeListener: () => null,
}));
vi.mock("@/app/tasks/components/task-tags", () => ({
  TaskTagSection: () => null,
}));
vi.mock("@/app/tasks/components/task-vendor-grant-approval-banner", () => ({
  TaskVendorGrantApprovalBanner: () => null,
}));
vi.mock("@/app/tasks/components/task-vendor-grant-pending-info-banner", () => ({
  TaskVendorGrantPendingInfoBanner: () => null,
}));

const { TaskDetailView } = await import("./task-detail-view");

function event(id: string, comment: string | null, minute: number): TaskEvent {
  return {
    id,
    taskId: "task_1",
    createdAt: new Date(`2026-10-05T09:${String(minute).padStart(2, "0")}:00Z`),
    updatedAt: new Date(`2026-10-05T09:${String(minute).padStart(2, "0")}:00Z`),
    comment,
    status: comment ? null : "RUNNING",
    userId: "user_owner",
    user: { id: "user_owner", name: "Owner", image: null },
    coworkerId: null,
    coworker: null,
    sokoBotId: null,
    sokoBot: null,
  } as unknown as TaskEvent;
}

function createTask(events: TaskEvent[]): Task {
  return {
    id: "task_1",
    name: "Facebook Page Analysis",
    identifier: null,
    description: null,
    status: "COMPLETED",
    visibility: "WORKSPACE",
    ownerId: "user_owner",
    owner: { id: "user_owner", name: "Owner", image: null },
    creator: {
      type: "user",
      id: "user_owner",
      user: { id: "user_owner", name: "Owner", image: null },
    },
    organizationId: "org_owner",
    projectId: null,
    scheduleId: null,
    assignee: null,
    links: [],
    files: [],
    jobs: [],
    participants: [],
    events,
    tags: [],
    createdAt: new Date("2026-10-05T09:00:00Z"),
    updatedAt: new Date("2026-10-05T09:00:00Z"),
    workspace: { id: "ws_owner", organizationId: "org_owner" },
  } as unknown as Task;
}

/** Server-renders the view and returns errors React reported during the render. */
async function renderErrors(element: ReactElement): Promise<unknown[]> {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(element, {
    onError: (error) => {
      errors.push(error);
    },
  });
  await stream.allReady;
  await new Response(stream).text();
  return errors;
}

describe("TaskDetailView (forceReadOnly: admin and developer views)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Core scopes GET /tasks/{id}/events to the caller's active workspace; a
    // platform admin outside the owner's workspace gets "Task not found".
    listTaskActivityFeedMock.mockRejectedValue(
      new FakeCoreApiRequestError("Task not found", 404),
    );
  });

  it("renders activity from the admin task payload instead of the workspace-scoped events read", async () => {
    const events = [
      event("evt_1", null, 1),
      ...Array.from({ length: 7 }, (_, index) =>
        event(`evt_c${index}`, `comment ${index}`, index + 2),
      ),
    ];

    const errors = await renderErrors(
      <TaskDetailView task={createTask(events)} forceReadOnly />,
    );

    expect(errors).toEqual([]);
    expect(listTaskActivityFeedMock).not.toHaveBeenCalled();
    expect(taskActivitySectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events,
        commentCount: 7,
        latestCommentId: "evt_c6",
        canComment: false,
      }),
    );
  });

  it("keeps the workspace-scoped events read for the user-facing view", async () => {
    const feedEvents = [event("evt_c0", "comment 0", 1)];
    listTaskActivityFeedMock.mockResolvedValue({
      events: feedEvents,
      pagination: { commentCount: 12, latestCommentId: "evt_c11" },
    });

    const errors = await renderErrors(<TaskDetailView task={createTask([])} />);

    expect(errors).toEqual([]);
    expect(listTaskActivityFeedMock).toHaveBeenCalledWith("task_1");
    expect(taskActivitySectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events: feedEvents,
        commentCount: 12,
        latestCommentId: "evt_c11",
      }),
    );
  });
});
