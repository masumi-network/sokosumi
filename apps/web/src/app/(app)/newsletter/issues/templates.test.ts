import { NewsletterTemplate } from "@sokosumi/core-client";
import { newsletterContentSchema } from "@sokosumi/utils";
import { type AbstractIntlMessages, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";
import { newsletterTemplateContent } from "./templates";

describe("newsletter templates", () => {
  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ] as const)(
    "prefills all three valid templates in %s",
    (locale, messages) => {
      const catalog: AbstractIntlMessages = messages;
      const t = createTranslator({
        locale,
        messages: catalog,
        namespace: "App.Projects.Newsletter.Issues",
      });
      const expected = {
        TEXT: ["heading", "text", "divider"],
        IMAGES: ["heading", "image", "text", "image"],
        BUTTONS: ["heading", "text", "button", "divider", "text"],
      };
      for (const template of Object.values(NewsletterTemplate)) {
        const content = newsletterTemplateContent(template, t);
        expect(newsletterContentSchema.safeParse(content).success).toBe(true);
        expect(content.map((block) => block.type)).toEqual(expected[template]);
        expect(content[0]).toMatchObject({
          text: messages.App.Projects.Newsletter.Issues.Templates.heading,
        });
      }
    },
  );
});
