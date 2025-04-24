import { BreadcrumbNavigation } from "@/components/breadcrumb-navigation";
import { cn } from "@/lib/utils";

import CustomTrigger from "./sidebar/components/custom-trigger";
import UserAvatar from "./user-avatar";
import UserCredits from "./user-credits";

interface HeaderProps {
  className?: string | undefined;
}

export default function Header({ className }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-background/95 sticky top-0 z-50 flex w-full items-center gap-2 border-b px-4 py-3",
        className,
      )}
    >
      <CustomTrigger when="invisible" />
      <BreadcrumbNavigation className="flex flex-1 px-2 sm:px-4" />
      <UserCredits />
      <UserAvatar />
    </header>
  );
}
