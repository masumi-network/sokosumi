import { z } from "zod";

export function newsletterSignupSchema(
  t: IntlTranslation<"PublicNewsletter.Signup">,
) {
  return z.object({
    email: z
      .string({ error: t("invalidEmail") })
      .trim()
      .toLowerCase()
      .pipe(z.email(t("invalidEmail")).max(254, t("invalidEmail"))),
    name: z
      .string({ error: t("invalidName") })
      .trim()
      .max(200, t("invalidName"))
      .optional(),
    consent: z
      .boolean({ error: t("consentRequired") })
      .refine((value) => value, t("consentRequired")),
    website: z.string().max(2048).optional(),
  });
}

export type NewsletterSignupValues = z.infer<
  ReturnType<typeof newsletterSignupSchema>
>;

export interface NewsletterSignupError {
  message: string;
  fieldErrors?: Partial<Record<keyof NewsletterSignupValues, string[]>>;
}
