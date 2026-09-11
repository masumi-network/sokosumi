import { buildDirectRoomName } from "@sokosumi/utils";
import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";

/** One member of a direct room, as the naming rule reads them. */
interface Participant {
  id: string;
  name: string;
}

function byDisplayNameThenId(a: Participant, b: Participant): number {
  const byName = a.name.localeCompare(b.name);

  return byName !== 0 ? byName : a.id.localeCompare(b.id);
}

/**
 * The name each reader's own screen gives this direct room.
 *
 * A direct room's stored `name` is a snapshot taken when it was created, and it
 * lists everyone the creator added rather than everyone in the room. It leaves
 * the creator out, keeps whoever has since left in, and keeps whatever names
 * people had that day. The sidebar never shows it: `getRoomDisplayName` in web
 * builds the list again per viewer, dropping the viewer instead of the creator.
 *
 * A notification carried the stored name, so a group direct room told every
 * reader but the creator the wrong thing: "Ada mentioned you in Ben, Cara"
 * names the reader and omits the person who wrote. The name has to travel on
 * the notification rather than be resolved where it is shown, because the push
 * service worker can query nothing (ADR-0023), so it is built here, once per
 * reader, from the roster as it stands now.
 *
 * The three reads run one after another, the same way `loadChatMentionNames`
 * does, so this stays safe to call on a transaction client.
 */
export async function loadDirectRoomNamesByReader(params: {
  roomId: string;
  readerUserIds: readonly string[];
}): Promise<ReadonlyMap<string, string>> {
  const humanMembers = await prisma.chatRoomUserMember.findMany({
    where: { roomId: params.roomId },
    select: { user: { select: { id: true, name: true, email: true } } },
  });
  const coworkerMembers = await prisma.chatRoomCoworkerMember.findMany({
    where: { roomId: params.roomId },
    select: { coworker: { select: { id: true, name: true } } },
  });
  const sokoBotMembers = await prisma.chatRoomSokoBotMember.findMany({
    where: { roomId: params.roomId },
    select: {
      sokoBot: {
        select: { id: true, name: true, user: { select: { name: true } } },
      },
    },
  });

  const humans: Participant[] = humanMembers.map(({ user }) => ({
    id: user.id,
    name: user.name || user.email,
  }));
  // Humans, then coworkers, then Soko Bots, each group sorted on its own by the
  // name it is shown under. That is the order the sidebar already lists them in.
  const coworkers: Participant[] = coworkerMembers.map(({ coworker }) => ({
    id: coworker.id,
    name: coworker.name,
  }));
  const sokoBots: Participant[] = sokoBotMembers.map(({ sokoBot }) => ({
    id: sokoBot.id,
    name: sokoBotDisplayName(sokoBot),
  }));
  humans.sort(byDisplayNameThenId);
  coworkers.sort(byDisplayNameThenId);
  sokoBots.sort(byDisplayNameThenId);

  return new Map(
    params.readerUserIds.map((readerUserId) => [
      readerUserId,
      buildDirectRoomName([
        ...humans
          .filter((human) => human.id !== readerUserId)
          .map((human) => human.name),
        ...coworkers.map((coworker) => coworker.name),
        ...sokoBots.map((sokoBot) => sokoBot.name),
      ]),
    ]),
  );
}
