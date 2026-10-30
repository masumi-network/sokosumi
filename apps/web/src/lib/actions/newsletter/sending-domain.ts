"use server";

import type {
  NewsletterSendingDomain,
  NewsletterSendingDomainConnect,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { newsletterService } from "@/lib/services/newsletter.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface SendingDomainError {
  message: string;
}

type SendingDomainAction =
  | "save"
  | "check"
  | "remove"
  | "cloudflare"
  | "resume";

async function errorMessage(
  error: unknown,
  action: SendingDomainAction,
): Promise<string> {
  const t = await getTranslations("App.Projects.Newsletter.SendingDomain");
  if (!(error instanceof CoreApiRequestError)) return t("errors.generic");
  switch (error.status) {
    case 403:
      return t("errors.forbidden");
    case 404:
      return t("errors.notFound");
    case 409:
      return action === "resume"
        ? t("errors.resumeUnavailable")
        : t("errors.conflict");
    case 422:
      return action === "cloudflare"
        ? t("errors.cloudflareRejected")
        : t("errors.domainRejected");
    case 502:
      return action === "cloudflare"
        ? t("errors.cloudflareFailed")
        : t("errors.providerFailed");
    default:
      return t("errors.generic");
  }
}

function revalidate() {
  revalidatePath("/newsletter/settings");
}

interface ProjectSendingDomainParameters extends AuthenticatedRequest {
  projectId: string;
}

interface SaveSendingDomainParameters extends ProjectSendingDomainParameters {
  fromAddress: string;
}

export const saveNewsletterSendingDomain = withSession<
  SaveSendingDomainParameters,
  ActionResultDto<NewsletterSendingDomain, SendingDomainError>
>(async ({ projectId, fromAddress }) => {
  const parsed = z
    .email()
    .max(254)
    .safeParse(String(fromAddress ?? "").trim());
  if (!parsed.success) {
    const t = await getTranslations("App.Projects.Newsletter.SendingDomain");
    return toActionResult(err({ message: t("errors.invalidAddress") }));
  }
  try {
    const domain = await newsletterService.saveSendingDomain(
      projectId,
      parsed.data,
    );
    revalidate();
    return toActionResult(ok(domain));
  } catch (error) {
    return toActionResult(err({ message: await errorMessage(error, "save") }));
  }
});

export const checkNewsletterSendingDomain = withSession<
  ProjectSendingDomainParameters,
  ActionResultDto<NewsletterSendingDomain, SendingDomainError>
>(async ({ projectId }) => {
  try {
    const domain = await newsletterService.checkSendingDomain(projectId);
    revalidate();
    return toActionResult(ok(domain));
  } catch (error) {
    return toActionResult(err({ message: await errorMessage(error, "check") }));
  }
});

export const resumeNewsletterSendingDomainWarmup = withSession<
  ProjectSendingDomainParameters,
  ActionResultDto<NewsletterSendingDomain, SendingDomainError>
>(async ({ projectId }) => {
  try {
    const domain = await newsletterService.resumeSendingDomainWarmup(projectId);
    revalidate();
    return toActionResult(ok(domain));
  } catch (error) {
    return toActionResult(
      err({ message: await errorMessage(error, "resume") }),
    );
  }
});

export const removeNewsletterSendingDomain = withSession<
  ProjectSendingDomainParameters,
  ActionResultDto<null, SendingDomainError>
>(async ({ projectId }) => {
  try {
    await newsletterService.removeSendingDomain(projectId);
    revalidate();
    return toActionResult(ok(null));
  } catch (error) {
    return toActionResult(
      err({ message: await errorMessage(error, "remove") }),
    );
  }
});

interface ConnectCloudflareParameters extends ProjectSendingDomainParameters {
  apiToken: string;
}

/** The token goes to Core once and is never stored or logged here. */
export const connectNewsletterSendingDomainWithCloudflare = withSession<
  ConnectCloudflareParameters,
  ActionResultDto<NewsletterSendingDomain, SendingDomainError>
>(async ({ projectId, apiToken }) => {
  const token = String(apiToken ?? "").trim();
  if (token.length < 20 || token.length > 256) {
    const t = await getTranslations("App.Projects.Newsletter.SendingDomain");
    return toActionResult(err({ message: t("errors.cloudflareRejected") }));
  }
  try {
    const domain = await newsletterService.connectSendingDomainWithCloudflare(
      projectId,
      token,
    );
    revalidate();
    return toActionResult(ok(domain));
  } catch (error) {
    return toActionResult(
      err({ message: await errorMessage(error, "cloudflare") }),
    );
  }
});

export const getNewsletterSendingDomainConnect = withSession<
  ProjectSendingDomainParameters,
  ActionResultDto<NewsletterSendingDomainConnect, SendingDomainError>
>(async ({ projectId }) => {
  try {
    return toActionResult(
      ok(await newsletterService.getSendingDomainConnect(projectId)),
    );
  } catch (error) {
    return toActionResult(err({ message: await errorMessage(error, "check") }));
  }
});
