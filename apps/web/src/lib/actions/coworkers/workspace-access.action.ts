"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const grantCoworkerEarlyAccessSchema = z.object({
  coworkerId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

interface GrantDeveloperCoworkerEarlyAccessParameters
  extends AuthenticatedRequest {
  coworkerId: string;
  workspaceId: string;
}

/**
 * Vendor admin dogfood / propose: Core decides GRANTED (member workspace)
 * vs PENDING (foreign). Platform admin also allowed via same path.
 */
export const grantDeveloperCoworkerEarlyAccessAction = withSession<
  GrantDeveloperCoworkerEarlyAccessParameters,
  Result<{ accessId: string; status: string }, ActionError>
>(async ({ coworkerId, workspaceId }) => {
  const parsed = grantCoworkerEarlyAccessSchema.safeParse({
    coworkerId,
    workspaceId,
  });
  if (!parsed.success) {
    return Err({ code: CommonErrorCode.BAD_INPUT });
  }

  try {
    const access = await coworkerAccessService.createForCoworker(
      parsed.data.coworkerId,
      parsed.data.workspaceId,
    );

    revalidatePath(`/developer/coworkers/${parsed.data.coworkerId}`);
    revalidatePath("/developer/coworkers");
    return Ok({ accessId: access.id, status: access.status });
  } catch (error) {
    console.error("Failed to grant developer coworker early access", error);
    return Err(toCoreApiActionError(error));
  }
});
