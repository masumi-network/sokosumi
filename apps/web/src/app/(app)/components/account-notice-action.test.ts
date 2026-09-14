import { describe, expect, it, vi } from "vitest";

import { getAccountNoticePath } from "@/app/components/account-notice-action";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));

describe("getAccountNoticePath", () => {
  it("sends email verification to the notifications page, which hosts the security check", () => {
    expect(
      getAccountNoticePath({
        type: "emailVerification",
        tone: "warning",
        email: "person@example.com",
      }),
    ).toBe("/notifications");
  });

  it("keeps credit notices on their own path", () => {
    expect(
      getAccountNoticePath({
        type: "outOfCredits",
        tone: "destructive",
        path: "/account?tab=credits",
      }),
    ).toBe("/account?tab=credits");
  });
});
