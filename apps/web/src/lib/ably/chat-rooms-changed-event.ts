import { CHAT_ROOM_COLLECTIONS } from "@sokosumi/utils";
import * as z from "zod";

export const chatRoomsChangedEventSchema = z.object({
  collections: z.array(z.enum(CHAT_ROOM_COLLECTIONS)).min(1),
  roomId: z.string().min(1).nullable(),
  at: z.iso.datetime(),
});

/** Canonical control-channel payload for sidebar collection invalidation (SOK-986). */
export type ChatRoomsChangedEvent = z.infer<typeof chatRoomsChangedEventSchema>;
