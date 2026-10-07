import { type Channel, type Prisma, TaskStatus } from "@sokosumi/database";

/**
 * The events a new Task is created with: a CREATED event, then the initial
 * status event (which keeps `statusEventId`, e.g. an effect event id).
 * Explicit times (t, t + 1 ms) keep CREATED first, never the latest event.
 */
export function taskCreationEvents(input: {
  status: TaskStatus;
  channel: Channel;
  actorFields: Pick<
    Prisma.TaskEventUncheckedCreateWithoutTaskInput,
    "userId" | "coworkerId" | "sokoBotId"
  >;
  statusEventId?: string;
}): Prisma.TaskEventUncheckedCreateWithoutTaskInput[] {
  const createdAt = new Date();
  const common = {
    channel: input.channel,
    ...input.actorFields,
    comment: null,
  };
  return [
    { ...common, status: TaskStatus.CREATED, createdAt },
    {
      ...common,
      id: input.statusEventId,
      status: input.status,
      createdAt: new Date(createdAt.getTime() + 1),
    },
  ];
}
