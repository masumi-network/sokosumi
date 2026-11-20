import { act } from "@testing-library/react";
import { HeadManagerContext } from "next/dist/shared/lib/head-manager-context.shared-runtime";
import type { ReactNode } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const usePathnameMock = vi.fn<() => string>();
const googleTagManagerMock = vi.fn();
const googleAnalyticsMock = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  getTraceData: () => ({}),
}));

vi.mock("next/font/google", () => ({
  Inter: () => ({ className: "font-inter", variable: "--font-inter" }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => usePathnameMock(),
}));

vi.mock("nuqs/adapters/next/app", () => ({
  NuqsAdapter: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@next/third-parties/google", () => ({
  GoogleTagManager: (props: { gtmId: string }) => {
    googleTagManagerMock(props);
    return null;
  },
  GoogleAnalytics: (props: { gaId: string }) => {
    googleAnalyticsMock(props);
    return null;
  },
}));

vi.mock("@/components/analytics/analytics-user-id", () => ({
  AnalyticsUserId: () => null,
}));

vi.mock("@/components/analytics/client-analytics", () => ({
  ClientAnalytics: () => null,
}));

vi.mock("@/components/analytics/cookie-banner", () => ({
  CookieBanner: () => null,
}));

vi.mock("@/components/deployment-refresh-handler", () => ({
  DeploymentRefreshHandler: () => null,
}));

vi.mock("@/components/dynamic-type-root-cap", () => ({
  DynamicTypeRootCap: () => null,
}));

vi.mock("@/components/navigation-progress.client", () => ({
  NavigationProgress: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/contexts/theme-context", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("./components/root-intl-tree", () => ({
  RootIntlTree: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({
    NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID: "GTM-TEST",
    NEXT_PUBLIC_GOOGLE_ANALYTICS_ID: "G-TEST",
  }),
}));

import RootLayout from "./layout";

function hydrateRootLayout(pathname: string) {
  usePathnameMock.mockReturnValue(pathname);

  const tree = (
    <HeadManagerContext.Provider value={{ appDir: true }}>
      <RootLayout>
        <main>content</main>
      </RootLayout>
    </HeadManagerContext.Provider>
  );

  const html = renderToString(tree);
  const doc = document.implementation.createHTMLDocument();
  doc.open();
  doc.write(`<!doctype html>${html}`);
  doc.close();

  let root: ReturnType<typeof hydrateRoot> | undefined;
  act(() => {
    root = hydrateRoot(doc, tree);
  });

  return {
    doc,
    unmount: () => {
      act(() => {
        root?.unmount();
      });
    },
  };
}

describe("RootLayout", () => {
  let unmount: (() => void) | undefined;

  beforeEach(() => {
    usePathnameMock.mockReset();
    googleTagManagerMock.mockReset();
    googleAnalyticsMock.mockReset();
  });

  afterEach(() => {
    unmount?.();
    unmount = undefined;
  });

  it("renders ConsentModeInit inside <body> without React script/html hydration errors", () => {
    const view = hydrateRootLayout("/agents");
    unmount = view.unmount;

    expect(
      Array.from(view.doc.documentElement.children).map((el) => el.tagName),
    ).toEqual(["HEAD", "BODY"]);

    const scriptsInBody = Array.from(view.doc.body.querySelectorAll("script"));
    expect(
      scriptsInBody.some((script) =>
        script.textContent?.includes("sokosumi-consent-default"),
      ),
    ).toBe(true);
    expect(googleTagManagerMock).toHaveBeenCalledWith({ gtmId: "GTM-TEST" });
    expect(googleAnalyticsMock).toHaveBeenCalledWith({ gaId: "G-TEST" });
  });

  it("omits ConsentModeInit and GoogleTags on blocked telemetry routes", () => {
    const view = hydrateRootLayout("/reset-password");
    unmount = view.unmount;

    const scripts = Array.from(view.doc.querySelectorAll("script"));
    expect(
      scripts.some((script) =>
        script.textContent?.includes("sokosumi-consent-default"),
      ),
    ).toBe(false);
    expect(googleTagManagerMock).not.toHaveBeenCalled();
    expect(googleAnalyticsMock).not.toHaveBeenCalled();
  });
});
