import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const english = en.App.Projects.SocialPosts.quote;

describe("X quote messages", () => {
  it.each(Object.entries({ en, de, es }))(
    "provides every quote message and its placeholders in %s",
    (locale, catalog) => {
      const messages = catalog.App.Projects.SocialPosts.quote;
      expect(Object.keys(messages).sort()).toEqual(Object.keys(english).sort());
      for (const key of Object.keys(english) as (keyof typeof english)[]) {
        expect(messages[key].trim()).not.toBe("");
        expect(messages[key].match(/\{[a-z]+\}/g)?.sort()).toEqual(
          english[key].match(/\{[a-z]+\}/g)?.sort(),
        );
        if (locale !== "en") expect(messages[key]).not.toBe(english[key]);
      }
    },
  );
});
