import type { Account } from "@sokosumi/utils";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import DisconnectModal from "./disconnect-modal";

vi.mock("next/navigation", () => ({
  usePathname: () => "/connections",
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    unlinkAccount: vi.fn(),
  },
  useSession: () => ({
    data: { user: { email: "owner@example.com" } },
  }),
}));

const googleAccount: Account = {
  accountId: "google-account",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "account-google",
  providerId: "google",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

describe("DisconnectModal names", () => {
  it("uses the brand name, not the provider id", () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <DisconnectModal
          account={googleAccount}
          accounts={[googleAccount]}
          open
          setOpen={vi.fn()}
        />
      </NextIntlClientProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Disconnect Google" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Are you sure you want to disconnect your Google account?",
      ),
    ).toBeVisible();
    expect(screen.getByRole("dialog").textContent).not.toMatch(/\bgoogle\b/);
  });
});
