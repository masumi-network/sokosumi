import { z } from "@hono/zod-openapi";
import {
  type DataRoom,
  type DataRoomMember,
  DataRoomStorage,
} from "@sokosumi/database";

import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import type { DataRoomTreeRow } from "@/services/data-room-files.service";
import type { DataRoomMemberSummary } from "@/services/data-room-members.service";

/** The store a data-room request is about, as every Drive route takes it. */
const storeFields = {
  scope: driveFileScopeSchema,
  organizationId: z.string().optional(),
};

export const dataRoomStoreQuerySchema = z.object(storeFields);

/** Header a viewer's browser sends its session in. */
export const DATA_ROOM_SESSION_HEADER = "x-data-room-session";

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

const isoDate = z.union([z.string(), z.null()]);

export const dataRoomSchema = z
  .object({
    id: z.string(),
    folderPath: z.string(),
    storage: z.enum(["moving_in", "private", "moving_out"]).openapi({
      description:
        "moving_in while its files go to the private store, private once they all are, moving_out after it was closed.",
    }),
    token: z
      .string()
      .openapi({ description: "The room's address: /share/rooms/{token}" }),
    title: z.union([z.string(), z.null()]),
    logoFileId: z.union([z.string(), z.null()]),
    allowedDomains: z.array(z.string()),
    expiresAt: isoDate,
    allowDownload: z.boolean(),
    watermark: z.boolean(),
    notifyOnFirstVisit: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("DataRoom");

export const dataRoomsSchema = z.array(dataRoomSchema).openapi("DataRooms");

export function toDataRoomDto(room: DataRoom): z.infer<typeof dataRoomSchema> {
  return {
    id: room.id,
    folderPath: room.folderPath,
    storage: STORAGE[room.storage],
    token: room.token,
    title: room.title,
    logoFileId: room.logoFileId,
    allowedDomains: room.allowedDomains,
    expiresAt: room.expiresAt?.toISOString() ?? null,
    allowDownload: room.allowDownload,
    watermark: room.watermark,
    notifyOnFirstVisit: room.notifyOnFirstVisit,
    createdAt: room.createdAt.toISOString(),
  };
}

export const dataRoomMemberSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    name: z.union([z.string(), z.null()]),
    invited: z.boolean().openapi({
      description: "Invited by name; false when let in by an allowed domain.",
    }),
    expiresAt: isoDate,
    revokedAt: isoDate,
    folderPaths: z.array(z.string()).openapi({
      description: "Folders of the room this person may see; empty is all.",
    }),
    firstVisitAt: isoDate,
    lastVisitAt: isoDate,
    views: z.number().int(),
    downloads: z.number().int(),
  })
  .openapi("DataRoomMember");

export function toDataRoomMemberDto(
  summary:
    | DataRoomMemberSummary
    | { member: DataRoomMember; views?: number; downloads?: number },
): z.infer<typeof dataRoomMemberSchema> {
  const { member } = summary;
  return {
    id: member.id,
    email: member.email,
    name: member.name,
    invited: member.invitedByUserId !== null,
    expiresAt: member.expiresAt?.toISOString() ?? null,
    revokedAt: member.revokedAt?.toISOString() ?? null,
    folderPaths: member.folderPaths,
    firstVisitAt: member.firstVisitAt?.toISOString() ?? null,
    lastVisitAt: member.lastVisitAt?.toISOString() ?? null,
    views: summary.views ?? 0,
    downloads: summary.downloads ?? 0,
  };
}

export const dataRoomTreeRowSchema = z
  .object({
    kind: z.enum(["folder", "file"]),
    path: z.string(),
    name: z.string(),
    depth: z.number().int(),
    number: z.string().openapi({ example: "1.2" }),
    resourceId: z.union([z.string(), z.null()]),
    sizeBytes: z.union([z.number().int(), z.null()]),
    mimeType: z.union([z.string(), z.null()]),
    updatedAt: isoDate,
    isNew: z.boolean(),
  })
  .openapi("DataRoomTreeRow");

export function toDataRoomTreeRowDto(
  row: DataRoomTreeRow,
): z.infer<typeof dataRoomTreeRowSchema> {
  return {
    kind: row.kind,
    path: row.path,
    name: row.name,
    depth: row.depth,
    number: row.number,
    resourceId: row.file?.resourceId ?? null,
    sizeBytes: row.file?.sizeBytes ?? null,
    mimeType: row.file?.mimeType ?? null,
    updatedAt: row.file?.updatedAt.toISOString() ?? null,
    isNew: row.isNew,
  };
}

export const dataRoomDetailSchema = z
  .object({
    room: dataRoomSchema,
    members: z.array(dataRoomMemberSchema),
    rows: z.array(dataRoomTreeRowSchema),
  })
  .openapi("DataRoomDetail");

export const updateDataRoomRequestSchema = z
  .object({
    ...storeFields,
    title: z.union([z.string().max(200), z.null()]).optional(),
    logoFileId: z.union([z.string().uuid(), z.null()]).optional(),
    allowedDomains: z.array(z.string().max(253)).max(50).optional(),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    allowDownload: z.boolean().optional(),
    watermark: z.boolean().optional(),
    notifyOnFirstVisit: z.boolean().optional(),
  })
  .openapi("UpdateDataRoomRequest");

export const inviteDataRoomMembersRequestSchema = z
  .object({
    ...storeFields,
    emails: z.array(z.string().max(320)).min(1).max(100),
    name: z.union([z.string().max(200), z.null()]).optional(),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    folderPaths: z.array(z.string().max(1_000)).max(100).optional(),
  })
  .openapi("InviteDataRoomMembersRequest");

export const updateDataRoomMemberRequestSchema = z
  .object({
    ...storeFields,
    name: z.union([z.string().max(200), z.null()]).optional(),
    expiresAt: z.union([z.string().datetime(), z.null()]).optional(),
    folderPaths: z.array(z.string().max(1_000)).max(100).optional(),
  })
  .openapi("UpdateDataRoomMemberRequest");

export const dataRoomEventSchema = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    kind: z.enum(["enter", "view", "download", "download_all", "ask"]),
    path: z.union([z.string(), z.null()]),
    memberId: z.union([z.string(), z.null()]),
    email: z.union([z.string(), z.null()]),
    name: z.union([z.string(), z.null()]),
  })
  .openapi("DataRoomEvent");

export const dataRoomEventsSchema = z
  .object({
    events: z.array(dataRoomEventSchema),
    nextBefore: z.union([z.string(), z.null()]),
  })
  .openapi("DataRoomEvents");

export const dataRoomQuestionSchema = z
  .object({
    id: z.string(),
    createdAt: z.string(),
    path: z.string(),
    body: z.string(),
    answer: z.union([z.string(), z.null()]),
    answeredAt: isoDate,
    email: z.string(),
    name: z.union([z.string(), z.null()]),
  })
  .openapi("DataRoomQuestion");

export const dataRoomQuestionsSchema = z
  .array(dataRoomQuestionSchema)
  .openapi("DataRoomQuestions");

export function toDataRoomQuestionDto(question: {
  id: string;
  createdAt: Date;
  path: string;
  body: string;
  answer: string | null;
  answeredAt: Date | null;
  member: { email: string; name: string | null };
}): z.infer<typeof dataRoomQuestionSchema> {
  return {
    id: question.id,
    createdAt: question.createdAt.toISOString(),
    path: question.path,
    body: question.body,
    answer: question.answer,
    answeredAt: question.answeredAt?.toISOString() ?? null,
    email: question.member.email,
    name: question.member.name,
  };
}

export const answerDataRoomQuestionRequestSchema = z
  .object({ ...storeFields, answer: z.string().min(1).max(5_000) })
  .openapi("AnswerDataRoomQuestionRequest");

export const setDataRoomOrderRequestSchema = z
  .object({
    ...storeFields,
    entries: z
      .array(
        z.object({
          path: z.string().min(1).max(1_000),
          position: z.number().int().min(1),
        }),
      )
      .max(5_000),
  })
  .openapi("SetDataRoomOrderRequest");

/** What a viewer's browser sees of a room. */
export const dataRoomViewSchema = z
  .object({
    state: z.enum(["in", "out", "closed", "expired"]),
    title: z.string(),
    hasLogo: z.boolean(),
    allowDownload: z.boolean(),
    watermark: z.boolean(),
    viewer: z.union([
      z.object({ email: z.string(), name: z.union([z.string(), z.null()]) }),
      z.null(),
    ]),
    rows: z.array(dataRoomTreeRowSchema),
  })
  .openapi("DataRoomView");

export const dataRoomCodeRequestSchema = z
  .object({ email: z.string().min(3).max(320) })
  .openapi("DataRoomCodeRequest");

export const dataRoomSessionRequestSchema = z
  .object({
    email: z.string().min(3).max(320),
    code: z.string().min(4).max(12),
  })
  .openapi("DataRoomSessionRequest");

export const dataRoomSessionSchema = z
  .object({ session: z.string() })
  .openapi("DataRoomSession");

export const askDataRoomQuestionRequestSchema = z
  .object({
    resourceId: z.string().uuid(),
    body: z.string().min(1).max(5_000),
  })
  .openapi("AskDataRoomQuestionRequest");
