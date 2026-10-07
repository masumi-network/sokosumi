import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirectMock, getSessionMock, requestHeaders } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  getSessionMock: vi.fn(),
  requestHeaders: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => requestHeaders.get(name) ?? null,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/auth.server", () => ({
  getSession: () => getSessionMock(),
}));
vi.mock("@/i18n/client-message-boundary", () => ({
  ClientMessageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@/components/masumi-logos", () => ({
  SokosumiLogo: () => null,
  ThemedLogo: () => null,
}));
vi.mock("./components/auth-background", () => ({
  __esModule: true,
  default: () => null,
}));

import AuthLayout from "./layout";

async function renderAt(pathname: string) {
  requestHeaders.set("x-pathname", pathname);
  render(await AuthLayout({ children: <p>page</p> }));
}

describe("AuthLayout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestHeaders.clear();
    getSessionMock.mockResolvedValue({ user: { id: "user_1" } });
  });

  it("sends a signed-in person away from sign-in", async () => {
    await renderAt("/signin");

    expect(redirectMock).toHaveBeenCalledOnce();
  });

  // Someone who signed in with a code because they forgot the password must
  // still be able to set a new one from the emailed link.
  it.each(["/forgot-password", "/reset-password"])(
    "lets a signed-in person use %s",
    async (pathname) => {
      await renderAt(pathname);

      expect(redirectMock).not.toHaveBeenCalled();
      expect(screen.getByText("page")).toBeInTheDocument();
    },
  );
});
