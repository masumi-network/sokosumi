import { NewsletterTemplate } from "@sokosumi/core-client";
import type { NewsletterBlock } from "@sokosumi/utils";

export function newsletterTemplateContent(
  template: NewsletterTemplate,
  t: IntlTranslation<"App.Projects.Newsletter.Issues">,
): NewsletterBlock[] {
  const heading: NewsletterBlock = {
    type: "heading",
    level: 1,
    text: t("Templates.heading"),
  };
  const text: NewsletterBlock = { type: "text", text: t("Templates.text") };
  switch (template) {
    case NewsletterTemplate.IMAGES:
      return [
        heading,
        {
          type: "image",
          url: "https://placehold.co/1200x600/png",
          alt: t("Templates.heroAlt"),
        },
        text,
        {
          type: "image",
          url: "https://placehold.co/800x600/png",
          alt: t("Templates.imageAlt"),
        },
      ];
    case NewsletterTemplate.BUTTONS:
      return [
        heading,
        text,
        {
          type: "button",
          label: t("Templates.button"),
          url: "https://example.com",
        },
        { type: "divider" },
        { ...text, text: t("Templates.closing") },
      ];
    case NewsletterTemplate.TEXT:
      return [
        heading,
        {
          ...text,
          text: `${t("Templates.text")}\n\n${t("Templates.closing")}`,
        },
        { type: "divider" },
      ];
  }
}
