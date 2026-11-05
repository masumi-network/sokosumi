import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const catalogs = { en, de, es };

describe("X thread messages", () => {
  it.each(Object.entries(catalogs))(
    "provides the same thread keys and placeholders in %s",
    (_locale, catalog) => {
      const messages = catalog.App.Projects.SocialPosts;
      expect(Object.keys(messages.thread).sort()).toEqual(
        Object.keys(en.App.Projects.SocialPosts.thread).sort(),
      );
      for (const key of Object.keys(
        en.App.Projects.SocialPosts.thread,
      ) as (keyof typeof messages.thread)[]) {
        expect(messages.thread[key].trim()).not.toBe("");
        expect(messages.thread[key].match(/\{[a-z]+\}/g)?.sort()).toEqual(
          en.App.Projects.SocialPosts.thread[key].match(/\{[a-z]+\}/g)?.sort(),
        );
      }
      expect(messages.actions.approve).toBeTruthy();
      expect(messages.toasts.approved).toBeTruthy();
    },
  );

  it.each([de, es])(
    "translates all prose rather than leaving English placeholders",
    (catalog) => {
      for (const key of Object.keys(
        en.App.Projects.SocialPosts.thread,
      ) as (keyof typeof en.App.Projects.SocialPosts.thread)[]) {
        if (key === "position") continue;
        expect(catalog.App.Projects.SocialPosts.thread[key]).not.toBe(
          en.App.Projects.SocialPosts.thread[key],
        );
      }
    },
  );
});
