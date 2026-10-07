"use server";

import { err, ok } from "neverthrow";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";

/**
 * The reader opened a feature its New badge pointed at. No revalidation: the
 * sidebar already hid the pill, and the next full load asks Core afresh.
 */
export async function markBadgeCampaignSeenAction(
  campaignId: string,
): Promise<ActionResultDto<void, ActionError>> {
  try {
    await coreClient.markBadgeCampaignSeen(campaignId);
    return toActionResult(ok(undefined));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
}
