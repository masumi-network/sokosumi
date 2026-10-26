"use server";

import type { NewsletterIssue, ProjectImageAsset } from "@sokosumi/core-client";
import { newsletterDraftInputSchema } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { newsletterService } from "@/lib/services/newsletter.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface DraftInput extends AuthenticatedRequest {
  projectId: string;
  values: unknown;
}
export interface NewsletterDraftError {
  message: string;
  fieldErrors?: Partial<
    Record<keyof z.infer<typeof newsletterDraftInputSchema>, string[]>
  >;
}

export const draftNewsletterIssue = withSession<
  DraftInput,
  ActionResultDto<NewsletterIssue, NewsletterDraftError>
>(async ({ projectId, values }) => {
  const t = await getTranslations("App.Projects.Newsletter.Issues.Ai");
  const parsed = newsletterDraftInputSchema.safeParse(values, {
    error: () => t("invalid"),
  });
  if (!parsed.success)
    return toActionResult(
      err({
        message: t("invalid"),
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      }),
    );
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ message: t("error") }));
  try {
    const issue = await newsletterService.draftIssue(projectId, parsed.data);
    revalidatePath(`/projects/${projectId}/newsletter/issues`);
    return toActionResult(ok(issue));
  } catch (error) {
    return toActionResult(
      err({
        message:
          error instanceof CoreApiRequestError && error.status === 429
            ? t("rateLimited")
            : t("error"),
      }),
    );
  }
});

export const getNewsletterDraftImages = withSession<
  AuthenticatedRequest & { projectId: string },
  ActionResultDto<ProjectImageAsset[], NewsletterDraftError>
>(async ({ projectId }) => {
  const t = await getTranslations("App.Projects.Newsletter.Issues.Ai");
  if (!z.uuid().safeParse(projectId).success)
    return toActionResult(err({ message: t("imagesError") }));
  try {
    const state = await imageStudioService.getState(projectId);
    return toActionResult(
      ok(
        state.assets
          .filter((asset) => asset.contentType.startsWith("image/"))
          .slice(0, 30),
      ),
    );
  } catch {
    return toActionResult(err({ message: t("imagesError") }));
  }
});
