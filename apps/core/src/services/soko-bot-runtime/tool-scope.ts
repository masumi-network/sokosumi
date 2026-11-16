import { SOKO_BOT_NEWSLETTER_CAPABILITIES } from "@sokosumi/soko-bot";
import { buildSokoBotReaderTaskWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import { requireProjectAccess } from "@/lib/image-studio/access";
import { ownerConfirmedConsent } from "@/lib/soko-bot/mail-send-guard";
import {
  isNewsletterSubscriberCapability,
  newsletterConsentClaim,
} from "@/lib/soko-bot/newsletter-tools";
import { sokoBotProjectRefusal } from "@/lib/soko-bot/write-scope";
import { getNewsletter } from "@/services/newsletter.service";
import { isNewsletterDraftAvailable } from "@/services/newsletter-draft.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";
import { actingMemberOf } from "./acting-scope";
import { type RuntimeOperations } from "./operations";
import { TASK_ID_FIELDS, TASK_ID_PREFIX } from "./task-policy";

/**
 * Cheaper models garble the tail of a long id they copy: Joseph read the
 * right Task, then sent four reply_to_task calls with `…7facc56a2e6a` for
 * `…7facc56b861e`. A uuid v7's first 23 characters are its millisecond and
 * random bits, so one visible Task matching them is the Task meant.
 */
export async function resolveTaskIds(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  value: unknown,
): Promise<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = { ...(value as Record<string, unknown>) };
  const visible = {
    workspaceId: authorized.turn.workspaceId,
    ...buildSokoBotReaderTaskWhere(authorized.reader),
  };
  for (const field of TASK_ID_FIELDS) {
    const id = input[field];
    if (typeof id !== "string" || id.length < TASK_ID_PREFIX) continue;
    const exact = await prisma.task.findFirst({
      where: { ...visible, id },
      select: { id: true },
    });
    if (exact) continue;
    const matches = await prisma.task.findMany({
      where: { ...visible, id: { startsWith: id.slice(0, TASK_ID_PREFIX) } },
      select: { id: true },
      take: 2,
    });
    if (matches.length === 1 && matches[0]) input[field] = matches[0].id;
  }
  return input;
}

/**
 * The checks every newsletter tool shares with the Newsletter UI: the bot's
 * own Project, the acting member's access to it, the beta gate, and an
 * existing newsletter. Subscriber emails are personal data, so only the
 * owner of a personal bot may have them read.
 */
export async function requireNewsletterScope(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  capability: (typeof SOKO_BOT_NEWSLETTER_CAPABILITIES)[number],
  projectId: string,
) {
  const refusal = sokoBotProjectRefusal(authorized.reader.sharedScope, [
    projectId,
  ]);
  if (refusal) throw new SokoBotRuntimeAuthorizationError(refusal);
  if (
    isNewsletterSubscriberCapability(capability) &&
    (authorized.reader.sharedScope || authorized.askedByKind !== "OWNER")
  ) {
    throw new SokoBotRuntimeAuthorizationError(
      "Newsletter subscribers are personal data, handled only on your owner's request. Point them to the Newsletter's Subscribers page instead.",
    );
  }
  const scope = await requireProjectAccess({
    projectId,
    workspaceId: authorized.turn.workspaceId,
    userId: actingMemberOf(authorized),
  });
  if (
    !(await isNewsletterDraftAvailable({
      projectId,
      workspaceId: scope.workspaceId,
    }))
  ) {
    throw new SokoBotRuntimeAuthorizationError("Newsletter is not enabled");
  }
  await getNewsletter({ projectId, workspaceId: scope.workspaceId });
  return scope;
}

/**
 * Subscriber changes reach other people's inboxes, so they run only on the
 * owner's word in their own chat: never in a turn Core started, another
 * assistant asked for, or a page steered. "They already agreed" skips the
 * confirmation email, so the owner must say that themselves, this turn.
 */
export async function requireOwnerSubscriberWord(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  capability: Parameters<typeof newsletterConsentClaim>[0],
  rawInput: unknown,
) {
  const { isOwnerDirected } = await import("@/lib/soko-bot/turn-loop");
  if (!(await isOwnerDirected(authorized.turn.id)))
    throw new SokoBotRuntimeValidationError(
      "Newsletter subscribers change only when the owner asks in their chat; ask them, or point them to the Newsletter's Subscribers page",
    );
  const people = newsletterConsentClaim(capability, rawInput);
  if (!people) return;
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { userMessage: true, parentTurnId: true },
  });
  // A background run's message is a brief the bot wrote, not the owner's.
  if (
    !turn ||
    turn.parentTurnId !== null ||
    !(await ownerConfirmedConsent(turn.userMessage, people))
  )
    throw new SokoBotRuntimeValidationError(
      "Only the owner can say people already agreed, in their own chat message this turn. Use consent ASK so they confirm by email, or ask the owner whether they agreed.",
    );
}
