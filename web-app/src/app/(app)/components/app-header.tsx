import CustomTrigger from "./app-sidebar/components/custom-trigger";
import MainNav from "./main-nav";
import MobileNav from "./mobile-nav";
import UserAvatar from "./user-avatar";

export default function AppHeader() {
  return (
    <header className="border-grid sticky top-0 z-50 flex h-[64px] w-full items-center border-b bg-background/95 px-4 py-3">
      <div className="flex w-full items-center">
        <CustomTrigger when="invisible" />
        <MainNav />
        <MobileNav />
        <UserAvatar />
      </div>
    </header>
  );
}
