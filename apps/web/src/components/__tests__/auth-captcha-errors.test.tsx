import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import { useAuthCaptcha } from "@/components/auth-captcha";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({}),
}));
vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

const catalogs = { en, de, es };

function ErrorMessage({ code, message }: { code: string; message?: string }) {
  const { getErrorMessage } = useAuthCaptcha("signin");
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
          <ErrorMessage code={code} message="Server English error" />
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
        <ErrorMessage code="INVALID_EMAIL_OR_PASSWORD" message={message} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(message ?? "Fallback error")).toBeInTheDocument();
  },
);
