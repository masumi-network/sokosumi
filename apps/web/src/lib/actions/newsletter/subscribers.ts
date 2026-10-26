"use server";

import {
  type NewsletterImportResult,
  type NewsletterSubscriber,
  NewsletterSubscriberStatus,
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
import {
  NEWSLETTER_CSV_MAX_BYTES,
  type NewsletterSubscriberError,
  newsletterImportSchema,
  newsletterSubscriberSchema,
} from "@/lib/schemas/newsletter-subscribers";
import { newsletterService } from "@/lib/services/newsletter.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface SubscriberInput extends AuthenticatedRequest {
  projectId: string;
  values: unknown;
}

interface SubscriberTarget extends AuthenticatedRequest {
  projectId: string;
  subscriberId: string;
}

const targetSchema = z.object({ projectId: z.uuid(), subscriberId: z.uuid() });

export const addNewsletterSubscriber = withSession<
  SubscriberInput,
  ActionResultDto<NewsletterSubscriber, NewsletterSubscriberError>
>(async ({ projectId, values }) => {
  const t = await getTranslations("App.Projects.Newsletter.Subscribers");
  const parsed = newsletterSubscriberSchema(t).safeParse(values);
  if (!parsed.success)
    return toActionResult(
      err({
        message: t("invalid"),
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      }),
    );
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ message: t("Add.error") }));
  try {
    const subscriber = await newsletterService.addSubscriber(projectId, {
      ...parsed.data,
      name: parsed.data.name || null,
      consent: true,
    });
    revalidatePath(`/projects/${projectId}/newsletter/subscribers`);
    return toActionResult(ok(subscriber));
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 409) {
      return toActionResult(
        err({
          message: t("Add.duplicate"),
          fieldErrors: { email: [t("Add.duplicate")] },
        }),
      );
    }
    return toActionResult(err({ message: t("Add.error") }));
  }
});

export const importNewsletterSubscribers = withSession<
  SubscriberInput,
  ActionResultDto<NewsletterImportResult, NewsletterSubscriberError>
>(async ({ projectId, values }) => {
  const t = await getTranslations("App.Projects.Newsletter.Subscribers");
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ message: t("Import.error") }));
  try {
    const form = values instanceof FormData ? values : null;
    const csv = form?.get("csv");
    if (csv instanceof Blob && csv.size > NEWSLETTER_CSV_MAX_BYTES) {
      return toActionResult(
        err({
          message: t("invalid"),
          fieldErrors: { csv: [t("Import.fileSize")] },
        }),
      );
    }
    const parsed = newsletterImportSchema(t).safeParse({
      csv: csv instanceof Blob ? await csv.text() : undefined,
      consent: form?.get("consent") === "true",
    });
    if (!parsed.success)
      return toActionResult(
        err({
          message: t("invalid"),
          fieldErrors: z.flattenError(parsed.error).fieldErrors,
        }),
      );
    const summary = await newsletterService.importSubscribers(projectId, {
      csv: parsed.data.csv,
      consent: true,
    });
    revalidatePath(`/projects/${projectId}/newsletter/subscribers`);
    return toActionResult(ok(summary));
  } catch (error) {
    return toActionResult(
      err({
        message:
          error instanceof CoreApiRequestError && error.status === 422
            ? t("Import.invalidCsv")
            : t("Import.error"),
      }),
    );
  }
});

export const changeNewsletterSubscriberStatus = withSession<
  SubscriberTarget & { status: unknown },
  ActionResultDto<NewsletterSubscriber, NewsletterSubscriberError>
>(async ({ projectId, subscriberId, status }) => {
  const t = await getTranslations("App.Projects.Newsletter.Subscribers");
  const parsed = z
    .literal(NewsletterSubscriberStatus.UNSUBSCRIBED)
    .safeParse(status);
  if (
    !targetSchema.safeParse({ projectId, subscriberId }).success ||
    !parsed.success
  )
    return toActionResult(err({ message: t("updateError") }));
  try {
    const subscriber = await newsletterService.updateSubscriber(
      projectId,
      subscriberId,
      { status: parsed.data },
    );
    revalidatePath(`/projects/${projectId}/newsletter/subscribers`);
    return toActionResult(ok(subscriber));
  } catch (error) {
    return toActionResult(
      err({
        message:
          error instanceof CoreApiRequestError && error.status === 409
            ? t("transitionError")
            : t("updateError"),
      }),
    );
  }
});

export const removeNewsletterSubscriber = withSession<
  SubscriberTarget,
  ActionResultDto<null, NewsletterSubscriberError>
>(async ({ projectId, subscriberId }) => {
  const t = await getTranslations("App.Projects.Newsletter.Subscribers");
  if (!targetSchema.safeParse({ projectId, subscriberId }).success)
    return toActionResult(err({ message: t("Remove.error") }));
  try {
    await newsletterService.removeSubscriber(projectId, subscriberId);
    revalidatePath(`/projects/${projectId}/newsletter/subscribers`);
    return toActionResult(ok(null));
  } catch {
    return toActionResult(err({ message: t("Remove.error") }));
  }
});
