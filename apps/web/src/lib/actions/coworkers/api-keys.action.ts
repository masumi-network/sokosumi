"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { developerCoworkerService } from "@/lib/services/developer-coworker.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const createCoworkerApiKeySchema = z.object({
  coworkerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
});

interface CreateDeveloperCoworkerApiKeyParameters extends AuthenticatedRequest {
  coworkerId: string;
  name: string;
}

/**
 * Mints a coworker runtime key. Core checks the caller manages the coworker
 * (vendor admin or assigned developer). The token is returned once.
 */
export const createDeveloperCoworkerApiKeyAction = withSession<
  CreateDeveloperCoworkerApiKeyParameters,
  ActionResultDto<{ key: string }, ActionError>
>(async ({ coworkerId, name }) => {
  const parsed = createCoworkerApiKeySchema.safeParse({ coworkerId, name });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const created = await developerCoworkerService.createApiKey(
      parsed.data.coworkerId,
      parsed.data.name,
    );

    revalidatePath(`/developer/coworkers/${parsed.data.coworkerId}`);
    return toActionResult(ok({ key: created.token }));
  } catch (error) {
    // Core turns a 401 into a sign-in redirect; let it through.
    unstable_rethrow(error);
    console.error("Failed to create developer coworker API key", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});

const revokeCoworkerApiKeySchema = z.object({
  coworkerId: z.string().uuid(),
  keyId: z.string().uuid(),
});

interface RevokeDeveloperCoworkerApiKeyParameters extends AuthenticatedRequest {
  coworkerId: string;
  keyId: string;
}

/** Revokes a coworker runtime key at once; agents using it get 401. */
export const revokeDeveloperCoworkerApiKeyAction = withSession<
  RevokeDeveloperCoworkerApiKeyParameters,
  ActionResultDto<{ keyId: string }, ActionError>
>(async ({ coworkerId, keyId }) => {
  const parsed = revokeCoworkerApiKeySchema.safeParse({ coworkerId, keyId });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  try {
    const revoked = await developerCoworkerService.revokeApiKey(
      parsed.data.coworkerId,
      parsed.data.keyId,
    );

    revalidatePath(`/developer/coworkers/${parsed.data.coworkerId}`);
    return toActionResult(ok({ keyId: revoked.id }));
  } catch (error) {
    // Core turns a 401 into a sign-in redirect; let it through.
    unstable_rethrow(error);
    console.error("Failed to revoke developer coworker API key", error);
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
