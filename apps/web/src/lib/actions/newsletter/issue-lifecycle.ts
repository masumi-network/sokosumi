"use server";

import type { NewsletterIssue } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import type { NewsletterIssueError } from "@/lib/schemas/newsletter-issues";
import { newsletterService } from "@/lib/services/newsletter.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface IssueLifecycleInput extends AuthenticatedRequest {
  projectId: string;
  issueId: string;
  revision: number;
  action: "submit" | "approve" | "schedule" | "sendNow" | "cancel";
  scheduledAt?: string;
  timezone?: string;
}
const target = z.object({
  projectId: z.uuid(),
  issueId: z.uuid(),
  revision: z.int().nonnegative(),
});
const inputSchema = z.discriminatedUnion("action", [
  target.extend({
    action: z.literal("schedule"),
    scheduledAt: z.iso.datetime(),
    timezone: z.string().min(1).max(100),
  }),
  target.extend({ action: z.enum(["submit", "approve", "sendNow", "cancel"]) }),
]);

export const changeNewsletterIssue = withSession<
  IssueLifecycleInput,
  ActionResultDto<NewsletterIssue, NewsletterIssueError>
>(async (input) => {
  const t = await getTranslations("App.Projects.Newsletter.Issues.Lifecycle");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err({ message: t("invalid") }));
  const { projectId, issueId, revision } = parsed.data;
  try {
    let issue: NewsletterIssue;
    switch (parsed.data.action) {
      case "schedule":
        issue = await newsletterService.scheduleIssue(projectId, issueId, {
          revision,
          scheduledAt: new Date(parsed.data.scheduledAt),
          timezone: parsed.data.timezone,
        });
        break;
      case "submit":
        issue = await newsletterService.submitIssue(projectId, issueId, {
          revision,
        });
        break;
      case "approve":
        issue = await newsletterService.approveIssue(projectId, issueId, {
          revision,
        });
        break;
      case "sendNow":
        issue = await newsletterService.sendIssueNow(projectId, issueId, {
          revision,
        });
        break;
      case "cancel":
        issue = await newsletterService.cancelIssue(projectId, issueId, {
          revision,
        });
        break;
    }
    revalidatePath("/newsletter/issues", "layout");
    revalidatePath("/social");
    revalidatePath("/calendar");
    revalidatePath("/tasks");
    if (issue.taskId) revalidatePath(`/tasks/${issue.taskId}`);
    return toActionResult(ok(issue));
  } catch (error) {
    let message = t("error");
    if (error instanceof CoreApiRequestError) {
      switch (error.kind) {
        case CORE_API_ERROR_KINDS.NEWSLETTER_NO_ACTIVE_SUBSCRIBERS:
          message = t("noSubscribers");
          break;
        case CORE_API_ERROR_KINDS.NEWSLETTER_SENDER_NOT_CONFIGURED:
          message = t("noSender");
          break;
        case CORE_API_ERROR_KINDS.NEWSLETTER_APPROVAL_REQUIRED:
          message = t("approvalRequired");
          break;
        default:
          if (error.status === 409) message = t("conflict");
          else if (error.status === 403) message = t("humanRequired");
          else if (error.status === 422) message = t("invalidSchedule");
      }
    }
    return toActionResult(err({ message }));
  }
});
