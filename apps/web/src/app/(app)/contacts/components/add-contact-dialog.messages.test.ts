import { readSignature } from "@sokosumi/utils";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

describe.each([
  ["en", en],
  ["de", de],
  ["es", es],
] as const)("Add contact signature copy in %s", (locale, messages) => {
  const t = createTranslator({
    locale,
    messages,
    namespace: "App.Contacts.addDialog",
  });

  it("formats every signature message", () => {
    for (const key of [
      "signature",
      "signatureFill",
      "signatureNothing",
    ] as const)
      expect(t(key)).not.toBe(`App.Contacts.addDialog.${key}`);
    expect(t("signatureFilled", { count: 2 })).toContain("2");
  });

  it("shows a placeholder the parser reads in full", () => {
    expect(readSignature(t("signaturePlaceholder"))).toEqual({
      name: expect.any(String),
      role: expect.any(String),
      organization: expect.any(String),
      email: expect.any(String),
    });
  });
});
