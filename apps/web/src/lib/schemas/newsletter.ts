import type { PutNewsletterRequest } from "@sokosumi/core-client";
import { type NewsletterBrand, newsletterBrandSchema } from "@sokosumi/utils";
import { z } from "zod";

export function newsletterSettingsSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Validation">,
) {
  const maxLength = (max: number) => t("maxLength", { max });
  const text = z.string({ error: t("required") });
  const color = text
    .trim()
    .refine(
      (value) => !value || /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value),
      t("color"),
    );
  const imageUrl = text
    .trim()
    .refine(
      (value) =>
        !value || z.url({ protocol: /^https$/ }).safeParse(value).success,
      t("url"),
    )
    .max(2048, maxLength(2048));

  return z
    .object(
      {
        name: text.trim().min(1, t("required")).max(200, maxLength(200)),
        senderName: text.trim().min(1, t("required")).max(200, maxLength(200)),
        replyTo: text
          .trim()
          .toLowerCase()
          .pipe(z.email(t("email")).max(254, maxLength(254))),
        logoUrl: imageUrl,
        primaryColor: color,
        accentColor: color,
        fontFamily: text.trim().min(1, t("required")).max(200, maxLength(200)),
        footerText: text.max(5000, maxLength(5000)),
        backgroundColor: color,
        buttonTextColor: color,
        buttonShape: z.enum(["square", "rounded", "pill"]),
        headerImageUrl: imageUrl,
        headerAlign: z.enum(["left", "center"]),
        spacing: z.enum(["compact", "normal", "roomy"]),
        signupForm: z
          .object({
            accentColor: color.optional(),
            buttonTextColor: color.optional(),
            buttonShape: z.enum(["", "square", "rounded", "pill"]).optional(),
            headerAlign: z.enum(["", "left", "center"]).optional(),
            spacing: z.enum(["", "compact", "normal", "roomy"]).optional(),
          })
          .optional(),
        welcomeEmailEnabled: z.boolean({ error: t("required") }),
        welcomeSubject: text.max(200, maxLength(200)),
        welcomeBody: text.max(100_000, maxLength(100_000)),
      },
      { error: t("required") },
    )
    .superRefine((values, context) => {
      if (!values.welcomeEmailEnabled) return;
      for (const field of ["welcomeSubject", "welcomeBody"] as const) {
        if (!values[field].trim()) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: t("required"),
          });
        }
      }
    });
}

export type NewsletterSettingsValues = z.infer<
  ReturnType<typeof newsletterSettingsSchema>
>;

type NewsletterBrandValues = Pick<
  NewsletterSettingsValues,
  | "logoUrl"
  | "primaryColor"
  | "accentColor"
  | "fontFamily"
  | "footerText"
  | "backgroundColor"
  | "buttonTextColor"
  | "buttonShape"
  | "headerImageUrl"
  | "headerAlign"
  | "spacing"
  | "signupForm"
>;

/** The design fields as Core stores them: blank optional fields are left out. */
export function newsletterBrandFromValues({
  logoUrl,
  primaryColor,
  accentColor,
  fontFamily,
  footerText,
  backgroundColor,
  buttonTextColor,
  buttonShape,
  headerImageUrl,
  headerAlign,
  spacing,
  signupForm,
}: NewsletterBrandValues): PutNewsletterRequest["brand"] {
  const overrides = {
    ...(signupForm?.accentColor ? { accentColor: signupForm.accentColor } : {}),
    ...(signupForm?.buttonTextColor
      ? { buttonTextColor: signupForm.buttonTextColor }
      : {}),
    ...(signupForm?.buttonShape ? { buttonShape: signupForm.buttonShape } : {}),
    ...(signupForm?.headerAlign ? { headerAlign: signupForm.headerAlign } : {}),
    ...(signupForm?.spacing ? { spacing: signupForm.spacing } : {}),
  };
  return {
    ...(logoUrl ? { logoUrl } : {}),
    ...(primaryColor ? { primaryColor } : {}),
    ...(accentColor ? { accentColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(buttonTextColor ? { buttonTextColor } : {}),
    ...(headerImageUrl ? { headerImageUrl } : {}),
    fontFamily,
    footerText,
    buttonShape,
    headerAlign,
    spacing,
    ...(Object.keys(overrides).length ? { signupForm: overrides } : {}),
  };
}

/** The design as typed so far, minus fields not yet valid, so the preview never stalls mid-edit. */
export function newsletterBrandForPreview(
  values: NewsletterSettingsValues,
): NewsletterBrand {
  const { signupForm, ...brand } = newsletterBrandFromValues(values);
  return {
    ...Object.fromEntries(
      Object.entries(brand).filter(
        ([key, value]) =>
          newsletterBrandSchema.shape[key as keyof NewsletterBrand].safeParse(
            value,
          ).success,
      ),
    ),
    ...(signupForm
      ? {
          signupForm: Object.fromEntries(
            Object.entries(signupForm).filter(
              ([key, value]) =>
                newsletterBrandSchema.shape.signupForm
                  .unwrap()
                  .shape[
                    key as keyof NonNullable<NewsletterBrand["signupForm"]>
                  ].safeParse(value).success,
            ),
          ),
        }
      : {}),
  };
}

export interface NewsletterSettingsError {
  message: string;
  fieldErrors?: Partial<Record<keyof NewsletterSettingsValues, string[]>>;
}
