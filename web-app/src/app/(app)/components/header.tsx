import { cn } from "@/lib/utils";

import CustomTrigger from "./app-sidebar/components/custom-trigger";
import MainNav from "./main-nav";
import MobileNav from "./mobile-nav";
import UserAvatar from "./user-avatar";

interface HeaderProps {
  className?: string;
}

export default function Header({ className = "h-[64px]" }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid sticky top-0 z-50 flex w-full items-center border-b bg-background/95 px-4 py-3",
        className,
      )}
    >
      <CustomTrigger when="invisible" />
      <MainNav />
      <MobileNav />
      <UserAvatar />
    </header>
  );
}
