import type { Account } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { SocialAccounts } from "./social-accounts";

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    linkSocial: vi.fn(),
  },
}));

const googleAccount: Account = {
  accountId: "google-account",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "account-google",
  providerId: "google",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

function setup(accounts: Account[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SocialAccounts accounts={accounts} />
    </NextIntlClientProvider>,
  );
}

describe("SocialAccounts", () => {
  it("names each provider in the row", () => {
    setup([googleAccount]);

    expect(screen.getByText("Google is connected")).toBeVisible();
    expect(screen.getByText("Microsoft is not connected")).toBeVisible();
  });
});
