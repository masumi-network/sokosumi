/**
 * Whether the team's latest outreach to a contact was answered, from the
 * directions of the logged interactions. Two derived fields carry it
 * (`lastInboundAt`: their latest message or a meeting; `awaitingReplySince`:
 * the first outreach since then), kept by Core like first and last contact.
 * The state itself depends on the clock, so it is worked out on read and in
 * filters from those two.
 */
import type { Prisma } from "@sokosumi/database";
import {
  CONTACT_CONVERSATION_DAYS,
  type CONTACT_REPLY_STATES,
  CONTACT_REPLY_WAIT_DAYS,
} from "@sokosumi/utils";

export type ContactReplyState = (typeof CONTACT_REPLY_STATES)[number];

const DAY_MS = 86_400_000;

export interface ReplyFields {
  /** Latest interaction from them: an inbound message or a meeting. */
  lastInboundAt: Date | null;
  /** First outreach since then; null when they had the last word. */
  awaitingReplySince: Date | null;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** The reply state at `now`; null when there is no directed interaction. */
export function contactReplyState(
  fields: ReplyFields,
  now: Date = new Date(),
): ContactReplyState | null {
  if (fields.awaitingReplySince)
    return fields.awaitingReplySince <= daysBefore(now, CONTACT_REPLY_WAIT_DAYS)
      ? "NO_REPLY"
      : "AWAITING_REPLY";
  if (fields.lastInboundAt)
    return fields.lastInboundAt >= daysBefore(now, CONTACT_CONVERSATION_DAYS)
      ? "IN_CONVERSATION"
      : "REPLIED";
  return null;
}

/** The contacts in `state` at `now`, as a query; mirrors `contactReplyState`. */
export function replyStateWhere(
  state: ContactReplyState,
  now: Date = new Date(),
): Prisma.ContactWhereInput {
  const waitedOut = daysBefore(now, CONTACT_REPLY_WAIT_DAYS);
  const conversation = daysBefore(now, CONTACT_CONVERSATION_DAYS);
  switch (state) {
    case "NO_REPLY":
      return { awaitingReplySince: { lte: waitedOut } };
    case "AWAITING_REPLY":
      return { awaitingReplySince: { gt: waitedOut } };
    case "IN_CONVERSATION":
      return {
        awaitingReplySince: null,
        lastInboundAt: { gte: conversation },
      };
    case "REPLIED":
      return {
        awaitingReplySince: null,
        lastInboundAt: { lt: conversation },
      };
  }
}
