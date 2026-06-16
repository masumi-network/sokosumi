"use server";

import { NoticeKind } from "@sokosumi/utils";
import type { ActionError } from "@/lib/actions/errors";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import type { Notice } from "@/lib/types/core-dto";

export type PendingNotice = Notice;
export type NoticeAcknowledgment = Awaited<
  ReturnType<typeof coreClient.acknowledgeNotice>
>;

export async function getPendingNoticesAction(
  kind?: NoticeKind,
): Promise<
  { ok: true; data: PendingNotice[] } | { ok: false; error: ActionError }
> {
  try {
    const notices = await coreClient.getPendingNotices(kind);
    return { ok: true, data: notices };
  } catch (error) {
    return { ok: false, error: toCoreApiActionError(error) };
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
