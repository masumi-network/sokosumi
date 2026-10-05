import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { beforeEach, vi } from "vitest";

import type {
  AuthCaptcha,
  AuthCaptchaEntry,
  CaptchaFetchOptions,
} from "@/components/auth-captcha";

// The pass needs no widget, so tests keep the real one.
export const { runWithCaptchaPass } = await vi.importActual<
  typeof import("@/components/auth-captcha")
>("@/components/auth-captcha");

export const requestCaptchaMock =
  vi.fn<() => Promise<CaptchaFetchOptions | null>>();
export const captchaErrorMessageMock = vi.fn<AuthCaptcha["getErrorMessage"]>();

export const captchaFetchOptions: CaptchaFetchOptions = {
  headers: { [AUTH_CAPTCHA_HEADER]: "verified-token" },
};

/** What Core's email status answer carries for the code sent next. */
export const CAPTCHA_PASS = "pass_from-email-status";
export const captchaPassFetchOptions: CaptchaFetchOptions = {
  headers: { [AUTH_CAPTCHA_HEADER]: CAPTCHA_PASS },
};

export function useAuthCaptcha(_entry: AuthCaptchaEntry): AuthCaptcha {
  return {
    widget: null,
    async runWithCaptcha(action) {
      const options = await requestCaptchaMock();
      return options ? action(options) : null;
    },
    getErrorMessage: captchaErrorMessageMock,
  };
}

beforeEach(() => {
  requestCaptchaMock.mockReset().mockResolvedValue(captchaFetchOptions);
  captchaErrorMessageMock
    .mockReset()
    .mockImplementation((_error, fallback) => fallback);
});
