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
  getTranslations: async () => (key: string, values?: { product: string }) =>
    values ? `${key}:${values.product}` : key,
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
  default: () => <aside>Sokosumi pitch</aside>,
}));

import AuthLayout, { generateMetadata } from "./layout";

const CMO_REQUEST = `client_id=cmo&redirect_uri=${encodeURIComponent(
  "https://app.cmo.xyz/api/auth/callback/sokosumi",
)}&exp=1&sig=abc`;

async function renderAt(pathname: string, search = "") {
  requestHeaders.set("x-pathname", pathname);
  requestHeaders.set("x-search-params", search);
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

  it("holds the page in the main landmark, apart from the pitch", async () => {
    getSessionMock.mockResolvedValue(null);
    await renderAt("/signup");

    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByText("page"));
    expect(main).not.toContainElement(screen.getByText("Sokosumi pitch"));
  });

  it("names CMO.XYZ in the tab of a sign-in that came from CMO, and Sokosumi otherwise", async () => {
    requestHeaders.set("x-search-params", CMO_REQUEST);
    expect(await generateMetadata()).toMatchObject({
      title: {
        default: "Title.default:CMO.XYZ",
        template: "Title.template:CMO.XYZ",
      },
      icons: { icon: "/images/logos/cmo-xyz-icon.svg" },
    });

    requestHeaders.set("x-search-params", "client_id=other&exp=1&sig=abc");
    const sokosumi = await generateMetadata();
    expect(sokosumi.title).toEqual({
      default: "Title.default:Sokosumi",
      template: "Title.template:Sokosumi",
    });
    expect(sokosumi.icons).toBeUndefined();
  });

  it("links CMO's own imprint under a sign-in that came from CMO", async () => {
    await renderAt("/signin", CMO_REQUEST);
    expect(screen.getByRole("link", { name: "imprint" })).toHaveAttribute(
      "href",
      "https://www.cmo.xyz/imprint",
    );
    expect(screen.queryByText("usesSokosumi")).not.toBeInTheDocument();
  });

  it("leaves Sokosumi's pitch out when signing in for another product", async () => {
    await renderAt("/signin", "client_id=cmo&exp=1&sig=abc");
    expect(screen.queryByText("Sokosumi pitch")).not.toBeInTheDocument();

    getSessionMock.mockResolvedValue(null);
    await renderAt("/signin");
    expect(screen.getByText("Sokosumi pitch")).toBeInTheDocument();
  });
});
