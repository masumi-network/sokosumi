import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CAPTCHA_PASS } from "@/test/auth-captcha-mock";

import { EmailStep } from "./email-step";

const emailStatusMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string) => key;
    t.has = () => true;
    return t;
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    $fetch: (...args: unknown[]) => emailStatusMock(...args),
  },
}));

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));

function renderStep(onContinue = vi.fn()) {
  render(
    <EmailStep
      defaultEmail=""
      emailLocked={false}
      autoFocus={false}
      autoComplete="username webauthn"
      captchaEntry="signin"
      detour={{
        title: "title",
        description: "description",
        label: "Create account",
        href: "/signup",
        follow: vi.fn(),
      }}
      onFormStart={vi.fn()}
      onContinue={onContinue}
    />,
  );
  return onContinue;
}

async function continueWith(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("label"), email);
  await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
}

describe("EmailStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  // Sign-in opens on the password for it, rather than emailing a code.
  it("tells Continue whether the account has a password", async () => {
    emailStatusMock.mockResolvedValue({
      data: { exists: true, hasPassword: true, captchaPass: CAPTCHA_PASS },
      error: null,
    });
    const onContinue = renderStep();

    await continueWith("ada@example.com");

    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith(
        "ada@example.com",
        expect.any(AbortSignal),
        { hasPassword: true, captchaPass: CAPTCHA_PASS },
      ),
    );
  });

  it("tells Continue an account without a password has none", async () => {
    emailStatusMock.mockResolvedValue({
      data: { exists: true, hasPassword: false, captchaPass: CAPTCHA_PASS },
      error: null,
    });
    const onContinue = renderStep();

    await continueWith("ada@example.com");

    await waitFor(() =>
      expect(onContinue).toHaveBeenCalledWith(
        "ada@example.com",
        expect.any(AbortSignal),
        { hasPassword: false, captchaPass: CAPTCHA_PASS },
      ),
    );
  });
});
