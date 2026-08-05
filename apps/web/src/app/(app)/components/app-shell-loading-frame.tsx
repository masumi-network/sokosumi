import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import { BreadcrumbOverrideProvider } from "@/contexts/breadcrumb-override-context";
import { NotificationFallbackProvider } from "@/contexts/notification-provider";

import { AppHeaderFallback } from "./app-header-fallback";
import { AppMobileChrome } from "./app-mobile-chrome.client";
import { AppSidebarFallback } from "./app-sidebar-fallback";

/** Stub session id for Instant Nav Suspense fallback (not a real session). */
const INSTANT_NAV_SHELL_FALLBACK_SESSION_ID = "instant-nav-shell-fallback";

interface AppShellLoadingFrameProps {
  children: React.ReactNode;
}

export function AppShellLoadingFrame({ children }: AppShellLoadingFrameProps) {
  return (
    <BreadcrumbOverrideProvider>
      <AppSidebarFallback />
      <div className="flex min-w-0 flex-1 overflow-clip" data-app-content>
        <div
          className="flex min-w-0 flex-1 flex-col overflow-clip"
          data-app-content-inner
        >
          <AppHeaderFallback className="h-16 p-4" />
          <main
            className="relative flex max-h-svh min-h-svh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 pt-20 md:max-h-[calc(100svh-64px)] md:min-h-[calc(100svh-64px)] md:pt-4"
            data-app-main
          >
            <div
              className="flex min-h-full flex-1 flex-col overflow-visible"
              data-app-main-inner
            >
              <AccountNoticeProvider
                notice={null}
                sessionId={INSTANT_NAV_SHELL_FALLBACK_SESSION_ID}
              >
                <NotificationFallbackProvider>
                  <AppMobileChrome>{children}</AppMobileChrome>
                </NotificationFallbackProvider>
              </AccountNoticeProvider>
            </div>
          </main>
        </div>
      </div>
    </BreadcrumbOverrideProvider>
  );
}
