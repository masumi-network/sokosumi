import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { beforeEach, vi } from "vitest";

import type {
  AuthCaptcha,
  AuthCaptchaEntry,
  CaptchaFetchOptions,
} from "@/components/auth-captcha";

export const requestCaptchaMock =
  vi.fn<() => Promise<CaptchaFetchOptions | null>>();
export const captchaErrorMessageMock = vi.fn<AuthCaptcha["getErrorMessage"]>();
export const captchaEntries: AuthCaptchaEntry[] = [];

export const captchaFetchOptions: CaptchaFetchOptions = {
  headers: { [AUTH_CAPTCHA_HEADER]: "verified-token" },
};

export function useAuthCaptcha(entry: AuthCaptchaEntry): AuthCaptcha {
  captchaEntries.push(entry);
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
  captchaEntries.length = 0;
  requestCaptchaMock.mockReset().mockResolvedValue(captchaFetchOptions);
  captchaErrorMessageMock
    .mockReset()
    .mockImplementation((_error, fallback) => fallback);
});
