import { z } from "zod";

export const NEWSLETTER_CSV_MAX_BYTES = 5_000_000;

export function newsletterSubscriberSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Subscribers">,
) {
  return z.object({
    email: z
      .string({ error: t("Validation.email") })
      .trim()
      .toLowerCase()
      .pipe(z.email(t("Validation.email")).max(254, t("Validation.email"))),
    name: z
      .string({ error: t("Validation.name") })
      .trim()
      .max(200, t("Validation.name"))
      .optional(),
    consent: z
      .boolean({ error: t("Validation.consent") })
      .refine((value) => value, t("Validation.consent")),
  });
}

export function newsletterImportSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Subscribers">,
) {
  return z.object({
    csv: z
      .string({ error: t("Import.fileRequired") })
      .min(1, t("Import.fileRequired"))
      .max(NEWSLETTER_CSV_MAX_BYTES, t("Import.fileSize"))
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <=
          NEWSLETTER_CSV_MAX_BYTES,
        t("Import.fileSize"),
      ),
    consent: z
      .boolean({ error: t("Validation.consent") })
      .refine((value) => value, t("Validation.consent")),
  });
}

export type NewsletterSubscriberValues = z.infer<
  ReturnType<typeof newsletterSubscriberSchema>
>;

export interface NewsletterSubscriberError {
  message: string;
  fieldErrors?: Partial<Record<"email" | "name" | "consent" | "csv", string[]>>;
}
