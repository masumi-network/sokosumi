import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import ThemeToggle from "@/components/theme-toggle";

import AppConnection from "./app-connection";
import HeaderBlur from "./header-blur";
import Navigation from "./navigation";
import SheetNavigation from "./sheet-navigation";

export default function Header() {
  return (
    <div
      id="header"
      className="bg-background/0 border-background/0 fixed top-0 z-50 w-full border-b py-3 lg:px-8 lg:py-6"
    >
      <HeaderBlur />
      <div className="relative z-10 container mx-auto flex items-center justify-between gap-6 px-12">
        {/* Left - Logo */}
        <Link href="/">
          <ThemedLogo
            LogoComponent={SokosumiLogo}
            width={200}
            height={26}
            priority
          />
        </Link>

        {/* Middle - Navigation Links */}
        <div className="absolute top-0 left-0 h-full w-full items-center justify-center">
          <Navigation />
        </div>

        {/* Right - Auth Buttons */}
        <div className="relative z-10 ml-auto hidden items-center gap-2 sm:flex">
          <AppConnection />
          <ThemeToggle />
        </div>

        {/* Sheet Navigation Trigger */}
        <div className="relative z-10 flex lg:hidden">
          <SheetNavigation />
        </div>
      </div>
    </div>
  );
}
