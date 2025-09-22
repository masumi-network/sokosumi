import * as z from "zod";

export const onboardingFormSchema = (t?: IntlTranslation<"Onboarding.Form">) =>
  z
    .object({
      organizationName: z
        .string()
        .trim()
        .min(1, t?.("Validation.organizationNameRequired")),
      emails: z.array(
        z.union([
          z.literal(""),
          z.email(t?.("Validation.invalidEmailAddress")),
        ]),
      ),
    })
    .superRefine((data, ctx) => {
      const emails = data.emails.map((email) => email.trim().toLowerCase());
      const seenEmails = new Set<string>();

      emails.forEach((email, index) => {
        if (email) {
          // Check for duplicates
          if (seenEmails.has(email)) {
            ctx.addIssue({
              code: "custom",
              message: t?.("Validation.emailAlreadyAdded"),
              path: ["emails", index],
            });
          } else {
            seenEmails.add(email);
          }
        }
      });
    });
export type OnboardingFormSchemaType = z.infer<
  ReturnType<typeof onboardingFormSchema>
>;
