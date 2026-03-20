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
});
