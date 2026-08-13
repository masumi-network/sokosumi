import { describe, expect, it } from "vitest";
import { canUseNextImageSrc } from "@/config/next-image";

describe("canUseNextImageSrc", () => {
  it("allows configured Vercel Blob store hosts", () => {
    expect(
      canUseNextImageSrc(
        "https://yhpsw8jlcoagsrkq.public.blob.vercel-storage.com/logo.png",
      ),
    ).toBe(true);
    expect(
      canUseNextImageSrc(
        "https://otherstoreid.public.blob.vercel-storage.com/org/logo.png",
      ),
    ).toBe(true);
  });

  it("rejects bare domain for * pattern (exactly one subdomain required)", () => {
    expect(
      canUseNextImageSrc("https://public.blob.vercel-storage.com/asset.png"),
    ).toBe(false);
  });

  it("rejects unknown remote hosts", () => {
    expect(canUseNextImageSrc("https://evil.example.com/asset.png")).toBe(
      false,
    );
  });

  it("allows relative paths", () => {
    expect(canUseNextImageSrc("/static/local.png")).toBe(true);
  });

  it("allows any single subdomain under serviceplan-agents.com plus the apex", () => {
    expect(
      canUseNextImageSrc(
        "https://usecases.serviceplan-agents.com/images/jamal.webp",
      ),
    ).toBe(true);
    expect(
      canUseNextImageSrc("https://foo.serviceplan-agents.com/images/maya.webp"),
    ).toBe(true);
    expect(
      canUseNextImageSrc(
        "https://cdn.serviceplan-agents.com/avatars/elena.png",
      ),
    ).toBe(true);
    expect(
      canUseNextImageSrc("https://serviceplan-agents.com/images/jamal.webp"),
    ).toBe(true);
  });

  it("rejects nested Serviceplan subdomains beyond one segment", () => {
    expect(
      canUseNextImageSrc(
        "https://a.b.serviceplan-agents.com/images/jamal.webp",
      ),
    ).toBe(false);
  });

  it("does not reject .webp on already-allowed hosts (format is not the gate)", () => {
    expect(
      canUseNextImageSrc(
        "https://yhpsw8jlcoagsrkq.public.blob.vercel-storage.com/coworkers/avatar.webp",
      ),
    ).toBe(true);
    expect(canUseNextImageSrc("/images/coworkers/elena.webp")).toBe(true);
    expect(
      canUseNextImageSrc("https://cdn.azurecontainerapps.io/path/to/face.webp"),
    ).toBe(true);
  });
});
