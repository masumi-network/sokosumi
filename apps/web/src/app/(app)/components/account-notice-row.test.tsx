import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import {
  AccountNoticeRow,
  getAccountNoticeEmphasis,
} from "@/app/components/account-notice-row";
import { PageSearchRows } from "@/components/page-list-search";
import { SearchablePageContent } from "@/components/searchable-page-content";
import { AccountNoticeProvider } from "@/contexts/account-notice-provider";

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

it("counts the translated account request once on the page while the bell keeps its own notice", () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <AccountNoticeProvider
        notice={{
          type: "emailVerification",
          tone: "warning",
          email: "person@example.com",
        }}
        sessionId="session"
      >
        <SearchablePageContent>
          <PageSearchRows rows={[]} />
          <AccountNoticeRow variant="page" />
        </SearchablePageContent>
        <aside aria-label="Bell">
          <AccountNoticeRow variant="panel" />
        </aside>
      </AccountNoticeProvider>
    </NextIntlClientProvider>,
  );
  const field = screen.getByRole("searchbox");
  for (const query of ["verify your email", "paid account features"]) {
    fireEvent.change(field, { target: { value: query } });
    expect(screen.getByRole("status")).toHaveTextContent("1 match");
    expect(
      screen.getByRole("button", { name: "Resend verification email" }),
    ).toBeVisible();
  }
  fireEvent.change(field, { target: { value: "unrelated" } });
  expect(screen.getByRole("status")).toHaveTextContent("No matches");
  expect(
    screen.queryByRole("button", { name: "Resend verification email" }),
  ).toBeNull();
  expect(
    within(screen.getByRole("complementary", { name: "Bell" })).getByText(
      "Verify your email address",
    ),
  ).toBeVisible();
});
