import { BreadcrumbOverrideProvider } from "@/contexts/breadcrumb-override-context";

import { AppHeaderFallback } from "./app-header-fallback";
import { AppMobileChrome } from "./app-mobile-chrome.client";
import { AppSidebarFallback } from "./app-sidebar-fallback";

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
              <AppMobileChrome>{children}</AppMobileChrome>
            </div>
          </main>
        </div>
      </div>
    </BreadcrumbOverrideProvider>
  );
}
