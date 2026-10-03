import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignUpFlow from "./sign-up-flow";

const signUpMock = vi.fn();
const finishAuthMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.has = () => true;
    return t;
  },
}));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    $fetch: vi.fn().mockResolvedValue({
      data: { exists: false, hasPassword: false },
      error: null,
    }),
    emailOtp: {
      sendVerificationOtp: vi
        .fn()
        .mockResolvedValue({ data: { success: true }, error: null }),
    },
    // A password sign-up goes through the email code.
    signIn: { emailOtp: (...args: unknown[]) => signUpMock(...args) },
  },
}));
vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
vi.mock("@/lib/actions/auth/action", () => ({ handleUtmConversion: vi.fn() }));
vi.mock("@/lib/auth/finish-auth.client", () => ({
  finishAuthInPlace: (...args: unknown[]) => finishAuthMock(...args),
}));
vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: { viewRegisterArea: vi.fn(), registerFormStart: vi.fn() },
}));
vi.mock("@/auth/components/social-buttons", () => ({ default: () => null }));

async function submitDetails() {
  const user = userEvent.setup();
  render(<SignUpFlow lastUsedMethod={null} />);
  await user.type(screen.getByLabelText("label"), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
  await user.type(await screen.findByLabelText("firstNameLabel"), "Ada");
  await user.type(screen.getByLabelText("lastNameLabel"), "Lovelace");
  await user.click(screen.getByRole("button", { name: "addPassword" }));
  await user.type(
    screen.getByLabelText("Fields.Password.label"),
    "password123",
  );
  await user.type(screen.getByRole("textbox", { name: "codeLabel" }), "042917");
  await waitFor(() =>
    expect(signUpMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ otp: "042917", password: "password123" }),
    ),
  );
  return user;
}

describe("SignUpFlow submission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the confirmed email visible during signup, then unlocks change on rejection", async () => {
    const pending = Promise.withResolvers<{
      data: null;
      error: { message: string };
    }>();
    signUpMock.mockReturnValueOnce(pending.promise);
    const user = await submitDetails();
    const changeEmail = screen.getByRole("button", { name: "changeEmail" });

    expect(changeEmail).toBeDisabled();
    await user.click(changeEmail);
    expect(screen.getByLabelText("firstNameLabel")).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "label" }),
    ).not.toBeInTheDocument();

    pending.resolve({ data: null, error: { message: "Retry signup" } });
    await waitFor(() => expect(changeEmail).toBeEnabled());
    await user.click(changeEmail);
    expect(screen.getByLabelText("label")).toHaveValue("ada@example.com");
    expect(finishAuthMock).not.toHaveBeenCalled();
  });

  it("keeps change locked after signup succeeds while authentication finishes", async () => {
    const pending = Promise.withResolvers<{
      data: { user: { email: string } };
      error: null;
    }>();
    signUpMock.mockReturnValueOnce(pending.promise);
    const finishing = Promise.withResolvers<void>();
    finishAuthMock.mockReturnValueOnce(finishing.promise);
    await submitDetails();
    pending.resolve({
      data: { user: { email: "ada@example.com" } },
      error: null,
    });
    await waitFor(() => expect(finishAuthMock).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "changeEmail" })).toBeDisabled();
    finishing.resolve();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "submit" })).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "changeEmail" })).toBeDisabled();
  });
});
