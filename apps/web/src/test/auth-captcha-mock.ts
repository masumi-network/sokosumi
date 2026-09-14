import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { beforeEach, vi } from "vitest";

import type {
  AuthCaptcha,
  CaptchaFetchOptions,
} from "@/components/auth-captcha-provider";

export const requestCaptchaMock =
  vi.fn<() => Promise<CaptchaFetchOptions | null>>();
export const captchaErrorMessageMock = vi.fn<AuthCaptcha["getErrorMessage"]>();

export const captchaFetchOptions: CaptchaFetchOptions = {
  headers: { [AUTH_CAPTCHA_HEADER]: "verified-token" },
};

export function useAuthCaptcha(): AuthCaptcha {
  return {
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
