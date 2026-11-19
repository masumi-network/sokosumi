import {
  type SokoBotCalendarEvent,
  sokoBotListCalendarEventsInputSchema,
} from "@sokosumi/soko-bot";
import { contactDetailHref } from "@sokosumi/utils";
import { sokoBotWorkspaceAccessWhere } from "@/helpers/soko-bot-workspace-access";
import { parseAddress } from "@/lib/contacts/capture-provider";
import prisma from "@/lib/db/prisma";
import { uniqueGuests } from "@/lib/soko-bot/integration-addresses";
import { readSokoBotSource } from "@/lib/soko-bot/source-query";
import {
  inviteNamesPerson,
  meetingContactMailboxes,
} from "@/services/contacts-context.service";
import {
  activeIntegrationsForBot,
  fetchCalendarEvents,
} from "@/services/soko-bot-integrations.service";
import {
  type AuthorizedSokoBotRuntime,
  SokoBotRuntimeValidationError,
} from "../soko-bot-runtime.service";

interface CalendarReader {
  grant: Pick<AuthorizedSokoBotRuntime["grant"], "capabilities">;
  turn: Pick<
    AuthorizedSokoBotRuntime["turn"],
    | "id"
    | "sokoBotId"
    | "workspaceId"
    | "actingUserId"
    | "source"
    | "chainDepth"
  >;
}

async function withContactReferences(
  authorized: CalendarReader,
  events: SokoBotCalendarEvent[],
) {
  const { turn, grant } = authorized;
  const { id, workspaceId, sokoBotId, actingUserId } = turn;
  if (
    !actingUserId ||
    turn.source !== "CHAT" ||
    turn.chainDepth !== 0 ||
    !grant.capabilities.includes("search_contacts")
  )
    return events;
  const people = events.map((event) =>
    uniqueGuests(
      [
        ...event.attendees,
        ...(event.organizer ? [event.organizer] : []),
      ].flatMap((value) => parseAddress(value, "invitation") ?? []),
    ),
  );
  const emails = people.flat().map(({ email }) => email);
  if (!emails.length) return events;

  // The chat grant can include Contacts even when a workspace outsider can read the room.
  // Only add references on the assistant page, in the member's private Direct, or in an internal workspace Channel.
  const privateDirect = {
    kind: "direct",
    userMembers: {
      some: { userId: actingUserId },
      every: { userId: actingUserId },
    },
    coworkerMembers: { none: {} },
    sokoBotMembers: {
      some: { sokoBotId },
      every: { sokoBotId },
    },
  };
  const allowed = await prisma.sokoBotTurn.findFirst({
    where: {
      id,
      parentTurnId: null,
      workspace: sokoBotWorkspaceAccessWhere(actingUserId, workspaceId),
      OR: [
        {
          chatMentionId: null,
          chatResponseMessageId: null,
          sokoBot: { userId: actingUserId },
        },
        {
          chatMention: {
            message: {
              room: {
                archivedAt: null,
                OR: [
                  privateDirect,
                  {
                    kind: "channel",
                    organization: { workspace: { id: workspaceId } },
                    discoverability: { in: ["public", "private"] },
                  },
                ],
              },
            },
          },
        },
      ],
    },
    select: {
      destinationRoomId: true,
      chatMention: { select: { message: { select: { roomId: true } } } },
    },
  });
  if (!allowed) return events;
  if (allowed.chatMention) {
    if (allowed.chatMention.message.roomId !== allowed.destinationRoomId)
      return events;
  } else if (allowed.destinationRoomId) {
    // A private assistant-page turn can reuse its owner's existing delivery Direct.
    const room = await prisma.chatRoom.findFirst({
      where: {
        ...privateDirect,
        id: allowed.destinationRoomId,
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!room) return events;
  }
  const channels = await meetingContactMailboxes(workspaceId, emails);
  const contacts = new Map(
    channels.map(({ value, contact }) => [value, contact]),
  );
  return events.map((event, index) => {
    const contactReferences = people[index]!.flatMap(({ email, name }) => {
      const contact = contacts.get(email);
      if (!contact) return [];
      return [
        {
          email,
          link: contactDetailHref(contact.id, workspaceId),
          ...(inviteNamesPerson(name, contact) ? { name } : {}),
        },
      ];
    });
    return contactReferences.length ? { ...event, contactReferences } : event;
  });
}

export async function listCalendarEvents(
  authorized: CalendarReader,
  input: unknown,
) {
  const parsed = sokoBotListCalendarEventsInputSchema.parse(input);
  const from = parsed.from ? new Date(parsed.from) : new Date();
  const to = parsed.to
    ? new Date(parsed.to)
    : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1_000);
  const integrations = await activeIntegrationsForBot(
    authorized.turn.sokoBotId,
    "calendar",
    parsed.provider,
  );
  if (to <= from)
    throw new SokoBotRuntimeValidationError(
      "Calendar window must end after it starts",
    );
  const limit = parsed.limit ?? 50;
  const result = await readSokoBotSource({
    source: "CALENDAR",
    filters: { from: from.toISOString(), to: to.toISOString() },
    queries: integrations.map(
      (integration) => () =>
        fetchCalendarEvents(integration, { from, to, limit }),
    ),
  });
  const returned = result.rows
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, limit);
  // An unavailable Contacts directory does not make a successful calendar read fail.
  const [tzRow, events] = await Promise.all([
    prisma.sokoBot.findUnique({
      where: { id: authorized.turn.sokoBotId },
      select: { ingestTimezone: true },
    }),
    withContactReferences(authorized, returned).catch(() => returned),
  ]);
  const timeZone = tzRow?.ingestTimezone ?? "UTC";
  const local = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone,
          weekday: "short",
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(iso))
      : null;
  return {
    timeZone,
    coverage: {
      ...result.coverage,
      includedCount: Math.min(result.rows.length, limit),
      omittedCount: Math.max(0, result.rows.length - limit),
    },
    failedSources: result.failedSources,
    note: result.note,
    events: events.map((event) => ({
      ...event,
      startsAtLocal: local(event.startsAt),
      endsAtLocal: local(event.endsAt),
    })),
  };
}
