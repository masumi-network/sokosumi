import { describe, expect, it } from "vitest";
import {
  contactFilterSchema,
  contactNameFromChannel,
  createContactSchema,
  mergeContactsSchema,
  normalizeContactChannelValue as normalize,
  updateContactSchema,
} from "./contacts.js";

describe("normalizeContactChannelValue", () => {
  it("lowercases and trims email, and drops mailto:", () => {
    expect(normalize("EMAIL", "  Nina.Keller@Example.COM ")).toBe(
      "nina.keller@example.com",
    );
    expect(normalize("EMAIL", "mailto:Nina@example.com")).toBe(
      "nina@example.com",
    );
    expect(normalize("EMAIL", "nina at example dot com")).toBeNull();
    expect(normalize("EMAIL", "nina@localhost")).toBeNull();
  });

  it("writes phones as E.164 when the country is given, digits otherwise", () => {
    expect(normalize("PHONE", "+41 79 123 45 67")).toBe("+41791234567");
    expect(normalize("PHONE", "0041 (79) 123-45-67")).toBe("+41791234567");
    expect(normalize("PHONE", "tel:+1-415-555-0100")).toBe("+14155550100");
    expect(normalize("PHONE", "(415) 555-0100")).toBe("4155550100");
    expect(normalize("WHATSAPP", "https://wa.me/41791234567")).toBe(
      "41791234567",
    );
    expect(normalize("PHONE", "12")).toBeNull();
    expect(normalize("PHONE", "call me")).toBeNull();
  });

  it("canonicalizes LinkedIn profiles and company pages", () => {
    const canonical = "https://www.linkedin.com/in/nina-keller";
    for (const value of [
      "https://www.linkedin.com/in/Nina-Keller/",
      "linkedin.com/in/nina-keller?trk=public",
      "http://ch.linkedin.com/in/nina-keller",
      "nina-keller",
      "@Nina-Keller",
    ])
      expect(normalize("LINKEDIN", value), value).toBe(canonical);
    expect(normalize("LINKEDIN", "linkedin.com/company/Acme")).toBe(
      "https://www.linkedin.com/company/acme",
    );
    expect(normalize("LINKEDIN", "https://example.com/in/nina")).toBeNull();
    expect(normalize("LINKEDIN", "linkedin.com/feed")).toBeNull();
  });

  it("reduces X, GitHub and Telegram to a lowercase handle", () => {
    for (const value of [
      "@NinaK",
      "ninak",
      "https://x.com/NinaK",
      "twitter.com/ninak/status/1",
      "https://mobile.twitter.com/NinaK",
    ])
      expect(normalize("X", value), value).toBe("ninak");
    expect(normalize("X", "https://facebook.com/ninak")).toBeNull();
    expect(normalize("GITHUB", "https://github.com/Octo-Cat")).toBe("octo-cat");
    expect(normalize("TELEGRAM", "t.me/NinaK")).toBe("ninak");
  });

  it("keeps one form of a website", () => {
    for (const value of [
      "https://www.Example.com/",
      "example.com",
      "http://example.com",
      "https://example.com/#top",
    ])
      expect(normalize("WEBSITE", value), value).toBe("https://example.com");
    expect(normalize("WEBSITE", "example.com/Team/")).toBe(
      "https://example.com/Team",
    );
    expect(normalize("WEBSITE", "ftp://example.com")).toBeNull();
    expect(normalize("WEBSITE", "localhost")).toBeNull();
  });

  it("writes Slack ids as TEAM:USER", () => {
    expect(normalize("SLACK", "t012ab:u34cd")).toBe("T012AB:U34CD");
    expect(normalize("SLACK", "U34CD")).toBeNull();
  });

  it("refuses blanks and keeps other values as written", () => {
    expect(normalize("EMAIL", "   ")).toBeNull();
    expect(normalize("OTHER", " Signal: +41 79 ")).toBe("Signal: +41 79");
  });
});

describe("contactNameFromChannel", () => {
  it("makes a readable name from an address", () => {
    expect(contactNameFromChannel("EMAIL", "nina.keller@example.com")).toBe(
      "Nina Keller",
    );
    expect(
      contactNameFromChannel(
        "LINKEDIN",
        "https://www.linkedin.com/in/nina-keller",
      ),
    ).toBe("nina-keller");
    expect(contactNameFromChannel("X", "ninak")).toBe("ninak");
  });
});

describe("contact input schemas", () => {
  it("needs a name or a channel to create a contact", () => {
    expect(createContactSchema.safeParse({}).success).toBe(false);
    expect(
      createContactSchema.parse({
        channels: [{ type: "EMAIL", value: "a@b.test" }],
      }),
    ).toMatchObject({ upsert: false });
    expect(createContactSchema.safeParse({ name: "Nina" }).success).toBe(true);
  });

  it("needs a version to update and a plain date to follow up", () => {
    expect(updateContactSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(
      updateContactSchema.safeParse({ version: 1, followUpAt: "2026-11-02" })
        .success,
    ).toBe(true);
    expect(
      updateContactSchema.safeParse({
        version: 1,
        followUpAt: "2026-11-02T10:00:00Z",
      }).success,
    ).toBe(false);
  });

  it("refuses merging a contact into itself and unknown filter keys", () => {
    const id = "0199f1c2-7a3b-7c1d-9e2f-3a4b5c6d7e8f";
    expect(
      mergeContactsSchema.safeParse({ winnerId: id, loserIds: [id] }).success,
    ).toBe(false);
    expect(contactFilterSchema.safeParse({ owner: "me" }).success).toBe(false);
    expect(
      contactFilterSchema.safeParse({
        stages: ["PROSPECT"],
        lastContactOlderThanDays: 90,
      }).success,
    ).toBe(true);
  });
});
