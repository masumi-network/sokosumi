"use server";

import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";
import { revalidatePath } from "next/cache";

import { type ActionError, CommonErrorCode } from "@/lib/actions/errors";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";
import {
  type AdminCoworkerDisplayUpdateBody,
  adminCoworkerService,
} from "@/lib/services/admin-coworker.service";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const MIN_NAME_LENGTH = 3;

export interface UpdateAdminCoworkerInput {
  name: string;
  caption: string;
  description: string;
  image: string;
}

function mapCoreError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      message: error.message,
    };
  }

  return toCoreApiActionError(error);
}

function normalizeOptionalDisplayField(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeImageField(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return resolveIpfsOrHttpUrl(trimmed);
}

function toPatchBody(
  input: UpdateAdminCoworkerInput,
): AdminCoworkerDisplayUpdateBody {
  return {
    name: input.name.trim(),
    caption: normalizeOptionalDisplayField(input.caption),
    description: normalizeOptionalDisplayField(input.description),
    image: normalizeImageField(input.image),
  };
}

function revalidateAdminCoworkerRoutes(coworkerId?: string) {
  revalidatePath("/admin/coworkers");
  if (coworkerId) {
    revalidatePath(`/admin/coworkers/${coworkerId}`);
  }
}

interface UpdateAdminCoworkerParameters extends AuthenticatedRequest {
  id: string;
  input: UpdateAdminCoworkerInput;
}

export const updateAdminCoworkerAction = withSession<
  UpdateAdminCoworkerParameters,
  Result<Coworker, ActionError>
>(async ({ session, id, input }) => {
  try {
    assertAdminSession(session);

    const name = input.name.trim();
    if (name.length < MIN_NAME_LENGTH) {
      return Err({
        code: CommonErrorCode.BAD_INPUT,
        message: `Name must be at least ${MIN_NAME_LENGTH} characters`,
      });
    }

    const coworker = await adminCoworkerService.updateCoworkerDisplay(
      id,
      toPatchBody({ ...input, name }),
    );
    revalidateAdminCoworkerRoutes(id);
    return Ok(coworker);
  } catch (error) {
    return Err(mapCoreError(error));
  }
});
