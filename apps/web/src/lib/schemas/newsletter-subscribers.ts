import { NewsletterConsent } from "@sokosumi/core-client";
import { z } from "zod";

export const NEWSLETTER_CSV_MAX_BYTES = 5_000_000;

function newsletterConsentSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Subscribers">,
) {
  return z
    .object({
      consent: z.enum(NewsletterConsent, { error: t("Validation.consent") }),
      consentConfirmed: z.boolean().optional(),
    })
    .refine(
      (values) =>
        values.consent !== NewsletterConsent.CONFIRMED ||
        values.consentConfirmed === true,
      { message: t("Validation.consent"), path: ["consent"] },
    );
}

export function newsletterSubscriberSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Subscribers">,
) {
  return newsletterConsentSchema(t).safeExtend({
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
  });
}

export function newsletterImportSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Subscribers">,
) {
  return newsletterConsentSchema(t).safeExtend({
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
  });
}

export function newsletterFromContactsSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Subscribers">,
) {
  return newsletterConsentSchema(t)
    .safeExtend({
      contactIds: z
        .array(z.uuid())
        .max(1000, t("FromContacts.selectionLimit"))
        .default([]),
      listIds: z
        .array(z.uuid())
        .max(20, t("FromContacts.selectionLimit"))
        .default([]),
    })
    .refine((values) => values.contactIds.length + values.listIds.length > 0, {
      message: t("FromContacts.selectionRequired"),
      path: ["contactIds"],
    });
}

export type NewsletterSubscriberValues = z.infer<
  ReturnType<typeof newsletterSubscriberSchema>
>;

export interface NewsletterSubscriberError {
  message: string;
  fieldErrors?: Partial<
    Record<
      | "email"
      | "name"
      | "consent"
      | "consentConfirmed"
      | "csv"
      | "contactIds"
      | "listIds",
      string[]
    >
  >;
}
