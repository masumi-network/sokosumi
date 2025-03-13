import { cn } from "@/lib/utils";

import NavigationMenu from "./navigation-menu";

export default function Navigation({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn("flex items-center gap-x-4 lg:gap-x-6", className)}
      {...props}
    >
      <NavigationMenu className="flex-row items-center gap-x-4 lg:gap-x-6" />
    </nav>
  );
}
