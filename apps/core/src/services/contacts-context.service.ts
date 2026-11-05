/**
 * One compact line per known person for the packets a Soko Bot reads before
 * meetings and in its daily brief: who they are, who on the team knows them,
 * the last touchpoint and their lists. Unknown addresses get nothing.
 */
import { contactReplyState } from "@/lib/contacts/reply-state";
import prisma from "@/lib/db/prisma";

const MAX_KNOWN_BY = 3;

function shortDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

const CHANNEL_WORD: Record<string, string> = {
  EMAIL: "email",
  MEETING: "meeting",
  SLACK: "Slack",
  CALL: "call",
  MANUAL: "note",
  OTHER: "touchpoint",
};

/** Contact line per lowercased email, for the emails that are contacts. */
export async function contactLinesByEmail(input: {
  workspaceId: string;
  emails: readonly string[];
  timeZone: string;
}): Promise<Map<string, string>> {
  const emails = [...new Set(input.emails.map((email) => email.toLowerCase()))];
  const lines = new Map<string, string>();
  if (emails.length === 0) return lines;
  const channels = await prisma.contactChannel.findMany({
    where: {
      workspaceId: input.workspaceId,
      type: "EMAIL",
      value: { in: emails },
      contact: { mergedIntoId: null, archivedAt: null },
    },
    select: {
      value: true,
      contact: {
        select: {
          id: true,
          name: true,
          organization: true,
          role: true,
          stage: true,
          kind: true,
          summary: true,
          lastInboundAt: true,
          awaitingReplySince: true,
          listMemberships: {
            select: { list: { select: { name: true } } },
            take: 4,
          },
          interactions: {
            orderBy: { occurredAt: "desc" },
            take: 1,
            select: {
              occurredAt: true,
              channel: true,
              summary: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (channels.length === 0) return lines;
  const contactIds = [...new Set(channels.map((row) => row.contact.id))];
  const knownBy = await prisma.contactInteraction.groupBy({
    by: ["contactId", "userId"],
    where: { contactId: { in: contactIds }, userId: { not: null } },
    _count: { _all: true },
  });
  const userIds = [
    ...new Set(
      knownBy.flatMap((group) => (group.userId ? [group.userId] : [])),
    ),
  ];
  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true },
      })
    ).map((user) => [user.id, user.name]),
  );
  for (const { value, contact } of channels) {
    const parts = [contact.name];
    const job = [contact.role, contact.organization]
      .filter(Boolean)
      .join(" @ ");
    if (job) parts[0] = `${contact.name} — ${job}`;
    parts.push(contact.stage.toLowerCase());
    if (contact.kind === "ORGANIZATION")
      parts.push("an organization or shared inbox, not one person");
    const reply = contactReplyState(contact);
    if (contact.awaitingReplySince && reply)
      parts.push(
        `${reply === "NO_REPLY" ? "no reply" : "awaiting their reply"} since ${shortDate(contact.awaitingReplySince, input.timeZone)}`,
      );
    const lists = contact.listMemberships.map(
      (membership) => membership.list.name,
    );
    if (lists.length) parts.push(`lists: ${lists.join(", ")}`);
    const team = knownBy
      .filter((group) => group.contactId === contact.id && group.userId)
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, MAX_KNOWN_BY)
      .map(
        (group) =>
          `${names.get(group.userId ?? "") ?? "a teammate"} (${group._count._all})`,
      );
    if (team.length) parts.push(`known by ${team.join(", ")}`);
    const last = contact.interactions[0];
    if (last)
      parts.push(
        `last: ${shortDate(last.occurredAt, input.timeZone)}, ${last.user?.name ?? "a teammate"}, ${CHANNEL_WORD[last.channel] ?? "touchpoint"} "${last.summary.slice(0, 80)}"`,
      );
    if (contact.summary)
      parts.push(contact.summary.replace(/\s+/g, " ").slice(0, 160));
    lines.set(value, `${parts.join(" · ")} (contact ${contact.id})`);
  }
  return lines;
}

/** Addresses in "Name <a@b.com>" or bare form. */
export function emailsIn(values: readonly string[]): string[] {
  return values.flatMap((value) => {
    const match = /[\w.+'-]+@[\w-]+(\.[\w-]+)+/.exec(value);
    return match ? [match[0].toLowerCase()] : [];
  });
}

/**
 * "## People on your calendar" for the stand-up and the morning briefing:
 * the attendees who are contacts, at most `limit`. Empty when none are.
 */
export async function calendarPeopleBlock(input: {
  workspaceId: string;
  attendees: readonly string[];
  timeZone: string;
  limit?: number;
}): Promise<string[]> {
  const emails = emailsIn(input.attendees);
  const lines = await contactLinesByEmail({
    workspaceId: input.workspaceId,
    emails,
    timeZone: input.timeZone,
  });
  if (lines.size === 0) return [];
  const ordered = [
    ...new Set(
      emails.flatMap((email) => {
        const line = lines.get(email);
        return line ? [`- ${line}`] : [];
      }),
    ),
  ];
  return [
    "## People on your calendar (from Contacts)",
    ...ordered.slice(0, input.limit ?? 8),
    "",
  ];
}
