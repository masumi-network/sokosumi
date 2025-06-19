import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { cn } from "@/lib/utils";

import AppConnection from "./app-connection";
import Navigation from "./navigation";

interface HeaderProps {
  className?: string;
}

export default function Header({ className }: HeaderProps) {
  return (
    <header
      id="header"
      className={cn(
        "border-background/0 bg-background/0 supports-[backdrop-filter]:bg-background/5 fixed top-0 z-50 w-full border-b px-4 backdrop-blur transition-colors duration-200 lg:px-8",
        className,
      )}
    >
      <div className="container mx-auto flex h-full items-center justify-between gap-4 px-0 sm:gap-6 sm:px-6 lg:px-0">
        {/* Left - Logo */}
        <Link href="/">
          <ThemedLogo LogoComponent={SokosumiLogo} priority />
        </Link>

        {/* Middle - Navigation Links */}
        <div className="flex flex-1 items-center justify-center">
          <Navigation />
        </div>

        {/* Right - Auth Buttons */}
        <div className="ml-auto flex items-center gap-2">
          <AppConnection />
        </div>
      </div>
    </header>
  );
}
