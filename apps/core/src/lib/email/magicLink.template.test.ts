import { beforeAll, describe, expect, it } from "vitest";

import { initI18next } from "@/lib/i18next";

import { renderMagicLinkTemplate } from "./magicLink.template";

describe("renderMagicLinkTemplate", () => {
  beforeAll(async () => {
    await initI18next();
  });

  it("renders the core auth email shell with magic-link copy and token fallback", () => {
    const html = renderMagicLinkTemplate({
      magicLink: "https://example.com/auth/magic-link/verify?token=secret",
      token: "secret-token",
      name: "Andreas",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Sokosumi - Magic Link");
    expect(html).toContain("Sign in to Sokosumi");
    expect(html).toContain("Hello Andreas");
    expect(html).toContain("Use the button below to sign in to Sokosumi.");
    expect(html).toContain("This magic link expires in 48 hours.");
    expect(html).toMatch(/<a[^>]+>\s*Sign in\s*<\/a>/);
    expect(html).toContain("Or copy and paste this URL into your browser:");
    expect(html).toContain(
      "If you need it, you can also use this one-time token:",
    );
    expect(html).toContain("secret-token");
    expect(html).toContain(
      "If you didn't request this email, you can safely ignore it.",
    );
  });
});
