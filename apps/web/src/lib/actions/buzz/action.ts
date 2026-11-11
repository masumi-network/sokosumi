"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { coreClientNoRedirect } from "@/lib/clients/core.client";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

type BuzzActionError = { message: string };

/** Shows the caller's Buzz secret key once, to import into a Buzz client. */
export const revealBuzzSecretKey = withSession<
  AuthenticatedRequest,
  ActionResultDto<{ nsec: string }, BuzzActionError>
>(async () => {
  const t = await getTranslations("App.Connections.Buzz");
  try {
    const response = await coreClientNoRedirect.postBuzzConnectionSecretKey();
    return toActionResult(ok({ nsec: response.data.nsec }));
  } catch {
    return toActionResult(err({ message: t("revealError") }));
  }
});

interface EnableBuzzParameters extends AuthenticatedRequest {
  organizationId: string;
}

/** Puts an organization's chats on Buzz (owners and admins). */
export const enableBuzzForOrganization = withSession<
  EnableBuzzParameters,
  ActionResultDto<{ relayUrl: string }, BuzzActionError>
>(async ({ organizationId }) => {
  const t = await getTranslations("App.Connections.Buzz");
  if (!z.string().min(1).safeParse(organizationId).success) {
    return toActionResult(err({ message: t("enableError") }));
  }
  try {
    const response =
      await coreClientNoRedirect.postBuzzOrganization(organizationId);
    revalidatePath("/connections");
    return toActionResult(ok({ relayUrl: response.data.relayUrl }));
  } catch {
    return toActionResult(err({ message: t("enableError") }));
  }
});
