import { MobileLeftPanel } from "./left-panel";
import MainNav from "./main-nav";
import MobileNav from "./mobile-nav";
import UserAvatar from "./user-avatar";

export default function AppHeader() {
  return (
    <header className="border-grid sticky top-0 z-50 h-[64px] w-full border-b bg-background/95 px-4 py-3">
      <div className="flex w-full items-center">
        <MainNav />
        <MobileLeftPanel />
        <MobileNav />
        <UserAvatar />
      </div>
    </header>
  );
}
