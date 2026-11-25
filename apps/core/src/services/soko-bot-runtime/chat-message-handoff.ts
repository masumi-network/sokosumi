import { hideSeoAuditRequest } from "@sokosumi/utils";
import { z } from "zod";
import prisma from "@/lib/db/prisma";
import {
  type HandoffRequest,
  handoffRequestBlock,
  REPLY_STATUSES,
  type ReplyStatus,
  replyLinks,
} from "@/lib/soko-bot/handoff-request";
import { askSmallModel } from "@/lib/soko-bot/small-model";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

/**
 * What send_message adds around the bot's own words: a request block for a
 * hand-off, the background the other side may see (a public Task or a
 * Project of this workspace, never the owner's mail, calendar or private
 * Tasks), a check that nothing private leaves, and the reply's status.
 */

/** Tools that read what only the owner may see. */
const PRIVATE_SOURCES = [
  "search_inbox",
  "read_email",
  "list_calendar_events",
  "read_integration_tool",
  "run_integration_tool",
  "save_email_attachment",
];
const BACKGROUND_CHARS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clip(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The Task or Project the message is about, as the other side may read it. */
async function background(
  authorized: AuthorizedSokoBotRuntime,
  input: { taskId?: string; projectId?: string },
): Promise<string[]> {
  const { workspaceId } = authorized.turn;
  const lines: string[] = [];
  if (input.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: input.taskId, workspaceId, archivedAt: null },
      select: {
        name: true,
        status: true,
        description: true,
        visibility: true,
      },
    });
    if (!task)
      throw new SokoBotRuntimeValidationError(
        "No Task with that taskId here; use an id from list_tasks or drop taskId.",
      );
    // A private Task is the owner's; the other side sees only that one exists.
    lines.push(
      task.visibility === "PUBLIC"
        ? `Task "${task.name}" (${task.status.toLowerCase()}): ${clip(hideSeoAuditRequest(task.description), BACKGROUND_CHARS) || "no description"}`
        : "It is about a private Task of the person I work for.",
    );
  }
  if (input.projectId) {
    const project = UUID.test(input.projectId)
      ? await prisma.project.findFirst({
          where: { id: input.projectId, workspaceId },
          select: { name: true, description: true },
        })
      : null;
    if (!project)
      throw new SokoBotRuntimeValidationError(
        "No Project with that projectId here; drop projectId or use one from your context.",
      );
    lines.push(
      `Project "${project.name}": ${clip(project.description, BACKGROUND_CHARS) || "no description"}`,
    );
  }
  return lines;
}

const detectedSchema = z.object({
  handoff: z.boolean(),
  goal: z.string(),
  deliverable: z.string(),
  deadline: z.string(),
});

/**
 * Whether a message asks the other side to make or find something, and if
 * so its goal, deliverable and deadline, read from the bot's own words. A
 * quick question stays as it is. Fails open: no block, the words go as written.
 */
async function detectHandoff(message: string) {
  const detected = await askSmallModel({
    purpose: "soko-bot",
    system:
      'An assistant is about to send this message to a colleague or another agent. handoff is true when it asks them to make, find or deliver something (a table, a draft, research, a review), false for a quick question or a status check. When true, give the goal in a few words, the deliverable, and the deadline as written ("Friday"), or an empty string when it names none.',
    prompt: message.slice(0, 4_000),
    schema: detectedSchema,
  }).catch(() => null);
  return detected?.output.handoff ? detected.output : null;
}

/** The message as sent: the bot's words, then the request block when it hands work over. */
export async function composeHandoff(
  authorized: AuthorizedSokoBotRuntime,
  input: {
    message: string;
    request?: {
      goal: string;
      deliverable?: string;
      deadline?: string;
      context?: string;
    };
    taskId?: string;
    projectId?: string;
  },
): Promise<{ message: string; handoff: boolean }> {
  const about = await background(authorized, input);
  const detected = input.request ? null : await detectHandoff(input.message);
  const asked =
    input.request ??
    (detected
      ? {
          goal: detected.goal,
          deliverable: detected.deliverable || undefined,
          deadline: detected.deadline || undefined,
        }
      : null);
  if (!asked) {
    return {
      message: about.length
        ? `${input.message}\n\nBackground: ${about.join(" ")}`
        : input.message,
      handoff: false,
    };
  }
  const owner = authorized.turn.actingUserId
    ? await prisma.user.findUnique({
        where: { id: authorized.turn.actingUserId },
        select: { name: true },
      })
    : null;
  const context = input.request?.context;
  const request: HandoffRequest = {
    goal: asked.goal,
    deliverable: asked.deliverable,
    deadline: asked.deadline,
    background: [
      ...(owner?.name ? [`for ${owner.name}.`] : []),
      ...(context ? [context] : []),
      ...about,
    ].join(" "),
  };
  return {
    message: `${input.message}\n\n${handoffRequestBlock(request)}`,
    handoff: true,
  };
}

const privacySchema = z.object({
  sharesPrivate: z.boolean(),
  what: z.string(),
});

/**
 * After the conversation read mail or a calendar, a message to anyone but
 * the owner may not carry it, unless the owner's own request asked to share
 * it. A small model reads the message against that request; it fails closed.
 */
export async function guardPrivateData(input: {
  turnIds: string[];
  ownerRequest: string;
  message: string;
}): Promise<void> {
  const read = await prisma.sokoBotToolCall.count({
    where: {
      turnId: { in: input.turnIds },
      capability: { in: PRIVATE_SOURCES },
      status: "COMPLETED",
    },
  });
  if (read === 0) return;
  const verdict = await askSmallModel({
    purpose: "soko-bot",
    system:
      "You check a message an assistant is about to send to someone other than its owner. Earlier in the conversation it read the owner's private mail or calendar. Say whether the message shares private content from them (who wrote, what an email says, subjects, attachments, meeting details or attendees) that the owner's own request does not clearly ask to share. Plain work facts the owner stated, Task names and general questions are not private content.",
    prompt: JSON.stringify({
      ownerRequest: input.ownerRequest.slice(0, 2_000),
      message: input.message.slice(0, 4_000),
    }),
    schema: privacySchema,
  }).catch(() => null);
  if (!verdict || verdict.output.sharesPrivate)
    throw new SokoBotRuntimeAuthorizationError(
      `This message would share the owner's private mail or calendar${verdict ? ` (${verdict.output.what})` : ""}. Leave that out, or ask the owner whether to share it.`,
    );
}

const statusSchema = z.object({ status: z.enum(REPLY_STATUSES) });

/** What came back from a hand-off: done, a question, a no, or still at it; with its links. */
export async function describeReply(
  reply: string,
): Promise<{ replyStatus: ReplyStatus | null; links: string[] }> {
  const classified = await askSmallModel({
    purpose: "soko-bot",
    system:
      'Classify the answer to a hand-off of work: "done" when it delivers the result, "needs_input" when it asks something before it can go on, "declined" when it says no or that someone else should do it, "working" when it accepts and will deliver later.',
    prompt: reply.slice(0, 6_000),
    schema: statusSchema,
  }).catch(() => null);
  return {
    replyStatus: classified?.output.status ?? null,
    links: replyLinks(reply),
  };
}
