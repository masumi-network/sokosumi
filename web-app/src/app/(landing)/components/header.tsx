import { ChevronDown } from "lucide-react";
import Link from "next/link";

import { SokosumiLogo } from "@/components/masumi-logos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Header() {
  return (
    <div id="header" className="w-full px-4 py-6 lg:px-8">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <Navigation />

        {/* Right - Auth Buttons */}
        <AuthButtons />
      </div>
    </div>
  );
}

export function AuthButtons() {
  return (
    <div className="flex items-center gap-4">
      <Link href="/signin">
        <Button variant="outline">Sign In</Button>
      </Link>
      <Link href="/signup">
        <Button>Sign Up</Button>
      </Link>
    </div>
  );
}

function Navigation({
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
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          Agents Gallery
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="#how-it-works"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          How it works
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="#join-our-community"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          Community
          <ChevronDown className="h-4 w-4" />
        </Link>
        <Link
          href="#monetize"
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          Monetize
          <ChevronDown className="h-4 w-4" />
        </Link>
      </nav>
    </div>
  );
}
