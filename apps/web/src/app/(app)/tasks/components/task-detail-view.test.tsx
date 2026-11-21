import type { Task, TaskEvent } from "@sokosumi/core-client";
import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskMetadataParticipantsField } from "@/app/tasks/components/task-metadata-participants-field";
import { TaskMetadataParticipantsRow } from "@/app/tasks/components/task-metadata-participants-row";

const taskActivitySectionMock = vi.fn();
const taskMetadataMock = vi.fn();
const taskDetailActionsMock = vi.fn();
const taskSubtaskSectionMock = vi.fn();
const taskContactsSectionMock = vi.fn();
const getTaskContactsMock = vi.hoisted(() => vi.fn());
const viewer = vi.hoisted(() => ({
  id: "user_admin",
  hasAssignedSeat: false,
}));

/** The component the sidebar's Participants row renders with. */
function participantsRowType() {
  const props = taskMetadataMock.mock.calls.at(-1)?.[0] as {
    participants: ReactElement;
  };
  return props.participants.type;
}

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => undefined }));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => {
    const translator = (key: string) => key;
    translator.raw = (key: string) => key;
    return translator;
  },
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getPrivateCachedSession: async () => ({
    session: { activeOrganizationId: null },
    user: { id: viewer.id, name: "Admin", email: "admin@example.com" },
  }),
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
  organizationSeatService: {
    hasAssignedSeat: async () => viewer.hasAssignedSeat,
  },
}));
vi.mock("@/lib/services/project.service", () => ({
  projectService: { getProjectById: async () => null },
}));
vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getTaskContacts: getTaskContactsMock,
    getMySokoBotActivity: async () => ({
      data: {
        id: "bot-1",
        userId: "viewer-1",
        avatarSeed: null,
        avatarImageUrl: null,
        avatarCode: null,
      },
    }),
  },
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
vi.mock("@/app/tasks/components/task-contacts", () => ({
  TaskContactsSection: (props: unknown) => {
    taskContactsSectionMock(props);
    return null;
  },
}));
vi.mock("@/app/tasks/components/task-context-section", () => ({
  TaskContextSection: () => null,
}));
vi.mock("@/app/tasks/components/task-description", () => ({
  TaskDescription: () => null,
}));
vi.mock("@/app/tasks/components/task-detail-actions", () => ({
  TaskDetailActions: (props: unknown) => {
    taskDetailActionsMock(props);
    return null;
  },
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
  TaskMetadata: (props: unknown) => {
    taskMetadataMock(props);
    return null;
  },
}));
vi.mock("@/app/tasks/components/task-related-tasks", () => ({
  TaskRelatedTasks: () => null,
}));
vi.mock("@/app/tasks/components/task-status-realtime-listener", () => ({
  TaskStatusRealtimeListener: () => null,
}));
vi.mock("@/app/tasks/components/task-subtask-section", () => ({
  TaskSubtaskSection: () => {
    taskSubtaskSectionMock();
    return null;
  },
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

function createTask(
  events: TaskEvent[],
  overrides: Record<string, unknown> = {},
): Task {
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
    parentTaskId: null,
    subtaskProgress: { completed: 0, total: 0 },
    events,
    tags: [],
    createdAt: new Date("2026-10-05T09:00:00Z"),
    updatedAt: new Date("2026-10-05T09:00:00Z"),
    workspace: { id: "ws_owner", organizationId: "org_owner" },
    ...overrides,
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
    viewer.id = "user_admin";
    viewer.hasAssignedSeat = false;
  });

  it("renders every comment from the admin task payload", async () => {
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
    expect(taskActivitySectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events,
        commentCount: 7,
        latestCommentId: "evt_c6",
        canComment: false,
      }),
    );
    // No follow for the reader of an admin view.
    const props = taskActivitySectionMock.mock.calls[0]?.[0] as {
      headerAction: { props: { viewerId: string | null } };
    };
    expect(props.headerAction.props.viewerId).toBeNull();
    // No join or leave either: the Participants row is read-only.
    expect(participantsRowType()).toBe(TaskMetadataParticipantsRow);
  });

  it("renders the user-facing view from the task payload with the newest 5 comments", async () => {
    const status = event("evt_1", null, 1);
    const comments = Array.from({ length: 7 }, (_, index) =>
      event(`evt_c${index}`, `comment ${index}`, index + 2),
    );

    const errors = await renderErrors(
      <TaskDetailView task={createTask([status, ...comments])} />,
    );

    expect(errors).toEqual([]);
    expect(taskActivitySectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        events: [status, ...comments.slice(2)],
        commentCount: 7,
        latestCommentId: "evt_c6",
      }),
    );
    expect(participantsRowType()).toBe(TaskMetadataParticipantsField);
  });
});

describe("TaskDetailView (rights follow the Owner)", () => {
  const personalWorkspace = { id: "ws_personal", organizationId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    viewer.id = "user_viewer";
    viewer.hasAssignedSeat = true;
  });

  async function renderFor(task: Task) {
    expect(await renderErrors(<TaskDetailView task={task} />)).toEqual([]);
    return {
      actions: taskDetailActionsMock.mock.lastCall?.[0],
      activity: taskActivitySectionMock.mock.lastCall?.[0],
    };
  }

  it("gives the Owner of a personal task its controls", async () => {
    const { actions, activity } = await renderFor(
      createTask([], {
        ownerId: "user_viewer",
        owner: { id: "user_viewer", name: "Viewer", image: null },
        workspace: personalWorkspace,
      }),
    );

    expect(actions).toMatchObject({ isTaskOwner: true, canCancel: true });
    expect(activity.canComment).toBe(true);
  });

  it("gives another member of the organization workspace no 'mine' controls but still lets them comment and cancel", async () => {
    const { actions, activity } = await renderFor(createTask([]));

    expect(actions).toMatchObject({ isTaskOwner: false, canCancel: true });
    expect(activity.canComment).toBe(true);
  });

  it("gives a viewer who does not own a personal task no controls", async () => {
    const { actions, activity } = await renderFor(
      createTask([], { workspace: personalWorkspace }),
    );

    expect(actions).toMatchObject({ isTaskOwner: false, canCancel: false });
    expect(activity.canComment).toBe(false);
  });

  it("shows a public Task whose Owner deleted their account", async () => {
    const { actions, activity } = await renderFor(
      createTask([], {
        ownerId: null,
        owner: null,
        userId: null,
        user: null,
        creator: null,
      }),
    );

    expect(actions).toMatchObject({ isTaskOwner: false });
    expect(activity.canComment).toBe(true);
  });

  it("gives nobody a personal-workspace right on a Task without an Owner", async () => {
    const { actions, activity } = await renderFor(
      createTask([], {
        ownerId: null,
        owner: null,
        workspace: personalWorkspace,
      }),
    );

    expect(actions).toMatchObject({ isTaskOwner: false, canCancel: false });
    expect(activity.canComment).toBe(false);
  });
});

describe("TaskDetailView (sub-task checklist)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.id = "user_owner";
    viewer.hasAssignedSeat = true;
  });

  it("leaves the checklist out of a Task with no sub-tasks", async () => {
    expect(
      await renderErrors(<TaskDetailView task={createTask([])} />),
    ).toEqual([]);

    expect(taskSubtaskSectionMock).not.toHaveBeenCalled();
  });

  it("shows the checklist once the Task has a sub-task", async () => {
    const task = createTask([], {
      subtaskProgress: { completed: 0, total: 1 },
    });

    expect(await renderErrors(<TaskDetailView task={task} />)).toEqual([]);

    expect(taskSubtaskSectionMock).toHaveBeenCalled();
  });
});

describe("TaskDetailView (tagged contacts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.id = "user_owner";
    viewer.hasAssignedSeat = true;
  });

  it("shows the contacts Core lists for the Task", async () => {
    const contacts = [{ id: "contact-1", name: "Maya Stone" }];
    getTaskContactsMock.mockResolvedValue({ data: contacts });

    expect(
      await renderErrors(<TaskDetailView task={createTask([])} />),
    ).toEqual([]);

    expect(getTaskContactsMock).toHaveBeenCalledWith("task_1");
    expect(taskContactsSectionMock).toHaveBeenCalledWith({ contacts });
    expect(taskMetadataMock).toHaveBeenCalled();
  });

  it("keeps the properties when the contacts cannot be read", async () => {
    getTaskContactsMock.mockRejectedValue(new Error("Core down"));

    expect(
      await renderErrors(<TaskDetailView task={createTask([])} />),
    ).toEqual([]);

    expect(taskContactsSectionMock).not.toHaveBeenCalled();
    expect(taskMetadataMock).toHaveBeenCalled();
  });
});
