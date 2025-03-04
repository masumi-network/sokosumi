import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function MainNav({
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <div className="flex items-center gap-8">
      <nav
      className={cn("flex items-center space-x-4 lg:space-x-6", className)}
      {...props}
    >
        <Link
          href="#agents-gallery"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary inline-flex items-center gap-1"
        >
          Agents Gallery
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="#how-it-works"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary inline-flex items-center gap-1"
        >
          How it works
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="#contribute"
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary inline-flex items-center gap-1"
        >
          Contribute
          <ChevronDown className="h-4 w-4" />
        </Link>
      </nav>
    </div>
  );
}
