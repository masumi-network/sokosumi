import { describe, expect, it } from "vitest";

import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";

const NAMES = {
  en: "Credit History",
  de: "Kreditverlauf",
  es: "Historial de créditos",
};

describe("Credit History page name", () => {
  it.each([
    ["en", en],
    ["de", de],
    ["es", es],
  ] as const)("is %s everywhere it is shown", (locale, messages) => {
    const name = NAMES[locale];
    const app = messages.App as unknown as {
      TransactionHistory: { Metadata: { title: string } };
    };

    expect(app.TransactionHistory.Metadata.title).toBe(name);
    // Nav item and the palette's "Go to" entry.
    const raw = JSON.stringify(messages);
    expect(raw.match(new RegExp(`"history":"${name}"`, "g"))).toHaveLength(2);
  });
});
