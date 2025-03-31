import Link from "next/link";

import { SokosumiLogo } from "@/components/masumi-logos";
import { LandingRoute } from "@/types/routes";

import AppConnection from "./app-connection";
import Navigation from "./navigation";
import SheetNavigation from "./sheet-navigation";

export default function Header() {
  return (
    <div id="header" className="w-full px-4 py-3 lg:px-8 lg:py-6">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <Link href={LandingRoute.Home}>
          <SokosumiLogo width={200} height={26} priority />
        </Link>

        {/* Middle - Navigation Links */}
        <Navigation />

        {/* Right - Auth Buttons */}
        <div className="ml-auto hidden sm:flex">
          <AppConnection />
        </div>

        {/* Sheet Navigation Trigger */}
        <div className="flex lg:hidden">
          <SheetNavigation />
        </div>
      </div>
    </div>
  );
}
