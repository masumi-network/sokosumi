import { describe, expect, it } from "vitest";

import {
  getAdminTaskResponseTransformer,
  getTasksByIdResponseTransformer,
  getTasksResponseTransformer,
} from "@/lib/clients/generated/core/transformers.gen";

/**
 * Exercises the real generated response transformers on a `share: null` task.
 *
 * Most tasks have no share, so the transformer must null-guard the share date
 * conversion. A regression here (e.g. `taskSchema.share` switching back to
 * `.nullable()` on a named component) produces an unguarded call that throws
 * "Cannot read properties of null (reading 'createdAt')". The unit/service
 * tests mock the client and never run the transformer, so this covers the gap.
 */
function buildTaskListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "tsk_1",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    userId: "user_1",
    user: { id: "user_1", name: "Ada", image: null },
    organizationId: null,
    organization: null,
    projectId: null,
    coworkerId: null,
    coworker: null,
    name: "Task",
    description: null,
    status: "READY",
    metadata: null,
    nextRunAt: null,
    jobsCount: 1,
    commentsCount: 2,
    workspace: { id: "ws_1", organizationId: null, organization: null },
    ...overrides,
  };
}

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "tsk_1",
    createdAt: "2026-03-25T10:00:00.000Z",
    updatedAt: "2026-03-25T10:00:00.000Z",
    userId: "user_1",
    user: { id: "user_1", name: "Ada", image: null },
    organizationId: null,
    organization: null,
    projectId: null,
    coworkerId: null,
    coworker: null,
    name: "Task",
    description: null,
    status: "RUNNING",
    events: [],
    jobs: [],
    credits: 0,
    workspace: { id: "ws_1", organizationId: null, organization: null },
    share: null,
    links: [],
    ...overrides,
  };
}

const meta = {
  timestamp: "2026-03-25T10:00:00.000Z",
  requestId: "req_1",
};

describe("task response transformers with a null share", () => {
  it("getTasksResponseTransformer does not throw for slim list items", async () => {
    const result = await getTasksResponseTransformer({
      data: [buildTaskListItem()],
      meta: { ...meta },
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.createdAt).toBeInstanceOf(Date);
    expect(result.data[0]).toMatchObject({
      jobsCount: 1,
      commentsCount: 2,
    });
    expect(result.data[0]).not.toHaveProperty("events");
    expect(result.data[0]).not.toHaveProperty("jobs");
  });

  it("getTasksByIdResponseTransformer does not throw and converts dates", async () => {
    const result = await getTasksByIdResponseTransformer({
      data: buildTask(),
      meta: { ...meta },
    });

    expect(result.data.share).toBeNull();
    expect(result.data.createdAt).toBeInstanceOf(Date);
  });

  it("getAdminTaskResponseTransformer does not throw and converts dates", async () => {
    const result = await getAdminTaskResponseTransformer({
      data: {
        task: buildTask(),
        user: { id: "user_1", name: "Ada", email: "ada@example.com" },
        organization: null,
      },
      meta: { ...meta },
    });

    expect(result.data.task.share).toBeNull();
    expect(result.data.task.createdAt).toBeInstanceOf(Date);
  });

  it("still converts a present share's dates", async () => {
    const result = await getTasksByIdResponseTransformer({
      data: buildTask({
        share: {
          id: "share_1",
          token: "tok",
          allowSearchIndexing: false,
          createdAt: "2026-03-25T10:00:00.000Z",
          updatedAt: "2026-03-25T10:00:00.000Z",
          taskId: "tsk_1",
        },
      }),
      meta: { ...meta },
    });

    expect(result.data.share?.createdAt).toBeInstanceOf(Date);
  });
});
