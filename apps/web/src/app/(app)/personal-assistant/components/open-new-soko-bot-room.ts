import { ensureSokoBotDirectRoomAction } from "@/app/chat/actions";
import { introduceSokoBotAction } from "@/lib/actions/soko-bot/action";

/**
 * A new personal bot's direct room, with the bot's hello already in it.
 * Null when the room could not be opened; the caller then stays put.
 */
export async function openNewSokoBotRoom(
  sokoBotId: string,
): Promise<string | null> {
  const room = await ensureSokoBotDirectRoomAction(sokoBotId);
  if (!room?.ok || !room.value) return null;
  await introduceSokoBotAction({ roomId: room.value.id });
  return room.value.id;
}
