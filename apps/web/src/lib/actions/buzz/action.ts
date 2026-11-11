"use server";

import type { BuzzAppKeyInvites, BuzzConnection } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";

import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";
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

interface LinkBuzzAppParameters extends AuthenticatedRequest {
  publicKey: string;
}

/** Starts linking the caller's own Buzz app: invites to open in Buzz. */
export const linkBuzzApp = withSession<
  LinkBuzzAppParameters,
  ActionResultDto<BuzzAppKeyInvites, BuzzActionError>
>(async ({ publicKey }) => {
  const t = await getTranslations("App.Connections.Buzz");
  if (!z.string().trim().min(1).safeParse(publicKey).success) {
    return toActionResult(err({ message: t("linkInvalid") }));
  }
  try {
    const response = await coreClientNoRedirect.postBuzzAppKey(publicKey);
    revalidatePath("/connections");
    return toActionResult(ok(response.data));
  } catch (error) {
    // Core says why a key cannot be linked (not a key, someone else's).
    const message =
      error instanceof CoreApiRequestError && error.status === 400
        ? error.message
        : t("linkError");
    return toActionResult(err({ message }));
  }
});

/** Forgets the caller's own Buzz app key. */
export const unlinkBuzzApp = withSession<
  AuthenticatedRequest,
  ActionResultDto<{ unlinked: boolean }, BuzzActionError>
>(async () => {
  const t = await getTranslations("App.Connections.Buzz");
  try {
    const response = await coreClientNoRedirect.deleteBuzzAppKey();
    revalidatePath("/connections");
    return toActionResult(ok(response.data));
  } catch {
    return toActionResult(err({ message: t("unlinkError") }));
  }
});

interface PersonalAgentsParameters extends AuthenticatedRequest {
  organizationId: string;
  allowPersonalAgents: boolean;
}

/** Whether members may bring their personal agents (owners and admins). */
export const setBuzzPersonalAgents = withSession<
  PersonalAgentsParameters,
  ActionResultDto<{ allowPersonalAgents: boolean }, BuzzActionError>
>(async ({ organizationId, allowPersonalAgents }) => {
  const t = await getTranslations("App.Connections.Buzz");
  try {
    const response = await coreClientNoRedirect.patchBuzzOrganization(
      organizationId,
      allowPersonalAgents,
    );
    revalidatePath("/connections");
    return toActionResult(ok(response.data));
  } catch {
    return toActionResult(err({ message: t("personalAgentsError") }));
  }
});

/** The caller's Buzz connection, for the connect dialog and its sidebar card. */
export const readBuzzConnection = withSession<
  AuthenticatedRequest,
  ActionResultDto<BuzzConnection, BuzzActionError>
>(async () => {
  const t = await getTranslations("App.Connections.Buzz");
  try {
    const response = await coreClientNoRedirect.getBuzzConnection();
    return toActionResult(ok(response.data));
  } catch {
    return toActionResult(err({ message: t("readError") }));
  }
});
