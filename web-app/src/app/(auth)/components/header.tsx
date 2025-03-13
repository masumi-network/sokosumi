import MainNavigation from "@/components/main-navigation";
import { SokosumiLogo } from "@/components/masumi-logos";

import AuthButton from "./auth-button";

export default function Header() {
  return (
    <div
      id="header"
      className="border-b-accent-foreground w-full border-b-2 px-4 py-6 lg:px-8"
    >
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <MainNavigation />

        {/* Right - Auth Button */}
        <AuthButton />
      </div>
    </div>
  );
}
