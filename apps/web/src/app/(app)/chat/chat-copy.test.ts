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
    "%s: Catch up and tag notes say chat, not room",
    (locale) => {
      const signals = catalogs[locale].App.Channels.Signals;
      expect(strings(signals).filter((s) => ROOM_WORD[locale].test(s))).toEqual(
        [],
      );
    },
  );

  it.each(Object.keys(catalogs) as (keyof typeof catalogs)[])(
    "%s: the add-everyone option counts one member in the singular",
    (locale) => {
      const t = translator(locale);
      const one = t("CreateWizard.addAll", { count: 1, organization: "Acme" });
      const many = t("CreateWizard.addAll", { count: 3, organization: "Acme" });
      expect(one).toContain("1");
      expect(one).not.toMatch(/1 (members|Mitglieder|miembros)/);
      expect(many).toMatch(/3 (members|Mitglieder|miembros)/);
    },
  );

  it("names people the same way in the picker as in mentions", () => {
    for (const locale of Object.keys(catalogs) as (keyof typeof catalogs)[]) {
      const channels = catalogs[locale].App.Channels;
      expect(channels.Dialog.humans).toBe(channels.MentionSections.people);
    }
  });
});
