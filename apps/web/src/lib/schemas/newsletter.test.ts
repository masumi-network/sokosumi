import { type AbstractIntlMessages, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";

import { newsletterSettingsSchema } from "./newsletter";

const messages: AbstractIntlMessages = en;
const schema = newsletterSettingsSchema(
  createTranslator({
    locale: "en",
    messages,
    namespace: "App.Projects.Newsletter.Validation",
  }),
);
const VALUES = {
  name: "Weekly",
  senderName: "Team",
  replyTo: "team@example.com",
  logoUrl: "",
  primaryColor: "",
  accentColor: "",
  fontFamily: "Arial",
  footerText: "",
  welcomeEmailEnabled: false,
  welcomeSubject: "",
  welcomeBody: "",
};

describe("newsletterSettingsSchema", () => {
  it("normalizes names and email and allows empty optional brand fields", () => {
    expect(
      schema.parse({
        ...VALUES,
        name: " Weekly ",
        replyTo: " Team@Example.com ",
      }),
    ).toMatchObject({ name: "Weekly", replyTo: "team@example.com" });
  });

  it.each([
    ["name", " "],
    ["senderName", ""],
    ["replyTo", "wrong"],
    ["logoUrl", "javascript:alert(1)"],
    ["logoUrl", "ftp://example.com/logo"],
    ["logoUrl", "http://example.com/logo.png"],
    ["primaryColor", "red"],
    ["accentColor", "#12345"],
    ["fontFamily", ""],
    ["name", "a".repeat(201)],
    ["welcomeSubject", "a".repeat(201)],
    ["footerText", "a".repeat(5001)],
    ["welcomeBody", "a".repeat(100001)],
  ])("rejects invalid %s", (name, value) => {
    expect(schema.safeParse({ ...VALUES, [name]: value }).success).toBe(false);
  });

  it("requires welcome subject and body only when enabled", () => {
    const result = schema.safeParse({
      ...VALUES,
      welcomeEmailEnabled: true,
      welcomeSubject: " ",
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual([
        "welcomeSubject",
        "welcomeBody",
      ]);
    expect(
      schema.safeParse({
        ...VALUES,
        welcomeEmailEnabled: true,
        welcomeSubject: "Hello",
        welcomeBody: "Welcome!",
      }).success,
    ).toBe(true);
  });

  it("accepts HTTPS logos and both short and full hex colors", () => {
    expect(
      schema.safeParse({
        ...VALUES,
        logoUrl: "https://example.com/logo.png",
        primaryColor: "#abc",
        accentColor: "#A1B2C3",
      }).success,
    ).toBe(true);
  });
});
