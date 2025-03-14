import { SokosumiLogo } from "@/components/masumi-logos";

import AuthButtons from "./auth-buttons";
import Navigation from "./navigation";
import SheetNavigation from "./sheet-navigation";

export default function Header() {
  return (
    <div id="header" className="w-full px-4 py-3 lg:px-8 lg:py-6">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <Navigation />

        {/* Right - Auth Buttons */}
        <div className="ml-auto hidden sm:block">
          <AuthButtons />
        </div>

        {/* Sheet Navigation Trigger */}
        <SheetNavigation />
      </div>
    </div>
  );
}
