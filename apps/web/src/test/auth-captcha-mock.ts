import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { createElement } from "react";
import { beforeEach, vi } from "vitest";

import type {
  AuthCaptcha,
  AuthCaptchaEntry,
  CaptchaFetchOptions,
} from "@/components/auth-captcha";

export const requestCaptchaMock =
  vi.fn<() => Promise<CaptchaFetchOptions | null>>();
export const captchaErrorMessageMock = vi.fn<AuthCaptcha["getErrorMessage"]>();

export const captchaFetchOptions: CaptchaFetchOptions = {
  headers: { [AUTH_CAPTCHA_HEADER]: "verified-token" },
};

export function useAuthCaptcha(entry: AuthCaptchaEntry): AuthCaptcha {
  return {
    // Marks where the page puts its Security check.
    widget: createElement("div", { "data-testid": `auth-captcha-${entry}` }),
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
