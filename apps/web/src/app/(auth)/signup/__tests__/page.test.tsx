import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookiesMock = vi.fn();
const getMock = vi.fn();
const socialButtonsMock = vi.fn();
const signUpFormMock = vi.fn();
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

vi.mock("../components/form", () => ({
  __esModule: true,
  default: (props: unknown) => {
    signUpFormMock(props);
    return <div data-testid="sign-up-form" />;
  },
}));

vi.mock("../components/header", () => ({
  __esModule: true,
  default: () => <div data-testid="sign-up-header" />,
}));

describe("SignUp page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockReturnValue({ value: "magic-link" });
    cookiesMock.mockResolvedValue({
      get: getMock,
    });
    getEnvSecretsMock.mockReturnValue({
      NETWORK: "Preprod",
      VERCEL_GIT_COMMIT_REF: "feature/123",
      VERCEL_ENV: "preview",
    });
  });

  it("reads the last-login cookie using the configured preview prefix", async () => {
    const { default: SignUpPage } = await import("../page");

    render(
      await SignUpPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(getMock).toHaveBeenCalledWith(
      "sokosumi-preview-preprod-feature-123.last_used_login_method",
    );
  });
});
