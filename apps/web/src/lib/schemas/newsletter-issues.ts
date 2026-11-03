import { NewsletterTemplate } from "@sokosumi/core-client";
import { newsletterContentSchema } from "@sokosumi/utils";
import { z } from "zod";

export function newsletterIssueInputSchema(
  t: IntlTranslation<"App.Projects.Newsletter.Issues">,
) {
  return z.object({
    subject: z
      .string()
      .trim()
      .min(1, t("Validation.subject"))
      .max(200, t("Validation.subject")),
    previewText: z
      .string()
      .max(500, t("Validation.previewText"))
      .nullable()
      .optional(),
    template: z.enum(NewsletterTemplate),
    content: newsletterContentSchema,
  });
}

export type NewsletterIssueValues = z.infer<
  ReturnType<typeof newsletterIssueInputSchema>
>;

export interface NewsletterIssueError {
  message: string;
  fieldErrors?: Partial<Record<keyof NewsletterIssueValues, string[]>>;
}
