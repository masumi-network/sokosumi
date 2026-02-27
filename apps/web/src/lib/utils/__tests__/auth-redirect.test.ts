import { getValidAuthRedirectUrl } from "@/lib/utils/auth-redirect";

describe("getValidAuthRedirectUrl", () => {
  it("returns fallback when returnUrl is missing", () => {
    expect(getValidAuthRedirectUrl(undefined, "/chat")).toBe("/chat");
  });

  it("returns relative returnUrl when it is safe", () => {
    expect(getValidAuthRedirectUrl("/accept-invitation/invite_123", "/chat")).toBe(
      "/accept-invitation/invite_123",
    );
  });

  it("returns fallback for external origins", () => {
    expect(getValidAuthRedirectUrl("https://evil.example/attack", "/chat")).toBe(
      "/chat",
    );
  });

  it("returns fallback for unsupported protocols", () => {
    expect(getValidAuthRedirectUrl("javascript:alert('x')", "/chat")).toBe(
      "/chat",
    );
  });
});
