import { redactSokoBotSensitiveText } from "@sokosumi/soko-bot";
import { z } from "zod";
import { cursorPaginationMetaSchema } from "@/schemas/pagination.schema";

export const READ_OBSERVATION_CAPABILITIES = [
  "get_task_status",
  "get_job_status",
  "list_project_social_accounts",
  "list_social_posts",
  "get_social_post",
  "list_chats",
  "read_chat",
] as const;

const MAX_CHAT_MESSAGES = 2;
const MAX_UNREAD_ROOMS = 5;
const MAX_CHAT_LABEL_LENGTH = 120;
const MAX_CHAT_MESSAGE_LENGTH = 1_000;
const MAX_STORED_CHAT_ITEMS = 100;

const chatRead = z.object({
  name: z.string(),
  messages: z
    .array(
      z.object({
        from: z.string(),
        at: z.string().datetime({ offset: true }),
        content: z.string(),
      }),
    )
    .max(MAX_STORED_CHAT_ITEMS),
});

const unreadChats = z.object({
  ownerUnread: z
    .array(
      z.object({
        name: z.string(),
        unread: z.number().int().nonnegative(),
        youAreMember: z.boolean(),
      }),
    )
    .max(MAX_STORED_CHAT_ITEMS),
});

/** Redact the whole value before clipping, so a partial secret is never shown. */
function quoteChat(value: string, maxLength = MAX_CHAT_LABEL_LENGTH): string {
  const safe = redactSokoBotSensitiveText(value).replace(/[\r\n]+/g, " ");
  return JSON.stringify(
    safe.length > maxLength ? `${safe.slice(0, maxLength)}…` : safe,
  );
}

function describeChatRead(capability: string, value: unknown): string[] {
  if (capability === "list_chats") {
    const parsed = unreadChats.safeParse(value);
    if (!parsed.success) return [];
    const unread = parsed.data.ownerUnread.filter(
      (room) => room.youAreMember && room.unread > 0,
    );
    if (!unread.length)
      return ["No unread messages were returned for chats I can read."];
    return [
      `Unread chats I can read: ${unread
        .slice(0, MAX_UNREAD_ROOMS)
        .map((room) => `${quoteChat(room.name)} (${room.unread})`)
        .join(
          "; ",
        )}.${unread.length > MAX_UNREAD_ROOMS ? ` Showing ${MAX_UNREAD_ROOMS} of ${unread.length} returned unread chats.` : ""}`,
    ];
  }
  const parsed = chatRead.safeParse(value);
  if (!parsed.success) return [];
  const messages = [...parsed.data.messages]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_CHAT_MESSAGES);
  if (!messages.length)
    return [`No messages were returned from ${quoteChat(parsed.data.name)}.`];
  return messages.map(
    (message) =>
      `In ${quoteChat(parsed.data.name)}, ${quoteChat(message.from)} wrote at ${JSON.stringify(message.at)}: ${quoteChat(message.content, MAX_CHAT_MESSAGE_LENGTH)}`,
  );
}

// These are persisted authorized read fields, not model-authored narration.
const readObservationSchema = z.object({
  id: z.string().optional(),
  name: z.string().nullable().optional(),
  status: z.string().optional(),
  project: z.object({ name: z.string() }).nullable().optional(),
  assignee: z.object({ name: z.string().nullable() }).nullable().optional(),
  events: z
    .array(
      z.object({
        status: z.string().nullable().optional(),
        comment: z.string().nullable().optional(),
        by: z.string().optional(),
        inputSchema: z.unknown().optional(),
      }),
    )
    .optional(),
  fulfillment: z
    .object({
      state: z.enum([
        "UNKNOWN",
        "IN_PROGRESS",
        "FULFILLED",
        "PARTIAL",
        "BLOCKED",
        "FAILED",
        "CANCELLED",
      ]),
      blockerKind: z.string().nullable(),
      remainingSteps: z.array(z.string()),
      acceptanceCriteria: z
        .array(z.object({ id: z.string(), description: z.string().optional() }))
        .optional(),
    })
    .optional(),
  links: z
    .array(
      z.object({
        relation: z.string(),
        direction: z.string(),
        note: z.string().nullable().optional(),
        task: z.object({ name: z.string(), status: z.string() }),
      }),
    )
    .optional(),
});

function quoteRead(value: string) {
  return JSON.stringify(value.slice(0, 600));
}

const socialAccountObservationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  externalHandle: z.string().nullable(),
  status: z.string(),
  connectedAt: z.string().nullable(),
  disconnectedAt: z.string().nullable(),
  // Absent from tool calls stored before accounts carried limits.
  textLimit: z.number().int().optional(),
});

const socialPostObservationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  text: z.string(),
  status: z.string(),
  revision: z.number().int().nonnegative(),
  scheduledAt: z.string().nullable(),
  timezone: z.string().nullable(),
  publishedUrl: z.string().nullable(),
  socialConnection: z
    .object({ externalHandle: z.string().nullable(), status: z.string() })
    .nullable()
    .optional(),
  threadPartCount: z.number().int().optional(),
  quotedPostId: z.string().nullable().optional(),
});

function describeSocialPost(read: z.infer<typeof socialPostObservationSchema>) {
  return `Observed social post ${quoteRead(read.id)}: platform ${quoteRead(read.provider)}, status ${quoteRead(read.status)}, revision ${read.revision}. Text: ${quoteRead(read.text)}. Scheduled at: ${quoteRead(read.scheduledAt ?? "not scheduled")}; time zone: ${quoteRead(read.timezone ?? "not set")}.${read.socialConnection ? ` Account: ${quoteRead(read.socialConnection.externalHandle ?? "unknown handle")}, status ${quoteRead(read.socialConnection.status)}.` : ""}${read.threadPartCount && read.threadPartCount > 1 ? ` Thread of ${read.threadPartCount} posts.` : ""}${read.quotedPostId ? ` Quotes post ${quoteRead(read.quotedPostId)}.` : ""}${read.publishedUrl ? ` Published URL: ${quoteRead(read.publishedUrl)}.` : ""}`;
}

function describeProject(value: unknown): string[] {
  const parsed = z
    .object({ project: z.object({ id: z.uuid(), name: z.string() }) })
    .safeParse(value);
  return parsed.success
    ? [`Recorded project: ${quoteRead(parsed.data.project.name)}.`]
    : [];
}

export function describeRead(capability: string, value: unknown): string[] {
  if (capability === "read_chat" || capability === "list_chats")
    return describeChatRead(capability, value);
  if (capability === "list_project_social_accounts") {
    const accounts = z.array(socialAccountObservationSchema);
    // Stored tool calls from before workspace availability contain the array directly.
    const parsed = z
      .union([
        accounts,
        z.object({ accounts }).transform((result) => result.accounts),
      ])
      .safeParse(value);
    if (!parsed.success) return [];
    return [
      ...describeProject(value),
      `Showing ${parsed.data.length} of ${parsed.data.length} returned social accounts.`,
      ...parsed.data.map(
        (read) =>
          `Observed social account ${quoteRead(read.id)}: platform ${quoteRead(read.provider)}, handle ${quoteRead(read.externalHandle ?? "unknown handle")}, status ${quoteRead(read.status)}. Connected at: ${quoteRead(read.connectedAt ?? "not recorded")}; disconnected at: ${quoteRead(read.disconnectedAt ?? "not recorded")}.${read.textLimit ? ` Text limit: ${read.textLimit} characters.` : ""}`,
      ),
    ];
  }
  if (capability === "list_social_posts") {
    const parsed = z
      .object({
        posts: z.array(socialPostObservationSchema),
        pagination: cursorPaginationMetaSchema,
      })
      .safeParse(value);
    if (!parsed.success) return [];
    return [
      ...describeProject(value),
      `Showing ${Math.min(parsed.data.posts.length, 5)} of ${parsed.data.posts.length} returned social posts (${parsed.data.pagination.total} total).${parsed.data.pagination.nextCursor ? " More posts are available." : ""}`,
      ...parsed.data.posts.slice(0, 5).map(describeSocialPost),
    ];
  }
  if (capability === "get_social_post") {
    const parsed = socialPostObservationSchema.safeParse(value);
    return parsed.success ? [describeSocialPost(parsed.data)] : [];
  }
  const parsed = readObservationSchema.safeParse(value);
  if (!parsed.success) return [];
  const read = parsed.data;
  const isTask = capability === "get_task_status";
  const event = isTask ? read.events?.at(-1) : read.events?.[0];
  const status = read.status ?? event?.status;
  const observations: string[] = [];
  if (read.name && status)
    observations.push(
      `Observed ${isTask ? "task" : "job"} ${quoteRead(read.name)}: status ${quoteRead(status)}.`,
    );
  if (read.project)
    observations.push(`Recorded project: ${quoteRead(read.project.name)}.`);
  if (read.assignee?.name)
    observations.push(`Recorded assignee: ${quoteRead(read.assignee.name)}.`);
  if (event?.comment)
    observations.push(
      `Latest reported task update (${quoteRead(event.by ?? "unknown author")}): ${quoteRead(event.comment)}.`,
    );
  if (!isTask && (status === "AWAITING_INPUT" || status === "input_required"))
    observations.push(
      "The latest job event is awaiting input; completion is not verified.",
    );
  if (read.fulfillment) {
    for (const id of read.fulfillment.remainingSteps.slice(0, 4)) {
      const criterion = read.fulfillment.acceptanceCriteria?.find(
        (item) => item.id === id,
      );
      observations.push(
        `Not confirmed yet: ${quoteRead(criterion?.description ?? id)}.`,
      );
    }
  }
  for (const link of (read.links ?? []).slice(0, 4))
    observations.push(
      `Recorded task relationship ${quoteRead(link.relation)} (${quoteRead(link.direction)}): ${quoteRead(link.task.name)}, status ${quoteRead(link.task.status)}.${link.note ? ` Reported note: ${quoteRead(link.note)}.` : ""}`,
    );
  return observations;
}
