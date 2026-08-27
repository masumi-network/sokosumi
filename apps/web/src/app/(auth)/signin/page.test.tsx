import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const socialButtonsMock = vi.fn();
const signInFormMock = vi.fn();
const getEnvSecretsMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

vi.mock("@/auth/components/divider", () => ({
  __esModule: true,
  default: () => <div data-testid="divider" />,
}));

vi.mock("@/auth/components/social-buttons", () => ({
  __esModule: true,
  default: (props: unknown) => {
    socialButtonsMock(props);
    return <div data-testid="social-buttons" />;
  },
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => getEnvSecretsMock(),
}));

vi.mock("./components/form", () => ({
  __esModule: true,
  default: (props: unknown) => {
    signInFormMock(props);
    return <div data-testid="sign-in-form" />;
  },
}));

vi.mock("./components/header", () => ({
  __esModule: true,
  default: () => <div data-testid="sign-in-header" />,
}));

describe("SignIn page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockReturnValue({ value: "passkey" });
    cookiesMock.mockResolvedValue({
      get: getMock,
    });
    getEnvSecretsMock.mockReturnValue({
      NETWORK: "Preprod",
      VERCEL_GIT_COMMIT_REF: "",
      VERCEL_ENV: undefined,
    });
  });

  it("reads the last-login cookie using the configured prefix", async () => {
    const { default: SignInPage } = await import("./page");

    render(
      await SignInPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(getMock).toHaveBeenCalledWith(
      "sokosumi-localhost-preprod.last_used_login_method",
    );
  });
});
