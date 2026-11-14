import type { Prisma } from "@sokosumi/database";
import {
  redactSokoBotSensitiveText,
  SOKO_BOT_SEO_WRITE_CAPABILITIES,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import { newsletterIssueLink } from "./newsletter-issue-link";

const NEWSLETTER_ISSUE_CAPABILITIES = new Set([
  "create_newsletter_issue",
  "update_newsletter_issue",
  "delete_newsletter_issue",
  "submit_newsletter_issue",
]);

const NEWSLETTER_SUBSCRIBER_CAPABILITIES = new Set([
  "add_newsletter_subscriber",
  "import_newsletter_subscribers",
  "add_newsletter_subscribers_from_contacts",
  "update_newsletter_subscriber",
  "remove_newsletter_subscriber",
]);

const TABLE_CAPABILITIES = new Set([
  "create_table",
  "write_table_rows",
  "update_table_columns",
]);

const CONTACT_CAPABILITIES = new Set([
  "upsert_contact",
  "update_contact",
  "log_contact_interaction",
  "merge_contacts",
  "manage_contact_lists",
  "find_people",
  "enrich_contact",
]);

/** The contact or list a contacts receipt names, from its stored result. */
function contactTarget(result: unknown): string {
  const named = z
    .union([
      z.object({ contact: z.object({ name: z.string().min(1) }) }),
      z.object({ name: z.string().min(1) }),
    ])
    .safeParse(result);
  if (!named.success) return "";
  return linkText(
    "contact" in named.data ? named.data.contact.name : named.data.name,
  );
}

const AD_CAMPAIGN_CAPABILITIES = new Set([
  "create_ad_campaign",
  "update_ad_campaign",
  "edit_ad_campaign",
]);

const SOCIAL_POST_CAPABILITIES = new Set([
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
]);

const SCHEDULE_CAPABILITIES = new Set([
  "create_schedule",
  "update_schedule",
  "delete_schedule",
]);
const MAX_ACTION_NAME_LENGTH = 120;
const MAX_QUEUED_CHAT_CONTENT_LENGTH = 1_000;
const queuedChatResult = z.object({
  messageId: z.string().min(1),
  roomName: z.string().min(1),
  queuedContent: z.string().min(1),
  deliveryStatus: z.literal("QUEUED"),
});
const scheduleResult = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  taskId: z.string().min(1).nullable().optional(),
  nextRunAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().min(1).optional(),
  runOnce: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

/** Redact before clipping, and keep saved text literal inside Markdown. */
function quoteResultText(value: string, maxLength: number): string {
  const safe = redactSokoBotSensitiveText(value).replace(/[\r\n]+/g, " ");
  const bounded =
    safe.length > maxLength ? `${safe.slice(0, maxLength)}...` : safe;
  return JSON.stringify(bounded).replace(/[\\`*_[\]<>]/g, "\\$&");
}

/** Only committed schedule results can name the work that a check watches. */
export function scheduleTaskId(call: {
  capability: string;
  targetId: string | null;
  result?: unknown;
}): string | null {
  if (
    !SCHEDULE_CAPABILITIES.has(call.capability) ||
    call.capability === "delete_schedule"
  )
    return null;
  const schedule = scheduleResult.safeParse(call.result);
  return schedule.success && schedule.data.id === call.targetId
    ? (schedule.data.taskId ?? null)
    : null;
}

export const TASK_TARGET_CAPABILITIES = new Set([
  "create_task",
  "update_task",
  "archive_task",
  "assign_task",
  "reply_to_task",
  "update_assigned_task",
]);

interface TaskLabel {
  name: string;
  assignee: string | null;
}

/** Names come from the stored task, never from the model's narration. */
export async function taskLabels(
  tx: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, TaskLabel>> {
  if (!ids.length) return new Map();
  const tasks = await tx.task.findMany({
    where: { id: { in: [...new Set(ids)] } },
    select: {
      id: true,
      name: true,
      assignee: { select: { name: true } },
      assigneeUser: { select: { name: true } },
      assigneeSokoBot: { select: { name: true } },
    },
  });
  return new Map(
    tasks.map((task) => [
      task.id,
      {
        name: task.name,
        assignee:
          task.assignee?.name ??
          task.assigneeUser?.name ??
          task.assigneeSokoBot?.name ??
          null,
      },
    ]),
  );
}

const SEO_WRITE_CAPABILITIES = new Set<string>(SOKO_BOT_SEO_WRITE_CAPABILITIES);
const SEO_TASK_CAPABILITIES = new Set([
  "request_seo_analysis",
  "create_seo_action_task",
]);
const seoReceiptResult = z.object({
  projectId: z.uuid(),
  id: z.uuid(),
  taskId: z.uuid().optional(),
  link: z.string(),
});

/** Only the locally committed result can identify the Project and optional Task. */
function seoReceipt(call: {
  capability: string;
  targetId: string | null;
  result?: unknown;
}) {
  if (!SEO_WRITE_CAPABILITIES.has(call.capability)) return null;
  const saved = seoReceiptResult.safeParse(call.result);
  if (!saved.success || saved.data.id !== call.targetId) return null;
  const link = `/seo?projectId=${encodeURIComponent(saved.data.projectId)}&view=project`;
  return saved.data.link === link ? saved.data : null;
}

/** SEO receipt targets name domain records, not Tasks. Resolve only the returned public Task in this scope. */
export async function seoTaskLabels(
  tx: Prisma.TransactionClient,
  turnId: string,
  calls: { capability: string; targetId: string | null; result?: unknown }[],
): Promise<Map<string, string>> {
  const targets = calls.flatMap((call) => {
    const saved = SEO_TASK_CAPABILITIES.has(call.capability)
      ? seoReceipt(call)
      : null;
    return saved?.taskId
      ? [{ id: saved.taskId, projectId: saved.projectId }]
      : [];
  });
  if (!targets.length) return new Map();
  const turn = await tx.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { workspaceId: true },
  });
  if (!turn) return new Map();
  const tasks = await tx.task.findMany({
    where: { workspaceId: turn.workspaceId, visibility: "PUBLIC", OR: targets },
    select: { id: true, name: true, projectId: true },
  });
  return new Map(
    tasks.map((task) => [`${task.projectId}:${task.id}`, task.name]),
  );
}

/** Literal text inside markdown: a Task called "[TEST] Launch" keeps its brackets. */
export function linkText(value: string): string {
  return value.slice(0, 120).replace(/[[\]\\]/g, "\\$&");
}

export function actionTarget(
  call: { capability: string; targetId: string | null; result?: unknown },
  tasks: Map<string, TaskLabel>,
  jobAgents: Map<string, string>,
  assignedTaskIds: ReadonlySet<string | null>,
  seoTasks: ReadonlyMap<string, string> = new Map(),
): string {
  const id = call.targetId ?? "";
  if (SEO_WRITE_CAPABILITIES.has(call.capability)) {
    const saved = seoReceipt(call);
    if (!saved) return "";
    const name =
      saved.taskId && SEO_TASK_CAPABILITIES.has(call.capability)
        ? seoTasks.get(`${saved.projectId}:${saved.taskId}`)
        : null;
    const task =
      name && saved.taskId
        ? `[${linkText(name)}](/tasks/${encodeURIComponent(saved.taskId)}) `
        : "";
    return `${task}([Open SEO](${saved.link}))`;
  }

  if (call.capability === "post_chat") {
    const chat = queuedChatResult.safeParse(call.result);
    return chat.success && chat.data.messageId === id
      ? `in ${quoteResultText(chat.data.roomName, MAX_ACTION_NAME_LENGTH)}: ${quoteResultText(chat.data.queuedContent, MAX_QUEUED_CHAT_CONTENT_LENGTH)} (delivery pending)`
      : "";
  }
  if (SCHEDULE_CAPABILITIES.has(call.capability)) {
    const schedule = scheduleResult.safeParse(call.result);
    if (!schedule.success || schedule.data.id !== id) return "";
    const saved = schedule.data;
    const name = quoteResultText(saved.name, MAX_ACTION_NAME_LENGTH);
    if (call.capability === "delete_schedule") return name;
    const task = saved.taskId ? tasks.get(saved.taskId) : null;
    const work =
      task && saved.taskId
        ? ` for [${linkText(task.name)}](/tasks/${encodeURIComponent(saved.taskId)})`
        : "";
    const time =
      saved.enabled === true && saved.nextRunAt && saved.timezone
        ? `, ${saved.runOnce ? "once" : "next run"} at ${new Date(saved.nextRunAt).toISOString()} (time zone ${redactSokoBotSensitiveText(
            saved.timezone,
          )
            .replace(/[\r\n]+/g, " ")
            .slice(0, 100)})`
        : "";
    return `${name}${work}${time}`;
  }
  if (call.capability === "newsletter_draft_issue") {
    const issue = z.object({ projectId: z.uuid() }).safeParse(call.result);
    return issue.success
      ? `([Review draft](${newsletterIssueLink({ id, projectId: issue.data.projectId }, true)}))`
      : "";
  }
  if (NEWSLETTER_ISSUE_CAPABILITIES.has(call.capability)) {
    const issue = z.object({ projectId: z.uuid() }).safeParse(call.result);
    if (!issue.success) return "";
    const query = `?projectId=${encodeURIComponent(issue.data.projectId)}`;
    // A deleted issue has no editor left to open.
    return call.capability === "delete_newsletter_issue"
      ? `([Open issues](/newsletter/issues${query}))`
      : `([Open issue](${newsletterIssueLink({ id, projectId: issue.data.projectId })}))`;
  }
  if (call.capability === "update_newsletter_settings") {
    const newsletter = z.object({ projectId: z.uuid() }).safeParse(call.result);
    return newsletter.success
      ? `([Open settings](/newsletter/settings?projectId=${encodeURIComponent(newsletter.data.projectId)}))`
      : "";
  }
  if (NEWSLETTER_SUBSCRIBER_CAPABILITIES.has(call.capability)) {
    const subscribers = z
      .object({ projectId: z.uuid() })
      .safeParse(call.result);
    return subscribers.success
      ? `([Open subscribers](/newsletter/subscribers?projectId=${encodeURIComponent(subscribers.data.projectId)}))`
      : "";
  }
  if (TABLE_CAPABILITIES.has(call.capability))
    return `([Open table](/drive/tables/${encodeURIComponent(id)}))`;
  if (CONTACT_CAPABILITIES.has(call.capability))
    return contactTarget(call.result);
  if (
    call.capability === "create_project" ||
    call.capability === "update_project"
  ) {
    const project = z
      .object({ name: z.string().min(1) })
      .safeParse(call.result);
    return project.success
      ? `[${linkText(project.data.name)}](/projects/${encodeURIComponent(id)})`
      : "";
  }
  if (SOCIAL_POST_CAPABILITIES.has(call.capability)) {
    const post = z
      .object({ projectId: z.string().min(1) })
      .safeParse(call.result);
    return post.success
      ? `([Open post](/social?projectId=${encodeURIComponent(post.data.projectId)}&postId=${encodeURIComponent(id)}))`
      : "";
  }
  if (AD_CAMPAIGN_CAPABILITIES.has(call.capability)) {
    const campaign = z
      .object({ link: z.string().startsWith("/ads/campaigns/") })
      .safeParse(call.result);
    return campaign.success ? `([Open campaign](${campaign.data.link}))` : "";
  }
  if (
    call.capability === "generate_image" ||
    call.capability === "generate_video"
  ) {
    const studio = z
      .object({ studioUrl: z.string().startsWith("/studio?") })
      .safeParse(call.result);
    if (studio.success)
      return `([Open in Content Studio](${studio.data.studioUrl}))`;
  }
  if (
    call.capability === "upload_file" ||
    call.capability === "generate_voiceover"
  ) {
    const file = z
      .object({ filename: z.string().min(1) })
      .safeParse(call.result);
    if (!file.success) return "";
    // Older receipts hold the blob URL and get their card from the line below.
    return id.startsWith("https://")
      ? linkText(file.data.filename)
      : `[${linkText(file.data.filename)}](/drive/files/${encodeURIComponent(id)})`;
  }
  if (call.capability === "hire_agent") {
    const agentId = jobAgents.get(id);
    return agentId
      ? `([Open job](/agents/${encodeURIComponent(agentId)}/jobs/${encodeURIComponent(id)}))`
      : "";
  }
  const task = tasks.get(id);
  // Anything else is named by its label alone: a raw id tells the owner
  // nothing.
  if (!task) return "";
  const link = `[${linkText(task.name)}](/tasks/${encodeURIComponent(id)})`;
  // Who got it is half of what the owner asked for. A Task created with its
  // assignee says so on the create line; one assigned afterwards on its own.
  const namesAssignee =
    call.capability === "assign_task" ||
    (call.capability === "create_task" && !assignedTaskIds.has(id));
  return namesAssignee && task.assignee
    ? `${link} → ${linkText(task.assignee)}`
    : link;
}

/** Names are listed up to this many; past it a count says enough. */
const MAX_NAMED_TARGETS = 5;

/**
 * What the owner asked for on a Task, said as not done ("Couldn't archive …")
 * or, when it ran but left no proof, as unconfirmed ("Couldn't confirm I
 * archived …").
 */
export const UNDONE_TASK_VERBS: Record<string, [string, string]> = {
  create_task: ["create", "created"],
  update_task: ["update", "updated"],
  archive_task: ["archive", "archived"],
  assign_task: ["assign", "assigned"],
  reply_to_task: ["comment on", "commented on"],
  update_assigned_task: ["update", "updated"],
};

/** The target a call was aimed at, even one refused before it had a receipt. */
export function attemptedTarget(call: {
  targetId: string | null;
  input?: unknown;
}): string | null {
  return (
    call.targetId ??
    z.object({ taskId: z.string().min(1) }).safeParse(call.input).data
      ?.taskId ??
    null
  );
}

/** "a Task", one linked Task, or a count that names a few. */
export function missedTasks(links: string[]): string {
  if (links.length === 1) return links[0] || "a Task";
  const label = `${links.length} Tasks`;
  return links.every(Boolean) && links.length <= MAX_NAMED_TARGETS
    ? `${label}: ${links.join(", ")}`
    : label;
}

/** "Archived task" ×4 → "Archived 4 Tasks"; other labels keep a count. */
export function countedLabel(label: string, count: number): string {
  if (count === 1) return label;
  const task = /^(.*) task$/i.exec(label);
  const schedule = /^(.*) schedule$/i.exec(label);
  return task
    ? `${task[1]} ${count} Tasks`
    : schedule
      ? `${schedule[1]} ${count} schedules`
      : `${label} (${count}×)`;
}

export function collapseActionLines(
  lines: { head: string; target: string; identity?: string }[],
): string[] {
  const groups = new Map<string, Map<string, string>>();
  for (const { head, target, identity } of lines) {
    const targets = groups.get(head) ?? new Map<string, string>();
    targets.set(identity ?? target, target);
    groups.set(head, targets);
  }
  return [...groups].map(([head, entries]) => {
    const targets = [...entries.values()];
    if (targets.length === 1)
      return `${[head, targets[0]].filter(Boolean).join(" ")}.`;
    const named = targets.filter(Boolean);
    const label = countedLabel(head, targets.length);
    return named.length && targets.length <= MAX_NAMED_TARGETS
      ? `${label}: ${named.join(", ")}.`
      : `${label}.`;
  });
}
