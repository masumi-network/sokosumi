import { UserAvatar } from "@/components/user-avatar";

import { MainNav } from "./main-nav";
import { MobileNav } from "./mobile-nav";

export function AppHeader() {
  return (
    <header className="border-grid bg-background/95 sticky top-0 z-50 w-full border-b px-4 py-3">
      <div className="flex w-full items-center">
        <MainNav />
        <MobileNav />
        <UserAvatar />
      </div>
    </header>
  );
}
