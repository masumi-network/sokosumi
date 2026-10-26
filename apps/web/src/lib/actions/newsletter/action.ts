"use server";

import type { Newsletter, PutNewsletterRequest } from "@sokosumi/core-client";
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
  type NewsletterSettingsError,
  newsletterSettingsSchema,
} from "@/lib/schemas/newsletter";
import { newsletterService } from "@/lib/services/newsletter.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface SaveNewsletterSettingsParameters extends AuthenticatedRequest {
  projectId: string;
  values: unknown;
}

export const saveNewsletterSettings = withSession<
  SaveNewsletterSettingsParameters,
  ActionResultDto<Newsletter, NewsletterSettingsError>
>(async ({ projectId, values }) => {
  const [t, validationT] = await Promise.all([
    getTranslations("App.Projects.Newsletter"),
    getTranslations("App.Projects.Newsletter.Validation"),
  ]);
  const parsed = newsletterSettingsSchema(validationT).safeParse(values);
  if (!parsed.success) {
    return toActionResult(
      err({
        message: t("invalid"),
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      }),
    );
  }
  if (!z.uuid().safeParse(projectId).success) {
    return toActionResult(err({ message: t("error") }));
  }

  const {
    logoUrl,
    primaryColor,
    accentColor,
    fontFamily,
    footerText,
    ...settings
  } = parsed.data;
  const input: PutNewsletterRequest = {
    ...settings,
    brand: {
      ...(logoUrl ? { logoUrl } : {}),
      ...(primaryColor ? { primaryColor } : {}),
      ...(accentColor ? { accentColor } : {}),
      fontFamily,
      footerText,
    },
  };

  try {
    const newsletter = await newsletterService.saveSettings(projectId, input);
    revalidatePath(`/projects/${projectId}/newsletter`);
    return toActionResult(ok(newsletter));
  } catch (error) {
    return toActionResult(
      err({
        message:
          error instanceof CoreApiRequestError && error.status === 404
            ? t("unavailable")
            : t("error"),
      }),
    );
  }
});
