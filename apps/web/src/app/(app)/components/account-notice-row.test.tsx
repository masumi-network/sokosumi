import { describe, expect, it, vi } from "vitest";

import { getAccountNoticeEmphasis } from "@/app/components/account-notice-row";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({ authClient: {} }));

describe("getAccountNoticeEmphasis", () => {
  it("fills email verification in the warning tone, because paid features are locked", () => {
    expect(
      getAccountNoticeEmphasis({
        type: "emailVerification",
        tone: "warning",
        email: "a@example.com",
      }),
    ).toBe("filled-warning");
  });

  it("fills no credits in the destructive tone, because work has stopped", () => {
    expect(
      getAccountNoticeEmphasis({
        type: "outOfCredits",
        tone: "destructive",
        path: "/billing?tab=credits",
      }),
    ).toBe("filled-destructive");
  });

  it("only marks low credits, because work still runs", () => {
    expect(
      getAccountNoticeEmphasis({
        type: "lowCredits",
        tone: "warning",
        path: "/billing?tab=credits",
      }),
    ).toBe("marked");
  });
});
