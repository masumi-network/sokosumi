"use server";

import { err, ok } from "neverthrow";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import type { Notice, NoticeKind } from "@/lib/clients/generated/core";

export async function getPendingNoticesAction(
  kind?: NoticeKind,
): Promise<ActionResultDto<Notice[], ActionError>> {
  try {
    const notices = await coreClient.getPendingNotices(kind);
    return toActionResult(ok(notices));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
}

export async function acknowledgeNoticeAction(
  noticeId: string,
): Promise<ActionResultDto<void, ActionError>> {
  try {
    await coreClient.acknowledgeNotice(noticeId);
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
}
