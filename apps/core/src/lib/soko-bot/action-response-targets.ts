import type { Prisma } from "@sokosumi/database";
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

/** Literal text inside markdown: a Task called "[TEST] Launch" keeps its brackets. */
export function linkText(value: string): string {
  return value.slice(0, 120).replace(/[[\]\\]/g, "\\$&");
}

export function actionTarget(
  call: { capability: string; targetId: string | null; result?: unknown },
  tasks: Map<string, TaskLabel>,
  jobAgents: Map<string, string>,
  assignedTaskIds: ReadonlySet<string | null>,
): string {
  const id = call.targetId ?? "";
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
  return task ? `${task[1]} ${count} Tasks` : `${label} (${count}×)`;
}

export function collapseActionLines(
  lines: { head: string; target: string }[],
): string[] {
  const groups = new Map<string, string[]>();
  for (const { head, target } of lines) {
    const targets = groups.get(head) ?? [];
    if (!targets.includes(target)) targets.push(target);
    groups.set(head, targets);
  }
  return [...groups].map(([head, targets]) => {
    if (targets.length === 1)
      return `${[head, targets[0]].filter(Boolean).join(" ")}.`;
    const named = targets.filter(Boolean);
    const label = countedLabel(head, targets.length);
    return named.length && targets.length <= MAX_NAMED_TARGETS
      ? `${label}: ${named.join(", ")}.`
      : `${label}.`;
  });
}
