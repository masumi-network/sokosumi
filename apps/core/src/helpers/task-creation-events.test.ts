import { Channel, TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { taskCreationEvents } from "./task-creation-events";

describe("taskCreationEvents", () => {
  it("returns CREATED, then the status event 1 ms later, which keeps the id", () => {
    const [created, status, ...rest] = taskCreationEvents({
      status: TaskStatus.READY,
      channel: Channel.SLACK,
      actorFields: { userId: "user_123" },
      statusEventId: "event_effect",
    });

    expect(rest).toEqual([]);
    expect(created).toMatchObject({
      status: TaskStatus.CREATED,
      comment: null,
      channel: Channel.SLACK,
      userId: "user_123",
    });
    expect(created.id).toBeUndefined();
    expect(status).toMatchObject({
      id: "event_effect",
      status: TaskStatus.READY,
      comment: null,
      channel: Channel.SLACK,
      userId: "user_123",
    });
    expect((status.createdAt as Date).getTime()).toBe(
      (created.createdAt as Date).getTime() + 1,
    );
  });
});
