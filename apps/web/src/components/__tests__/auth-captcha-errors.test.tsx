import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import {
  AuthCaptchaProvider,
  useAuthCaptcha,
} from "@/components/auth-captcha-provider";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({}),
}));

const catalogs = { en, de, es };

function ErrorMessage({ code, message }: { code: string; message?: string }) {
  const { getErrorMessage } = useAuthCaptcha();
  return <p>{getErrorMessage({ code }, message ?? "Fallback error")}</p>;
}

describe.each(["en", "de", "es"] as const)("captcha errors in %s", (locale) => {
  it.each([
    ["VERIFICATION_FAILED", "verificationFailed"],
    ["MISSING_RESPONSE", "missingResponse"],
    ["UNKNOWN_ERROR", "requestFailed"],
  ] as const)(
    "translates %s instead of exposing the server message",
    (code, key) => {
      render(
        <NextIntlClientProvider locale={locale} messages={catalogs[locale]}>
          <AuthCaptchaProvider>
            <ErrorMessage code={code} message="Server English error" />
          </AuthCaptchaProvider>
        </NextIntlClientProvider>,
      );
      expect(
        screen.getByText(catalogs[locale].Components.AuthCaptcha[key]),
      ).toBeInTheDocument();
      expect(
        screen.queryByText("Server English error"),
      ).not.toBeInTheDocument();
    },
  );
});

it.each(["Existing error", undefined])(
  "preserves unrelated error handling (%s)",
  (message) => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <AuthCaptchaProvider>
          <ErrorMessage code="INVALID_EMAIL_OR_PASSWORD" message={message} />
        </AuthCaptchaProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(message ?? "Fallback error")).toBeInTheDocument();
  },
);
