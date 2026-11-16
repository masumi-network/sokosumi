import { SOKO_BOT_TOOL_INPUT_SCHEMAS } from "@sokosumi/soko-bot";
import { getEnv } from "@/config/env";
import { serializableTransaction } from "@/lib/db/transaction";
import { publicDriveUrl } from "@/lib/drive-blob";
import { commitActionReceipt } from "@/lib/soko-bot/action-receipts";
import { persistedToolResult } from "@/lib/soko-bot/persisted-value";
import {
  type Announcement,
  listAnnouncements,
  saveAnnouncementDraft,
  setAnnouncementLive,
} from "@/services/announcements.service";
import {
  type AuthorizedSokoBotRuntime,
  type ExecuteSokoBotToolInput,
  SokoBotRefusedUnsentError,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

/** What the popup can show: a video loops muted, an image stands still. */
const COVER_EXTENSION = /\.(mp4|webm|mov|m4v|png|jpe?g|gif|webp)$/i;

/** Whether this bot may write the announcements every user sees. */
export function isAnnouncementBot(sokoBotId: string): boolean {
  return getEnv().SOKO_BOT_ANNOUNCEMENT_BOT_IDS.includes(sokoBotId);
}

export function requireAnnouncementBot(sokoBotId: string): void {
  if (!isAnnouncementBot(sokoBotId))
    throw new SokoBotRuntimeAuthorizationError(
      "Only Sokosumi's own announcement bot may write announcements",
    );
}

async function coverUrlOf(
  runtime: RuntimeOperations,
  authorized: AuthorizedSokoBotRuntime,
  coverFileId: string,
): Promise<string> {
  const { resource } = await runtime.ownerDriveFile(authorized, coverFileId);
  if (!COVER_EXTENSION.test(resource.sourceId))
    throw new SokoBotRefusedUnsentError(
      "The cover must be an mp4, webm, mov, m4v, png, jpg, gif or webp file",
    );
  const url = await publicDriveUrl(resource.sourceId);
  if (!url)
    throw new SokoBotRefusedUnsentError(
      "That file is private to a data room; save the cover elsewhere in Files",
    );
  return url;
}

function receiptOf(
  authorized: AuthorizedSokoBotRuntime,
  input: ExecuteSokoBotToolInput,
  announcement: Announcement,
) {
  return {
    turnId: authorized.turn.id,
    toolCallId: input.toolCallId,
    actorBotId: authorized.turn.sokoBotId,
    targetId: announcement.announcementId,
    observedVersion: announcement.updatedAt,
    result: persistedToolResult(announcement),
  };
}

export async function dispatchAnnouncementTools(
  runtime: RuntimeOperations,
  input: ExecuteSokoBotToolInput,
  authorized: AuthorizedSokoBotRuntime,
): Promise<unknown> {
  switch (input.capability) {
    case "list_announcements":
      return { announcements: await listAnnouncements() };

    case "save_announcement": {
      const { announcementId, coverFileId, action, ...draft } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.save_announcement.parse(input.input);
      const coverUrl = coverFileId
        ? await coverUrlOf(runtime, authorized, coverFileId)
        : undefined;
      return serializableTransaction(async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
        );
        const saved = await saveAnnouncementDraft(tx, announcementId, {
          ...draft,
          coverUrl,
          action: action ?? null,
        });
        if (saved === null)
          throw new SokoBotRefusedUnsentError(
            "No announcement with that id; use one from list_announcements",
          );
        if (saved === "live")
          throw new SokoBotRefusedUnsentError(
            "That announcement is live; ask the owner to end it with publish_announcement live: false before changing it",
          );
        await commitActionReceipt(tx, receiptOf(authorized, input, saved));
        return saved;
      }, "Announcement changed concurrently");
    }

    case "publish_announcement": {
      const { announcementId, live } =
        SOKO_BOT_TOOL_INPUT_SCHEMAS.publish_announcement.parse(input.input);
      // Every user sees it: only the owner's word counts, in their own chat or
      // a follow-up of a turn they started.
      const { isOwnerDirected } = await import("@/lib/soko-bot/turn-loop");
      if (!(await isOwnerDirected(authorized.turn.id)))
        throw new SokoBotRefusedUnsentError(
          "Announcements go live or end only when the owner says so in chat; show them the draft and ask",
        );
      return serializableTransaction(async (tx) => {
        await runtime.requireMutationAuthority(
          tx,
          authorized,
          false,
          input.capability,
        );
        const announcement = await setAnnouncementLive(
          tx,
          announcementId,
          live,
        );
        if (!announcement)
          throw new SokoBotRefusedUnsentError(
            "No announcement with that id; use one from list_announcements",
          );
        await commitActionReceipt(
          tx,
          receiptOf(authorized, input, announcement),
        );
        return announcement;
      }, "Announcement changed concurrently");
    }

    default:
      throw new Error(`Not an announcement tool: ${input.capability}`);
  }
}
