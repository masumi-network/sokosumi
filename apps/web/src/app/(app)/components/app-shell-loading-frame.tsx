import { AccountNoticeProvider } from "@/contexts/account-notice-provider";
import { BreadcrumbOverrideProvider } from "@/contexts/breadcrumb-override-context";
import { NotificationFallbackProvider } from "@/contexts/notification-provider";
import { OrganizationSeatProvider } from "@/contexts/organization-seat-context";
import { cn } from "@/lib/utils";

import { AppHeaderFallback } from "./app-header-fallback";
import { AppMobileChrome } from "./app-mobile-chrome.client";
import {
  APP_MAIN_MOBILE_PT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
  APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
} from "./app-shell-safe-area";
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
          <AppHeaderFallback className="px-4 py-3 md:px-4 md:py-0" />
          <main
            className={cn(
              "relative flex max-h-svh min-h-svh flex-1 flex-col overflow-x-hidden overflow-y-auto p-4 md:pt-4",
              APP_MAIN_MOBILE_PT_CLASS,
              APP_SHELL_BELOW_HEADER_MD_MIN_HEIGHT_CLASS,
              APP_SHELL_BELOW_HEADER_MD_MAX_HEIGHT_CLASS,
            )}
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
                  <OrganizationSeatProvider hasAssignedSeat={false}>
                    <AppMobileChrome>{children}</AppMobileChrome>
                  </OrganizationSeatProvider>
                </NotificationFallbackProvider>
              </AccountNoticeProvider>
            </div>
          </main>
        </div>
      </div>
    </BreadcrumbOverrideProvider>
  );
}
