import { cn } from "@/lib/utils";

import SheetNavigation from "./sheet-navigation";
import CustomTrigger from "./sidebar/components/custom-trigger";
import StickyNavigation from "./sticky-navigation";
import UserAvatar from "./user-avatar";

interface HeaderProps {
  className?: string;
}

export default function Header({ className = "h-[64px]" }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-background/95 sticky top-0 z-50 flex w-full items-center border-b px-4 py-3",
        className,
      )}
    >
      <CustomTrigger when="invisible" />
      <StickyNavigation />
      <SheetNavigation />
      <UserAvatar />
    </header>
  );
}
