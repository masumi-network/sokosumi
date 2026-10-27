"use server";

import type { NewsletterIssue } from "@sokosumi/core-client";
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
  type NewsletterIssueError,
  newsletterIssueInputSchema,
} from "@/lib/schemas/newsletter-issues";
import { newsletterService } from "@/lib/services/newsletter.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface IssueInput extends AuthenticatedRequest {
  projectId: string;
  values: unknown;
}
interface IssueTarget extends AuthenticatedRequest {
  projectId: string;
  issueId: string;
}
const targetSchema = z.object({ projectId: z.uuid(), issueId: z.uuid() });

export const createNewsletterIssue = withSession<
  IssueInput,
  ActionResultDto<NewsletterIssue, NewsletterIssueError>
>(async ({ projectId, values }) => {
  const t = await getTranslations("App.Projects.Newsletter.Issues");
  const parsed = newsletterIssueInputSchema(t).safeParse(values, {
    error: () => t("Validation.content"),
  });
  if (!parsed.success)
    return toActionResult(
      err({
        message: t("invalid"),
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      }),
    );
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ message: t("createError") }));
  try {
    const issue = await newsletterService.createIssue(projectId, parsed.data);
    revalidatePath(`/projects/${projectId}/newsletter/issues`);
    return toActionResult(ok(issue));
  } catch {
    return toActionResult(err({ message: t("createError") }));
  }
});

export const saveNewsletterIssue = withSession<
  IssueInput & IssueTarget & { revision: unknown },
  ActionResultDto<NewsletterIssue, NewsletterIssueError>
>(async ({ projectId, issueId, revision, values }) => {
  const t = await getTranslations("App.Projects.Newsletter.Issues");
  const parsed = newsletterIssueInputSchema(t).safeParse(values, {
    error: () => t("Validation.content"),
  });
  if (!parsed.success)
    return toActionResult(
      err({
        message: t("invalid"),
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      }),
    );
  const version = z.int().nonnegative().safeParse(revision);
  if (
    !targetSchema.safeParse({ projectId, issueId }).success ||
    !version.success
  )
    return toActionResult(err({ message: t("saveError") }));
  try {
    const issue = await newsletterService.saveIssue(projectId, issueId, {
      ...parsed.data,
      revision: version.data,
    });
    revalidatePath(`/projects/${projectId}/newsletter/issues`);
    return toActionResult(ok(issue));
  } catch (error) {
    return toActionResult(
      err({
        message:
          error instanceof CoreApiRequestError && error.status === 409
            ? t("conflict")
            : t("saveError"),
      }),
    );
  }
});

export const deleteNewsletterIssue = withSession<
  IssueTarget,
  ActionResultDto<null, NewsletterIssueError>
>(async ({ projectId, issueId }) => {
  const t = await getTranslations("App.Projects.Newsletter.Issues");
  if (!targetSchema.safeParse({ projectId, issueId }).success)
    return toActionResult(err({ message: t("Delete.error") }));
  try {
    await newsletterService.deleteIssue(projectId, issueId);
    revalidatePath(`/projects/${projectId}/newsletter/issues`);
    return toActionResult(ok(null));
  } catch {
    return toActionResult(err({ message: t("Delete.error") }));
  }
});
