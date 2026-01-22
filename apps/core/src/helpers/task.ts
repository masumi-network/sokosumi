import { type Attachment, TaskStatus } from "@sokosumi/database";

import type { Task } from "@/types/task";

import { unprocessableEntity } from "./error";

type AttachmentReference = {
  referenceId: string;
  referenceType: "Input" | "Task" | "Comment";
};

function getAttachmentReference(attachment: Attachment): AttachmentReference {
  if (attachment.jobInputId) {
    return { referenceId: attachment.jobInputId, referenceType: "Input" };
  }

  if (attachment.taskId) {
    return { referenceId: attachment.taskId, referenceType: "Task" };
  }

  if (attachment.taskCommentId) {
    return { referenceId: attachment.taskCommentId, referenceType: "Comment" };
  }

  throw unprocessableEntity("Invalid attachment: missing reference");
}

export function validateStatusTransition(
  from: TaskStatus,
  to: TaskStatus,
): void {
  if (from === to) {
    return;
  }

  const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
    [TaskStatus.DRAFT]: [TaskStatus.READY, TaskStatus.RUNNING],
    [TaskStatus.READY]: [TaskStatus.DRAFT, TaskStatus.RUNNING],
    [TaskStatus.INPUT_REQUIRED]: [
      TaskStatus.RUNNING,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
    ],
    [TaskStatus.RUNNING]: [
      TaskStatus.INPUT_REQUIRED,
      TaskStatus.COMPLETED,
      TaskStatus.FAILED,
    ],
    [TaskStatus.COMPLETED]: [],
    [TaskStatus.FAILED]: [],
  };

  if (!allowedTransitions[from].includes(to)) {
    throw unprocessableEntity(
      `Invalid status transition from ${from} to ${to}`,
    );
  }
}

type TaskCommentWithAttachments = {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string | null;
  orchestratorId: string | null;
  attachments: Attachment[];
};

export function mapTask(task: Task) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    name: task.name,
    description: task.description ?? null,
    status: task.status,
    userId: task.userId,
    orchestratorId: task.orchestratorId ?? null,
    _count: {
      comments: task._count.comments,
    },
    attachments: task.attachments.map((attachment) =>
      mapTaskAttachment(attachment),
    ),
  };
}

export function mapTaskAttachment(attachment: Attachment) {
  const { referenceId, referenceType } = getAttachmentReference(attachment);

  return {
    id: attachment.id,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    referenceId,
    referenceType,
    name: attachment.name ?? null,
    size: attachment.size ? Number(attachment.size) : null,
    mimeType: attachment.mimeType ?? null,
    url: attachment.url ?? null,
  };
}

export function mapTaskComment(comment: TaskCommentWithAttachments) {
  return {
    ...comment,
    attachments: comment.attachments.map((attachment) =>
      mapTaskAttachment(attachment),
    ),
  };
}