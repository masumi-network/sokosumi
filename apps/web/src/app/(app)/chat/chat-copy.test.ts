import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";

import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const catalogs = { en, de, es };

function translator(locale: keyof typeof catalogs) {
  return createTranslator({
    locale,
    messages: catalogs[locale],
    namespace: "App.Channels",
  });
}

// Readers know chats and channels; "room" is the code's word for both.
const ROOM_WORD = { en: /\brooms?\b/i, de: /\bR(a|ä)um/, es: /\bsalas?\b/i };

// Readable text only: ICU argument names like {rooms, plural, …} are code.
function strings(value: unknown): string[] {
  if (typeof value === "string")
    return [value.replace(/\{\s*\w+\s*(,|\})/g, "{$1")];
  if (value && typeof value === "object")
    return Object.values(value).flatMap(strings);
  return [];
}

describe("chat copy", () => {
  it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
    "%s: Catch up, tag, pinned and assistant notes say chat, not room",
    (locale) => {
      const { App } = catalogs[locale];
      const copy = [
        App.Channels.Signals,
        App.Channels.PinnedMessages.roomRequired,
        App.Chat.SokoBot.chainRoomRate,
      ];
      expect(strings(copy).filter((s) => ROOM_WORD[locale].test(s))).toEqual(
        [],
      );
    },
  );

  it.each([
    ["en", "1 member", "3 members"],
    ["de", "1 Mitglied", "3 Mitglieder"],
    ["es", "1 miembro", "3 miembros"],
  ] as const)(
    "%s: the add-everyone option counts one member in the singular",
    (locale, singular, plural) => {
      const t = translator(locale);
      const one = t("CreateWizard.addAll", { count: 1, organization: "Acme" });
      const many = t("CreateWizard.addAll", { count: 3, organization: "Acme" });
      expect(one).toContain(`(${singular})`);
      expect(many).toContain(`(${plural})`);
    },
  );

  it("names people the same way in the picker as in mentions", () => {
    for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[]) {
      const channels = catalogs[locale].App.Channels;
      expect(channels.Dialog.humans).toBe(channels.MentionSections.people);
    }
  });
});
