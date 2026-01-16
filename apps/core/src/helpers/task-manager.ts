type AttachmentWithSize = {
  id: string;
  url: string;
  name: string | null;
  mimeType: string | null;
  size: bigint | null;
};

type CommentWithAttachments = {
  id: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  userId: string | null;
  orchestratorId: string | null;
  attachments: AttachmentWithSize[];
};

type TaskWithAttachmentsAndComments = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  orchestrator: {
    id: string;
    slug: string;
    name: string;
    url: string | null;
    email: string | null;
    description: string | null;
    image: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  events: Array<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    status: string;
    userId: string | null;
    orchestratorId: string | null;
  }>;
  comments: CommentWithAttachments[];
  attachments: AttachmentWithSize[];
};

export function mapTaskAttachment(attachment: AttachmentWithSize) {
  return {
    ...attachment,
    size: attachment.size ? Number(attachment.size) : null,
  };
}

export function mapTaskComment(comment: CommentWithAttachments) {
  return {
    ...comment,
    attachments: comment.attachments.map(mapTaskAttachment),
  };
}

export function mapTaskDetail(task: TaskWithAttachmentsAndComments) {
  return {
    ...task,
    attachments: task.attachments.map(mapTaskAttachment),
    comments: task.comments.map(mapTaskComment),
  };
}
