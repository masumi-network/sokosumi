"use server";

import type { Notice, NoticeKind } from "@sokosumi/database";

import { type ActionError } from "@/lib/actions/errors";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";

export type PendingNotice = Notice;
export type NoticeAcknowledgment = Awaited<
  ReturnType<typeof coreClient.acknowledgeNotice>
>;

export async function getPendingNoticesAction(
  kind?: NoticeKind,
): Promise<PendingNotice[]> {
  try {
    return await coreClient.getPendingNotices(kind);
  } catch (_error) {
    return [];
  }
}

export async function acknowledgeNoticeAction(
  noticeId: string,
): Promise<
  { ok: true; data: NoticeAcknowledgment } | { ok: false; error: ActionError }
> {
  try {
    const data = await coreClient.acknowledgeNotice(noticeId);
    return {
      ok: true,
      data,
    };
  } catch (error) {
    return { ok: false, error: toCoreApiActionError(error) };
  }
}
