"use server";

import type { NewsletterSignupAccepted } from "@sokosumi/core-client";
import { DEFAULT_LOCALE, parseLocalePreference } from "@sokosumi/utils";
import { err, ok } from "neverthrow";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import {
  type NewsletterSignupError,
  newsletterSignupSchema,
} from "@/lib/schemas/newsletter-signup";
import { newsletterService } from "@/lib/services/newsletter.service";

export async function subscribeToNewsletter(input: {
  slug: string;
  values: unknown;
}): Promise<ActionResultDto<NewsletterSignupAccepted, NewsletterSignupError>> {
  const t = await getTranslations("PublicNewsletter.Signup");
  if (!z.string().min(1).max(300).safeParse(input.slug).success) {
    return toActionResult(err({ message: t("unavailable") }));
  }
  const parsed = newsletterSignupSchema(t).safeParse(input.values);
  if (!parsed.success) {
    return toActionResult(
      err({
        message: t("invalid"),
        fieldErrors: z.flattenError(parsed.error).fieldErrors,
      }),
    );
  }
  try {
    const response = await newsletterService.subscribe(input.slug, {
      email: parsed.data.email,
      name: parsed.data.name || undefined,
      website: parsed.data.website,
      source: "SIGNUP_FORM",
      locale: parseLocalePreference(await getLocale()) ?? DEFAULT_LOCALE,
    });
    return toActionResult(ok(response));
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      if (error.status === 429)
        return toActionResult(err({ message: t("rateLimit") }));
      if (error.status === 404)
        return toActionResult(err({ message: t("unavailable") }));
      if (error.status === 422)
        return toActionResult(
          err({
            message: t("invalidEmail"),
            fieldErrors: { email: [t("invalidEmail")] },
          }),
        );
    }
    return toActionResult(err({ message: t("error") }));
  }
}
