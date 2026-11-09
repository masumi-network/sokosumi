import { z } from "@hono/zod-openapi";
import { type DataRoom, DataRoomStorage } from "@sokosumi/database";

import { driveFileScopeSchema } from "@/schemas/drive-file.schema";

/** The store a data-room request is about, as every Drive route takes it. */
const storeFields = {
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
};

export const dataRoomStoreQuerySchema = z.object(storeFields);

export const createDataRoomRequestSchema = z
  .object({
    ...storeFields,
    folderPath: z.string().min(1).max(1_000).openapi({
      description: 'Folder to turn into a data room, e.g. "Series A".',
      example: "Series A",
    }),
  })
  .openapi("CreateDataRoomRequest");

const STORAGE: Record<DataRoomStorage, "moving_in" | "private" | "moving_out"> =
  {
    [DataRoomStorage.MOVING_IN]: "moving_in",
    [DataRoomStorage.PRIVATE]: "private",
    [DataRoomStorage.MOVING_OUT]: "moving_out",
  };

export const dataRoomSchema = z
  .object({
    id: z.string(),
    folderPath: z.string(),
    storage: z.enum(["moving_in", "private", "moving_out"]).openapi({
      description:
        "moving_in while its files go to the private store, private once they all are, moving_out after it was closed.",
    }),
    createdAt: z.string(),
  })
  .openapi("DataRoom");

export const dataRoomsSchema = z.array(dataRoomSchema).openapi("DataRooms");

export function toDataRoomDto(room: DataRoom): z.infer<typeof dataRoomSchema> {
  return {
    id: room.id,
    folderPath: room.folderPath,
    storage: STORAGE[room.storage],
    createdAt: room.createdAt.toISOString(),
  };
}
